// controllers/odds.controller.js
const dotenv = require('dotenv');
dotenv.config();
const Odds = require('../db/models/odds');
const Matchs = require('../db/models/match');

const handleSport = async (req, res, sport) => {
  try {
    const [matchs, odds] = await Promise.all([
      Matchs.find({ sport, status:{$ne:"completed"} }).lean(),
      Odds.find({ sport }).lean(),
    ]);

    // Build odds lookup: matchId -> odds array
    const oddsMap = new Map();
    for (const o of odds) {
      oddsMap.set(String(o.matchId), o.odds); // o.odds should already be an array
    }

    const view = matchs.map(m => ({
      teamHome: m.teamHome,
      teamAway: m.teamAway,
      title: m.title,
      start_time: m.start_time_ist,
      status: m.status,
      matchId: m.matchId,
      odds: oddsMap.get(String(m.matchId)) || [], // always return array
    }));

    return res.json({ success: true, data: view });
  } catch (err) {
    console.error("Error in handleSport:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


// ------------------------- Exports -------------------------
exports.cricket = (req, res) => handleSport(req, res, 'cricket');
exports.football = (req, res) => handleSport(req, res, 'soccer');
exports.tennis = (req, res) => handleSport(req, res, 'tennis');
exports.baseball = (req, res) => handleSport(req, res, 'baseball');
exports.basketball = (req, res) => handleSport(req, res, 'basketball_nba');

// ------------------------- Live endpoint -------------------------
function isNewerThan(date, minutes = 5) {
  return Date.now() - new Date(date).getTime() <= minutes * 60 * 1000;
}

exports.cricketLive = async (req, res) => {
  try {
    let sport = "cricket";
    // Fetch only LIVE matches
    const [matchs, odds] = await Promise.all([
      Matchs.find({ sport, status: "live" }).lean(),
      Odds.find({ sport }).lean(), // odds may not have status field
    ]);

    // Build odds lookup: matchId -> odds array
    const oddsMap = new Map();
    for (const o of odds) {
      oddsMap.set(String(o.matchId), o.odds);
    }

    // Only include matches that also have odds
    const view = matchs
      .filter(m => oddsMap.has(String(m.matchId))) // ensure odds exist
      .map(m => ({
        teamHome: m.teamHome,
        teamAway: m.teamAway,
        title: m.title,
        start_time: m.start_time_ist,
        status: m.status,
        matchId: m.matchId,
        odds: oddsMap.get(String(m.matchId)) || [], // guaranteed to have odds
      }));

    return res.json({ success: true, data: view });
  } catch (err) {
    console.error("Error in handleSport:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.otherLive = async (req, res) => {
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
}

// Fetch odds for a single matchId (optionally provide sport via :sport param / query / body)
exports.matchOdds = async (req, res) => {
  try {
    const { matchId } = req.body;
    console.log("MatchID: ", matchId);

    if (!matchId) return res.status(400).json({ success: false, error: 'matchId required' });

    const fetchData = await Odds.findOne({ matchId: matchId }).select('matchId odds marketKey bookmakerKey sport streamLink provider');

    console.log(fetchData);


    // console.log("Sports_Key: ", fetchData.sportsKey);
    // const url = `https://api.the-odds-api.com/v4/sports/${fetchData.sportsKey}/events/${matchId}/odds?apiKey=${process.env.ODDS_API_KEY}&regions=uk&markets=h2h,player_assists,player_field_goals`;

    // const apiRes = await fetch(url);
    // if (!apiRes.ok) {
    //   let tempData = {
    //     bookmaker: fetchData.bookmakerKey,
    //     outcomes: fetchData.odds,
    //     market: fetchData.marketKey
    //   }
    //   return res.status(apiRes.status).json({ success: true, data: tempData, message: `Upstream ${apiRes.status}` });
    // }

    // const raw = await apiRes.json();
    // let bookmakers = [];

    // bookmaker: raw.bookmakers[0].key,
    // outcomes: raw.bookmakers[0].markets[0].outcomes,
    // market: raw.bookmakers[0].markets[0].key

    data = {
      bookmaker: fetchData.bookmakerKey,
      outcomes: fetchData.odds,
      market: fetchData.marketKey
    }

    // console.log("Session Odds: ", raw.bookmakers[0].markets[0]);



    return res.json({ success: true, data: data, meta: { sportkey: fetchData.sport, matchId: fetchData.matchId, market: fetchData.marketKey, streamLink: fetchData.streamLink } });
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

