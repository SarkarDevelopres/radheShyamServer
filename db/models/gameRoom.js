const mongoose = require('mongoose');

const GameRoomSchema = new mongoose.Schema({
    gameName: {  type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
    players: [playerSchema],
    playerCount: { type: Number, enum: [2, 3, 4], required: true },
    entryFee: { type: Number, required: true }, // e.g. ₹50
    prizePool: { type: Number, required: true }, // Calculated dynamically
    status: { type: String, enum: ['waiting', 'ongoing', 'completed'], default: 'waiting' },
     winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });


module.exports = mongoose.model('GameRoom', GameRoomSchema);
