// games/highlow.js
const { RoundEngine } = require("./engine");
const { createRound, lockRound, settleRoundTx } = require("../db/store");

// Odds (decimal, total return incl. stake) — adjust as you like
const ODDS = { high: 1.9, low: 1.9 };  // tie returns stake when TIE_PUSH = true

/** =========================
 *  High–Low helpers
 *  ========================= */
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["hearts", "diamonds", "clubs", "spades"];

// Configure rules here:
const ACE_HIGH = true;  // If true, Ace = 14; else Ace = 1
const TIE_PUSH = true;  // If true, tie = push/refund (winMarket = null)

function rankValue(rank) {
  const r = String(rank).toUpperCase();
  if (r === "A") return ACE_HIGH ? 14 : 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  return parseInt(r, 10);
}

function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push({ rank: r, suit: s });
  }
  return deck;
}

function drawTwoCardsNoReplace() {
  const deck = makeDeck();
  for (let i = deck.length - 1; i > deck.length - 10; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const baseCard = deck.pop();
  const nextCard = deck.pop();
  return { baseCard, nextCard };
}

function compareCards(baseCard, nextCard) {
  const a = rankValue(baseCard.rank);
  const b = rankValue(nextCard.rank);
  if (b > a) return "HIGH";
  if (b < a) return "LOW";
  return "TIE";
}

function rngHighLow() {
  const { baseCard, nextCard } = drawTwoCardsNoReplace();
  const outcome = compareCards(baseCard, nextCard); // 'HIGH' | 'LOW' | 'TIE'
  let winMarket = null; // 'high' | 'low' | null (push)
  if (outcome === "HIGH") winMarket = "high";
  else if (outcome === "LOW") winMarket = "low";
  else winMarket = null; // TIE → push if TIE_PUSH
  return { baseCard, nextCard, outcome, winMarket };
}

/** =========================================================== */
function fiks(io, tableId = "default") {
  const GAME = "HIGH_LOW";
  const room = `${GAME}:${tableId}`;
  const prepared = new Map(); // roundId -> { baseCard, nextCard, outcome, winMarket }

  const engine = new RoundEngine({
    io,
    game: GAME,
    tableId,
    roundMs: 15000,
    betMs: 12000,
    resultShowMs: 3000,
    hooks: {
      // (optional) include base and odds in the round:start snapshot if your engine supports a decorator
      decorateSnapshot: (snap) => {
        const rid = snap?.id;
        const res = rid && prepared.get(rid);
        return res ? { ...snap, baseCard: res.baseCard, odds: ODDS } : { ...snap, odds: ODDS };
      },

      onCreateRound: async (p) => {
        const row = await createRound(p);
        const roundId = row._id;
        if (!roundId) throw new Error("createRound must return roundId");

        let res = prepared.get(roundId);
        if (!res) {
          res = rngHighLow();
          prepared.set(roundId, res);
        }

        // If you still emit a separate base event, include odds there too
        io.to(room).emit("highlow:base", {
          roundId,
          baseCard: res.baseCard,
          odds: ODDS,
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
        const res = prepared.get(roundId) || rngHighLow();
        return {
          roundId,
          baseCard: res.baseCard,   // optional (already shown)
          nextCard: res.nextCard,
          outcome: res.outcome,     // 'HIGH' | 'LOW' | 'TIE'
          odds: ODDS,               // include odds for client display if desired
        };
      },

      onSettle: async (roundId, result) => {
        const res = prepared.get(roundId) || result;
        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: res.outcome,
          meta: {
            baseCard: res.baseCard,
            nextCard: res.nextCard,
            winMarket: res.winMarket, // 'high' | 'low' | null
            tiePush: TIE_PUSH,
            odds: ODDS,               // pass odds to settlement
          },
        });
      },

      onEnd: async (roundId) => {
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

module.exports = { fiks };
