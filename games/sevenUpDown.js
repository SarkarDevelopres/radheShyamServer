// games/sevenUpDown.js
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

function rngDice() {
  let card = chooseRandomCard();
  let high = false, low = false, seven = false, group = "red", suit = card.suit;
  const rank = card.rank;
  let rankValue = 0;
  if (rank === "A") rankValue = 1;
  else if (rank === "J") rankValue = 11;
  else if (rank === "Q") rankValue = 12;
  else if (rank === "K") rankValue = 13;
  else rankValue = parseInt(rank);

  // high, low, or seven
  if (rankValue === 7) seven = true;
  else if (rankValue < 7) low = true;
  else high = true;

  //  red or black group
  if (suit === "hearts" || suit === "diamonds") group = "red";
  else group = "black";

  return { high, low, seven, group, suit, card };
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
        const { high, low, seven, group, suit, card } = result || rngDice();
        let firstOutcome = "HIGH";
        if (high) firstOutcome = "HIGH";
        else if (low) firstOutcome = "LOW";
        else if (seven) firstOutcome = "SEVEN";
        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: { firstOutcome, group, suit, card }, 
          meta: { firstOutcome, group, suit, card }
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
