// db/models/odds.js
const mongoose = require('mongoose');

const OddsSchema = new mongoose.Schema({
  sport: { type: String, required: true },
  matchId:{ type: String, required: true },
  bookmakerKey: { type: String, default: null },
  marketKey: { type: String, default: 'h2h' },
  odds: [{
    name: String,
    price: Number
  }],
  isBet: { type: Boolean, default: false },
  provider: { type: String, default: 'the-odds-api' },
  sportsKey: { type: String },
  streamLink: {
    link: { type: Object },
    type: { type: String, enum: ["iframe", "link"] }
  },
  fetchedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Unique doc per market/sport/game to support upsert
OddsSchema.index({ sport: 1, matchId: 1, bookmakerKey: 1, marketKey: 1 }, { unique: true });

module.exports = mongoose.model('Odds', OddsSchema);
