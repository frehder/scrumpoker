import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const STATS_DIR = join(__dirname, "data");
const STATS_FILE = join(STATS_DIR, "stats.json");

// In-memory store: roomId → { users: Map<socketId, { name, vote, spectator }>, revealed: boolean }
const rooms = new Map();

function defaultStats() {
  return {
    totals: {
      landingViews: 0,
      roomViews: 0,
      roomsCreated: 0,
      roomJoins: 0,
      votesSubmitted: 0,
      votesRevealed: 0,
      votesReset: 0,
    },
    byDay: {},
    updatedAt: new Date().toISOString(),
  };
}

function loadStats() {
  try {
    const raw = readFileSync(STATS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultStats(),
      ...parsed,
      totals: {
        ...defaultStats().totals,
        ...(parsed?.totals ?? {}),
      },
      byDay: parsed?.byDay ?? {},
    };
  } catch {
    return defaultStats();
  }
}

let stats = loadStats();
let saveTimer = null;
let statsWriteWarningShown = false;

function saveStatsNow() {
  try {
    mkdirSync(STATS_DIR, { recursive: true });
    stats.updatedAt = new Date().toISOString();
    writeFileSync(STATS_FILE, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
    statsWriteWarningShown = false;
  } catch (error) {
    if (!statsWriteWarningShown) {
      console.warn("Unable to persist usage stats to disk:", error.message);
      statsWriteWarningShown = true;
    }
  }
}

function saveStatsSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStatsNow();
  }, 500);
}

function incrementStat(metric) {
  const day = new Date().toISOString().slice(0, 10);
  stats.totals[metric] = (stats.totals[metric] ?? 0) + 1;
  if (!stats.byDay[day]) {
    stats.byDay[day] = {
      landingViews: 0,
      roomViews: 0,
      roomsCreated: 0,
      roomJoins: 0,
      votesSubmitted: 0,
      votesRevealed: 0,
      votesReset: 0,
    };
  }
  stats.byDay[day][metric] = (stats.byDay[day][metric] ?? 0) + 1;
  saveStatsSoon();
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { users: new Map(), revealed: false });
  }
  return rooms.get(roomId);
}

function getRoomPayload(room) {
  return {
    users: Array.from(room.users.entries()).map(([id, u]) => ({
      id,
      name: u.name,
      spectator: u.spectator,
      vote: u.spectator ? null : room.revealed ? u.vote : u.vote !== null ? "hidden" : null,
    })),
    revealed: room.revealed,
  };
}

app.get("/", (_req, res) => {
  incrementStat("landingViews");
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.use(express.static(join(__dirname, "public")));

// Serve room page for any /room/:id route
app.get("/room/:id", (_req, res) => {
  incrementStat("roomViews");
  res.sendFile(join(__dirname, "public", "room.html"));
});

// Create a new room and redirect
app.get("/create", (_req, res) => {
  incrementStat("roomsCreated");
  const id = randomUUID();
  res.redirect(`/room/${id}`);
});

app.get("/admin", (_req, res) => {
  res.sendFile(join(__dirname, "public", "admin.html"));
});

app.get("/admin/stats", (_req, res) => {
  const byDay = Object.entries(stats.byDay)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, counts]) => ({ date, ...counts }));
  return res.json({
    totals: stats.totals,
    byDay,
    activeRooms: rooms.size,
    activeConnections: io.engine.clientsCount,
    updatedAt: stats.updatedAt,
  });
});

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("join-room", ({ roomId, name, spectator }) => {
    if (!roomId || !name) return;

    // Sanitise inputs
    const safeRoomId = String(roomId).slice(0, 64);
    const safeName = String(name).trim().slice(0, 32) || "Anonymous";

    const room = getOrCreateRoom(safeRoomId);
    room.users.set(socket.id, { name: safeName, vote: null, spectator: !!spectator });
    incrementStat("roomJoins");
    currentRoom = safeRoomId;

    socket.join(safeRoomId);
    io.to(safeRoomId).emit("room-update", getRoomPayload(room));
  });

  socket.on("vote", ({ roomId, vote }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    if (user.spectator) return; // spectators cannot vote
    if (room.revealed) return; // no voting after reveal

    const VALID_VOTES = [0, 0.5, 1, 2, 3, 5, 8, 13, "?", 9999];
    if (!VALID_VOTES.includes(vote)) return;

    user.vote = vote;
    incrementStat("votesSubmitted");
    io.to(roomId).emit("room-update", getRoomPayload(room));
  });

  socket.on("show-votes", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.revealed = true;
    incrementStat("votesRevealed");
    io.to(roomId).emit("room-update", getRoomPayload(room));
  });

  socket.on("reset-votes", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    for (const user of room.users.values()) {
      user.vote = null;
    }
    room.revealed = false;
    incrementStat("votesReset");
    io.to(roomId).emit("room-update", getRoomPayload(room));
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.users.delete(socket.id);

    if (room.users.size === 0) {
      rooms.delete(currentRoom);
    } else {
      io.to(currentRoom).emit("room-update", getRoomPayload(room));
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Scrum Poker running at http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveStatsNow();
    process.exit(0);
  });
}
