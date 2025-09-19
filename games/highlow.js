// games/highlow.js
const { RoundEngine } = require("./engine");
const { createRound, lockRound, settleRoundTx } = require("../db/store");

/** =========================
 *  High–Low helpers
 *  ========================= */

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["hearts", "diamonds", "clubs", "spades"];

// Configure rules here:
const ACE_HIGH = true;  // If true, Ace = 14; else Ace = 1
const TIE_PUSH = false;  // If true, tie = push/refund (winMarket = null)

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
  // console.log(deck);

  return deck;
}

function drawTwoCardsNoReplace() {
  const deck = makeDeck();
  // Partial Fisher–Yates to mix enough for two draws
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

function getDynamicHighLowOdds(baseCard, margin = 0.06) {
  const v = rankValue(baseCard.rank);
  const cardsHigher = 4 * (14 - v);
  const cardsLower = 4 * (v - 2);
  const cardsTie = 3;
  const live = cardsHigher + cardsLower;

  const probHigh = cardsHigher / live;
  const probLow = cardsLower / live;
  const probTie = cardsTie / 51;

  const roundOdds = (p) => ((1 - margin) / p);

  const odds = {
    HIGH: Math.min(12, roundOdds(probHigh)),
    LOW: Math.max(1.01, roundOdds(probLow)),
    TIE: Math.min(50, roundOdds(probTie)),
    RED: 1.9,
    BLACK: 1.9,
    HEARTS: 3.9,
    DIAMONDS: 3.9,
    CLUBS: 3.9,
    SPADES: 3.9
  };

  // Round to 2 decimal places
  for (let k in odds) {
    odds[k] = Math.round(odds[k] * 100) / 100;
  }

  return odds;
}


/**
 * Produce per-round result we’ll store & emit.
 * We pre-select both cards at LOCK so base is fixed before settle.
 */
function rngHighLow() {
  const { baseCard, nextCard } = drawTwoCardsNoReplace();

  let suit = nextCard.suit;
  let group = "red";
  if (suit === "hearts" || suit === "diamonds") group = "red";
  else group = "black";

  const firstOutcome = compareCards(baseCard, nextCard); // 'HIGH' | 'LOW' | 'TIE'
  const odds = getDynamicHighLowOdds(baseCard);          // NEW: inject odds

  let finalOutcome = { firstOutcome, suit, group, baseCard, nextCard };
  let winMarket = null;
  if (firstOutcome === "HIGH") winMarket = "high";
  else if (firstOutcome === "LOW") winMarket = "low";
  else winMarket = null;

  // console.log(nextCard);
  

  return { baseCard, nextCard, outcome: finalOutcome, winMarket, odds };  // RETURN odds
}


/** ===========================================================
 *  High–Low init — non-blocking hooks + explicit reveal
 *  =========================================================== */
function initHighLow(io, tableId = "default") {
  const GAME = "HIGH_LOW";
  const room = `${GAME}:${tableId}`;

  // Keep prepared result between lock and settle
  const prepared = new Map(); // roundId -> { baseCard, nextCard, outcome, winMarket }
  let lastPrepared = null;    // latest prepared for this table (fallback safety)

  const engine = new RoundEngine({
    io,
    game: GAME,
    tableId,
    roundMs: 30000,
    betMs: 25000,
    resultShowMs: 5000,  // result -> end
    hooks: {
      /**
       * Create/open a round in DB (short op). Engine will emit round:start.
       * Accepts engine payload: { game, tableId, startAt, betsCloseAt, resultAt, endAt, status }
       */
      decorateSnapshot: (snap) => {
        // console.log("Decorate Snap called");

        const rid = snap.id;                      // engine.publicRound() uses 'id'
        const res = rid && prepared.get(rid);
        return res ? { ...snap, baseCard: res.baseCard } : snap;
      },

      onCreateRound: async (p) => {
        // 1) Create the round to get a real roundId
        // p typically has timings + game/table. Your createRound should return the new id.
        const row = await createRound(p);              // -> { roundId, ... }  (ensure this!)
        // console.log("Row: ", row);

        const roundId = row._id;
        if (!roundId) throw new Error("createRound must return roundId");

        // 2) PREPARE the full outcome ONCE for this round
        let res = prepared.get(roundId);
        // console.log("OUTCOME: ",!res);

        if (!res) {
          res = rngHighLow();                          // { baseCard, nextCard, outcome, winMarket }
          // console.log("NEWOUTCOME: ",res);

          prepared.set(roundId, res);
        }

        // 3) (Optional but recommended) fairness commit
        // store a commitment or at least persist baseCard at create time so you can’t change it later

        // 4) REVEAL BASE at the start of the round (this is your requirement)
        // Engine will also emit its own `round:start`. Keep that for timers/state,
        // and add a dedicated base reveal event that your client listens to.
        io.to(room).emit("highlow:base", {
          roundId,
          baseCard: res.baseCard,
          startAt: p.startAt,
          betsCloseAt: p.betsCloseAt,
          resultAt: p.resultAt,
        });

        return row; // important: return the DB row so engine continues
      },

      onLock: async (roundId) => {
        // close betting
        await lockRound(roundId);
        // no reveal here (base is already visible; next will show at result)
      },

      /**
       * COMPUTE RESULT: Pure + instant (no DB).
       * Engine will emit 'round:result' immediately with this payload.
       */
      onComputeResult: (roundId) => {
        // Engine calls this at the result tick (immediately after lock, or a few seconds later depending on your timings)
        const res = prepared.get(roundId) || rngHighLow(); // fallback shouldn’t happen if create prepared
        return {
          roundId,
          baseCard: res.baseCard,  // optional
          nextCard: res.nextCard,
          odds: res.odds,
          outcome: res.outcome.firstOutcome,    // 'HIGH'|'LOW'|'TIE'
        };
      },

      onSettle: async (roundId, result) => {
        // console.log("RESULT: ", result);

        const res = prepared.get(roundId) || result;
        await settleRoundTx({
          roundId,
          game: GAME,
          outcome: res.outcome,
          odds: res.odds,
          meta: {
            baseCard: res.baseCard,
            nextCard: res.nextCard,
            winMarket: res.winMarket,
            tiePush: TIE_PUSH,
          },
        });
      },

      onEnd: async (roundId) => {
        prepared.delete(roundId);
      },
    },
  });

  // Optional local join handler (if not done globally)
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

module.exports = { initHighLow };
