const mongoose = require('mongoose');

const BetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  matchId: { type: String }, 
  market: { type: String, default: 'h2h' },
  selectedTeam: { type: String },             // team name
  stake:{ type: Number },                 // coins (int)
  odds: { type: Number },                // decimal odds at bet time (freeze this!)
  bookmakerKey: { type: String },          // optional, from your rollup
  status: { type: String, enum: ['open','won','lost','void'], default: 'open', index: true },
  potentialPayout: { type: Number },            // stake * odds (precomputed)
}, { timestamps: true });

module.exports = mongoose.model('Bet', BetSchema);