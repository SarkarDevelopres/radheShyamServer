// games/dragontiger.js
const { RoundEngine } = require("./engine");
const { createRound, lockRound, settleRoundTx } = require("../db/store");

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

function rngDragonTiger() {
  const dragon = drawCard();
  const tiger = drawCard();
  const winner = determineOutcome(dragon, tiger);

  const outcome = {
    result: winner,   // DRAGON | TIGER | TIE
    dragonRank: dragon.rank,
    dragonSuit: dragon.suit,
    dragonGroup: dragon.group,
    tigerRank: dragon.rank,
    tigerSuit: tiger.suit,
    tigerGroup: tiger.group,
  };
  // console.log(winner);
  // console.log(dragon);
  // console.log(tiger);
  

  return { dragon, tiger, outcome, odds: DRAGON_TIGER_ODDS };
}

function initDragonTiger(io, tableId = "default") {
  const GAME = "DRAGON_TIGER";
  const room = `${GAME}:${tableId}`;
  const prepared = new Map();

  const engine = new RoundEngine({
    io,
    game: GAME,
    tableId,
    roundMs: 30000,
    betMs: 25000,
    resultShowMs: 5000,

    hooks: {
      decorateSnapshot: (snap) => {
        const rid = snap.id;
        const res = rid && prepared.get(rid);
        return res
          ? { ...snap, dragonCard: res.dragon, tigerCard: res.tiger }
          : snap;
      },

      onCreateRound: async (p) => {
        const row = await createRound(p);
        const roundId = row._id;
        if (!roundId) throw new Error("createRound must return roundId");

        let res = prepared.get(roundId);
        if (!res) {
          res = rngDragonTiger();
          prepared.set(roundId, res);
        }

        io.to(room).emit("dragontiger:cards", {
          roundId,
          startAt: p.startAt,
          betsCloseAt: p.betsCloseAt,
          resultAt: p.resultAt,
        });

        return row;
      },

      onLock: async (roundId) => {
        await lockRound(roundId);
      },

      onComputeResult: (roundId) => {
        const res = prepared.get(roundId);
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
        const res = prepared.get(roundId) || result;
        // console.log("CAME RESULTS: ",result);
        // console.log("Stored RESULTS: ",prepared.get(roundId));
        // console.log("REAL RESULTS: ",res);
        
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
        prepared.delete(roundId);
      },
    },
  });

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
