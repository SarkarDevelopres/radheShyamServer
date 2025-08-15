const mongoose = require('mongoose');

const TimeConfigSchema = new mongoose.Schema({
    turnTimeSec: { type: Number, default: 20 },           // per-turn timer (if applicable)
    matchTimeLimitSec: { type: Number, default: 0 },      // 0 => unlimited
    graceDisconnectSec: { type: Number, default: 10 },    // allowed reconnect window
    idlePolicy: {                                         // what to do on timeouts
        type: { type: String, enum: ["skip", "auto-move", "forfeit"], default: "skip" },
        maxSkipsBeforeForfeit: { type: Number, default: 3 },
    },
});

const GameSchema = new mongoose.Schema({
    name: { type: String, required: true },// "Ludo", "Chess", "Teen Patti"

    slug: { type: String, required: true, unique: true, lowercase: true }, // "ludo", "chess"

    category: { type: String, enum: ["board", "card", "strategy", "casino", "fantasy", "other"], required: true },

    description: { type: String, default: "" },

    status: { type: String, enum: ["draft", "active", "maintenance", "retired"], default: "draft" },
    featured: { type: Boolean, default: false },

    minPlayers: { type: Number, required: true },

    maxPlayers: { type: Number, required: true },
    
    allowedCounts: [{ type: Number, required: true }],

    timeConfig: { type: TimeConfigSchema, required: true },

    entryFees: { type: Number, required: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
}, { timestamps: true });

module.exports = mongoose.model('Game', GameSchema);
