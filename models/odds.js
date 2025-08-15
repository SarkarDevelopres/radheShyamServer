const mongoose = require('mongoose');

const OddSchema = new mongoose.Schema({
    matchId: { type: String, required:true },
    sport: { type: String, enum:["cricket","tennis", "football"], required:true },
    event: { type: String, required:true },
    teams: {
        home:{ type: String, required:true },
        away: { type: String, required:true },
    },
    startTime: {type: Date, required:true},
    odds:{
        home:{
            price:{ type: Number, required:true },
            bookmaker:{ type: String, required:true },
        },
        away:{
            price:{ type: Number, required:true },
            bookmaker:{ type: String, required:true },
        },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });


module.exports = mongoose.model('Odd', OddSchema);
