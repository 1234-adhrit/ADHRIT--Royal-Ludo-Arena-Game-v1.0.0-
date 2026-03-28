"use strict";

const socket = io();

const state = {
  room: null,
  game: null,
  self: null
};

const MODE_LABEL = {
  2: "1v1",
  3: "1v1v1",
  4: "1v1v1v1"
};

const COLOR_HEX = {
  red: "#df4f4f",
  green: "#38a463",
  yellow: "#efb738",
  blue: "#4d7ee5"
};

const COLOR_SOFT = {
  red: "#ffd9d9",
  green: "#d9f0df",
  yellow: "#fff1ce",
  blue: "#dce8ff"
};

const START_INDEX_BY_COLOR = {
  red: 0,
  green: 39,
  yellow: 26,
  blue: 13
};

const PATH_CELLS = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0]
];

const HOME_CELLS = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]]
};

const YARD_SPOTS = {
  red: [[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]],
  green: [[10.9, 1.9], [13.1, 1.9], [10.9, 4.1], [13.1, 4.1]],
  yellow: [[10.9, 10.9], [13.1, 10.9], [10.9, 13.1], [13.1, 13.1]],
  blue: [[1.9, 10.9], [4.1, 10.9], [1.9, 13.1], [4.1, 13.1]]
};

const FINISH_SPOTS = {
  red: [[7.0, 7.0], [6.4, 6.9], [7.0, 6.3], [7.6, 6.9]],
  green: [[7.8, 7.0], [8.3, 6.6], [8.2, 7.4], [7.6, 7.6]],
  yellow: [[8.0, 8.0], [7.3, 8.4], [8.5, 8.3], [7.9, 7.4]],
  blue: [[7.1, 8.0], [6.6, 7.5], [6.4, 8.3], [7.4, 8.5]]
};

const ui = {
  lobbySection: document.getElementById("lobbySection"),
  roomSection: document.getElementById("roomSection"),
  gameSection: document.getElementById("gameSection"),
  createForm: document.getElementById("createForm"),
  joinForm: document.getElementById("joinForm"),
  createNameInput: document.getElementById("createNameInput"),
  joinNameInput: document.getElementById("joinNameInput"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  modeSelect: document.getElementById("modeSelect"),
  roomCodeText: document.getElementById("roomCodeText"),
  roomMetaText: document.getElementById("roomMetaText"),
  playerList: document.getElementById("playerList"),
  startGameBtn: document.getElementById("startGameBtn"),
  startHintText: document.getElementById("startHintText"),
  copyCodeBtn: document.getElementById("copyCodeBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  rollDiceBtn: document.getElementById("rollDiceBtn"),
  tokenButtons: document.getElementById("tokenButtons"),
  logList: document.getElementById("logList"),
  turnText: document.getElementById("turnText"),
  diceText: document.getElementById("diceText"),
  winnerBanner: document.getElementById("winnerBanner"),
  toast: document.getElementById("toast"),
  boardWrap: document.getElementById("boardWrap"),
  boardCanvas: document.getElementById("boardCanvas")
};

const board = {
  ctx: ui.boardCanvas.getContext("2d"),
  side: 620,
  dpr: window.devicePixelRatio || 1
};

const animationState = {
  moves: new Map(),
  rafId: null,
  interactiveTokens: []
};

const MOVE_ANIMATION_MS_PER_CELL = 95;

let toastTimeout = null;

function showToast(message, isError = true) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  ui.toast.classList.toggle("error", Boolean(isError));

  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toastTimeout = setTimeout(() => {
    ui.toast.classList.add("hidden");
  }, 2600);
}

function emitAck(eventName, payload, onSuccess) {
  socket.emit(eventName, payload, (response) => {
    if (!response || !response.ok) {
      showToast((response && response.message) || "Request failed.");
      return;
    }

    if (typeof onSuccess === "function") {
      onSuccess(response);
    }
  });
}

function normalizeCode(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 5);
}

function cellSize() {
  return board.side / 15;
}

function gridToPx(value) {
  return value * cellSize();
}

function tokenKey(playerId, tokenIndex) {
  return `${playerId}:${tokenIndex}`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function drawRectGrid(x, y, w, h, fill, stroke = "rgba(33, 48, 67, 0.14)") {
  const ctx = board.ctx;
  const px = gridToPx(x);
  const py = gridToPx(y);
  const pw = gridToPx(w);
  const ph = gridToPx(h);

  ctx.fillStyle = fill;
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(px, py, pw, ph);
}

function tokenTextColor(color) {
  if (color === "yellow") {
    return "#41361a";
  }
  return "#ffffff";
}

function drawBoardBase() {
  const ctx = board.ctx;
  ctx.clearRect(0, 0, board.side, board.side);
  drawRectGrid(0, 0, 15, 15, "#f9f6ed", "rgba(35, 46, 60, 0.2)");

  drawRectGrid(0, 0, 6, 6, COLOR_SOFT.red);
  drawRectGrid(9, 0, 6, 6, COLOR_SOFT.green);
  drawRectGrid(9, 9, 6, 6, COLOR_SOFT.yellow);
  drawRectGrid(0, 9, 6, 6, COLOR_SOFT.blue);

  drawRectGrid(1, 1, 4, 4, "#fff");
  drawRectGrid(10, 1, 4, 4, "#fff");
  drawRectGrid(10, 10, 4, 4, "#fff");
  drawRectGrid(1, 10, 4, 4, "#fff");

  PATH_CELLS.forEach((cell) => {
    drawRectGrid(cell[0], cell[1], 1, 1, "#fff");
  });

  Object.keys(HOME_CELLS).forEach((color) => {
    HOME_CELLS[color].forEach((cell) => {
      drawRectGrid(cell[0], cell[1], 1, 1, COLOR_SOFT[color]);
    });
  });

  Object.keys(START_INDEX_BY_COLOR).forEach((color) => {
    const startCell = PATH_CELLS[START_INDEX_BY_COLOR[color]];
    drawRectGrid(startCell[0], startCell[1], 1, 1, COLOR_HEX[color]);
  });

  const cx = gridToPx(7.5);
  const cy = gridToPx(7.5);
  const dist = gridToPx(1.7);

  ctx.beginPath();
  ctx.moveTo(cx, cy - dist);
  ctx.lineTo(cx + dist, cy);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = COLOR_HEX.green;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx + dist, cy);
  ctx.lineTo(cx, cy + dist);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = COLOR_HEX.yellow;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, cy + dist);
  ctx.lineTo(cx - dist, cy);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = COLOR_HEX.blue;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - dist, cy);
  ctx.lineTo(cx, cy - dist);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = COLOR_HEX.red;
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(32, 44, 58, 0.35)";
  ctx.strokeRect(gridToPx(6), gridToPx(6), gridToPx(3), gridToPx(3));

  Object.keys(YARD_SPOTS).forEach((color) => {
    YARD_SPOTS[color].forEach((point) => {
      ctx.beginPath();
      ctx.arc(gridToPx(point[0]), gridToPx(point[1]), gridToPx(0.34), 0, Math.PI * 2);
      ctx.fillStyle = `${COLOR_HEX[color]}26`;
      ctx.fill();
      ctx.strokeStyle = `${COLOR_HEX[color]}88`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    });
  });
}

function tokenGridPosition(color, steps, tokenIndex) {
  if (steps === -1) {
    return YARD_SPOTS[color][tokenIndex];
  }

  if (steps === 57) {
    return FINISH_SPOTS[color][tokenIndex % FINISH_SPOTS[color].length];
  }

  if (steps <= 51) {
    const pathIndex = (START_INDEX_BY_COLOR[color] + steps) % PATH_CELLS.length;
    const cell = PATH_CELLS[pathIndex];
    return [cell[0] + 0.5, cell[1] + 0.5];
  }

  const homeIndex = steps - 52;
  const homeCell = HOME_CELLS[color][homeIndex];
  return [homeCell[0] + 0.5, homeCell[1] + 0.5];
}

function buildTokenSnapshot(gameState) {
  const snapshot = new Map();

  if (!gameState || !Array.isArray(gameState.playerStates)) {
    return snapshot;
  }

  gameState.playerStates.forEach((playerState) => {
    playerState.tokens.forEach((steps, tokenIndex) => {
      snapshot.set(tokenKey(playerState.id, tokenIndex), {
        playerId: playerState.id,
        tokenIndex,
        color: playerState.color,
        steps
      });
    });
  });

  return snapshot;
}

function pushUniquePoint(points, point) {
  const last = points[points.length - 1];
  if (!last || last[0] !== point[0] || last[1] !== point[1]) {
    points.push(point);
  }
}

function buildMovementPoints(color, fromSteps, toSteps, tokenIndex) {
  if (fromSteps === toSteps) {
    return [];
  }

  const points = [];

  if (fromSteps === -1 && toSteps >= 0) {
    pushUniquePoint(points, tokenGridPosition(color, -1, tokenIndex));
    for (let step = 0; step <= toSteps; step += 1) {
      pushUniquePoint(points, tokenGridPosition(color, step, tokenIndex));
    }
    return points;
  }

  if (fromSteps >= 0 && toSteps >= 0 && toSteps > fromSteps) {
    for (let step = fromSteps; step <= toSteps; step += 1) {
      pushUniquePoint(points, tokenGridPosition(color, step, tokenIndex));
    }
    return points;
  }

  pushUniquePoint(points, tokenGridPosition(color, fromSteps, tokenIndex));
  pushUniquePoint(points, tokenGridPosition(color, toSteps, tokenIndex));
  return points;
}

function startAnimationLoop() {
  if (animationState.rafId !== null) {
    return;
  }

  animationState.rafId = window.requestAnimationFrame(() => {
    animationState.rafId = null;
    drawBoard();
    if (animationState.moves.size > 0) {
      startAnimationLoop();
    }
  });
}

function stageTokenAnimations(previousGame, nextGame) {
  if (!previousGame || !nextGame) {
    animationState.moves.clear();
    return;
  }

  const previousSnapshot = buildTokenSnapshot(previousGame);
  const nextSnapshot = buildTokenSnapshot(nextGame);
  const now = performance.now();
  let stagedAny = false;

  nextSnapshot.forEach((nextToken, key) => {
    const previousToken = previousSnapshot.get(key);
    if (!previousToken) {
      return;
    }

    if (previousToken.steps === nextToken.steps) {
      return;
    }

    const points = buildMovementPoints(
      nextToken.color,
      previousToken.steps,
      nextToken.steps,
      nextToken.tokenIndex
    );

    if (points.length < 2) {
      return;
    }

    const duration = Math.max(
      180,
      Math.min(1500, points.length * MOVE_ANIMATION_MS_PER_CELL)
    );

    animationState.moves.set(key, {
      points,
      startAt: now,
      duration
    });
    stagedAny = true;
  });

  if (stagedAny) {
    startAnimationLoop();
  }
}

function animatedPositionForEntry(entry, now) {
  const key = tokenKey(entry.playerId, entry.tokenIndex);
  const movement = animationState.moves.get(key);

  if (!movement || movement.points.length < 2) {
    return {
      position: entry.position,
      animating: false
    };
  }

  const elapsed = now - movement.startAt;
  const t = Math.max(0, Math.min(1, elapsed / movement.duration));
  const eased = easeInOut(t);
  const segments = movement.points.length - 1;
  const segmentFloat = eased * segments;
  const segmentIndex = Math.min(segments - 1, Math.floor(segmentFloat));
  const segmentT = segmentFloat - segmentIndex;
  const from = movement.points[segmentIndex];
  const to = movement.points[Math.min(segments, segmentIndex + 1)];

  const position = [
    lerp(from[0], to[0], segmentT),
    lerp(from[1], to[1], segmentT)
  ];

  if (t >= 1) {
    animationState.moves.delete(key);
    return {
      position: movement.points[movement.points.length - 1],
      animating: false
    };
  }

  return {
    position,
    animating: true
  };
}

function getTokenEntries() {
  if (!state.game) {
    return [];
  }

  const entries = [];
  const myId = state.self ? state.self.id : null;

  state.game.playerStates.forEach((playerState) => {
    playerState.tokens.forEach((steps, tokenIndex) => {
      const position = tokenGridPosition(playerState.color, steps, tokenIndex);

      const canMove =
        state.game.currentPlayerId === myId &&
        playerState.id === myId &&
        state.game.diceValue !== null &&
        state.game.movableTokens.includes(tokenIndex) &&
        !state.game.finished;

      entries.push({
        playerId: playerState.id,
        color: playerState.color,
        tokenIndex,
        position,
        canMove
      });
    });
  });

  return entries;
}

function drawTokens() {
  const ctx = board.ctx;
  const entries = getTokenEntries();
  const groups = new Map();
  const now = performance.now();
  let hasActiveAnimations = false;
  animationState.interactiveTokens = [];

  entries.forEach((entry) => {
    const animated = animatedPositionForEntry(entry, now);
    if (animated.animating) {
      hasActiveAnimations = true;
    }

    const entryWithPosition = {
      ...entry,
      position: animated.position
    };

    const key = `${entryWithPosition.position[0].toFixed(2)}:${entryWithPosition.position[1].toFixed(2)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entryWithPosition);
  });

  groups.forEach((group) => {
    group.forEach((entry, index) => {
      const spread = group.length <= 1 ? 0 : 0.23;
      const angle = (Math.PI * 2 * index) / group.length;
      const gx = entry.position[0] + Math.cos(angle) * spread;
      const gy = entry.position[1] + Math.sin(angle) * spread;

      const x = gridToPx(gx);
      const y = gridToPx(gy);
      const radius = gridToPx(0.28);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_HEX[entry.color] || "#666";
      ctx.fill();

      if (entry.canMove) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 140);
        ctx.beginPath();
        ctx.arc(x, y, radius + gridToPx(0.09 + pulse * 0.05), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 236, 151, 0.45)";
        ctx.fill();
      }

      ctx.lineWidth = entry.canMove ? 3 + Math.sin(now / 130) * 0.8 : 1.8;
      ctx.strokeStyle = entry.canMove ? "#f0df80" : "rgba(18, 31, 44, 0.75)";
      ctx.stroke();

      ctx.font = `${Math.max(10, board.side * 0.023)}px Sora, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = tokenTextColor(entry.color);
      ctx.fillText(String(entry.tokenIndex + 1), x, y + 0.4);

      if (entry.canMove && state.self && entry.playerId === state.self.id) {
        animationState.interactiveTokens.push({
          tokenIndex: entry.tokenIndex,
          x,
          y,
          radius: radius + gridToPx(0.16)
        });
      }
    });
  });

  if (hasActiveAnimations) {
    startAnimationLoop();
  }
}

function drawBoard() {
  if (!board.ctx) {
    return;
  }
  drawBoardBase();
  drawTokens();
}

function resizeBoard(force = false) {
  const availableWidth = ui.boardWrap.clientWidth;
  if (!availableWidth) {
    return;
  }

  const nextSide = Math.max(320, Math.min(760, Math.floor(availableWidth - 20)));
  if (!force && Math.abs(nextSide - board.side) < 2) {
    return;
  }

  board.side = nextSide;
  board.dpr = window.devicePixelRatio || 1;

  ui.boardCanvas.style.width = `${board.side}px`;
  ui.boardCanvas.style.height = `${board.side}px`;
  ui.boardCanvas.width = Math.floor(board.side * board.dpr);
  ui.boardCanvas.height = Math.floor(board.side * board.dpr);

  board.ctx.setTransform(board.dpr, 0, 0, board.dpr, 0, 0);
  drawBoard();
}

function canvasPointFromEvent(event) {
  const rect = ui.boardCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function movableTokenAtPoint(x, y) {
  for (let i = 0; i < animationState.interactiveTokens.length; i += 1) {
    const token = animationState.interactiveTokens[i];
    const dx = x - token.x;
    const dy = y - token.y;
    if (Math.hypot(dx, dy) <= token.radius) {
      return token;
    }
  }
  return null;
}

function updateBoardCursor(event) {
  const point = canvasPointFromEvent(event);
  const hit = movableTokenAtPoint(point.x, point.y);
  ui.boardCanvas.style.cursor = hit ? "pointer" : "default";
}

function playerById(playerId) {
  if (!state.room) {
    return null;
  }
  return state.room.players.find((player) => player.id === playerId) || null;
}

function renderPlayerList() {
  ui.playerList.innerHTML = "";

  state.room.players.forEach((player) => {
    const li = document.createElement("li");
    li.className = "player-item";

    const left = document.createElement("span");
    left.className = "player-tag";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.backgroundColor = COLOR_HEX[player.color] || "#666";

    const name = document.createElement("span");
    name.textContent = player.name;

    left.append(dot, name);

    const right = document.createElement("small");
    const tags = [];
    if (player.id === state.room.hostId) {
      tags.push("Host");
    }
    if (state.self && player.id === state.self.id) {
      tags.push("You");
    }
    right.textContent = tags.join(" | ");

    li.append(left, right);
    ui.playerList.appendChild(li);
  });
}

function tokenStatusText(steps) {
  if (steps === -1) {
    return "Yard";
  }
  if (steps === 57) {
    return "Finished";
  }
  if (steps <= 51) {
    return `Path ${steps + 1}/52`;
  }
  return `Home ${steps - 51}/5`;
}

function renderTokenButtons() {
  ui.tokenButtons.innerHTML = "";

  if (!state.game || !state.self) {
    return;
  }

  const myState = state.game.playerStates.find((player) => player.id === state.self.id);
  if (!myState) {
    return;
  }

  myState.tokens.forEach((steps, tokenIndex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "token-btn";

    const movable =
      state.game.currentPlayerId === state.self.id &&
      state.game.diceValue !== null &&
      state.game.movableTokens.includes(tokenIndex) &&
      !state.game.finished;

    btn.disabled = !movable;
    if (movable) {
      btn.classList.add("can-move");
    }

    const left = document.createElement("span");
    left.textContent = `Token ${tokenIndex + 1}`;
    const right = document.createElement("strong");
    right.textContent = tokenStatusText(steps);

    btn.append(left, right);
    btn.addEventListener("click", () => {
      emitAck("move_token", { tokenIndex });
    });

    ui.tokenButtons.appendChild(btn);
  });
}

function renderLogs() {
  ui.logList.innerHTML = "";

  if (!state.game) {
    return;
  }

  const logs = state.game.logs.slice().reverse();
  logs.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    ui.logList.appendChild(li);
  });
}

function renderRoom() {
  ui.roomCodeText.textContent = state.room.code;
  ui.roomMetaText.textContent = `${MODE_LABEL[state.room.mode]} | ${state.room.players.length}/${state.room.mode} players`;

  renderPlayerList();

  const isHost = state.self && state.self.id === state.room.hostId;
  ui.startGameBtn.classList.toggle("hidden", !isHost || state.room.started);
  ui.startGameBtn.disabled =
    !isHost || state.room.started || state.room.players.length !== state.room.mode;

  if (!state.room.started) {
    if (!isHost) {
      ui.startHintText.textContent = "Waiting for host to start the match.";
    } else if (state.room.players.length === state.room.mode) {
      ui.startHintText.textContent = "All players are ready.";
    } else {
      ui.startHintText.textContent = `Need ${state.room.mode - state.room.players.length} more player(s).`;
    }
  } else {
    ui.startHintText.textContent = "Match in progress.";
  }
}

function renderGame() {
  const currentPlayer = playerById(state.game.currentPlayerId);
  ui.turnText.textContent = currentPlayer
    ? `${currentPlayer.name} (${currentPlayer.color})`
    : "-";
  ui.diceText.textContent =
    state.game.diceValue === null ? "-" : String(state.game.diceValue);

  const isMyTurn = state.self && state.game.currentPlayerId === state.self.id;
  ui.rollDiceBtn.disabled = !isMyTurn || state.game.diceValue !== null || state.game.finished;

  if (state.game.finished) {
    const winner = playerById(state.game.winnerId);
    ui.winnerBanner.classList.remove("hidden");
    ui.winnerBanner.textContent = winner
      ? `${winner.name} won the match.`
      : "Match ended.";
  } else {
    ui.winnerBanner.classList.add("hidden");
    ui.winnerBanner.textContent = "";
  }

  renderTokenButtons();
  renderLogs();
}

function render() {
  const hasRoom = Boolean(state.room);

  ui.lobbySection.classList.toggle("hidden", hasRoom);
  ui.roomSection.classList.toggle("hidden", !hasRoom);
  ui.gameSection.classList.toggle("hidden", !(hasRoom && state.room.started));

  if (!hasRoom) {
    animationState.moves.clear();
    animationState.interactiveTokens = [];
    ui.boardCanvas.style.cursor = "default";
    ui.playerList.innerHTML = "";
    ui.tokenButtons.innerHTML = "";
    ui.logList.innerHTML = "";
    ui.roomCodeText.textContent = "-----";
    ui.roomMetaText.textContent = "";
    ui.turnText.textContent = "-";
    ui.diceText.textContent = "-";
    ui.winnerBanner.classList.add("hidden");
    ui.winnerBanner.textContent = "";
    drawBoard();
    return;
  }

  renderRoom();

  if (state.room.started && state.game) {
    renderGame();
    drawBoard();
    requestAnimationFrame(() => resizeBoard(false));
  }
}

ui.createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = ui.createNameInput.value.trim();
  const mode = Number(ui.modeSelect.value);

  emitAck("create_room", { name, mode }, () => {
    showToast("Server created.", false);
    ui.joinCodeInput.value = "";
  });
});

ui.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = ui.joinNameInput.value.trim();
  const code = normalizeCode(ui.joinCodeInput.value);
  ui.joinCodeInput.value = code;

  emitAck("join_room", { name, code }, () => {
    showToast("Joined server.", false);
  });
});

ui.joinCodeInput.addEventListener("input", () => {
  ui.joinCodeInput.value = normalizeCode(ui.joinCodeInput.value);
});

ui.copyCodeBtn.addEventListener("click", async () => {
  if (!state.room) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.room.code);
    showToast("Room code copied.", false);
  } catch (_error) {
    showToast("Could not copy room code.");
  }
});

ui.leaveRoomBtn.addEventListener("click", () => {
  emitAck("leave_room", {}, () => {
    state.room = null;
    state.game = null;
    state.self = null;
    render();
    showToast("You left the server.", false);
  });
});

ui.startGameBtn.addEventListener("click", () => {
  emitAck("start_game", {});
});

ui.rollDiceBtn.addEventListener("click", () => {
  emitAck("roll_dice", {});
});

ui.boardCanvas.addEventListener("click", (event) => {
  const point = canvasPointFromEvent(event);
  const hit = movableTokenAtPoint(point.x, point.y);
  if (!hit) {
    return;
  }

  emitAck("move_token", { tokenIndex: hit.tokenIndex });
});

ui.boardCanvas.addEventListener("mousemove", (event) => {
  updateBoardCursor(event);
});

ui.boardCanvas.addEventListener("mouseleave", () => {
  ui.boardCanvas.style.cursor = "default";
});

socket.on("state_update", (payload) => {
  const nextGame = payload.game || null;
  stageTokenAnimations(state.game, nextGame);
  state.room = payload.room || null;
  state.game = nextGame;
  state.self = payload.self || null;
  render();
});

socket.on("connect", () => {
  showToast("Connected.", false);
});

socket.on("disconnect", () => {
  showToast("Connection lost. Reconnecting...");
});

socket.on("connect_error", (error) => {
  const message = (error && error.message) || "Could not connect to server.";
  showToast(message);
});

window.addEventListener("resize", () => resizeBoard(false));

if ("ResizeObserver" in window) {
  const observer = new ResizeObserver(() => {
    resizeBoard(false);
  });
  observer.observe(ui.boardWrap);
}

resizeBoard(true);
render();
