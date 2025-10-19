const dotenv = require('dotenv');
dotenv.config();
const Odds = require('../db/models/odds');
const Matchs = require('../db/models/match');

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
exports.setMatch = async (req, res) => {
    const match = {
        match_id: 939662,
        title: "Ajman vs Sharjah",
        short_title: "AJM vs SHA",
        subtitle: "23rd Match",
        match_number: "23",
        format: 6,
        format_str: "T20",
        status: 3,
        status_str: "Live",
        status_note: "",
        game_state: 3,
        game_state_str: "Play Ongoing",
        domestic: "1",
        competition: {
            cid: 129822,
            title: "Emirates D20",
            abbr: "Emirates D20",
            type: "tournament",
            category: "domestic",
            match_format: "t20",
            season: "2025",
            status: "live",
            datestart: "2025-10-07",
            dateend: "2025-10-24",
            country: "ae",
            total_matches: "30",
            total_rounds: "1",
            total_teams: "6",
        },
        teama: {
            team_id: 116221,
            name: "Ajman",
            short_name: "AJM",
            logo_url: "https://gcdnimages.entitysport.com/assets/uploads/2022/06/AJM-CR2@2x.png",
        },
        teamb: {
            team_id: 116225,
            name: "Sharjah",
            short_name: "SHA",
            logo_url: "https://gcdnimages.entitysport.com/assets/uploads/2023/05/SHA-CR2@2x.png",
        },
        date_start: "2025-10-19 13:30:00",
        date_end: "2025-10-19 23:30:00",
        timestamp_start: 1760880600,
        timestamp_end: 1760916600,
        date_start_ist: "2025-10-19 19:00:00",
        date_end_ist: "2025-10-20 05:00:00",
        venue: {
            venue_id: "98",
            name: "Sharjah Cricket Stadium",
            location: "Sharjah",
            country: "United Arab Emirates",
            timezone: "",
        },
        umpires: "",
        referee: "",
        equation: "",
        live: "",
        result: "",
        result_type: "",
        win_margin: "",
        winning_team_id: 0,
        commentary: 1,
        wagon: 0,
        latest_inning_number: 0,
        oddstype: "betfair",
        session_odds_available: false,
        day: "0",
        session: "0",
        toss: {
            winner: 0,
            decision: 0,
        },
    };

    const startTime = normalizeIsoToDate(match.date_start);
    const endTime = normalizeIsoToDate(match.date_end);
    await Matchs.create({
        matchId: match.match_id,
        sport: 'cricket',
        sportkey: 'cricket',
        teamHome: match.teama,
        teamAway: match.teamb,
        title: match.competition.title,
        start_time: startTime,
        end_time: endTime,
        category: match.format_str,
        start_time_ist: displayTimeIST(startTime),
        end_time_ist: displayTimeIST(endTime),
        status: String(match.status_str || '').toLowerCase(),
        game_state: { code: match.game_state, string: match.game_state_str },
        isOdds: true,
        sessionOdds: !!match.session_odds_available
    })
    await Odds.create({
        matchId: String(match.match_id),
        sport: "cricket",
        sportKey: "cricket",
        bookmakerKey: match.oddstype,
        marketKey: 'h2h', // keep consistent with your UI/queries
        isBet: false,
        provider: 'entity-sport',
        odds: [
            { name: match.teama.name, price: 1.2 },
            { name: match.teamb.name, price: 3.4 }
        ],
        sessionOdds: []
    })

    return res.status(200).json({ok:true});
}
exports.completeMatch = async (req, res) => {

}