const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const Round = require('../db/models/round');
const User = require('../db/models/user');
const Transaction = require('../db/models/transaction');

exports.gameLog = async (req, res) => {

    try {
        // Read token from Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res.status(401).json({ ok: false, message: "No token provided" });
        }

        // Format: "Bearer <token>"
        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ ok: false, message: "Invalid token format" });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const adminId = decoded.adminID;

        if (!adminId) {
            return res.status(401).json({ ok: false, message: "Unauthorized" });
        }

        // Fetch latest 5 rounds
        const latest5Rounds = await Round.find({})
            .sort({ createdAt: -1 })
            .limit(5);
        // console.log(latest5Rounds);

        return res.status(200).json({
            ok: true,
            rounds: latest5Rounds,
        });
    } catch (error) {
        console.error("Error in gameLog:", error);
        return res.status(500).json({
            ok: false,
            message: "Server error",
        });
    }
};


exports.transLog = async (req, res) => {
    try {
        // Read token from Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res.status(401).json({ ok: false, message: "No token provided" });
        }

        // Format: "Bearer <token>"
        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ ok: false, message: "Invalid token format" });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const adminId = decoded.adminID;

        if (!adminId) {
            return res.status(401).json({ ok: false, message: "Unauthorized" });
        }

        // Fetch latest 5 rounds
        const latest5Transaction = await Transaction.find({})
            .sort({ createdAt: -1 })
            .limit(5);
        console.log(latest5Transaction);

        return res.status(200).json({
            ok: true,
            trans: latest5Transaction,
        });
    } catch (error) {
        console.error("Error in gameLog:", error);
        return res.status(500).json({
            ok: false,
            message: "Server error",
        });
    }
}

exports.totalGames = async (req, res) => {
    console.log("I am triggered!");
    
    try {
        // Read token from Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res.status(401).json({ ok: false, message: "No token provided" });
        }

        // Format: "Bearer <token>"
        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ ok: false, message: "Invalid token format" });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const adminId = decoded.adminID;

        if (!adminId) {
            return res.status(401).json({ ok: false, message: "Unauthorized" });
        }

        // Fetch latest 5 rounds
        const totalGames = await Round.countDocuments({});
        console.log(totalGames);

        return res.status(200).json({
            ok: true,
            totalGames: totalGames,
        });
    } catch (error) {
        console.error("Error in gameLog:", error);
        return res.status(500).json({
            ok: false,
            message: "Server error",
        });
    }
}
exports.totalUsersDetails = async (req, res) => {
    console.log("I am triggered!");
    
    try {
        // Read token from Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res.status(401).json({ ok: false, message: "No token provided" });
        }

        // Format: "Bearer <token>"
        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ ok: false, message: "Invalid token format" });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const adminId = decoded.adminID;

        if (!adminId) {
            return res.status(401).json({ ok: false, message: "Unauthorized" });
        }

        // Fetch latest 5 rounds
        const totalUser = await User.find().select('_id email phone username');

        console.log("TOTAL USER: ",totalUser);

        return res.status(200).json({
            ok: true,
            totalUser: totalUser,
        });
    } catch (error) {
        console.error("Error in gameLog:", error);
        return res.status(500).json({
            ok: false,
            message: "Server error",
        });
    }
}
exports.totalTransactionDetails = async (req, res) => {
    console.log("I am triggered!");
    
    try {
        // Read token from Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res.status(401).json({ ok: false, message: "No token provided" });
        }

        // Format: "Bearer <token>"
        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ ok: false, message: "Invalid token format" });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const adminId = decoded.adminID;

        if (!adminId) {
            return res.status(401).json({ ok: false, message: "Unauthorized" });
        }

        // Fetch latest 5 rounds
        const totalTransaction = await Transaction.find().select('_id type amount createdAt');

        console.log("TOTAL TRANS: ",totalTransaction);

        return res.status(200).json({
            ok: true,
            totalTransaction: totalTransaction,
        });
    } catch (error) {
        console.error("Error in gameLog:", error);
        return res.status(500).json({
            ok: false,
            message: "Server error",
        });
    }
}