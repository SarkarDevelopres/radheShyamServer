// controllers/odds.controller.js
const dotenv = require('dotenv');
dotenv.config();
const Odds = require('../db/models/odds');

const THIRTY_MIN = 30 * 60 * 1000;

// in-memory per-sport cache for the assembled response list (optional, fast path)
const memCache = new Map(); // sport -> { ts, data }

// helper to format displayable time
function displayTime(iso) {
  const date = new Date(iso);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).replace(",", "");
}

// Normalize API -> our model doc
function normalizeApiMatch(m, bookmakerKey = null, marketKey = 'h2h') {
  const market = m.bookmakers?.[0]?.markets?.[0];
  return {
    matchId: m.id,
    home: m.home_team,
    away: m.away_team,
    title: m.sport_title,
    commenceTime: m.commence_time,
    bookmakerKey: bookmakerKey || (m.bookmakers?.[0]?.key ?? null),
    marketKey,
    odds: (market?.outcomes || []).map(o => ({ name: o.name, price: o.price })),
  };
}

// Upsert many docs for a sport
async function upsertOddsBatch(sport, matches) {
  if (!Array.isArray(matches) || !matches.length) return 0;

  const ops = [];
  for (const m of matches) {
    const doc = normalizeApiMatch(m);
    ops.push({
      updateOne: {
        filter: {
          sport,
          matchId: doc.matchId,
          bookmakerKey: doc.bookmakerKey,
          marketKey: doc.marketKey
        },
        update: {
          $set: {
            sport,
            home: doc.home,
            away: doc.away,
            title: doc.title,
            commenceTime: doc.commenceTime,
            bookmakerKey: doc.bookmakerKey,
            marketKey: doc.marketKey,
            odds: doc.odds,
            provider: 'the-odds-api',
            fetchedAt: new Date()
          }
        },
        upsert: true
      }
    });
  }
  if (!ops.length) return 0;
  const res = await Odds.bulkWrite(ops, { ordered: false });
  return res.upsertedCount + (res.modifiedCount || 0);
}

// Assemble list payload from DB
async function readSportFromDB(sport) {
  // Only future (or recent) matches first; adjust as needed
  const now = new Date();
  const rows = await Odds.find({ sport })
    .sort({ commenceTime: 1, fetchedAt: -1 })
    .limit(500)
    .lean();

  // Group by matchId to present one row per match with first odds set
  const byMatch = new Map();
  for (const r of rows) {
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, r);
  }

  const list = Array.from(byMatch.values()).map(r => ({
    matchId: r.matchId,
    home: r.home,
    away: r.away,
    title: r.title,
    startTime: r.commenceTime,
    market: r.marketKey,
    bookmakerKey: r.bookmakerKey,
    displayableTime: displayTime(r.commenceTime),
    odds: r.odds || []
  }));

  console.log("LIST: ", list);


  return list;
}

// Determine if DB is fresh for the sport
async function isDBFresh(sport) {
  const last = await Odds.findOne({ sport }).sort({ fetchedAt: -1 }).select({ fetchedAt: 1 }).lean();
  if (!last) return false;
  return (Date.now() - new Date(last.fetchedAt).getTime()) < THIRTY_MIN;
}

// The one function to handle any sport key compatible with The Odds API
async function handleSport(req, res, sportKey) {
  try {
    // Fast path: memory cache per sport (optional)
    const inMem = memCache.get(sportKey);
    if (inMem && (Date.now() - inMem.ts) < 10_000) {
      return res.json({ success: true, data: inMem.data });
    }

    // If DB is fresh, serve from DB
    if (await isDBFresh(sportKey)) {
      const list = await readSportFromDB(sportKey);
      memCache.set(sportKey, { ts: Date.now(), data: list });
      return res.json({ success: true, data: list });
    }

    // Else fetch from upstream, upsert, then read from DB
    const API_SPORT = sportKey === 'football' ? 'soccer' : sportKey; // your UI uses 'football'
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=uk&markets=h2h&apiKey=${process.env.ODDS_API_KEY}`;

    const apiRes = await fetch(url);
    if (!apiRes.ok) {
      // serve stale DB if available rather than 500
      const list = await readSportFromDB(sportKey);
      if (list.length) {
        return res.json({ success: true, data: list, stale: true });
      }
      return res.status(apiRes.status).json({ success: false, error: `Upstream ${apiRes.status}` });
    }

    const raw = await apiRes.json();
    await upsertOddsBatch(sportKey, raw);

    const list = await readSportFromDB(sportKey);
    memCache.set(sportKey, { ts: Date.now(), data: list });
    return res.json({ success: true, data: list });
  } catch (err) {
    console.error(`[odds] ${sportKey} error:`, err);
    // try serving whatever DB has
    const list = await readSportFromDB(sportKey).catch(() => []);
    if (list.length) return res.json({ success: true, data: list, stale: true });
    return res.status(500).json({ success: false, error: 'Failed to fetch odds' });
  }
}

// Exported handlers
exports.cricket = (req, res) => handleSport(req, res, 'cricket');
exports.football = (req, res) => handleSport(req, res, 'soccer'); // UI uses 'football'
exports.tennis = (req, res) => handleSport(req, res, 'tennis');
