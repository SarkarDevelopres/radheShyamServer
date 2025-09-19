// games/amarAkbarAnthony.js
const { RoundEngine } = require('./engine');
const { createRound, lockRound, settleRoundTx } = require('../db/store');

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["hearts", "diamonds", "clubs", "spades"]; // 0..3

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

function resolveOutcome() {
  let card = chooseRandomCard();
  let amar = false, akbar = false, anthony = false, group = "red", suit = card.suit;
  const rank = card.rank;
  let rankValue = 0;
  if (rank === "A") rankValue = 1;
  else if (rank === "J") rankValue = 11;
  else if (rank === "Q") rankValue = 12;
  else if (rank === "K") rankValue = 13;
  else rankValue = parseInt(rank);

  // high, low, or seven
  if (rankValue < 7) amar = true;
  else if (rankValue => 7 && rankValue < 11) akbar = true;
  else anthony = true;

  //  red or black group
  if (suit === "hearts" || suit === "diamonds") group = "red";
  else group = "black";

  return { amar, akbar, anthony, group, suit, card };
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
    roundMs: 30000,
    betMs: 25000,
    resultShowMs: 5000,
    hooks: {
      // Create a DB round doc (keep quick)
      onCreateRound: (p) => createRound(p),

      // Idempotent lock
      onLock: async (roundId) => { await lockRound(roundId); },

      // Compute result once; engine will emit exactly this object
      onComputeResult: () => resolveOutcome(),

      // Persist settlement using the SAME result emitted above
      onSettle: async (roundId, result) => {
        // result is { outcome, card } from onComputeResult
        const { amar, akbar, anthony, group, suit, card } = result || resolveOutcome();
        let firstOutcome = "AMAR";
        if (amar) firstOutcome = "AMAR";
        else if (akbar) firstOutcome = "AKBAR";
        else if (anthony) firstOutcome = "ANTHONY";
        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: { firstOutcome, group, suit, card },    // "AMAR" | "AKBAR" | "ANTHONY"
          meta: {  amar, akbar, anthony, group, suit, card} // keep full card in meta
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
