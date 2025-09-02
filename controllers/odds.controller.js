// controllers/odds.controller.js
const dotenv = require('dotenv');
dotenv.config();
const Odds = require('../db/models/odds');

// use built-in fetch if available, else lazy-load node-fetch
const fetch = global.fetch || ((...args) =>
  import('node-fetch').then(({ default: f }) => f(...args)));

const THIRTY_MIN = 30 * 60 * 1000;

// in-memory per-sport cache for the assembled response list (optional, fast path)
const memCache = new Map(); // sport -> { ts, data }


// --- helpers for the live endpoint ---

const SPORTS = ['cricket', 'football', 'tennis', 'baseball', 'basketball_nba'];

function apiSportFor(sportKey) {
  // Map UI keys -> Odds API keys
  if (sportKey === 'football') return 'soccer';
  if (sportKey === 'baseball') return 'baseball_mlb'; // common case
  return sportKey; // cricket, tennis, basketball_nba already match
}

function toClientRow(r) {
  const isLive = computeIsLive(r);
  return {
    matchId: r.matchId,
    home: r.home,
    away: r.away,
    title: r.title,
    leagueTitle: r.leagueTitle,
    startTime: r.commenceTime, // Date (UTC)
    market: r.marketKey,
    bookmakerKey: r.bookmakerKey,
    displayableTime: displayTimeIST(new Date(r.commenceTime).toISOString()),
    odds: r.odds || [],
    isLive
  };
}

async function queryFreshRows(sport) {
  const freshCut = new Date(Date.now() - THIRTY_MIN);
  // Fresh rows with non-empty odds
  const rows = await Odds.find({
    sport,
    'odds.0': { $exists: true },
    $or: [
      { fetchedAt: { $gte: freshCut } },
      { updatedAt: { $gte: freshCut } },
      { createdAt: { $gte: freshCut } },
    ],
  })
    .sort({ commenceTime: 1, fetchedAt: -1 })
    .limit(1000)
    .lean();

  // dedupe by matchId (keep first by our sort)
  const byMatch = new Map();
  for (const r of rows) {
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, r);
  }
  return Array.from(byMatch.values());
}

async function fetchAndUpsertFromAPI(sportKey) {
  const API_SPORT = apiSportFor(sportKey);
  const url =
    `https://api.the-odds-api.com/v4/sports/${API_SPORT}/odds/` +
    `?regions=uk&markets=h2h_lay&apiKey=${process.env.ODDS_API_KEY}`;

  const apiRes = await fetch(url);
  if (!apiRes.ok) {
    throw new Error(`Upstream ${apiRes.status}`);
  }
  const raw = await apiRes.json();
  await upsertOddsBatch(sportKey, raw); // only upserts matches with non-empty odds
}
async function fetchAndUpsertEventFromAPI(sportKey) {
  const API_SPORT = apiSportFor(sportKey);
  const url =
    `https://api.the-odds-api.com/v4/sports/${API_SPORT}/events/` +
    `?apiKey=${process.env.ODDS_API_KEY}`;

  const apiRes = await fetch(url);
  if (!apiRes.ok) {
    throw new Error(`Upstream ${apiRes.status}`);
  }
  const raw = await apiRes.json();
  await upsertEventsBatch(sportKey, raw); // only upserts matches with non-empty odds
}


// ------------------------- Time helpers -------------------------

// helper to format displayable time (IST), expects an ISO string WITH timezone (e.g. ...Z)
function displayTimeIST(iso) {
  if (typeof iso !== "string" || !(/[zZ]|[+\-]\d{2}:?\d{2}$/.test(iso))) {
    throw new Error(`displayTimeIST: expected ISO string WITH timezone, got: ${iso}`);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`;
}

// ------------------------- Normalization -------------------------

// Find the first bookmaker/market combo that actually has outcomes
function pickFirstMarketWithOutcomes(m) {
  const bms = Array.isArray(m?.bookmakers) ? m.bookmakers : [];
  for (const bm of bms) {
    const mkts = Array.isArray(bm?.markets) ? bm.markets : [];
    for (const mk of mkts) {
      if (Array.isArray(mk?.outcomes) && mk.outcomes.length > 0) {
        return { bookmakerKey: bm.key || null, marketKey: mk.key || null, outcomes: mk.outcomes };
      }
    }
  }
  return null;
}

// Normalize API -> our model doc
function normalizeApiMatch(m) {
  const chosen = pickFirstMarketWithOutcomes(m);
  const firstBM = m.bookmakers?.[0] || null;
  const firstMarket = firstBM?.markets?.[0] || null;

  const outcomes = chosen?.outcomes || firstMarket?.outcomes || [];

  return {
    matchId: m.id,
    home: m.home_team,
    away: m.away_team,
    title: `${m.home_team} vs ${m.away_team}`, // clearer for UI rows
    leagueTitle: m.sport_title || null,
    sportskey:m.sport_key,
    // store as Date for proper indexing & comparisons
    commenceTime: m.commence_time ? new Date(m.commence_time) : null,
    bookmakerKey: chosen?.bookmakerKey ?? firstBM?.key ?? null,
    marketKey: chosen?.marketKey ?? firstMarket?.key ?? null, // e.g., 'h2h_lay'
    odds: (Array.isArray(outcomes) ? outcomes : []).map(o => ({ name: o.name, price: o.price })),
  };
}

// ------------------------- Expected end-time -------------------------

const MIN = 60 * 1000;

const DURATIONS = {
  FOOTBALL: 120 * MIN,             // ~2h
  TENNIS: 150 * MIN,               // ~2h30
  BASKETBALL: 135 * MIN,           // ~2h15
  BASEBALL: 180 * MIN,             // ~3h
  ICE_HOCKEY: 150 * MIN,           // ~2h30
  CRICKET_T20: 195 * MIN,          // ~3h15
  CRICKET_ODI: 465 * MIN,          // ~7h45
  CRICKET_TEST: 5 * 24 * 60 * MIN, // ~5 days (coarse)
  CRICKET_HUNDRED: 150 * MIN       // ~2h30
};

function normalizeIsoToDate(isoLike) {
  if (isoLike instanceof Date) {
    return Number.isNaN(isoLike.getTime()) ? null : isoLike;
  }
  const iso = typeof isoLike === "string" && /[zZ]|[+\-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function detectCategory(sportParam, m, doc) {
  const sk = String(m?.sport_key || sportParam || "").toLowerCase();
  const st = String(m?.sport_title || m?.sports_title || "").toLowerCase();
  const league = String(m?.league || m?.league_name || m?.competition || "").toLowerCase();
  const title = String(doc?.title || m?.title || `${m?.home_team || ""} vs ${m?.away_team || ""}`).toLowerCase();

  const isCricket = sk.includes("cricket") || st.includes("cricket") || league.includes("cricket");

  if (isCricket) {
    if (sk.includes("t20") || /(^|\W)t20(\W|$)|twenty ?20|ipl|psl|bbl|cpl|blast/.test(title)) return "CRICKET_T20";
    if (sk.includes("odi") || /(^|\W)odi(\W|$)|one[-\s]?day/.test(title)) return "CRICKET_ODI";
    if (sk.includes("test") || /(^|\W)test(\W|$)/.test(title)) return "CRICKET_TEST";
    if (/hundred/.test(title)) return "CRICKET_HUNDRED";
    return "CRICKET_T20"; // cricket fallback
  }

  if (sk.includes("soccer") || st.includes("soccer") || st.includes("football")) return "FOOTBALL";
  if (sk.includes("tennis") || st.includes("tennis")) return "TENNIS";
  if (sk.includes("basketball") || st.includes("basketball")) return "BASKETBALL";
  if (sk.includes("baseball") || st.includes("baseball")) return "BASEBALL";
  if (sk.includes("ice_hockey") || sk.includes("icehockey") || st.includes("ice hockey") || sk.includes("nhl") || st.includes("nhl")) return "ICE_HOCKEY";

  return null;
}

function expectedEnd(commenceTimeIsoOrDate, category) {
  const start = normalizeIsoToDate(commenceTimeIsoOrDate);
  if (!start || !category || !DURATIONS[category]) return null;
  return new Date(start.getTime() + DURATIONS[category]);
}

// ------------------------- Upsert batch -------------------------

async function upsertOddsBatch(sport, matches) {
  if (!Array.isArray(matches) || !matches.length) return 0;

  const ops = [];
  for (const m of matches) {
    const doc = normalizeApiMatch(m);

    // console.log(doc);
    
    // ---- HARD GUARD: skip anything with NO odds ----
    if (!Array.isArray(doc.odds) || doc.odds.length === 0) continue;

    const category = detectCategory(sport, m, doc);
    const EndTime = expectedEnd(doc.commenceTime, category);

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
            leagueTitle: doc.leagueTitle,
            commenceTime: doc.commenceTime, // Date
            bookmakerKey: doc.bookmakerKey,
            marketKey: doc.marketKey,       // actual market key (e.g., 'h2h_lay')
            odds: doc.odds,
            isBet: false,
            expectedEndAt: EndTime,
            expectedCategory: category,
            sportsKey:doc.sportskey,
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
  return (res.upsertedCount || 0) + (res.modifiedCount || 0);
}
async function upsertEventsBatch(sport, matches) {
  if (!Array.isArray(matches) || !matches.length) return 0;

  const ops = [];
  for (const m of matches) {
    const doc = normalizeApiMatch(m);

    // ---- HARD GUARD: skip anything with NO odds ----
    if (!Array.isArray(doc.odds) || doc.odds.length === 0) continue;

    const category = detectCategory(sport, m, doc);
    const EndTime = expectedEnd(doc.commenceTime, category);

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
            leagueTitle: doc.leagueTitle,
            commenceTime: doc.commenceTime, // Date
            bookmakerKey: doc.bookmakerKey,
            marketKey: doc.marketKey,       // actual market key (e.g., 'h2h_lay')
            odds: doc.odds,
            isBet: false,
            expectedEndAt: EndTime,
            expectedCategory: category,
            sportsKey:doc.sportskey,
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
  return (res.upsertedCount || 0) + (res.modifiedCount || 0);
}

// helper: compute live flag from stored times
function computeIsLive(r, nowTs = Date.now()) {
  const startTs = r?.commenceTime ? new Date(r.commenceTime).getTime() : NaN;
  if (!Number.isFinite(startTs)) return false;
  const endTs = r?.expectedEndAt ? new Date(r.expectedEndAt).getTime() : null;
  return nowTs >= startTs && (endTs == null || nowTs < endTs);
}

// Read from DB, exclude empty-odds rows, add isLive, then sort live-first
async function readSportFromDB(sport) {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);

  const rows = await Odds.find({
    sport,
    commenceTime: { $gte: cutoff },
    'odds.0': { $exists: true } // ensure odds array is non-empty
  })
    .sort({ commenceTime: 1, fetchedAt: -1 })
    .limit(500)
    .lean();

  const byMatch = new Map();
  for (const r of rows) {
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, r);
  }

  const list = Array.from(byMatch.values()).map(r => {
    const isLive = computeIsLive(r);
    return {
      matchId: r.matchId,
      home: r.home,
      away: r.away,
      title: r.title,
      leagueTitle: r.leagueTitle,
      startTime: r.commenceTime, // Date (UTC)
      market: r.marketKey,
      bookmakerKey: r.bookmakerKey,
      displayableTime: displayTimeIST(new Date(r.commenceTime).toISOString()),
      odds: r.odds || [],
      isLive
    };
  });

  // Live first; within each group, earlier start first
  list.sort((a, b) =>
    (b.isLive - a.isLive) ||
    (new Date(a.startTime) - new Date(b.startTime))
  );

  return list;
}

// ------------------------- Freshness -------------------------

async function isDBFresh(sport) {
  const last = await Odds.findOne({ sport }).sort({ fetchedAt: -1 }).select({ fetchedAt: 1 }).lean();
  if (!last) return false;
  return (Date.now() - new Date(last.fetchedAt).getTime()) < THIRTY_MIN;
}

// ------------------------- Handle a sport -------------------------

async function handleSport(req, res, sportKey) {
  try {
    // memory cache (10s)
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

    // Map UI key -> API key (expand if needed)
    const API_SPORT = sportKey === 'football' ? 'soccer' : sportKey;
    // NOTE: if you later need MLB: map 'baseball' -> 'baseball_mlb'

    const url =
      `https://api.the-odds-api.com/v4/sports/${API_SPORT}/odds/` +
      `?regions=uk&markets=h2h_lay&apiKey=${process.env.ODDS_API_KEY}`;

    const apiRes = await fetch(url);
    if (!apiRes.ok) {
      // serve stale DB if available
      const list = await readSportFromDB(sportKey);
      if (list.length) return res.json({ success: true, data: list, stale: true });
      return res.status(apiRes.status).json({ success: false, error: `Upstream ${apiRes.status}` });
    }

    const raw = await apiRes.json();

    // Upsert ONLY those with non-empty odds (enforced inside)
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

// ------------------------- Exports -------------------------

exports.cricket = (req, res) => handleSport(req, res, 'cricket');
exports.football = (req, res) => handleSport(req, res, 'football'); 
exports.tennis = (req, res) => handleSport(req, res, 'tennis');
exports.baseball = (req, res) => handleSport(req, res, 'baseball');
exports.basketball = (req, res) => handleSport(req, res, 'basketball_nba');

// ------------------------- Live endpoint -------------------------

exports.live = async (req, res) => {
  try {
    const result = {};

    await Promise.all(
      SPORTS.map(async (sport) => {
        try {
          // Step 1: pull fresh (<= 30min old) rows from DB
          let rows = await queryFreshRows(sport);

          // Step 2: if none fresh, hit upstream then requery
          if (rows.length === 0) {
            try {
              await fetchAndUpsertFromAPI(sport);
              rows = await queryFreshRows(sport);
            } catch (err) {
              console.error(`[odds.live] fetch fail for ${sport}:`, err.message);
              rows = []; // keep going; other sports may still succeed
            }
          }

          // Step 3: keep only live rows, map to client shape, sort by start
          const liveRows = rows
            .filter((r) => computeIsLive(r))
            .map(toClientRow)
            .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

          result[sport] = liveRows;
        } catch (e) {
          console.error(`[odds.live] error for ${sport}:`, e);
          result[sport] = [];
        }
      })
    );

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[odds.live] fatal:', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch live odds' });
  }
};


// Fetch odds for a single matchId (optionally provide sport via :sport param / query / body)
exports.matchOdds = async (req, res) => {
  try {
    const { matchId } = req.body;
    if (!matchId) return res.status(400).json({ success: false, error: 'matchId required' });

    const fetchData = await Odds.findOne({matchId:matchId}).select('sportsKey streamLink');
    
    console.log("Sports_Key: ",fetchData.sportsKey);
    const url =
    `https://api.the-odds-api.com/v4/sports/${fetchData.sportsKey}/events/${matchId}/odds?apiKey=${process.env.ODDS_API_KEY}&regions=uk&markets=h2h`;
    
    const apiRes = await fetch(url);
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ success: false, error: `Upstream ${apiRes.status}` });
    }
    
    const raw = await apiRes.json();
    let bookmakers = [];
    // console.log(raw);

    for ( let i=0; i<raw.bookmakers.length; i++ ){
      
      for (let j = 0; j < raw.bookmakers[i].markets.length; j++) {

        let data = {
          bookmaker:raw.bookmakers[i].key,
          outcomes:raw.bookmakers[i].markets[j].outcomes,
          market:raw.bookmakers[i].markets[j].key
        }

        bookmakers.push(data);
      }

    }


    return res.json({ success: true, data: bookmakers, meta:{sportkey:raw.sport_key, matchId:raw.id, market:raw.marketKey, streamLink:fetchData.streamLink } });
  } catch (error) {
    console.error('[odds] matchOdds error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch odds' });
  }
};

// ------------------------- All-sports endpoint -------------------------

// (Optional) helper to normalize response keys
function responseKeyFor(sport) {
  return sport === 'basketball_nba' ? 'basketball' : sport;
}

exports.allSports = async (req, res) => {
  try {
    const result = { cricket: [], football: [], tennis: [], baseball: [], basketball: [] };

    await Promise.all(
      SPORTS.map(async (sport) => {
        try {
          // Step 1: read fresh rows (<= 30 mins old) with non-empty odds
          let rows = await queryFreshRows(sport);

          // Step 2: if none fresh, fetch upstream then requery
          if (rows.length === 0) {
            try {
              await fetchAndUpsertEventFromAPI(sport);
              rows = await queryFreshRows(sport);
            } catch (err) {
              console.error(`[odds.allSports] fetch fail for ${sport}:`, err.message);
              rows = [];
            }
          }

          // Step 3: map to client rows and sort (live first, then start time asc)
          const list = rows
            .map(toClientRow) // adds isLive, displayTime, etc.
            .sort((a, b) =>
              (b.isLive - a.isLive) ||
              (new Date(a.startTime) - new Date(b.startTime))
            );

          const key = responseKeyFor(sport);
          result[key] = list;
        } catch (e) {
          console.error(`[odds.allSports] error for ${sport}:`, e);
          result[responseKeyFor(sport)] = [];
        }
      })
    );

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[odds.allSports] fatal:', e);
    return res.status(500).json({ success: false, error: 'Failed to fetch all sports' });
  }
};

