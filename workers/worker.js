// workers/worker.js
require('dotenv').config();
const mongoose = require('mongoose');
const Matchs = require('../db/models/match');
const Odds = require('../db/models/odds');

async function connect() {
    if (mongoose.connection.readyState) return;
    await mongoose.connect(process.env.DB_URI, {
        dbName: 'RadheShyamExch',
        readPreference: 'primary',
    });
}



const memCache = new Map()

const MIN = 60 * 1000;

const SPORTS = ["cricket", "soccer", "tennis", "basketball_nba", "baseball"]; // keep values matching your provider

const DURATIONS = {
    SOCCER: 120 * MIN,
    TENNIS: 150 * MIN,
    BASKETBALL: 135 * MIN,
    BASEBALL: 180 * MIN,
};

// utilitiy functions

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));


async function withTimeout(promise, ms, tag = 'op') {
    let t;
    const timeout = new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    }
    finally { clearTimeout(t); }
}

function changeFromIsoToEpoch(startTime) {
    let date = new Date(startTime);
    let sinceEpochTime = date.getTime();
    return sinceEpochTime;
}

function normalizeIsoToDate(isoLike) {
    if (isoLike instanceof Date) {
        return Number.isNaN(isoLike.getTime()) ? null : isoLike;
    }
    const iso = typeof isoLike === "string" && /[zZ]|[+\-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

function displayTimeIST(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return "";
    const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`;
}



function detectCategory(sportParam, m) {
    const sk = String(m?.sport_key || sportParam || "").toLowerCase();
    const st = String(m?.sport_title || m?.sports_title || "").toLowerCase();

    if (sk.includes("soccer") || st.includes("soccer") || st.includes("football")) return "SOCCER";
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
// -------------- you fill these 2 with your API code --------------
async function fetchMatchesFromProvider(sport) {
    if (sport === "cricket") {
        const scheduledUrl = "https://restapi.entitysport.com/exchange/matches/?status=1&token=a34a487cafbb7c1a67af8d50d67a360e";
        const liveUrl = "https://restapi.entitysport.com/exchange/matches/?status=3&token=a34a487cafbb7c1a67af8d50d67a360e";

        const [data, liveData] = await Promise.all([fetch(scheduledUrl), fetch(liveUrl)]);
        if (!data.ok || !liveData.ok) return [];

        const raw = await data.json();
        const liveRaw = await liveData.json();
        const merged = [...(liveRaw.response?.items || []), ...(raw.response?.items || [])];

        const matchList = [];
        for (const it of merged) {
            if (!it || it.oddstype === "") continue;

            const start = it.date_start; // ISO string or Date-like
            const end = it.end ?? it.date_end ?? null;

            const startTime = normalizeIsoToDate(start);
            const endTime = end ? normalizeIsoToDate(end) : null;

            matchList.push({
                matchId: it.match_id,
                sport: "cricket",
                sportKey: "cricket",
                teamHome: it.teama?.name,
                teamAway: it.teamb?.name,
                title: it.competition?.title,
                start_time: startTime ? startTime.getTime() : null,
                end_time: endTime ? endTime.getTime() : null,
                category: it.format_str,
                start_time_ist: startTime ? displayTimeIST(startTime) : "",
                end_time_ist: endTime ? displayTimeIST(endTime) : "",
                status: String(it.status_str || "").toLowerCase(), // scheduled/live/completed
                isOdds: true,
                sessionOdds: !!it.session_odds_available
            });
        }
        return matchList;
    }

    // ---- OddsAPI branch (soccer/tennis/basketball/baseball etc.)
    const oddsUrl =
        `https://api.the-odds-api.com/v4/sports/${sport}/odds/?regions=uk&markets=h2h_lay&apiKey=${process.env.ODDS_API_KEY}`;
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
            matchId: o.id,
            sport: sport,
            sportKey: o.sport_key,
            teamHome: o.home_team,
            teamAway: o.away_team,              // <-- fix
            title: o.sport_title,
            start_time: startEpoch,
            end_time: endEpoch,
            category,
            start_time_ist: startEpoch ? displayTimeIST(startTime) : "",
            end_time_ist: endEpoch ? displayTimeIST(endTime) : "",
            status: isLive ? "live" : isScheduled ? "scheduled" : "completed",
            isOdds: true,
            sessionOdds: false
        });
    }
    return matchList;
}

async function fetchOddsBatch(sport, matchIds) {
    if (sport === "cricket") {
        const url = `https://restapi.entitysport.com/exchange/matchesmultiodds?token=a34a487cafbb7c1a67af8d50d67a360e&match_id=${matchIds.join(",")}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const raw = await res.json();
        if (raw.status !== "ok") return [];

        const nameById = memCache.get('nameById') || new Map();
        const response = raw.response || {};
        const oddsList = [];

        for (const mid of matchIds) {
            const r = response[mid];
            if (!r || !r.live_odds || !r.live_odds.matchodds) continue;

            const names = nameById.get(String(mid)) || {};
            oddsList.push({
                matchId: mid,                               // <-- REQUIRED for upsert
                sport: sport,
                sportKey: sport,
                bookmakerKey: names.bookmakerKey || "entity",
                marketKey: "h2h",
                isBet: false,
                provider: "entity-sport",
                odds: [
                    { name: names.teama || "Team A", price: r.live_odds.matchodds?.teama?.back },
                    { name: names.teamb || "Team B", price: r.live_odds.matchodds?.teamb?.back }
                ]
            });
        }
        return oddsList;
    }

    // ---- OddsAPI branch
    const oddsUrl =
        `https://api.the-odds-api.com/v4/sports/${sport}/odds/?regions=uk&markets=h2h_lay&apiKey=${process.env.ODDS_API_KEY}`;
    const apiOddsRes = await fetch(oddsUrl);
    if (!apiOddsRes.ok) return [];
    const odds = await apiOddsRes.json();

    const docs = [];
    for (const o of odds || []) {
        if (!o.bookmakers?.length) continue;
        docs.push({
            matchId: o.id,
            sport: sport,
            sportKey: o.sport_key,
            bookmakerKey: o.bookmakers[0].key,
            marketKey: "h2h",
            isBet: false,
            sessionOdds: false,
            provider: "the-odds-api",
            odds: o.bookmakers[0].markets[0].outcomes
        });
        
    }
    return docs;
}

// ---------------------------------------------------------------

async function runFetchAndMaterialize() {
    await connect();
    console.log('[mongo] uri      =', process.env.DB_URI);
    console.log('[mongo] host/db  =', mongoose.connection.host, '/', mongoose.connection.name);

    const before = await Odds.countDocuments({});
    console.log('[mongo] odds count BEFORE =', before);

    const started = Date.now();
    let totalMatches = 0, totalOdds = 0;

    for (const sport of SPORTS) {
        try {
            console.log(`[worker] -> ${sport} fetching data`);
            const matches = await withTimeout(fetchMatchesFromProvider(sport), 20_000, `fixtures:${sport}`);

            // upsert matches
            if (matches.length) {
                let matchRes = await Matchs.bulkWrite(matches.map(m => ({
                    updateOne: {
                        filter: { matchId: m.matchId },
                        update: { $set: { ...m, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
                        upsert: true
                    }
                })), { ordered: false });
                console.log('[odds.bulkWrite] ack=', matchRes);
            }
            totalMatches += matches.length;

            // build id->names map and cache
            const nameById = new Map(matches.map(m => [
                String(m.matchId),
                { teama: m.teamHome, teamb: m.teamAway, bookmakerKey: m.bookmakerKey || (sport === 'cricket' ? 'entity' : undefined) }
            ]));
            memCache.set('nameById', nameById);

            const active = matches.filter(f => f.status === 'live' || f.status === 'scheduled');
            const ids = active.map(a => a.matchId);

            if (ids.length) {
                const oddDocs = await withTimeout(fetchOddsBatch(sport, ids), 20_000, `odds:${sport}`);
                if (oddDocs.length) {
                    let oddRes = await Odds.bulkWrite(oddDocs.map(d => ({
                        updateOne: {
                            filter: { matchId: d.matchId, bookmakerKey: d.bookmakerKey, marketKey: d.marketKey, sport:sport },
                            update: {
                                $set: { odds: d.odds, updatedAt: new Date() },
                                $setOnInsert: { createdAt: new Date(), matchId: d.matchId, bookmakerKey: d.bookmakerKey, marketKey: d.marketKey, sport:sport }
                            },
                            upsert: true
                        }
                    })), { ordered: false });
                }
                totalOdds += oddDocs.length;
            }

            await sleep(250); // gentle spacing

        } catch (error) {
            console.log(`[worker] errored: ${error.message}`);
        }
    }

    console.log(`[worker] ✓ refresh done in ${Date.now() - started}ms  matches:${totalMatches} odds:${totalOdds}`);

}


async function runSettlement() {
    await connect();
    // find completed but not settled and call your existing settle logic
    // leave simple for tomorrow; even a stub is okay
    console.log('[worker] settlement tick (stub)');
}

setInterval(runFetchAndMaterialize, 2 * 60 * 1000);
setInterval(runSettlement, 30 * 60 * 1000);

// first run now
runFetchAndMaterialize().catch(console.error);
