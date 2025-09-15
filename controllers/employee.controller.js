const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const User = require('../db/models/user');


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
        const adminId = decoded.employeeID;

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
        const adminId = decoded.employeeID;

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
        const adminId = decoded.employeeID;

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
        const adminId = decoded.employeeID;

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