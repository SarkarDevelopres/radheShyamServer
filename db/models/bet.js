// db/models/bet.js
const mongoose = require('mongoose');

const BetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },

  // unify: tell us which domain this bet belongs to
  type: { type: String, enum: ['sports', 'casino'], required: true, index: true },

  // SPORTS fields
  eventId: { type: String, index: true },     // e.g. matchId from odds feed
  market: { type: String },                   // e.g. 'h2h', 'winner', 'OU', etc.
  selection: { type: String },                // team/runner
  odds: { type: Number },                     // decimal odds, frozen at placement
  bookmakerKey: { type: String },
  lay: { type: Boolean, default: false },

  // CASINO/GAME fields
  game: { type: String, index: true },        // e.g. 'SEVEN_UP_DOWN'
  tableId: { type: String, index: true, default: 'default' },
  roundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Round', index: true },

  // Common
  stake: { type: Number, required: true, min: 1 },
  potentialPayout: { type: Number },          // precomputed if applicable
  payout: { type: Number, default: 0 },

  // Normalized lifecycle (align with Round: OPEN -> LOCKED -> SETTLED)
  status: {
    type: String,
    enum: ['OPEN', 'LOCKED', 'WON', 'LOST', 'VOID', 'SETTLED'],
    default: 'OPEN',
    index: true
  },

  meta: { type: Object }
}, { timestamps: true });

// My bets pagination
BetSchema.index({ userId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Bet', BetSchema);
