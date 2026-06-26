import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

// In-memory store: roomId → { users: Map<socketId, { name, vote, spectator }>, revealed: boolean }
const rooms = new Map();

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

app.use(express.static(join(__dirname, "public")));

// Serve room page for any /room/:id route
app.get("/room/:id", (_req, res) => {
  res.sendFile(join(__dirname, "public", "room.html"));
});

// Create a new room and redirect
app.get("/create", (_req, res) => {
  const id = randomUUID();
  res.redirect(`/room/${id}`);
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
    io.to(roomId).emit("room-update", getRoomPayload(room));
  });

  socket.on("show-votes", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.revealed = true;
    io.to(roomId).emit("room-update", getRoomPayload(room));
  });

  socket.on("reset-votes", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    for (const user of room.users.values()) {
      user.vote = null;
    }
    room.revealed = false;
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
