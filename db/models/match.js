// db/models/match.js
const mongoose = require('mongoose');
const MatchScehma = new mongoose.Schema({
    matchId:  { type: String, required: true },
    teamHome: { type: Object, required: true },
    teamAway: { type: Object, required: true },
    title: { type: String },
    category: { type: String },
    start_time: { type: Number },
    end_time: { type: Number },
    start_time_ist: { type: String },
    end_time_ist: { type: String },
    status: { type: String, enum: ["scheduled", "live", "completed", "bets_pending"] },
    game_state: { type: Object },
    isOdds: { type: Boolean },
    sport: { type: String },
    sportsKey: {type: String},
})
module.exports = mongoose.model('Matchs', MatchScehma);

