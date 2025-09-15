// db/models/score.js
const mongoose = require('mongoose');
const ScoreScehma = new mongoose.Schema({
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', index: true, required: true },
    score: { type: Object },
    sport: { type: String }
})

module.exports = mongoose.model('Scores', ScoreScehma);