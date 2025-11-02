// simulate_forbidden_markets.js
// OFFLINE TEST HARNESS — use only in staging/local tests.
// WARNING: Do NOT use this logic in production or any user-facing rounds.

const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const RANK_VAL = Object.fromEntries(RANKS.map((r,i)=>[r, i + 2])); // 2..14 (A=14)

const WIN_WEIGHTAGE = {
  Trio: 6,
  StraightFlush: 5,
  Straight: 4,
  Flush: 3,
  Pair: 2,
  Highcard: 1
};

// ---------------- deck / index utilities
function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, val: RANK_VAL[rank] });
    }
  }
  return deck;
}

function all3CombIndices(n) {
  const out = [];
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        out.push([i, j, k]);
      }
    }
  }
  return out;
}

function drawByIndices(deck, indices) {
  return indices.map(i => deck[i]);
}

// --------------- hand evaluation (same rules as earlier)
function evaluateHand(cards) {
  const vals = cards.map(c => c.val).sort((a,b)=>a-b); // ascending
  const suits = cards.map(c => c.suit);
  const uniqVals = [...new Set(vals)];
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;

  const isTrio = uniqVals.length === 1;
  const isPair = uniqVals.length === 2;
  const isFlush = new Set(suits).size === 1;

  // Straight detection handling A-2-3 low and normal
  let isStraight = false;
  let straightHigh = null; // for tie-breaker: A-2-3 -> 3
  if (uniqVals.length === 3) {
    if (vals[2] - vals[0] === 2 && vals[0] + 1 === vals[1]) {
      isStraight = true;
    } else if (vals.includes(14) && vals.includes(2) && vals.includes(3)) {
      isStraight = true;
    }
    if (isStraight) {
      if (vals.includes(14) && vals[0] === 2 && vals[1] === 3) {
        straightHigh = 3;
      } else {
        straightHigh = vals[2];
      }
    }
  }

  const isStraightFlush = isStraight && isFlush;
  const isHighcard = !isTrio && !isPair && !isFlush && !isStraight;

  const hasK = vals.includes(RANK_VAL["K"]);
  const hasQ = vals.includes(RANK_VAL["Q"]);
  const hasJ = vals.includes(RANK_VAL["J"]);
  const KandQ = hasK && hasQ;
  const JandQ = hasJ && hasQ;

  // tie-break key
  let key = [];
  if (isTrio) {
    key = [vals[0]];
  } else if (isPair) {
    let pairRank = null, kicker = null;
    for (const v of Object.keys(counts).map(Number)) {
      if (counts[v] === 2) pairRank = v;
      if (counts[v] === 1) kicker = v;
    }
    key = [pairRank, kicker];
  } else if (isStraight || isStraightFlush) {
    key = [straightHigh];
  } else {
    key = vals.slice().sort((a,b)=>b-a);
  }

  return {
    Trio: isTrio,
    StraightFlush: isStraightFlush,
    Straight: isStraight && !isFlush,
    Flush: isFlush && !isStraight,
    Pair: isPair,
    Highcard: isHighcard,
    HighestRankVal: Math.max(...vals),
    KandQ,
    JandQ,
    key,
    cards
  };
}

// --------------- compare evaluator
function topCategoryWeight(ev) {
  if (ev.Trio) return WIN_WEIGHTAGE.Trio;
  if (ev.StraightFlush) return WIN_WEIGHTAGE.StraightFlush;
  if (ev.Straight) return WIN_WEIGHTAGE.Straight;
  if (ev.Flush) return WIN_WEIGHTAGE.Flush;
  if (ev.Pair) return WIN_WEIGHTAGE.Pair;
  return WIN_WEIGHTAGE.Highcard;
}

function compareEvaluations(aEval, bEval) {
  const wa = topCategoryWeight(aEval);
  const wb = topCategoryWeight(bEval);
  if (wa !== wb) return wa > wb ? 1 : -1;
  const len = Math.max(aEval.key.length, bEval.key.length);
  for (let i = 0; i < len; i++) {
    const av = aEval.key[i] ?? 0;
    const bv = bEval.key[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

// --------------- compute outcomes (market booleans)
function computeMarketOutcomes(aEval, bEval) {
  const winnerCmp = compareEvaluations(aEval, bEval);
  const winner = winnerCmp === 1 ? "PlayerA" : (winnerCmp === -1 ? "PlayerB" : "Tie");

  return {
    Winner: winner,
    PlayerA_Trio: aEval.Trio,
    PlayerB_Trio: bEval.Trio,
    PlayerA_Pair: aEval.Pair,
    PlayerB_Pair: bEval.Pair,
    PlayerA_StraightFlush: aEval.StraightFlush,
    PlayerB_StraightFlush: bEval.StraightFlush,
    PlayerA_Straight: aEval.Straight,
    PlayerB_Straight: bEval.Straight,
    PlayerA_Flush: aEval.Flush,
    PlayerB_Flush: bEval.Flush,
    PlayerA_KandQ: aEval.KandQ,
    PlayerB_KandQ: bEval.KandQ,
    PlayerA_JandQ: aEval.JandQ,
    PlayerB_JandQ: bEval.JandQ
  };
}

// --------------- house P/L model (simple)
const DEFAULT_PAYOUTS = {
  // define payout multiplier (house pays exposures * payout on win; else keeps stake)
  // (These are example multipliers — replace with your actual odds)
  PlayerA_Trio: 50,
  PlayerB_Trio: 50,
  PlayerA_Pair: 3,
  PlayerB_Pair: 3,
  PlayerA_StraightFlush: 40,
  PlayerB_StraightFlush: 40,
  PlayerA_Straight: 6,
  PlayerB_Straight: 6,
  PlayerA_Flush: 4,
  PlayerB_Flush: 4,
  PlayerA_KandQ: 2,
  PlayerB_KandQ: 2,
  PlayerA_JandQ: 2,
  PlayerB_JandQ: 2,
  Winner_PlayerA: 1.95, // example winner market odds
  Winner_PlayerB: 1.95
};

const DEFAULT_EXPOSURES = {
  // example exposures (stakes)
  PlayerA_Trio: 100000,
  PlayerB_Trio: 10000,
  PlayerA_Pair: 25000,
  PlayerB_Pair: 8000,
  PlayerA_StraightFlush: 5000,
  PlayerB_StraightFlush: 2000,
  PlayerA_Straight: 12000,
  PlayerB_Straight: 6000,
  PlayerA_Flush: 8000,
  PlayerB_Flush: 3500,
  PlayerA_KandQ: 4000,
  PlayerB_KandQ: 2000,
  PlayerA_JandQ: 3000,
  PlayerB_JandQ: 1500,
  Winner_PlayerA: 50000,
  Winner_PlayerB: 45000
};

// --------------- forbidden-check helper
// allowedForbidden: array of strings like 'PlayerA_Trio' or 'Winner=PlayerA'
function isDealAllowed(outcomes, forbiddenSet) {
  for (const f of forbiddenSet) {
    if (f.includes('=')) {
      // Winner=PlayerA style
      const [k, v] = f.split('=');
      if (k === 'Winner' && outcomes.Winner === v) return false;
      continue;
    }
    if (outcomes[f]) return false;
  }
  return true;
}

// --------------- simulation core
function simulate({
  rounds = 20000,
  forbidden = [],            // array of forbidden strings, e.g. ['PlayerA_Trio','PlayerA_KandQ','Winner=PlayerA']
  exposures = DEFAULT_EXPOSURES,
  payouts = DEFAULT_PAYOUTS
} = {}) {
  const deck = makeDeck();
  const n = deck.length;
  const allIdx = all3CombIndices(n);

  // Precompute allowed A combos based on forbidden list (we evaluate A only here)
  const allowedA = allIdx.filter(idxs => {
    const aCards = drawByIndices(deck, idxs);
    const aEval = evaluateHand(aCards);
    // Build a partial outcomes for A-only markets to test forbids that affect only A:
    // For forbids that depend on B or Winner we can't decide here; we keep combos that don't violate A-only forbids.
    const partialOutcomes = {
      PlayerA_Trio: aEval.Trio,
      PlayerA_Pair: aEval.Pair,
      PlayerA_StraightFlush: aEval.StraightFlush,
      PlayerA_Straight: aEval.Straight,
      PlayerA_Flush: aEval.Flush,
      PlayerA_KandQ: aEval.KandQ,
      PlayerA_JandQ: aEval.JandQ
    };
    // If any forbidden item directly applies to A-only and is true, exclude this A combo
    for (const f of forbidden) {
      if (!f.startsWith('PlayerA_')) continue;
      if (partialOutcomes[f]) return false;
    }
    // For forbids that can't be decided until B is known (e.g., Winner=PlayerA or PlayerB_Trio),
    // we let A combos pass; final filtering happens during pairing with a B combo.
    return true;
  });

  if (allowedA.length === 0) {
    throw new Error("No allowed Player A combinations after applying A-specific forbidden filters.");
  }

  // counters
  const counts = {
    Winner: { PlayerA: 0, PlayerB: 0, Tie: 0 }
  };
  const marketKeys = [
    "PlayerA_Trio","PlayerB_Trio",
    "PlayerA_Pair","PlayerB_Pair",
    "PlayerA_StraightFlush","PlayerB_StraightFlush",
    "PlayerA_Straight","PlayerB_Straight",
    "PlayerA_Flush","PlayerB_Flush",
    "PlayerA_KandQ","PlayerB_KandQ",
    "PlayerA_JandQ","PlayerB_JandQ"
  ];
  for (const k of marketKeys) counts[k] = 0;

  let roundsSimulated = 0;
  let totalHouseProfit = 0;
  let worstHouseProfit = Infinity; // min profit (most negative)

  for (let r = 0; r < rounds; r++) {
    // pick A uniformly from allowedA
    const aIdx = allowedA[Math.floor(Math.random() * allowedA.length)];
    const remaining = [];
    for (let i = 0; i < n; i++) if (!aIdx.includes(i)) remaining.push(i);

    // choose a random B combo from remaining
    const bIdx = [];
    while (bIdx.length < 3) {
      const cand = remaining[Math.floor(Math.random() * remaining.length)];
      if (!bIdx.includes(cand)) bIdx.push(cand);
    }

    const aCards = drawByIndices(deck, aIdx);
    const bCards = drawByIndices(deck, bIdx);

    const aEval = evaluateHand(aCards);
    const bEval = evaluateHand(bCards);

    const outcomes = computeMarketOutcomes(aEval, bEval);

    // Now check forbidden set (including winner-based forbids or B-based forbids)
    if (!isDealAllowed(outcomes, new Set(forbidden))) {
      // If forbidden, skip this round without counting. To keep sampling efficiency,
      // we simply continue and do not increment r; but to avoid infinite loop when forbid is too strict,
      // we instead count how many skips and break if too many.
      r--; // retry this iteration
      // Add a safeguard: if too many successive rejections occur, abort to avoid infinite loop
      // (we track via roundsSimulated vs attempts — here simplified)
      // To keep code straightforward, we will allow up to 10 * rounds trial attempts.
      if (r < -rounds * 9) throw new Error("Too many forbidden rejections — adjust forbidden set or reduce strictness.");
      continue;
    }

    // Count outcomes
    counts.Winner[outcomes.Winner]++;
    for (const k of marketKeys) if (outcomes[k]) counts[k]++;

    // compute house profit this round (simple model)
    // House keeps stake if outcome false; pays exposures * payout if true (loss).
    let roundProfit = 0;
    // handle Winner markets separately: exposures map uses keys Winner_PlayerA / Winner_PlayerB
    const winnerKeyA = "Winner_PlayerA";
    const winnerKeyB = "Winner_PlayerB";

    for (const mk of Object.keys(exposures)) {
      const stake = exposures[mk] || 0;
      const payout = payouts[mk] || 0;
      let outcomeHit = false;

      if (mk === winnerKeyA) {
        outcomeHit = (outcomes.Winner === "PlayerA");
      } else if (mk === winnerKeyB) {
        outcomeHit = (outcomes.Winner === "PlayerB");
      } else {
        outcomeHit = !!outcomes[mk];
      }

      if (outcomeHit) {
        roundProfit -= stake * payout;
      } else {
        roundProfit += stake;
      }
    }

    totalHouseProfit += roundProfit;
    worstHouseProfit = Math.min(worstHouseProfit, roundProfit);

    roundsSimulated++;
  }

  // frequencies
  const freqs = {};
  freqs.Winner = {
    PlayerA: counts.Winner.PlayerA / roundsSimulated,
    PlayerB: counts.Winner.PlayerB / roundsSimulated,
    Tie: counts.Winner.Tie / roundsSimulated
  };
  for (const k of marketKeys) freqs[k] = counts[k] / roundsSimulated;

  return {
    roundsSimulated,
    counts,
    freqs,
    totalHouseProfit,
    avgHouseProfitPerRound: totalHouseProfit / roundsSimulated,
    worstHouseProfitPerRound: worstHouseProfit
  };
}

// ------------------ main / usage
function main() {
  const rounds = Number(process.argv[2] || 20000);

  // EDIT this array to forbid markets during the simulation (test-only)
  // Examples:
  // const FORBIDDEN_MARKETS = ['PlayerA_Trio']; // only forbid A's trio
  // const FORBIDDEN_MARKETS = ['PlayerA_Trio','PlayerA_Pair','PlayerA_KandQ']; // forbid multiple A markets
  // const FORBIDDEN_MARKETS = ['Winner=PlayerA']; // forbid A winning any round
  const FORBIDDEN_MARKETS = ['PlayerA_Trio']; // adjust as needed for tests

  // You may adapt exposures/payouts to match your real book
  const exposures = DEFAULT_EXPOSURES;
  const payouts = DEFAULT_PAYOUTS;

  console.log("OFFLINE TEST RUN");
  console.log("Rounds (target):", rounds);
  console.log("Forbidden markets:", FORBIDDEN_MARKETS);
  console.log("WARNING: This harness removes forbidden outcomes from sampled deals. Use only offline.");

  const out = simulate({ rounds, forbidden: FORBIDDEN_MARKETS, exposures, payouts });

  console.log("\n--- RESULTS ---");
  console.log("Rounds simulated:", out.roundsSimulated);
  console.log("Counts:", JSON.stringify(out.counts, null, 2));
  console.log("Frequencies:", JSON.stringify(out.freqs, null, 2));
  console.log("House P/L (total):", out.totalHouseProfit);
  console.log("Avg house P/L per round:", out.avgHouseProfitPerRound);
  console.log("Worst single-round house P/L:", out.worstHouseProfitPerRound);
}

main();
