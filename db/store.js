// db/store.js
const User = require('./models/user');
const Bet = require('./models/bet');
const Odds = require('../db/models/odds');
const Round = require('./models/round');
const Transaction = require('./models/transaction'); // optional but recommended
const mongoose = require('mongoose');
const SevenODDS = {
  UP: 1.9,
  DOWN: 1.9,
  SEVEN: 12,
  RED: 1.9,
  BLACK: 1.9,
  HEARTS: 4,
  DIAMONDS: 3.9,
  CLUBS: 3.9,
  SPADES: 3.9,
  // Optional: Exact card guess (if you ever add that)
  // "7_of_hearts": 50,
};

const AAAODDS = {
  AMAR: 2.1,
  AKBAR: 3.2,
  ANTHONY: 4.2,
  RED: 1.9,
  BLACK: 1.9,
  HEARTS: 3.9,
  DIAMONDS: 3.9,
  CLUBS: 3.9,
  SPADES: 3.9,
};

// HIGH_LOW game
const HLODDS = {
  HIGH: 1.9,      // 24/51 ≈ 47.06% win → ~10.6% house edge at 1.9
  LOW: 1.9,       // same as HIGH
  TIE: 16,       // tie (same rank), 3/51 ≈ 5.88% → ~5.9% edge

  RED: 1.9,       // ≈50% → ~5% edge
  BLACK: 1.9,     // ≈50% → ~5% edge

  HEARTS: 3.9,    // ≈25% → ~2.5% edge
  DIAMONDS: 3.9,  // ≈25% → ~2.5% edge
  CLUBS: 3.9,     // ≈25% → ~2.5% edge
  SPADES: 3.9     // ≈25% → ~2.5% edge
};


// ---------- helpers ----------
const normalize = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);
const toMs = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

// ---------- rounds ----------
async function createRound({ game, tableId, startAt, betsCloseAt, resultAt, endAt, settleAt }) {
  // Accept both resultAt/endAt from engine and older settleAt for backward-compat
  const doc = {
    game: normalize(game),
    tableId,
    startAt,
    betsCloseAt,
    // prefer resultAt; if schema only has settleAt, you can map accordingly
    resultAt: resultAt ?? settleAt,
    endAt: endAt ?? null,
    // if your Round schema still uses 'settleAt', also set it:
    settleAt: resultAt ?? settleAt ?? null,
    status: 'OPEN',
  };
  // console.log(doc);

  return Round.create(doc);
}

async function lockRound(roundId) {
  await Round.updateOne(
    { _id: roundId, status: 'OPEN' },
    { $set: { status: 'LOCKED' } }
  );
}

// (optional) call this from your engine's onLock hook; safe to keep even if unused
async function lockBetsForRound(roundId) {
  return Bet.updateMany(
    { roundId, type: 'casino', status: 'OPEN' },
    { $set: { status: 'LOCKED' } }
  );
}


async function fetchBalance(userId) {
  // console.log("USERID: ", userId);
  console.log(userId);

  const u = await User.findById(userId).select("balance");
  return u;
}
// ---------- casino bet placement (socket flow) ----------
async function placeBetTx({ userId, game, tableId, roundId, market, stake }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const r = await Round.findById(roundId).session(session);
    if (!r || r.status !== 'OPEN' || Date.now() >= toMs(r.betsCloseAt)) {
      throw new Error('BETS_LOCKED');
    }

    const u = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: stake } },
      { $inc: { balance: -stake } },
      { new: true, session }
    );
    if (!u) throw new Error('INSUFFICIENT FUNDS');

    const normGame = normalize(game);
    const normMarket = normalize(market);

    const [betDoc] = await Bet.create(
      [{
        userId,
        type: 'casino',
        game: normGame,
        tableId,
        roundId,
        market: normMarket,
        stake,
        status: 'OPEN',
      }],
      { session }
    );

    try {
      await Transaction.create(
        [{
          userId,
          type: 'bet_place',
          amount: -stake,
          balanceAfter: u.balance,
          meta: { betId: betDoc._id, roundId, game: normGame, market: normMarket },
        }],
        { session }
      );
    } catch (_) { }

    await session.commitTransaction();
    session.endSession();
    return { ok: true, balance: u.balance };
  } catch (e) {
    await session.abortTransaction().catch(() => { });
    session.endSession();
    return { ok: false, error: e.message };
  }
}

// ---------- sports bet placement (HTTP route) ----------
async function placeSportsBetTx({ userId, eventId, market, selection, stake, odds, lay, deductAmount }) {
  // console.log("USerID: u", userId);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const u = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: deductAmount } },
      { $inc: { balance: -deductAmount } },
      { new: true, session }
    );
    if (!u) throw new Error('INSUFFICIENT_FUNDS');

    const potentialPayout = odds ? Math.floor(stake * odds) : undefined;
   
    const [betDoc] = await Bet.create(
      [{
        userId,
        type: 'sports',
        eventId,
        market,
        selection,
        stake,
        odds,
        status: 'OPEN',
        potentialPayout,
        lay:lay
      }],
      { session }
    );

    const setBetTrue = await Odds.findOneAndUpdate(
      { matchId: eventId, isBet: false },   // condition
      { $set: { isBet: true } },            // update
      { new: true }                         // return updated doc
    );

    try {
      await Transaction.create(
        [{
          userId,
          type: 'bet_place',
          amount: -stake,
          balanceAfter: u.balance,
          meta: { betId: betDoc._id, eventId, market, selection, odds, provider: bookmakerKey },
        }],
        { session }
      );
    } catch (_) { }

    await session.commitTransaction();
    session.endSession();
    return { ok: true, _doc: { balance: u.balance } };
  } catch (e) {
    await session.abortTransaction().catch(() => { });
    session.endSession();
    return { ok: false, error: e.message };
  }
}

// ---------- casino settlement (called by engine hook) ----------
async function settleRoundTx({ roundId, game, outcome, meta = {}, odds = {} }) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // 1) Load round & idempotency guard
    const round = await Round.findById(roundId).session(session);
    if (!round) throw new Error(`Round ${roundId} not found`);
    if (round.status === 'SETTLED') {
      return { ok: true, alreadySettled: true, outcome: round.outcome };
    }

    const canonGame = normalize(game);
    const canonOutcome = outcome.card;
    const canonFirstOutcome = normalize(outcome.firstOutcome);
    const canonGroupOutcome = normalize(outcome.group);
    const canonSuitOutcome = normalize(outcome.suit);

    // 2) Load all unsettled casino bets for this round
    const bets = await Bet.find({ roundId, settled: { $ne: true }, type: 'casino' }).session(session);

    // 3) Decide winners / payouts
    const betUpdates = [];
    const walletIncs = []; // bulk ops for User
    const txDocs = [];
    let totalPayout = 0;
    let winners = 0;
    let losers = 0;
    let pushes = 0;

    if (canonGame === 'SEVEN_UP_DOWN') {

      // console.log("I TOO WAS CALLED");
      for (const b of bets) {
        const pick = normalize(b.market);
        const won = pick === canonFirstOutcome || pick === canonGroupOutcome || pick == canonSuitOutcome;
        const odd = won ? (SevenODDS[pick] || 0) : 0;
        const payout = won ? Math.round(Number(b.stake) * Number(odd)) : 0;


        betUpdates.push({
          updateOne: {
            filter: { _id: b._id },
            update: {
              $set: {
                settled: true,
                status: won ? 'WON' : 'LOST',
                won,
                payout,
                outcome: pick,
                meta,
                settledAt: new Date(),
              },
            },
          },
        });

        if (payout > 0) {
          walletIncs.push({
            updateOne: {
              filter: { _id: b.userId },
              update: { $inc: { balance: Number(payout) } },
            },
          });
          txDocs.push({
            userId: b.userId,
            type: 'payout_win',
            amount: payout,
            // balanceAfter: (optional; see note below)
            meta: { betId: b._id, roundId, game: canonGame, market: pick, outcome: canonOutcome }
          });
          totalPayout += payout;
          winners++;


        } else {
          losers++;
        }
      }
    } else if (canonGame === 'HIGH_LOW') {


      const tiePush = meta.tiePush !== false;
      const marketWins = canonOutcome === 'HIGH' ? 'high' : canonOutcome === 'LOW' ? 'low' : null;
      const roundOdds = odds

      for (const b of bets) {
        const pick = normalize(b.market);
        // console.log("PICK :", pick);

        let won = pick === canonFirstOutcome || pick === canonGroupOutcome || pick == canonSuitOutcome;
        let status = won ? 'WIN' : 'LOST';
        let payout = won ? Math.round(Number(b.stake) * Number(roundOdds[pick] || 0)) : 0;

        betUpdates.push({
          updateOne: {
            filter: { _id: b._id },
            update: {
              $set: {
                settled: true,
                status,      // 'WON' | 'LOST' | 'PUSH'
                won,
                payout,
                outcome: canonOutcome,
                meta,
                settledAt: new Date(),
              },
            },
          },
        });

        if (payout > 0) {
          walletIncs.push({
            updateOne: {
              filter: { _id: b.userId },
              update: { $inc: { balance: Number(payout) } },
            },
          });
          txDocs.push({
            userId: b.userId,
            type: 'payout_win',
            amount: payout,
            balanceAfter: payout,
            meta: { betId: b._id, roundId, game: canonGame, market: pick, outcome: canonOutcome }
          });
          totalPayout += payout;
          if (status === 'PUSH') pushes++; else winners++;
        } else if (status === 'PUSH') {
          pushes++;
        } else {
          losers++;
        }
      }
    }
    else if (canonGame === "AMAR_AKBAR_ANTHONY") {
      for (const b of bets) {
        const pick = normalize(b.market);                 // "AMAR" | "AKBAR" | "ANTHONY"
        const won = pick === canonFirstOutcome || pick === canonGroupOutcome || pick == canonSuitOutcome;
        const odd = won ? (AAAODDS[pick] || 0) : 0;

        // Full payout = stake * odd (adjust if you deduct commission elsewhere)
        const payout = won ? Math.round(Number(b.stake) * odd) : 0;

        betUpdates.push({
          updateOne: {
            filter: { _id: b._id },
            update: {
              $set: {
                settled: true,
                status: won ? 'WON' : 'LOST',
                won,
                payout,
                outcome: canonOutcome,   // "AMAR"/"AKBAR"/"ANTHONY"
                meta,
                settledAt: new Date(),
              },
            },
          },
        });

        if (payout > 0) {
          walletIncs.push({
            updateOne: {
              filter: { _id: b.userId },
              update: { $inc: { balance: Number(payout) } },
            },
          });
          txDocs.push({
            userId: b.userId,
            type: 'payout_win',
            amount: payout,
            balanceAfter: payout,
            meta: { betId: b._id, roundId, game: canonGame, market: pick, outcome: canonOutcome }
          });
          totalPayout += payout;
          winners++;
        } else {
          losers++;
        }
      }
    }
    else if (canonGame === "DRAGON_TIGER") {
      const result = normalize(outcome.result);
      const roundOdds = odds
      const tSuit = normalize(outcome.tigerSuit);
      const tigerSuit = `TIGER_${tSuit}`;
      const dSuit = normalize(outcome.dragonSuit);
      const dragonSuit = `DRAGON_${dSuit}`;


      const tGroup = normalize(outcome.tigerGroup);
      const tigerGroup = `TIGER_${tGroup}`
      const dGroup = normalize(outcome.dragonGroup);
      const draginGroup = `DRAGON_${dGroup}`

      for (const b of bets) {
        const pick = normalize(b.market);                 // "AMAR" | "AKBAR" | "ANTHONY"

        const won = pick === result || pick === tigerSuit || pick == tigerGroup || pick === dragonSuit || pick === draginGroup;
        const odd = won ? (roundOdds[pick] || 0) : 0;

        // Full payout = stake * odd (adjust if you deduct commission elsewhere)
        const payout = won ? Math.round(Number(b.stake) * odd) : 0;

        betUpdates.push({
          updateOne: {
            filter: { _id: b._id },
            update: {
              $set: {
                settled: true,
                status: won ? 'WON' : 'LOST',
                won,
                payout,
                outcome: result,
                meta,
                settledAt: new Date(),
              },
            },
          },
        });

        if (payout > 0) {
          walletIncs.push({
            updateOne: {
              filter: { _id: b.userId },
              update: { $inc: { balance: Number(payout) } },
            },
          });
          txDocs.push({
            userId: b.userId,
            type: 'payout_win',
            amount: payout,
            balanceAfter: payout,
            meta: { betId: b._id, roundId, game: canonGame, market: pick, outcome: canonOutcome }
          });
          totalPayout += payout;
          winners++;
        } else {
          losers++;
        }
      }
    }
    else {
      throw new Error(`Unknown game ${canonGame} in settleRoundTx`);
    }

    // 4) Apply bet updates & wallet increments (still inside TX)
    if (betUpdates.length) {
      await Bet.bulkWrite(betUpdates, { session, ordered: false });
    }
    // console.log(walletIncs);
    if (walletIncs.length) {
      await User.bulkWrite(walletIncs, { session, ordered: false });
    }
    // console.log("Trans Doc: ", txDocs);

    if (txDocs.length) await Transaction.insertMany(txDocs, { session });

    // 5) Mark round settled + store outcome/meta/summary
    round.status = 'SETTLED';          // canonical round phase
    // If (and only if) your UI insists on 'WON'/'LOST' for round.status, switch to:
    // round.status = 'CLOSED';
    // console.log(winners);

    round.outcome = canonOutcome;
    round.summary = {
      winners,
      losers,
      pushes,
      totalPayout,
      settledAt: new Date(),
    };
    if (meta) round.meta = { ...(round.meta || {}), ...meta };

    await round.save({ session });

    await session.commitTransaction();
    return { ok: true, settled: bets.length, outcome: outcome, summary: round.summary };
  } catch (e) {
    await session.abortTransaction().catch(() => { });
    console.error('settleRoundTx error:', e);
    throw e;
  } finally {
    session.endSession();
  }
}


module.exports = {
  fetchBalance,
  createRound,
  lockRound,
  placeBetTx,        // casino
  placeSportsBetTx,  // sports
  settleRoundTx,
  lockBetsForRound,  // optional (call in onLock if you want)
};
