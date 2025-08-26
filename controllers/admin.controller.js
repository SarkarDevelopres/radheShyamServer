const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const Round = require('../db/models/round');
const User = require('../db/models/user');
const Transaction = require('../db/models/transaction');
// const bcrypt = require("bcryptjs");

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
        // console.log(latest5Transaction);

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
    // console.log("I am triggered!");

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
        // console.log(totalGames);

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
    // console.log("I am triggered!");

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
        const totalUser = await User.find().select('_id email phone username balance');

        // console.log("TOTAL USER: ", totalUser);

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
    // console.log("I am triggered!");

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

        // console.log("TOTAL TRANS: ", totalTransaction);

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


exports.createUser = async (req, res) => {
    try {
        const authHeader = req.headers["authorization"];
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

        const { username, phone, password } = req.body;

        console.log("USername: ", username);


        if (!username || !phone || !password) {
            return res.status(400).json({ ok: false, message: "All fields are required" });
        }

        // Check if user exists
        const existingUser = await User.findOne({ $or: [{ username }, { phone }] });
        if (existingUser) {
            return res.status(409).json({ ok: false, message: "User already exists" });
        }


        const newUser = new User({
            username,
            phone,
            password: password,
        });

        await newUser.save();

        return res.status(201).json({
            ok: true,
            message: "User created successfully",
            userData: {
                _id: newUser._id,
                username: newUser.username,
                phone: newUser.phone,
            },
        });
    } catch (error) {
        console.error("Create user error:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
};

exports.addCoins = async (req, res) => {
    try {
        const authHeader = req.headers["authorization"];
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
        const { userId, coins } = req.body;

        if (!userId || !coins) {
            return res.status(400).json({ ok: false, message: "userId and coins are required" });
        }

        // Increment balance directly
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $inc: { balance: Number(coins) } },
            { new: true }  // return updated document
        );

        if (!updatedUser) {
            return res.status(404).json({ ok: false, message: "User not found" });
        }

        return res.status(200).json({
            ok: true,
            message: `${coins} coins added successfully`,
            newBalance: updatedUser.balance,
        });

    } catch (error) {
        console.error("Add Coins Error:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
};

exports.deductCoins = async (req, res) => {

    try {
        const authHeader = req.headers["authorization"];
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

        const { userId, coins } = req.body;

        if (!userId || !coins) {
            return res.status(400).json({ ok: false, message: "userId and coins are required" });
        }

        // First check if user exists and has enough balance
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ ok: false, message: "User not found" });
        }

        if ((user.balance || 0) < coins) {
            return res.status(400).json({ ok: false, message: "Insufficient balance" });
        }

        // Deduct balance atomically
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $inc: { balance: -Number(coins) } },
            { new: true }
        );

        return res.status(200).json({
            ok: true,
            message: `${coins} coins deducted successfully`,
            newBalance: updatedUser.balance,
        });

    } catch (error) {
        console.error("Deduct Coins Error:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }

}

exports.getTodayTotalTransactions = async (req, res) => {

    try {

        // Calculate today's start and end
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);   // force UTC
        const end = new Date();
        end.setUTCHours(23, 59, 59, 999);

        // Use aggregation
        const result = await Transaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: start, $lte: end }
                    // optionally filter: type: 'deposit'
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$amount" },
                    transactionCount: { $sum: 1 }
                }
            }
        ]);
        console.log("Result: ", result);

        return res.status(200).json({
            ok: true,
            totalAmount: result.length > 0 ? result[0].totalAmount : 0,
        });
    } catch (error) {
        console.error("Error in getTodayTotalTransactions:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
};

exports.deleteUser = async (req, res) => {

    try {
        const authHeader = req.headers["authorization"];
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

        const { userId } = req.body;

        if (!userId ) {
            return res.status(400).json({ ok: false, message: "userId required" });
        }

        // First check if user exists and has enough balance
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ ok: false, message: "User not found" });
        }
        // Deduct balance atomically
        await User.findByIdAndDelete(userId);

        return res.status(200).json({
            ok: true,
            message: `User deleted successfully`
        });

    } catch (error) {
        console.error("User Delete Error:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
}

exports.findUser = async (req, res) => {
  try {
    const { username, email, phone } = req.body;

    if (!username && !email && !phone) {
      return res.status(400).json({ ok: false, message: "Provide at least one field" });
    }

    // Build query object dynamically
    let query = {};
    if (username) query.username = username;
    if (email) query.email = email;
    if (phone) query.phone = phone;

    const user = await User.findOne(query);

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    return res.status(200).json({ ok: true, user, message:"Found user" });

  } catch (error) {
    console.error("FindUser error:", error);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};
