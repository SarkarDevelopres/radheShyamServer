// games/dragontiger.js
const { RoundEngine } = require("./engine");
const { createRound, lockRound, settleRoundTx } = require("../db/store");
const Bet = require("../db/models/bet");

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

const DRAGON_TIGER_ODDS = {
  DRAGON: 2.04,
  TIGER: 2.04,
  TIE: 12.2,
  DRAGON_RED: 1.9,
  DRAGON_BLACK: 1.9,
  DRAGON_HEARTS: 3.9,
  DRAGON_CLUBS: 3.9,
  DRAGON_SPADES: 3.9,
  DRAGON_DIAMONDS: 3.9,
  TIGER_RED: 1.9,
  TIGER_BLACK: 1.9,
  TIGER_DIAMONDS: 3.9,
  TIGER_HEARTS: 3.9,
  TIGER_CLUBS: 3.9,
  TIGER_SPADES: 3.9,
};

function drawCard() {
  const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  const val = RANK_VAL[rank];
  const group = (suit === "hearts" || suit === "diamonds") ? "red" : "black";
  return { rank, suit, val, group };
}

function determineOutcome(dragon, tiger) {
  if (dragon.val > tiger.val) return "DRAGON";
  if (dragon.val < tiger.val) return "TIGER";
  return "TIE";
}

// ---- Biased RNG for DragonTiger ----
async function biasedDragonTiger(roundId) {
  const bets = await Bet.find({ roundId, type: "casino", status: "OPEN" });

  // Aggregate stake totals
  const totals = {};
  for (const b of bets) {
    const pick = String(b.market || "").toUpperCase();
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

  let dragon, tiger, winner;


  // Keep drawing until result avoids worst market
  do {
    dragon = drawCard();
    tiger = drawCard();
    winner = determineOutcome(dragon, tiger);
  } while (
    (worst === "DRAGON" && winner === "DRAGON") ||
    (worst === "TIGER" && winner === "TIGER") ||
    (worst === "TIE" && winner === "TIE") ||
    (worst && worst.startsWith("DRAGON_") &&
      worst.split("_")[1] === dragon.group.toUpperCase()) ||
    (worst && worst.startsWith("DRAGON") &&
      worst.split("_")[1] === dragon.suit.toUpperCase()) ||
    (worst && worst.startsWith("TIGER_") &&
      worst.split("_")[1] === tiger.group.toUpperCase()) ||
    (worst && worst.startsWith("TIGER") &&
      worst.split("_")[1] === tiger.suit.toUpperCase())
  );

  const outcome = {
    result: winner,
    dragonRank: dragon.rank,
    dragonSuit: dragon.suit,
    dragonGroup: dragon.group,
    tigerRank: tiger.rank,
    tigerSuit: tiger.suit,
    tigerGroup: tiger.group,
  };

  return { dragon, tiger, outcome, odds: DRAGON_TIGER_ODDS };
}

function initDragonTiger(io, tableId = "default") {
  const GAME = "DRAGON_TIGER";
  const room = `${GAME}:${tableId}`;

  const engine = new RoundEngine({
    io,
    game: GAME,
    tableId,
    roundMs: 30000,
    betMs: 25000,
    resultShowMs: 5000,

    hooks: {
      onCreateRound: async (p) => {
        const row = await createRound(p);
        return row;
      },

      onLock: async (roundId) => {
        await lockRound(roundId);
        const result = await biasedDragonTiger(roundId);
        engine._preResults.set(roundId, result);
      },

      onComputeResult: (roundId) => {
        const res = engine._preResults.get(roundId);
        if (!res) throw new Error("Missing result for Dragon Tiger round");
        return {
          roundId,
          dragon: res.dragon,
          tiger: res.tiger,
          odds: res.odds,
          outcome: res.outcome.result,
        };
      },

      onSettle: async (roundId, result) => {
        const res = engine._preResults.get(roundId) || result;
        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: res.outcome,
          odds: res.odds,
          meta: {
            dragonCard: res.dragon,
            tigerCard: res.tiger,
            result: res.outcome.result,
          },
        });
      },

      onEnd: (roundId) => {
        engine._preResults.delete(roundId);
      },
    },
  });

  engine._preResults = new Map();

  io.on("connection", (socket) => {
    socket.on("join", ({ game, tableId: t }) => {
      if (String(game).toUpperCase() === GAME && t === tableId) {
        socket.join(room);
      }
    });
  });

  engine.start();
  return engine;
}

module.exports = { initDragonTiger };
