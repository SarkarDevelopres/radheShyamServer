// workers/worker.js
require('dotenv').config();
const mongoose = require('mongoose');
const Matchs = require('../db/models/match');
const Odds = require('../db/models/odds');
const Bet = require('../db/models/bet');
const User = require('../db/models/user');
const Transaction = require('../db/models/transaction');
// const { getIO } = require("../socket");

// ---- Mongoose setup (single connection) ----
mongoose.set('bufferCommands', false);
mongoose.connection.on('error', (e) => console.error('[db] error:', e.message));
mongoose.connection.on('disconnected', () => console.error('[db] disconnected'));
mongoose.connection.on('reconnected', () => console.log('[db] reconnected'));

// ---- In-memory (optional helper cache) ----
const memCache = new Map();

// ---- Constants ----
const MIN = 60 * 1000;
const SPORTS = ['cricket', 'soccer', 'tennis', 'basketball_nba', 'baseball'];

const DURATIONS = {
  SOCCER: 120 * MIN,
  TENNIS: 150 * MIN,
  BASKETBALL: 135 * MIN,
  BASEBALL: 180 * MIN,
};

// ---- Utilities ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

async function withTimeout(promise, ms, tag = 'op') {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

function normalizeIsoToDate(isoLike) {
  if (isoLike instanceof Date) return Number.isNaN(isoLike.getTime()) ? null : isoLike;
  const iso = typeof isoLike === 'string' && /[zZ]|[+\-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function displayTimeIST(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`;
}

function detectCategory(sportParam, m) {
  const sk = String(m?.sport_key || sportParam || '').toLowerCase();
  const st = String(m?.sport_title || m?.sports_title || '').toLowerCase();
  if (sk.includes('soccer') || st.includes('soccer') || st.includes('football')) return 'SOCCER';
  if (sk.includes('tennis') || st.includes('tennis')) return 'TENNIS';
  if (sk.includes('basketball') || st.includes('basketball')) return 'BASKETBALL';
  if (sk.includes('baseball') || st.includes('baseball')) return 'BASEBALL';
  if (sk.includes('ice_hockey') || sk.includes('icehockey') || st.includes('ice hockey') || sk.includes('nhl') || st.includes('nhl')) return 'ICE_HOCKEY';
  return null;
}

function expectedEnd(commenceTimeIsoOrDate, category) {
  const start = normalizeIsoToDate(commenceTimeIsoOrDate);
  if (!start || !category || !DURATIONS[category]) return null;
  return new Date(start.getTime() + DURATIONS[category]);
}

// ---- Provider calls ----
async function fetchMatchesFromProvider(sport) {
  if (sport === 'cricket') {
    const scheduledUrl = `https://restapi.entitysport.com/exchange/matches/?status=1&token=${process.env.ENTITY_TOKEN}`;
    const liveUrl = `https://restapi.entitysport.com/exchange/matches/?status=3&token=${process.env.ENTITY_TOKEN}`;
    const [data, liveData] = await Promise.all([fetch(scheduledUrl), fetch(liveUrl)]);
    if (!data.ok || !liveData.ok) return [];

    const raw = await data.json();
    const liveRaw = await liveData.json();
    const merged = [...(liveRaw.response?.items || []), ...(raw.response?.items || [])];

    const matchList = [];
    for (const it of merged) {
      if (!it || it.oddstype === '') continue;

      const start = it.date_start;
      const end = it.end ?? it.date_end ?? null;
      const startTime = normalizeIsoToDate(start);
      const endTime = end ? normalizeIsoToDate(end) : null;

      matchList.push({
        matchId: String(it.match_id),
        sport: 'cricket',
        sportKey: 'cricket',
        teamHome: it.teama,
        teamAway: it.teamb,
        title: it.competition?.title,
        start_time: startTime ? startTime.getTime() : null,
        end_time: endTime ? endTime.getTime() : null,
        category: it.format_str,
        start_time_ist: startTime ? displayTimeIST(startTime) : '',
        end_time_ist: endTime ? displayTimeIST(endTime) : '',
        status: String(it.status_str || '').toLowerCase(),
        game_state: { code: it.game_state, string: it.game_state_str },
        isOdds: true,
        sessionOdds: !!it.session_odds_available
      });
    }
    return matchList;
  }

  // OddsAPI branch
  const oddsUrl =
    `https://api.the-odds-api.com/v4/sports/${sport}/odds/?regions=uk&markets=h2h,h2h_lay&apiKey=${process.env.ODDS_API_KEY}`;
  const apiOddsRes = await fetch(oddsUrl);
  if (!apiOddsRes.ok) return [];
  const odds = await apiOddsRes.json();

  const now = Date.now();
  const matchList = [];

  for (const o of odds || []) {
    if (!o.bookmakers?.length) continue;

    const startTime = normalizeIsoToDate(o.commence_time);
    const category = detectCategory(sport, o);
    const endTime = expectedEnd(startTime, category);

    const startEpoch = startTime ? startTime.getTime() : null;
    const endEpoch = endTime ? endTime.getTime() : null;

    const isLive = startEpoch && endEpoch ? (now >= startEpoch && now < endEpoch) : false;
    const isScheduled = startEpoch ? (now < startEpoch) : false;

    matchList.push({
      matchId: String(o.id),
      sport,
      sportKey: o.sport_key,
      teamHome: o.home_team,
      teamAway: o.away_team,
      title: o.sport_title || o.title,
      start_time: startEpoch,
      end_time: endEpoch,
      category,
      start_time_ist: startEpoch ? displayTimeIST(startTime) : '',
      end_time_ist: endEpoch ? displayTimeIST(endTime) : '',
      status: isLive ? 'live' : isScheduled ? 'scheduled' : 'completed',
      isOdds: true,
      sessionOdds: false
    });
  }
  return matchList;
}

async function fetchOddsBatch(sport, matchIds, nameById) {
  if (sport === 'cricket') {
    // console.log(matchIds);

    const url = `https://restapi.entitysport.com/exchange/matchesmultiodds?token=${process.env.ENTITY_TOKEN}&match_id=${matchIds.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const raw = await res.json();
    if (raw.status !== 'ok') return [];

    const response = raw.response || {};
    const oddsList = [];

    for (const mid of matchIds) {
      const r = response[mid];
      // if (mid=='91903') {
      //   console.log(r);        
      // }
      const mo = r?.live_odds?.matchodds;
      if (!mo) continue;

      const names = nameById.get(String(mid)) || {};
      const priceA = mo?.teama?.back;
      const priceB = mo?.teamb?.back;
      if (priceA == null || priceB == null) continue;

      oddsList.push({
        matchId: String(mid),
        sport: sport,
        sportKey: sport,
        bookmakerKey: names.bookmakerKey || 'entity',
        marketKey: 'h2h', // keep consistent with your UI/queries
        isBet: false,
        provider: 'entity-sport',
        odds: [
          { name: names.teama || 'Team A', price: priceA },
          { name: names.teamb || 'Team B', price: priceB }
        ],
        sessionOdds: r.session_odds
      });
    }
    return oddsList;
  }

  // OddsAPI branch: one doc per market
  const oddsUrl =
    `https://api.the-odds-api.com/v4/sports/${sport}/odds/?regions=uk&markets=h2h,h2h_lay&apiKey=${process.env.ODDS_API_KEY}`;
  const apiOddsRes = await fetch(oddsUrl);
  if (!apiOddsRes.ok) return [];
  const odds = await apiOddsRes.json();

  const docs = [];
  for (const o of odds || []) {
    if (!o.bookmakers?.length) continue;
    const bk = o.bookmakers[0];
    for (const mkt of bk.markets || []) {
      if (!mkt?.key) continue;
      docs.push({
        matchId: String(o.id),
        sport,
        sportKey: o.sport_key,
        bookmakerKey: bk.key,
        marketKey: mkt.key,           // e.g., 'h2h' or 'h2h_lay'
        isBet: false,
        sessionOdds: [],
        provider: 'the-odds-api',
        odds: o.bookmakers[0].markets[0].outcomes
      });
    }
  }
  // if you only want odds for `matchIds`, filter here:
  return docs.filter(d => matchIds.includes(d.matchId));
}

async function fetchCompletedCricketIds() {
  const url = `https://restapi.entitysport.com/exchange/matches/?status=2&token=${process.env.ENTITY_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const json = await res.json();
  const items = json?.response?.items || [];

  // Return array of objects: { matchId, winningTeamId }
  return items
    .map(it => ({
      matchId: String(it.match_id),
      winningTeamId: it.winning_team_id ? String(it.winning_team_id) : null,
    }))
    .filter(it => Boolean(it.matchId));
}


function testWin(userId) {
  const io = getIO();
  io.to(`user:${userId}`).emit("wallet:update", {
    ok: true,
    balance: 1234.56,   // fake balance
    amount: 500,        // fake win amount
    type: "bet_win",
    betId: "test123",
    eventId: "match_test"
  });
  console.log(`[test] emitted fake win to user:${userId}`);
}
// ---- Jobs ----
async function runFetchAndMaterialize() {
  // console.log('[mongo] host/db =', mongoose.connection.host, '/', mongoose.connection.name);
  const started = Date.now();
  let totalMatches = 0, totalOdds = 0;

  // accumulate names across sports (avoid overwriting with empty)
  const globalNameById = memCache.get('nameById') || new Map();

  for (const sport of SPORTS) {
    try {
      // console.log(`[worker] → ${sport}: fetching fixtures`);
      const matches = await withTimeout(fetchMatchesFromProvider(sport), 25_000, `fixtures:${sport}`);

      // upsert matches
      if (matches.length) {
        const matchOps = matches.map(m => ({
          updateOne: {
            filter: { matchId: m.matchId },
            update: { $set: { ...m, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            upsert: true
          }
        }));
        const r = await Matchs.bulkWrite(matchOps, { ordered: false });
        // console.log('[matches.bulkWrite] matched=', r.matchedCount, ' modified=', r.modifiedCount, ' upserted=', r.upsertedCount);
      }
      totalMatches += matches.length;

      // merge into global map
      for (const m of matches) {
        globalNameById.set(String(m.matchId), {
          teama: m.teamHome.name,
          teamb: m.teamAway.name,
          bookmakerKey: m.bookmakerKey || (sport === 'cricket' ? 'entity' : undefined)
        });
      }

      const active = matches.filter(f => f.status === 'live' || f.status === 'scheduled');
      const ids = active.map(a => a.matchId);

      if (ids.length) {
        // console.log(`[worker] → ${sport}: fetching odds for ${ids.length}`);
        const oddDocs = await withTimeout(fetchOddsBatch(sport, ids, globalNameById), 25_000, `odds:${sport}`);

        if (oddDocs.length) {

          const ops = oddDocs
            .filter(d => d.matchId && d.bookmakerKey && d.marketKey)
            .map(d => {
              const match = matches.find(m => m.matchId === d.matchId);

              let finalOdds = d.sessionOdds;
              if (d.matchId == '91903') {
                // console.log(finalOdds);

              }

              // If suspended or live+session odds → empty array
              if (match?.status === 'live') {
                finalOdds = [];
              }
              return {

                updateOne: {
                  filter: { matchId: d.matchId, bookmakerKey: d.bookmakerKey, marketKey: d.marketKey, sport: d.sport },
                  update: {
                    $set: { odds: d.odds, sessionOdd: finalOdds, updatedAt: new Date() },
                    $setOnInsert: { createdAt: new Date(), matchId: d.matchId, bookmakerKey: d.bookmakerKey, marketKey: d.marketKey, sport: d.sport }
                  },
                  upsert: true
                }
              }
            });
          if (ops.length) {
            const res = await Odds.bulkWrite(ops, { ordered: false });
            // console.log('[odds.bulkWrite] matched=', res.matchedCount, ' modified=', res.modifiedCount, ' upserted=', res.upsertedCount);
          }
          totalOdds += oddDocs.length;
        }
      }

      await sleep(250); // gentle spacing to avoid spikes
    } catch (err) {
      console.error(`[worker] ${sport} errored:`, err.message);
    }
  }

  // save merged cache once
  memCache.set('nameById', globalNameById);

  // console.log(`[worker] ✓ refresh done in ${Date.now() - started}ms  matches:${totalMatches} odds:${totalOdds}`);
}

async function runSettlement() {
  try {
    // const io = getIO();
    // testWin("68ada5984140021fe4bd57a0")
    // 1) Fetch provider’s completed matches (with winners)
    const completed = await withTimeout(
      fetchCompletedCricketIds(),
      20_000,
      'completed:cricket'
    );

    if (completed.length) {
      // Update match status → completed
      const ids = completed.map(m => m.matchId);
      const res = await Matchs.updateMany(
        { sport: 'cricket', matchId: { $in: ids }, status: { $ne: 'completed' } },
        { $set: { status: 'completed', updatedAt: new Date() } }
      );
      console.log(
        '[settle] cricket completed → matched:',
        res.matchedCount ?? res.n,
        ' modified:',
        res.modifiedCount ?? res.nModified
      );

      // ---- NEW: settle sports bets ----
      for (const { matchId, winningTeamId } of completed) {
        if (!winningTeamId) continue;

        // Fetch all unsettled bets for this match
        const bets = await Bet.find({
          type: { $in: ["sports", "cashout"] },
          eventId: matchId,
          status: "OPEN"
        });

        if (!bets.length) continue;
        const bulkBets = [];
        const bulkUsers = [];
        const txs = [];

        for (const b of bets) {
          if (b.type === "cashout") {
            bulkBets.push({
              updateOne: {
                filter: { _id: b._id },
                update: { $set: { status: "SETTLED" } }
              }
            });

            if (b.stake > 0) {
              bulkUsers.push({
                updateOne: {
                  filter: { _id: b.userId },
                  update: { $inc: { balance: b.stake } }
                }
              });
              txs.push({
                userId: b.userId,
                type: "cashout_win",
                amount: b.stake,
                meta: { betId: b._id, eventId: matchId }
              });
            }

            continue; // skip rest
          }
          let won = false;
          let payout = 0;
          let liability = 0;
          if (!b.lay) {
            // BACK bet
            won = String(b.selection) === String(winningTeamId);
            payout = won ? Math.round(b.stake * b.odds) : 0;
          } else {
            // LAY bet
            if (String(b.selection) !== String(winningTeamId)) {
              won = true;
              payout = b.stake; // lay wins stake amount
            } else {
              won = false;
              liability = Math.round((b.odds - 1) * b.stake);
              payout = -liability; // show as negative in bet record
            }
          }

          bulkBets.push({
            updateOne: {
              filter: { _id: b._id },
              update: {
                $set: {
                  status: won ? 'WON' : 'LOST',
                  won,
                  payout,
                }
              }
            }
          });

          if (payout > 0) {
            bulkUsers.push({
              updateOne: {
                filter: { _id: b.userId },
                update: { $inc: { balance: payout } }
              }
            });
            // io.to(`user:${b.userId}`).emit("wallet:update", {
            //   ok: true,
            //   balance: b.userBalance + payout,  // or fetch latest balance
            //   amount: payout,
            //   type: "bet_win",
            //   betId: b._id,
            //   eventId: matchId
            // });
            txs.push({
              userId: b.userId,
              type: 'payout_win',
              amount: payout,
              meta: { betId: b._id, eventId: matchId }
            });
          }
        }

        if (bulkBets.length) await Bet.bulkWrite(bulkBets);
        if (bulkUsers.length) await User.bulkWrite(bulkUsers);
        if (txs.length) await Transaction.insertMany(txs);

        console.log(`[settle] bets settled for match ${matchId}: total=${bets.length}`);
      }
    } else {
      console.log('[settle] no completed cricket matches from provider');
    }

    // 2) Handle all other sports (time-driven)
    const now = Date.now();
    const otherRes = await Matchs.updateMany(
      {
        sport: { $ne: 'cricket' },
        status: { $in: ['live', 'scheduled'] },
        end_time: { $lt: now }
      },
      { $set: { status: 'completed', updatedAt: new Date() } }
    );

    console.log(
      '[settle] non-cricket expired → matched:',
      otherRes.matchedCount ?? otherRes.n,
      ' modified:',
      otherRes.modifiedCount ?? otherRes.nModified
    );
  } catch (e) {
    console.error('[settle] error:', e.message);
  }
}



// ---- Boot once, schedule jobs ----
(async () => {
  try {
    await mongoose.connect(process.env.DB_URI, {
      dbName: 'RadheShyamExch',
      readPreference: 'primary',
    });
    console.log('[db] connected');

    // run once at startup
    await runFetchAndMaterialize();

    // schedule periodic jobs (add small jitter to avoid exact-minute stampedes)
    const jitter = () => 500 + Math.floor(Math.random() * 1500);
    setInterval(runFetchAndMaterialize, 5 * MIN + jitter());
    setInterval(runSettlement, 15 * 1000 + jitter());
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    process.exit(1);
  }
})();
