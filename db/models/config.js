// db/models/config.js
const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
    _id: { type: String, default: "server_config_89263" },
    slides: { type: Array },
    gamesBiased: {type: Boolean, default: true},
    announcements: { type: Object },
}, { timestamps: true });

module.exports = mongoose.model('Config', ConfigSchema);
