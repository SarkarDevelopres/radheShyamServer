// games/sevenUpDown.js
const { RoundEngine } = require('./engine');
const { createRound, lockRound, settleRoundTx } = require('../db/store');

function rngDice() {
  const d1 = (Math.random() * 6 | 0) + 1;
  const d2 = (Math.random() * 6 | 0) + 1;
  const total = d1 + d2;
  const outcome = total === 7 ? 'SEVEN' : (total > 7 ? 'UP' : 'DOWN');
  return { d1, d2, total, outcome };
}

function initSevenUpDown(io, tableId = 'table-1') {
  // Use the CANONICAL game key everywhere
  const GAME = 'SEVEN_UP_DOWN';

  const engine = new RoundEngine({
    io,
    game: GAME,         // <- matches socket rooms + store
    tableId,
    roundMs: 15000,
    betMs: 7000,
    resultShowMs: 3000,
    hooks: {
      // Engine calls this after scheduling timers. Keep short, return doc/plain with _id.
      onCreateRound: (p) => {
        // p: { game, tableId, startAt, betsCloseAt, resultAt, endAt, status }
        return createRound(p);
      },

      // Called at lock; keep idempotent/short.
      onLock: async (roundId) => {
        await lockRound(roundId);
      },

      // Pure RNG so engine can emit result immediately (no DB wait).
      onComputeResult: () => rngDice(),

      // Persist using the SAME result that was emitted.
      onSettle: async (roundId, result) => {
        const { d1, d2, total, outcome } = result || rngDice();
        await settleRoundTx({
          roundId,
          game: GAME,
          outcome,              // 'UP' | 'DOWN' | 'SEVEN'
          meta: { d1, d2, total }
        });
        // no return; engine already emitted result
      },

      onEnd: async (_roundId) => {
        // no-op; add analytics if you want
      },
    },
  });

  // If you don’t already have a global join handler, you can keep a local one:
  io.on('connection', (socket) => {
    socket.on('join', ({ game, tableId: t }) => {
      if (String(game).toUpperCase() === GAME && t === tableId) {
        socket.join(`${GAME}:${tableId}`);
      }
    });
  });

  engine.start();
  return engine;
}

module.exports = { initSevenUpDown };
