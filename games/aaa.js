// games/amarAkbarAnthony.js
const { RoundEngine } = require('./engine');
const { createRound, lockRound, settleRoundTx } = require('../db/store');

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS = ["hearts","diamonds","clubs","spades"]; // 0..3

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  return deck;
}

function chooseRandomCard() {
  const deck = makeDeck();
  const idx = Math.floor(Math.random() * deck.length); // 0..51
  return deck[idx];
}

/**
 * Map a card to one of the 3 boxes with (near) perfectly even distribution.
 * outcome ∈ {"AMAR","AKBAR","ANTHONY"}
 */
function resolveOutcome(card) {
  const rIdx = RANKS.indexOf(String(card.rank).toUpperCase());   // 0..12
  const sIdx = SUITS.indexOf(String(card.suit).toLowerCase());   // 0..3
  const bucket = (rIdx + sIdx) % 3;
  return bucket === 0 ? "AMAR" : bucket === 1 ? "AKBAR" : "ANTHONY";
}

/**
 * If you prefer a simple suit-based mapping instead (less uniform), you can do:
 *   hearts -> AMAR, diamonds -> AKBAR, clubs/spades -> ANTHONY
 * Just swap resolveOutcome with:
 * function resolveOutcome(card) {
 *   if (card.suit === "hearts") return "AMAR";
 *   if (card.suit === "diamonds") return "AKBAR";
 *   return "ANTHONY";
 * }
 */

function initAAA(io, tableId = 'table-1') {
  const GAME = 'AMAR_AKBAR_ANTHONY';

  const engine = new RoundEngine({
    io,
    game: GAME,
    tableId,
    roundMs: 15000,
    betMs: 7000,
    resultShowMs: 3000,
    hooks: {
      // Create a DB round doc (keep quick)
      onCreateRound: (p) => createRound(p),

      // Idempotent lock
      onLock: async (roundId) => { await lockRound(roundId); },

      // Compute result once; engine will emit exactly this object
      onComputeResult: () => {
        const card = chooseRandomCard();
        const outcome = resolveOutcome(card);
        // This exact payload is what clients see and what onSettle receives
        return { outcome, card }; 
      },

      // Persist settlement using the SAME result emitted above
      onSettle: async (roundId, result) => {
        // result is { outcome, card } from onComputeResult
        const payload = result || (() => {
          const c = chooseRandomCard();
          return { outcome: resolveOutcome(c), card: c };
        })();

        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: payload.outcome,    // "AMAR" | "AKBAR" | "ANTHONY"
          meta: { card: payload.card } // keep full card in meta
        });
      },

      onEnd: async (_roundId) => { /* no-op; add analytics if needed */ },
    },
  });

  // Optional: room join helper (if you don't already have a global join)
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

module.exports = { initAAA };
