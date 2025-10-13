// socket.js
const { Server } = require("socket.io");
const { placeBetTx, fetchBalance, fetchExp } = require("./db/store");
const { initSevenUpDown } = require("./games/sevenUpDown");
const { initHighLow } = require("./games/highlow");
const { initAAA } = require("./games/aaa");
const { initDragonTiger } = require("./games/dragontiger");
const jwt = require('jsonwebtoken');
const {add,remove} = require('./isWatched');
const { getMatch } = require('./cache');

let ioInstance = null;
function canonGameName(g) {
  if (!g) return "";
  const s = String(g).toLowerCase().replace(/[\s\-]/g, "_");
  if (s === "seven_up_down" || s === "7updown" || s === "sevenupdown" || s === "seven_updown")
    return "SEVEN_UP_DOWN";
  if (s === "high_low" || s === "highlow" || s === "hi_lo" || s === "hi_low")
    return "HIGH_LOW";
  if (s === "high_low" || s === "highlow" || s === "hi_lo" || s === "hi_low")
    return "HIGH_LOW";
  return g.toUpperCase();
}

function attachSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000", "https://radheshyamexch.com", "https://www.eradheshyamexch.com"], // add frontend origins as needed
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  ioInstance = io;

  // --- Start game engines ---
  const seven = initSevenUpDown(io, "table-1");
  const highlow = initHighLow(io, "default");
  const aaa = initAAA(io, "default");
  const dragontiger = initDragonTiger(io, "default");

  // Registry so we can fetch engine by roomKey on join
  const engines = {
    ["SEVEN_UP_DOWN:table-1"]: seven,
    ["HIGH_LOW:default"]: highlow,
    ["AMAR_AKBAR_ANTHONY:default"]: aaa,
    ["DRAGON_TIGER:default"]: dragontiger,
  };

  io.on("connection", (socket) => {
    socket.onAny((event, ...args) => {
      // console.log("[socket] IN:", event, args[0]);
    });
    // --- Live scores: client joins/leaves a match room ---
    
    socket.on('watch:join', (matchId) => {
      if (!matchId) return;
      add(matchId);
      
      console.log("Socket Match ID:", matchId);
      
      const room = `live:match:${matchId}`;
      socket.join(room);
      let data = getMatch(matchId)      
      socket.emit('watch:joined', { data });
    });

    socket.on('watch:leave', (matchId) => {
      if (!matchId) return;
      remove(matchId)
      const room = `live:match:${matchId}`;
      socket.leave(room);
      
      socket.emit('watch:left', { matchId });
    });

    const token = socket.handshake.auth?.token;
    // console.log("IsToken: ",token);

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userID = decoded.userID;   // 👈 store mapping
        socket.join(`user:${socket.userID}`);
      } catch (err) {
        console.error("Invalid token:", err);
      }
    }
    socket.on("wallet:update", (data) => {
      // This will only fire if a CLIENT emits wallet:update (not in your flow).
      // In your case, the server is the one emitting, so this won't normally trigger.
      console.log(`[socket] wallet:update received on server for socket ${socket.id}`, data);
    });
    socket.on("exp:update", (data) => {
      // This will only fire if a CLIENT emits wallet:update (not in your flow).
      // In your case, the server is the one emitting, so this won't normally trigger.
      console.log(`[socket] wallet:update received on server for socket ${socket.id}`, data);
    });

    // Join a game/table room to get lifecycle events
    socket.on("join", ({ game, tableId }) => {
      const canon = canonGameName(game);
      const tid = tableId || "default";
      const roomKey = `${canon}:${tid}`;

      console.log(`[socket] join request → room ${roomKey}`);
      socket.join(roomKey);

      // Send current round snapshot immediately
      const engine = engines[roomKey];
      if (engine && typeof engine.publicRound === "function") {
        socket.emit("round:start", engine.publicRound() || {});
      } else {
        socket.emit("round:start", {}); // empty starter payload
      }
    });

    socket.on("wallet:fetch", async ({ userId }, cb) => {
      try {
        // console.log("RECIEVED TOKEN :", userId);

        const decoded = jwt.verify(userId, process.env.JWT_SECRET);
        // console.log("DECODED TOKEN :", decoded);
        const userID = decoded.userID;
        const data = await fetchBalance(userID);
        // e.g. { balance: number }
        // console.log("DATA: ", data);

        cb?.({ ok: true, ...data });
      } catch (e) {
        console.error("[wallet:fetch] error:", e);
        cb?.({ ok: false, error: e?.message || "Failed to fetch balance" });
      }
    });
    socket.on("exp:fetch", async ({ userId }, cb) => {
      try {
        // console.log("RECIEVED TOKEN :", userId);

        const decoded = jwt.verify(userId, process.env.JWT_SECRET);
        // console.log("DECODED TOKEN :", decoded);
        const userID = decoded.userID;
        const data = await fetchExp(userID);
        // e.g. { balance: number }
        // console.log("DATA: ", data);

        cb?.({ ok: true, ...data });
      } catch (e) {
        console.error("[wallet:fetch] error:", e);
        cb?.({ ok: false, error: e?.message || "Failed to fetch balance" });
      }
    });

    // Unified bet API for all games
    socket.on(
      "bet:place",
      async ({ userId, roundId, game, tableId, market, stake }, cb) => {
        try {
          const decoded = jwt.verify(userId, process.env.JWT_SECRET);
          const userID = decoded.userID;
          const canon = canonGameName(game);
          const tid = tableId || "default";
          console.log(
            `[bet:place] user=${userId} game=${canon} table=${tid} market=${market} stake=${stake}`
          );

          const out = await placeBetTx({
            userId: userID,
            roundId,
            game: canon,     // store canonical game name
            tableId: tid,
            market,
            stake: Number(stake),
          });
          const data = await fetchBalance(userID);
          io.to(`user:${userID}`).emit("wallet:update", { ok: true, ...data });
          cb?.(out);
        } catch (e) {
          console.error("[bet:place] error:", e);
          cb?.({ ok: false, error: e?.message || "Bet failed" });
        }
      }
    );

    socket.on("leave", ({ game, tableId }) => {
      const canon = canonGameName(game);
      const tid = tableId || "default";
      const roomKey = `${canon}:${tid}`;
      socket.leave(roomKey);
      console.log(`[socket] left room ${roomKey}`);
    });
  });

  return io;
}



function getIO() {
  if (!ioInstance) throw new Error("Socket.io not initialized yet");
  return ioInstance;
}

module.exports = { attachSocket, getIO };
