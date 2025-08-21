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

/**
 * Produce per-round result we’ll store & emit.
 * We pre-select both cards at LOCK so base is fixed before settle.
 */
function rngHighLow() {
  const { baseCard, nextCard } = drawTwoCardsNoReplace();
  const outcome = compareCards(baseCard, nextCard); // 'HIGH' | 'LOW' | 'TIE'
  let winMarket = null; // 'high' | 'low' | null (push)
  if (outcome === "HIGH") winMarket = "high";
  else if (outcome === "LOW") winMarket = "low";
  else winMarket = null; // 'TIE' → push if TIE_PUSH
  return { baseCard, nextCard, outcome, winMarket };
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
    roundMs: 15000,      // start -> result
    betMs: 12000,        // start -> lock (reveal baseCard here)
    resultShowMs: 3000,  // result -> end
    hooks: {
      /**
       * Create/open a round in DB (short op). Engine will emit round:start.
       * Accepts engine payload: { game, tableId, startAt, betsCloseAt, resultAt, endAt, status }
       */
      decorateSnapshot: (snap) => {
        console.log("Decorate Snap called");
        
        const rid = snap.id;                      // engine.publicRound() uses 'id'
        const res = rid && prepared.get(rid);
        return res ? { ...snap, baseCard: res.baseCard } : snap;
      },

      onCreateRound: async (p) => {
        // 1) Create the round to get a real roundId
        // p typically has timings + game/table. Your createRound should return the new id.
        const row = await createRound(p);              // -> { roundId, ... }  (ensure this!)
        console.log("Row: ", row);

        const roundId = row._id;
        if (!roundId) throw new Error("createRound must return roundId");

        // 2) PREPARE the full outcome ONCE for this round
        let res = prepared.get(roundId);
        if (!res) {
          res = rngHighLow();                          // { baseCard, nextCard, outcome, winMarket }
          console.log("Result: ", res);

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
          outcome: res.outcome,    // 'HIGH'|'LOW'|'TIE'
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
