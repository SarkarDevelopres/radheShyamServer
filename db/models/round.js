const mongoose = require('mongoose');

const RoundSchema = new mongoose.Schema({
  game: { type: String, index: true },          // 'SEVEN_UP_DOWN'
  tableId: { type: String, index: true, default: 'default' },
  startAt: Number,
  betsCloseAt: Number,
  settleAt: Number,
  status: { type: String, enum: ['OPEN','LOCKED','SETTLED'], index: true },
  result: { d1: Number, d2: Number, total: Number, outcome: String }, // set at settle
}, { timestamps: true });

module.exports = mongoose.model('Round', RoundSchema);