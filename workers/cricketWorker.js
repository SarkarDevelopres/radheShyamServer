// workers/worker.js
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Matchs = require('../db/models/match');
const Odds = require('../db/models/odds');
const Bet = require('../db/models/bet');
const User = require('../db/models/user');
const Transaction = require('../db/models/transaction');
const match = require('../db/models/match');
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
const SPORTS = ['cricket'];
// const SPORTS = ['tennis'];

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
}



async function fetchCompletedCricketIds() {
    try {
        // Completed matches (status=2)
        const completedURL = `https://restapi.entitysport.com/exchange/matches/?status=2&token=${process.env.ENTITY_TOKEN}`;
        const completedRes = await fetch(completedURL);
        if (!completedRes.ok) return [];

        const completedJson = await completedRes.json();
        const completedItems = completedJson?.response?.items || [];

        // Cancelled matches (status=4)
        const cancelURL = `https://restapi.entitysport.com/exchange/matches/?status=4&token=${process.env.ENTITY_TOKEN}`;
        const cancelRes = await fetch(cancelURL);
        if (!cancelRes.ok) return [];

        const cancelJson = await cancelRes.json();
        const cancelItems = cancelJson?.response?.items || [];

        // Map both arrays
        const completedMapped = completedItems.map(it => ({
            matchId: String(it.match_id),
            winningTeamId: it.winning_team_id ? String(it.winning_team_id) : null,
            status: "completed"
        }));

        const cancelledMapped = cancelItems.map(it => ({
            matchId: String(it.match_id),
            winningTeamId: null,     // explicitly null for cancelled
            status: "cancelled"
        }));

        // Merge and remove duplicates just in case
        const merged = [...completedMapped, ...cancelledMapped];
        const unique = Object.values(
            merged.reduce((acc, cur) => {
                acc[cur.matchId] = cur;
                return acc;
            }, {})
        );

        return unique.filter(it => Boolean(it.matchId));
    } catch (err) {
        console.error("[EntitySport] fetchCompletedCricketIds failed:", err.message);
        return [];
    }
}




async function settleSportMatches(sport, completed) {
    try {
        if (!completed.length) {
            console.log(`[settle] no completed matches for ${sport}`);
            return;
        }

        const ids = completed.map(m => m.matchId);

        // Mark matches completed/cancelled properly
        for (const { matchId, winningTeamId, status } of completed) {
            await Matchs.updateOne(
                { sport, matchId },
                {
                    $set: {
                        game_state: { code: status ==="cancelled" ?  4 : 2, string: status ==="cancelled" ? "cancelled" : "completed"},
                        status: status === "cancelled" ? "cancelled" : "completed",
                        winner:winningTeamId,
                        updatedAt: new Date()
                    }
                }
            );

            const bets = await Bet.find({
                type: { $in: ["sports", "cashout"] },
                eventId: matchId,
                status: "OPEN"
            });

            if (!bets.length) continue;

            const bulkBets = [];
            const bulkUsers = [];
            const txs = [];

            // ------------------------------------------------
            // 1️⃣ VOID CASE → cancelled or no winning team
            // ------------------------------------------------
            if (!winningTeamId || status === "cancelled") {
                for (const b of bets) {
                    bulkBets.push({
                        updateOne: {
                            filter: { _id: b._id },
                            update: { $set: { status: "VOID" } }
                        }
                    });

                    if (b.type === "sports") {
                        // 15% fee withheld
                        let refundAmount = 0;
                        if (b.lay) {
                            const liability = (b.odds - 1) * b.stake;
                            refundAmount = liability * 0.85; // 85% returned
                        } else {
                            refundAmount = b.stake * 0.85;
                        }

                        bulkUsers.push({
                            updateOne: {
                                filter: { _id: b.userId },
                                update: { $inc: { balance: refundAmount } }
                            }
                        });

                        txs.push({
                            userId: b.userId,
                            type: "bet_void_refund",
                            amount: refundAmount,
                            meta: { betId: b._id, eventId: matchId }
                        });
                    }
                }

                if (bulkBets.length) await Bet.bulkWrite(bulkBets);
                if (bulkUsers.length) await User.bulkWrite(bulkUsers);
                if (txs.length) await Transaction.insertMany(txs);

                console.log(`[settle] VOID bets settled for match ${matchId}: total=${bets.length}`);
                continue; // ✅ important — skip the rest
            }


            // ------------------------------------------------
            // 2️⃣ NORMAL SETTLEMENT CASE

            for (const b of bets) {
                if (b.type === "cashout") {
                    bulkBets.push({
                        updateOne: {
                            filter: { _id: b._id },
                            update: { $set: { status: "SETTLED" } }
                        }
                    });

                    if (b.profitHeld > 0) {
                        bulkUsers.push({
                            updateOne: {
                                filter: { _id: b.userId },
                                update: { $inc: { balance: b.profitHeld } }
                            }
                        });
                        txs.push({
                            userId: b.userId,
                            type: "cashout_win",
                            amount: b.profitHeld,
                            meta: { betId: b._id, eventId: matchId }
                        });
                    }

                    continue;
                }

                let won = false;
                let payout = 0;

                if (!b.lay) {
                    // BACK bet
                    won = String(b.selection) === String(winningTeamId);
                    payout = won ? b.stake * b.odds : 0;
                } else {
                    // LAY bet
                    const liability = (b.odds - 1) * b.stake;
                    won = String(b.selection) !== String(winningTeamId);
                    payout = won ? (b.stake + liability) : 0; // ✅ correct lay payout
                }

                bulkBets.push({
                    updateOne: {
                        filter: { _id: b._id },
                        update: { $set: { status: won ? "WON" : "LOST", won, payout } }
                    }
                });

                if (payout > 0) {
                    bulkUsers.push({
                        updateOne: {
                            filter: { _id: b.userId },
                            update: { $inc: { balance: payout } }
                        }
                    });

                    txs.push({
                        userId: b.userId,
                        type: "payout_win",
                        amount: payout,
                        meta: { betId: b._id, eventId: matchId }
                    });
                }
            }

            if (bulkBets.length) await Bet.bulkWrite(bulkBets);
            if (bulkUsers.length) await User.bulkWrite(bulkUsers);
            if (txs.length) await Transaction.insertMany(txs);

            console.log(`[settle] ${sport} bets settled for match ${matchId}: total=${bets.length}`);
        }

    } catch (e) {
        console.error("[settle] error:", e.message);
    }
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
            console.log(`[worker] → ${sport}: fetching fixtures`);
            const matches = await withTimeout(fetchMatchesFromProvider(sport), 20_000, `fixtures:${sport}`);

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
                // console.log(matches);

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
                const oddDocs = await withTimeout(fetchOddsBatch(sport, ids, globalNameById), 60_000, `odds:${sport}`);

                if (oddDocs.length) {

                    const ops = oddDocs
                        .filter(d => d.matchId && d.bookmakerKey && d.marketKey)
                        .map(d => {
                            const match = matches.find(m => m.matchId === d.matchId);

                            let finalOdds = d.sessionOdds;
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

    console.log(`[worker] ✓ refresh done in ${Date.now() - started}ms  matches:${totalMatches} odds:${totalOdds}`);
}


async function runSettlement() {
    try {
        let completed = await withTimeout(fetchCompletedCricketIds(), 60_000, `completed: cricket`);
        await settleSportMatches("cricket", completed);
        // console.log('[runSettlement] completed IDs:', completed);
    }
    catch {
        console.error('[runSettlement] cricket error:', e);
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
        // await runFetchAndMaterialize();
        await runSettlement();

        // schedule periodic jobs (add small jitter to avoid exact-minute stampedes)
        const jitter = () => 500 + Math.floor(Math.random() * 1500);
        // setInterval(runFetchAndMaterialize, 5 * MIN + jitter());
        // setInterval(runSettlement, 2* MIN + jitter());
    } catch (err) {
        console.error('[db] connection failed:', err.message);
        process.exit(1);
    }
})();
