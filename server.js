"use strict";

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static(path.join(__dirname, "public")));

const COLORS = ["red", "green", "yellow", "blue"];
const VALID_MODES = new Set([2, 3, 4]);
const START_INDEX_BY_COLOR = {
  red: 0,
  green: 39,
  yellow: 26,
  blue: 13
};
const SAFE_CELLS = new Set(Object.values(START_INDEX_BY_COLOR));
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const rooms = new Map();

function sanitizeName(rawName) {
  const clean = String(rawName || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);

  if (clean.length > 0) {
    return clean;
  }

  return `Player-${crypto.randomInt(100, 999)}`;
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }

  throw new Error("Unable to generate a unique room code.");
}

function findPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function pushLog(room, message) {
  room.game.logs.push(message);
  if (room.game.logs.length > 80) {
    room.game.logs.splice(0, room.game.logs.length - 80);
  }
}

function sendError(callback, message) {
  if (typeof callback === "function") {
    callback({
      ok: false,
      message
    });
  }
}

function sendOk(callback, payload = {}) {
  if (typeof callback === "function") {
    callback({
      ok: true,
      ...payload
    });
  }
}

function getMovableTokens(room, playerId, diceValue) {
  const game = room.game;
  const tokens = game.tokens[playerId] || [];
  const movable = [];

  tokens.forEach((steps, tokenIndex) => {
    if (steps === 57) {
      return;
    }

    if (steps === -1) {
      if (diceValue === 6) {
        movable.push(tokenIndex);
      }
      return;
    }

    if (steps + diceValue <= 57) {
      movable.push(tokenIndex);
    }
  });

  return movable;
}

function resolveGlobalPathCell(color, steps) {
  if (steps < 0 || steps > 51) {
    return null;
  }

  return (START_INDEX_BY_COLOR[color] + steps) % 52;
}

function pickNextTurn(room, currentPlayerId) {
  const game = room.game;
  const eligiblePlayers = room.players.filter(
    (player) => !game.winners.includes(player.id)
  );

  if (eligiblePlayers.length <= 1) {
    return null;
  }

  const order = room.players.map((player) => player.id);
  let index = order.indexOf(currentPlayerId);

  for (let i = 0; i < order.length; i += 1) {
    index = (index + 1) % order.length;
    const candidate = order[index];
    if (!game.winners.includes(candidate) && findPlayer(room, candidate)) {
      return candidate;
    }
  }

  return null;
}

function startGame(room) {
  room.started = true;

  const tokenMap = {};
  room.players.forEach((player) => {
    tokenMap[player.id] = [-1, -1, -1, -1];
  });

  room.game = {
    currentPlayerId: room.players[0].id,
    diceValue: null,
    movableTokens: [],
    winnerId: null,
    finished: false,
    winners: [],
    tokens: tokenMap,
    logs: [`${room.players[0].name} goes first.`]
  };
}

function moveToken(room, playerId, tokenIndex) {
  const game = room.game;
  const player = findPlayer(room, playerId);
  const tokens = game.tokens[playerId];
  const diceValue = game.diceValue;
  const currentSteps = tokens[tokenIndex];
  const nextSteps = currentSteps === -1 ? 0 : currentSteps + diceValue;

  tokens[tokenIndex] = nextSteps;

  const landingCell = resolveGlobalPathCell(player.color, nextSteps);
  const captured = [];

  if (landingCell !== null && !SAFE_CELLS.has(landingCell)) {
    room.players.forEach((opponent) => {
      if (opponent.id === playerId) {
        return;
      }

      const opponentTokens = game.tokens[opponent.id];
      let capturedToken = false;

      for (let i = 0; i < opponentTokens.length; i += 1) {
        const opponentLanding = resolveGlobalPathCell(opponent.color, opponentTokens[i]);
        if (opponentLanding === landingCell) {
          opponentTokens[i] = -1;
          capturedToken = true;
        }
      }

      if (capturedToken) {
        captured.push(opponent.name);
      }
    });
  }

  if (captured.length > 0) {
    pushLog(
      room,
      `${player.name} captured token(s) from ${captured.join(", ")}.`
    );
  }

  if (tokens.every((steps) => steps === 57)) {
    game.winnerId = playerId;
    game.finished = true;
    game.winners.push(playerId);
    pushLog(room, `${player.name} wins the match.`);
    game.diceValue = null;
    game.movableTokens = [];
    return;
  }

  const rolledSix = diceValue === 6;
  game.diceValue = null;
  game.movableTokens = [];

  if (rolledSix) {
    pushLog(room, `${player.name} rolled 6 and gets another turn.`);
    return;
  }

  const nextPlayerId = pickNextTurn(room, playerId);
  if (!nextPlayerId) {
    game.finished = true;
    game.winnerId = playerId;
    pushLog(room, `${player.name} wins by default.`);
    return;
  }

  game.currentPlayerId = nextPlayerId;
  const nextPlayer = findPlayer(room, nextPlayerId);
  if (nextPlayer) {
    pushLog(room, `Turn: ${nextPlayer.name}`);
  }
}

function buildState(room, viewerId) {
  const self = findPlayer(room, viewerId);

  const roomView = {
    code: room.code,
    mode: room.mode,
    started: room.started,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      isHost: player.id === room.hostId
    }))
  };

  let gameView = null;
  if (room.started && room.game) {
    gameView = {
      currentPlayerId: room.game.currentPlayerId,
      diceValue: room.game.diceValue,
      movableTokens:
        room.game.currentPlayerId === viewerId ? room.game.movableTokens.slice() : [],
      winnerId: room.game.winnerId,
      finished: room.game.finished,
      logs: room.game.logs.slice(-40),
      playerStates: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        tokens: (room.game.tokens[player.id] || [-1, -1, -1, -1]).slice()
      }))
    };
  }

  return {
    room: roomView,
    game: gameView,
    self: self
      ? {
          id: self.id,
          name: self.name,
          color: self.color
        }
      : null
  };
}

function emitState(room) {
  room.players.forEach((player) => {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      socket.emit("state_update", buildState(room, player.id));
    }
  });
}

function removeFromCurrentRoom(socket, reason) {
  const code = socket.data.roomCode;
  if (!code) {
    return;
  }

  socket.data.roomCode = null;
  const room = rooms.get(code);

  if (!room) {
    return;
  }

  const playerIndex = room.players.findIndex((player) => player.id === socket.id);
  if (playerIndex < 0) {
    return;
  }

  const leavingPlayer = room.players[playerIndex];
  room.players.splice(playerIndex, 1);
  socket.leave(`room:${code}`);

  if (room.game && room.game.tokens) {
    delete room.game.tokens[leavingPlayer.id];
  }

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (room.hostId === leavingPlayer.id) {
    room.hostId = room.players[0].id;
  }

  if (room.started && room.game && !room.game.finished) {
    room.game.finished = true;
    room.game.diceValue = null;
    room.game.movableTokens = [];

    if (room.players.length === 1) {
      room.game.winnerId = room.players[0].id;
      pushLog(
        room,
        `${leavingPlayer.name} left (${reason}). ${room.players[0].name} wins by default.`
      );
    } else {
      room.game.winnerId = null;
      pushLog(room, `${leavingPlayer.name} left (${reason}). Match ended.`);
    }
  }

  emitState(room);
}

io.on("connection", (socket) => {
  socket.data.roomCode = null;

  socket.on("create_room", (payload, callback) => {
    try {
      const name = sanitizeName(payload && payload.name);
      const mode = Number(payload && payload.mode);

      if (!VALID_MODES.has(mode)) {
        sendError(callback, "Mode must be 2, 3, or 4 players.");
        return;
      }

      removeFromCurrentRoom(socket, "switched room");

      const code = makeRoomCode();
      const room = {
        code,
        mode,
        started: false,
        hostId: socket.id,
        players: [
          {
            id: socket.id,
            name,
            color: COLORS[0]
          }
        ],
        game: null
      };

      rooms.set(code, room);
      socket.data.roomCode = code;
      socket.join(`room:${code}`);

      emitState(room);
      sendOk(callback, { code });
    } catch (error) {
      sendError(callback, "Failed to create server. Please try again.");
    }
  });

  socket.on("join_room", (payload, callback) => {
    const name = sanitizeName(payload && payload.name);
    const code = String((payload && payload.code) || "")
      .trim()
      .toUpperCase();

    if (!code) {
      sendError(callback, "Please enter a room code.");
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      sendError(callback, "Server not found. Check the room code.");
      return;
    }

    if (room.started) {
      sendError(callback, "Game already started. New players cannot join now.");
      return;
    }

    if (room.players.length >= room.mode) {
      sendError(callback, "This server is full.");
      return;
    }

    removeFromCurrentRoom(socket, "switched room");

    const color = COLORS[room.players.length];
    room.players.push({
      id: socket.id,
      name,
      color
    });

    socket.data.roomCode = room.code;
    socket.join(`room:${room.code}`);

    emitState(room);
    sendOk(callback, { code: room.code });
  });

  socket.on("start_game", (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);

    if (!room) {
      sendError(callback, "You are not in a server.");
      return;
    }

    if (room.hostId !== socket.id) {
      sendError(callback, "Only the server creator can start the game.");
      return;
    }

    if (room.started) {
      sendError(callback, "Game already started.");
      return;
    }

    if (room.players.length !== room.mode) {
      sendError(
        callback,
        `Need exactly ${room.mode} players before starting.`
      );
      return;
    }

    startGame(room);
    emitState(room);
    sendOk(callback);
  });

  socket.on("roll_dice", (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || !room.game) {
      sendError(callback, "Game is not running.");
      return;
    }

    const game = room.game;
    const player = findPlayer(room, socket.id);

    if (game.finished) {
      sendError(callback, "Game is finished.");
      return;
    }

    if (game.currentPlayerId !== socket.id) {
      sendError(callback, "It is not your turn.");
      return;
    }

    if (game.diceValue !== null) {
      sendError(callback, "You already rolled. Move a token.");
      return;
    }

    const diceValue = crypto.randomInt(1, 7);
    game.diceValue = diceValue;
    game.movableTokens = getMovableTokens(room, socket.id, diceValue);

    pushLog(room, `${player.name} rolled ${diceValue}.`);

    if (game.movableTokens.length === 0) {
      game.diceValue = null;
      game.movableTokens = [];

      if (diceValue === 6) {
        pushLog(room, `${player.name} has no valid move but keeps the turn (rolled 6).`);
      } else {
        const nextPlayerId = pickNextTurn(room, socket.id);
        if (nextPlayerId) {
          game.currentPlayerId = nextPlayerId;
          const nextPlayer = findPlayer(room, nextPlayerId);
          pushLog(room, `No move available. Turn: ${nextPlayer.name}`);
        }
      }
    }

    emitState(room);
    sendOk(callback, { diceValue });
  });

  socket.on("move_token", (payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || !room.game) {
      sendError(callback, "Game is not running.");
      return;
    }

    const game = room.game;
    const tokenIndex = Number(payload && payload.tokenIndex);
    const player = findPlayer(room, socket.id);

    if (game.finished) {
      sendError(callback, "Game is finished.");
      return;
    }

    if (game.currentPlayerId !== socket.id) {
      sendError(callback, "It is not your turn.");
      return;
    }

    if (game.diceValue === null) {
      sendError(callback, "Roll the dice first.");
      return;
    }

    if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
      sendError(callback, "Invalid token.");
      return;
    }

    if (!game.movableTokens.includes(tokenIndex)) {
      sendError(callback, "That token cannot be moved for this roll.");
      return;
    }

    pushLog(room, `${player.name} moved token ${tokenIndex + 1}.`);
    moveToken(room, socket.id, tokenIndex);
    emitState(room);
    sendOk(callback);
  });

  socket.on("leave_room", (_payload, callback) => {
    removeFromCurrentRoom(socket, "left");
    sendOk(callback);
  });

  socket.on("disconnect", () => {
    removeFromCurrentRoom(socket, "disconnected");
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    now: new Date().toISOString()
  });
});

server.listen(PORT, () => {
  console.log(`Royal Ludo Arena is running on http://localhost:${PORT}`);
});
