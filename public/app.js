const VOTE_OPTIONS = [0, 0.5, 1, 2, 3, 5, 8, 13, "?", 9999];

const roomId = location.pathname.split("/room/")[1];
if (!roomId) location.href = "/";

// ── DOM refs ──────────────────────────────────────────────────────────────
const nameModal       = document.getElementById("name-modal");
const nameForm        = document.getElementById("name-form");
const nameInput       = document.getElementById("name-input");
const spectatorInput  = document.getElementById("spectator-input");
const app             = document.getElementById("app");
const roomIdDisplay   = document.getElementById("room-id-display");
const copyBtn         = document.getElementById("copy-btn");
const playerList      = document.getElementById("player-list");
const cardDeck        = document.getElementById("card-deck");
const showBtn         = document.getElementById("show-btn");
const resetBtn        = document.getElementById("reset-btn");
const voteAverage     = document.getElementById("vote-average");

// ── State ─────────────────────────────────────────────────────────────────
let mySocketId   = null;
let myVote       = null;
let mySpectator  = false;
let roomRevealed = false;

// ── Socket ────────────────────────────────────────────────────────────────
const socket = io();

socket.on("connect", () => {
  mySocketId = socket.id;
});

socket.on("room-update", (room) => {
  roomRevealed = room.revealed;
  renderPlayers(room.users);
  renderDeck(room.revealed);
  renderAverage(room.users, room.revealed);
  showBtn.disabled  = room.revealed;
  showBtn.textContent = room.revealed ? "Votes Revealed" : "Show Votes";
});

// ── Name form ─────────────────────────────────────────────────────────────
nameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;

  mySpectator = spectatorInput.checked;
  socket.emit("join-room", { roomId, name, spectator: mySpectator });
  nameModal.classList.add("hidden");
  app.classList.remove("hidden");
  if (mySpectator) cardDeck.closest(".vote-section").classList.add("hidden");
  roomIdDisplay.textContent = roomId;
});

// ── Copy link ─────────────────────────────────────────────────────────────
copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(location.href).then(() => {
    const orig = copyBtn.textContent;
    copyBtn.textContent = "✅ Copied!";
    setTimeout(() => { copyBtn.textContent = orig; }, 1500);
  });
});

// ── Build card deck ───────────────────────────────────────────────────────
VOTE_OPTIONS.forEach((val) => {
  const card = document.createElement("button");
  card.className = "vote-card";
  card.textContent = val;
  card.dataset.value = val;

  card.addEventListener("click", () => {
    if (roomRevealed) return;
    // Toggle off if already selected
    if (myVote === val) return;
    myVote = val;
    socket.emit("vote", { roomId, vote: val });
    updateSelectedCard(val);
  });

  cardDeck.appendChild(card);
});

function updateSelectedCard(val) {
  document.querySelectorAll(".vote-card").forEach((c) => {
    // eslint-disable-next-line eqeqeq -- intentional loose equality for string/number comparison
    c.classList.toggle("selected", c.dataset.value == val);
  });
}

// ── Controls ──────────────────────────────────────────────────────────────
showBtn.addEventListener("click", () => {
  socket.emit("show-votes", { roomId });
});

resetBtn.addEventListener("click", () => {
  myVote = null;
  updateSelectedCard(null);
  socket.emit("reset-votes", { roomId });
});

// ── Render ────────────────────────────────────────────────────────────────
function renderPlayers(users) {
  playerList.innerHTML = "";

  for (const user of users) {
    const isMe = user.id === mySocketId;
    const hasVoted = user.vote !== null;

    const li = document.createElement("li");
    li.className = `player-item${hasVoted ? " voted" : ""}${isMe ? " you" : ""}${user.spectator ? " spectator" : ""}`;

    const initials = user.name
      .split(" ")
      .map((w) => w[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("");

    let voteDisplay = "";
    if (user.spectator) {
      voteDisplay = `<span class="player-vote spectator-badge">👁</span>`;
    } else if (roomRevealed && hasVoted) {
      voteDisplay = `<span class="player-vote revealed">${user.vote}</span>`;
    } else if (hasVoted) {
      voteDisplay = `<span class="player-vote hidden-vote"></span>`;
    } else {
      voteDisplay = `<span class="player-vote waiting"></span>`;
    }

    li.innerHTML = `
      <div class="player-avatar">${initials || "?"}</div>
      <div class="player-info">
        <span class="player-name">${escapeHtml(user.name)}</span>
      </div>
      ${voteDisplay}`;

    playerList.appendChild(li);
  }
}

function renderDeck(revealed) {
  document.querySelectorAll(".vote-card").forEach((c) => {
    c.disabled = revealed;
    c.style.opacity = revealed ? "0.5" : "1";
    c.style.cursor  = revealed ? "not-allowed" : "pointer";
  });
}

function renderAverage(users, revealed) {
  if (!revealed) {
    voteAverage.classList.add("hidden");
    return;
  }
  const numeric = users
    .filter((u) => !u.spectator)
    .map((u) => u.vote)
    .filter((v) => v !== null && v !== "?" && v !== "hidden");
  if (numeric.length === 0) {
    voteAverage.classList.add("hidden");
    return;
  }
  const avg = numeric.reduce((sum, v) => sum + Number(v), 0) / numeric.length;
  const rounded = Math.round(avg * 10) / 10;
  voteAverage.textContent = `Average: ${rounded}`;
  voteAverage.classList.remove("hidden");
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}
