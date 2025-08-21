// db/store.js
const User = require('./models/user');
const Bet = require('./models/bet');
const Round = require('./models/round');
const Transaction = require('./models/transaction'); // optional but recommended
const mongoose = require('mongoose');
const SevenODDS = { UP: 1.9, DOWN: 1.9, SEVEN: 12 };
const AAAODDS = {
  AMAR: 3.0,
  AKBAR: 3.0,
  ANTHONY: 3.0,
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
    if (!u) throw new Error('INSUFFICIENT_FUNDS');

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
async function placeSportsBetTx({ userId, eventId, market, selection, stake, odds, bookmakerKey }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const u = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: stake } },
      { $inc: { balance: -stake } },
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
        bookmakerKey,
        status: 'OPEN',
        potentialPayout,
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
          meta: { betId: betDoc._id, eventId, market, selection, odds, provider: bookmakerKey },
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

// ---------- casino settlement (called by engine hook) ----------
async function settleRoundTx({ roundId, game, outcome, meta = {} }) {
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
    const canonOutcome = normalize(outcome);

    // 2) Load all unsettled casino bets for this round
    const bets = await Bet.find({ roundId, settled: { $ne: true }, type: 'casino' }).session(session);

    // 3) Decide winners / payouts
    const betUpdates = [];
    const walletIncs = []; // bulk ops for User
    let totalPayout = 0;
    let winners = 0;
    let losers = 0;
    let pushes = 0;

    if (canonGame === 'SEVEN_UP_DOWN') {
      for (const b of bets) {
        const pick = normalize(b.market);
        const won = pick === canonOutcome;
        const odd = won ? (SevenODDS[canonOutcome] || 0) : 0;
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
          totalPayout += payout;
          winners++;
        } else {
          losers++;
        }
      }
    } else if (canonGame === 'HIGH_LOW') {
      const tiePush = meta.tiePush !== false;
      const marketWins = canonOutcome === 'HIGH' ? 'high' : canonOutcome === 'LOW' ? 'low' : null;
      const HL_ODDS = { high: 1.9, low: 1.9 };

      for (const b of bets) {
        const pick = String(b.market || '').toLowerCase();
        let status = 'LOST';
        let won = false;
        let payout = 0;

        if (canonOutcome === 'TIE') {
          if (tiePush) {
            payout = Number(b.stake); // refund stake
            status = 'PUSH';
          } else {
            payout = 0;
            status = 'LOST';
          }
        } else {
          won = pick === marketWins;
          if (won) {
            payout = Math.round(Number(b.stake) * Number(HL_ODDS[pick] || 0));
            status = 'WON';
          }
        }

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
        const won = pick === canonOutcome;

        // Use AAA odds mapping
        const odd = won ? Number(AAAODDS[canonOutcome] || 0) : 0;

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
    if (walletIncs.length) {
      await User.bulkWrite(walletIncs, { session, ordered: false });
    }

    // 5) Mark round settled + store outcome/meta/summary
    round.status = 'SETTLED';          // canonical round phase
    // If (and only if) your UI insists on 'WON'/'LOST' for round.status, switch to:
    // round.status = 'CLOSED';
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
    return { ok: true, settled: bets.length, outcome: canonOutcome, summary: round.summary };
  } catch (e) {
    await session.abortTransaction().catch(() => { });
    console.error('settleRoundTx error:', e);
    throw e;
  } finally {
    session.endSession();
  }
}


module.exports = {
  createRound,
  lockRound,
  placeBetTx,        // casino
  placeSportsBetTx,  // sports
  settleRoundTx,
  lockBetsForRound,  // optional (call in onLock if you want)
};
