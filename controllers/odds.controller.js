const dotenv = require('dotenv');
dotenv.config();

let cache = { data: null, ts: 0 };

exports.cricket = async (req, res) => {
  const now = Date.now();

  // use cache if fresh (< 10s old)
  if (cache.data && now - cache.ts < 10000) {
    return res.json(cache.data);
  }

  try {
    const apiRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/cricket/odds/?regions=uk&markets=h2h&apiKey=${process.env.ODDS_API_KEY}`
    );
    const raw = await apiRes.json();

    const trimmed = raw.map(m => {
      const market = m.bookmakers?.[0]?.markets?.[0];

      // format start time
      const date = new Date(m.commence_time);
      const formattedDate = date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).replace(",", "");

      return {
        matchId: m.id,
        home: m.home_team,
        away: m.away_team,
        title:m.sport_title,
        startTime: m.commence_time, 
        displayableTime: formattedDate, // send displayable date
        odds: market?.outcomes?.map(o => ({
          name: o.name,
          price: o.price
        })) || []
      };
    });

    cache = { data: trimmed, ts: now };

    res.json({data:trimmed, success:true});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch odds" });
  }
};



exports.football = async(req,res) => {
const now = Date.now();

  // use cache if fresh (< 10s old)
  if (cache.data && now - cache.ts < 10000) {
    return res.json(cache.data);
  }

  try {
    const apiRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=uk&markets=h2h&apiKey=${process.env.ODDS_API_KEY}`
    );
    const raw = await apiRes.json();

    const trimmed = raw.map(m => {
      const market = m.bookmakers?.[0]?.markets?.[0];

      // format start time
      const date = new Date(m.commence_time);
      const formattedDate = date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).replace(",", "");

      return {
        matchId: m.id,
        home: m.home_team,
        away: m.away_team,
        title:m.sport_title,
        startTime: m.commence_time, 
        displayableTime: formattedDate, // send displayable date
        odds: market?.outcomes?.map(o => ({
          name: o.name,
          price: o.price
        })) || []
      };
    });

    cache = { data: trimmed, ts: now };

    res.json({data:trimmed, success:true});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch odds" });
  }
}
exports.tennis = async(req,res) => {
const now = Date.now();

  // use cache if fresh (< 10s old)
  if (cache.data && now - cache.ts < 10000) {
    return res.json(cache.data);
  }

  try {
    const apiRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/tennis/odds/?regions=uk&markets=h2h&apiKey=${process.env.ODDS_API_KEY}`
    );
    const raw = await apiRes.json();

    const trimmed = raw.map(m => {
      const market = m.bookmakers?.[0]?.markets?.[0];

      // format start time
      const date = new Date(m.commence_time);
      const formattedDate = date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).replace(",", "");

      return {
        matchId: m.id,
        home: m.home_team,
        away: m.away_team,
        title:m.sport_title,
        startTime: m.commence_time, 
        displayableTime: formattedDate, // send displayable date
        odds: market?.outcomes?.map(o => ({
          name: o.name,
          price: o.price
        })) || []
      };
    });

    cache = { data: trimmed, ts: now };

    res.json({data:trimmed, success:true});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch odds" });
  }
}
