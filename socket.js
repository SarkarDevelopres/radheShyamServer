// socket.js
const { Server } = require("socket.io");
const { placeBetTx, fetchBalance } = require("./db/store");
const { initSevenUpDown } = require("./games/sevenUpDown");
const { initHighLow } = require("./games/highlow");
const { initAAA } = require("./games/aaa");
const { initDragonTiger } = require("./games/dragontiger");

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
       origin: ["http://localhost:3000", "https://radheshyamexch.com","https://www.eradheshyamexch.com"], // add frontend origins as needed
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

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
        const data = await fetchBalance(userId);
        // e.g. { balance: number }
        console.log("DATA: ",data);
        
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
          const canon = canonGameName(game);
          const tid = tableId || "default";
          console.log(
            `[bet:place] user=${userId} game=${canon} table=${tid} market=${market} stake=${stake}`
          );

          const out = await placeBetTx({
            userId,
            roundId,
            game: canon,     // store canonical game name
            tableId: tid,
            market,
            stake: Number(stake),
          });
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

module.exports = { attachSocket };
