// games/sevenUpDown.js
const { RoundEngine } = require('./engine');
const { createRound, lockRound, settleRoundTx } = require('../db/store');
const Bet = require("../db/models/bet"); // <-- import Bet model

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["hearts", "diamonds", "clubs", "spades"]; // 0..3

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  return deck;
}

// Convert card → outcome details
function cardToOutcome(card) {
  let high = false, low = false, seven = false
  const rank = card.rank;
  let rankValue = 0;
  let firstOutcome = "UP";
  if (rank === "A") rankValue = 1;
  else if (rank === "J") rankValue = 11;
  else if (rank === "Q") rankValue = 12;
  else if (rank === "K") rankValue = 13;
  else rankValue = parseInt(rank);

  if (rankValue === 7) { seven = true; firstOutcome = "SEVEN" }
  else if (rankValue < 7) { low = true; firstOutcome = "DOWN" }
  else high = true;

  const group = (card.suit === "hearts" || card.suit === "diamonds") ? "red" : "black";
  let suit = card.suit.toLowerCase();

  return { high, low, seven, firstOutcome, group, suit, card };
}

// Biased RNG → excludes the market with the highest exposure
async function biasedDice(roundId) {
  const deck = makeDeck();

  // 1. Load all bets for this round
  const bets = await Bet.find({ roundId, type: "casino", status: "OPEN" });

  // 2. Aggregate totals per market
  const totals = {};
  for (const b of bets) {
    const pick = String(b.market || "").toUpperCase();
    totals[pick] = (totals[pick] || 0) + Number(b.stake);
  }

  // 3. Find the market with max exposure
  let worst = null;
  let maxStake = 0;
  for (const [market, amt] of Object.entries(totals)) {
    if (amt > maxStake) {
      worst = market;
      maxStake = amt;
    }
  }

  // 4. Filter deck to avoid that market
  let filtered = deck;

  if (worst === "BLACK") {
    filtered = deck.filter(c => c.suit === "hearts" || c.suit === "diamonds");
  } else if (worst === "RED") {
    filtered = deck.filter(c => c.suit === "clubs" || c.suit === "spades");
  } else if (worst === "UP") {
    filtered = deck.filter(c => {
      const val = RANKS.indexOf(c.rank) + 1;
      return val <= 7; // keep DOWN + SEVEN
    });
  } else if (worst === "DOWN") {
    filtered = deck.filter(c => {
      const val = RANKS.indexOf(c.rank) + 1;
      return val >= 7; // keep UP + SEVEN
    });
  } else if (worst === "SEVEN") {
    filtered = deck.filter(c => (RANKS.indexOf(c.rank) + 1) !== 7);
  } else if (["HEARTS", "DIAMONDS", "CLUBS", "SPADES"].includes(worst)) {
    filtered = deck.filter(c => c.suit.toUpperCase() !== worst);
  }
  else if (worst == null) {
    const card = filtered[Math.floor(Math.random() * filtered.length)];
    return cardToOutcome(card);
  }
  // 5. Fallback → if no cards left, reset to full deck
  if (!filtered.length) filtered = deck;
  // 6. Randomly pick from remaining cards
  const card = filtered[Math.floor(Math.random() * filtered.length)];
  // console.log("CARD: ",card);
  return cardToOutcome(card);
}

// Game initializer
function initSevenUpDown(io, tableId = 'table-1') {
  const GAME = 'SEVEN_UP_DOWN';

  const engine = new RoundEngine({
    io,
    game: GAME,
    tableId,
    roundMs: 30000,
    betMs: 25000,
    resultShowMs: 5000,
    hooks: {
      onCreateRound: (p) => createRound(p),

      onLock: async (roundId) => {
        await lockRound(roundId);
        const result = await biasedDice(roundId);
        engine._preResults.set(roundId, result);
      },

      // Biased RNG is computed here
      onComputeResult: (roundId) => {
        const res = engine._preResults.get(roundId);
        // console.log("Res before: ", res);
        if (!res) {
          console.warn(`[${roundId}] No cached result found — using fallback random card`);
          const deck = makeDeck();
          const card = deck[Math.floor(Math.random() * deck.length)];
          res = cardToOutcome(card);
          engine._preResults.set(roundId, res); // store for consistency
        }

        // console.log("Res before:", res);
        return res;
      },

      onSettle: async (roundId, result) => {
        // console.log("Res:", result);

        const { firstOutcome, group, suit, card } = result;
        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: { firstOutcome, group, suit, card },
          meta: { firstOutcome, group, suit, card }
        });
      },

      onEnd: async (_roundId) => {
        engine._preResults.delete(_roundId);
      },
    },
  });

  engine._preResults = new Map();

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
