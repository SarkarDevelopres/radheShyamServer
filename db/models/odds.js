// db/models/odds.js
const mongoose = require('mongoose');

const OddsSchema = new mongoose.Schema({
  sport: { type: String, required: true },           // 'cricket' | 'soccer' | 'tennis' ...
  matchId: { type: String, required: true },         // m.id from API
  home: String,
  away: String,
  title: String,                                     // m.sport_title
  commenceTime: { type: Date, index: true },

  bookmakerKey: { type: String, default: null },     // e.g. first bookmaker key
  marketKey: { type: String, default: 'h2h' },

  // normalized outcomes to render fast
  odds: [{
    name: String,
    price: Number
  }],

  // helpful for debugging
  provider: { type: String, default: 'the-odds-api' },

  // when we last refreshed this record from upstream
  fetchedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Unique doc per market/sport/game to support upsert
OddsSchema.index({ sport: 1, matchId: 1, bookmakerKey: 1, marketKey: 1 }, { unique: true });

module.exports = mongoose.model('Odds', OddsSchema);
