const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },

  // Append-only money movement type
  type: { 
    type: String,
    enum: ['deposit','withdraw','bet_place','bet_void_refund','payout_win'],
    index: true,
    required: true
  },

  // Amount in integer coins/paise; +credit, -debit
  amount: { type: Number, required: true, min: -9_000_000_000, max: 9_000_000_000 },

  // Snapshot of user's balance *after* this tx is applied
  balanceAfter: { type: Number, required: true },

  // Optional operational status for async flows (deposits/withdrawals)
  status: { type: String, enum: ['completed','pending','failed'], default: 'completed', index: true },

  // Flexible metadata about the origin of this tx
  meta: {
    betId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bet' },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Round' },
    eventId: { type: String },
    provider: { type: String },
    notes: { type: String },
    // keep this open for anything else:
    _raw: mongoose.Schema.Types.Mixed
  }
}, { timestamps: true });

// Fast per-user pagination & sorting
TransactionSchema.index({ userId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
