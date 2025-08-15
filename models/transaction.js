const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  type: { 
    type: String, 
    enum: ['deposit','withdraw','bet_place','bet_void_refund','payout_win'], 
    index: true 
  },
  amount: Number,       // positive for credit, negative for debit (coins)
  balanceAfter: Number, // snapshot after this tx (optional but handy)
  meta: mongoose.Schema.Types.Mixed // { betId, matchId, notes }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);