const mongoose = require('mongoose');

const RoundSchema = new mongoose.Schema({
  game: { type: String, index: true },          // 'SEVEN_UP_DOWN'
  tableId: { type: String, index: true, default: 'default' },
  startAt: Number,
  betsCloseAt: Number,
  settleAt: Number,
  status: { type: String, enum: ['OPEN','LOCKED','SETTLED'], index: true },
  result: { type: Object }, // set at settle
}, { timestamps: true });

module.exports = mongoose.model('Round', RoundSchema);