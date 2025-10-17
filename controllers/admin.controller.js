const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const Round = require('../db/models/round');
const User = require('../db/models/user');
const Employee = require('../db/models/employee');
const Admin = require('../db/models/admin');
const Odds = require('../db/models/odds');
const Transaction = require('../db/models/transaction');
const Config = require('../db/models/config');
// const bcrypt = require("bcryptjs");


function isValidIndianPhone(phone) {
    const str = String(phone);

    // Must start with 91 and then exactly 10 digits
    if (!/^91\d{10}$/.test(str)) return false;

    const number = str.slice(2); // get last 10 digits

    // Reject all identical digits (0000000000, 1111111111, etc.)
    if (/^(\d)\1{9}$/.test(number)) return false;

    // Reject sequential ascending and descending
    if (number === "1234567890" || number === "9876543210") return false;

    return true; // ✅ Valid
}

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
exports.totalEmployeeDetails = async (req, res) => {
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
        const totalEmployee = await Employee.find().select('_id email phone employee_id name');

        return res.status(200).json({
            ok: true,
            totalEmployee: totalEmployee,
        });
    } catch (error) {
        console.error("Error in employee data:", error);
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

        if (!userId) {
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
exports.deleteEmp = async (req, res) => {

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

        const { empId } = req.body;

        if (!empId) {
            return res.status(400).json({ ok: false, message: "userId required" });
        }

        // First check if user exists and has enough balance
        const emp = await Employee.findById(empId);
        if (!emp) {
            return res.status(404).json({ ok: false, message: "Employee not found" });
        }

        await Employee.findByIdAndDelete(empId);

        return res.status(200).json({
            ok: true,
            message: `Employee deleted successfully`
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

        return res.status(200).json({ ok: true, user, message: "Found user" });

    } catch (error) {
        console.error("FindUser error:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
};

exports.getNumber = async (req, res) => {
    try {

        let phoneDetails = await Admin.findOne({ role: "admin" }).select("phone");
        res.status(200).json({ ok: true, data: phoneDetails })

    } catch (error) {
        console.error("number not found:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
}

exports.chngWhatsapp = async (req, res) => {

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

        const { phone } = req.body;

        if (!phone) {
            return res.status(401).json({ ok: false, message: "Invalid Value" });
        }

        let validity = isValidIndianPhone(phone)

        if (validity) {

            const updatedAdmin = await Admin.findByIdAndUpdate(
                adminId,
                { phone: phone },
                { new: true }
            );

            res.status(200).json({ ok: true, message: "Succesfully No. Updated!", data: updatedAdmin });
        }

        else {
            return res.status(401).json({ ok: false, message: "Invalid Value" });
        }



    } catch (error) {
        console.error("number cannot be updated:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
}

exports.getLiveOdds = async (req, res) => {
    try {
        const now = new Date();

        console.log("I came!!");

        const { sport, limit } = req.query;

        // commenceTime: { $lte: now },
        const filter = {
            expectedEndAt: { $gt: now }    // non-empty odds
        };
        if (sport) filter.sport = sport;   // e.g., cricket, football, tennis, baseball, basketball_nba

        const cap = Math.min(Math.max(parseInt(limit || '500', 10), 1), 1000);

        // Pull candidate rows
        const rows = await Odds.find(filter)
            .sort({ commenceTime: 1, fetchedAt: -1 })
            .limit(cap)
            .lean();

        // Dedupe by matchId (keep earliest start / latest fetched as per sort)
        console.log(rows);




        return res.json({ ok: true, data: rows });
    } catch (err) {
        console.error('[odds.getLiveOdds] error:', err);
        return res.status(500).json({ success: false, error: 'Failed to fetch live odds' });
    }
};

exports.updateOddsStream = async (req, res) => {
    try {
        console.log("I was called!! ");

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

        const { id, streamLink, linkType } = req.body;

        if (!id) {
            return res.status(400).json({ ok: false, message: "Provide either id or matchId" });
        }
        if (typeof streamLink !== "string" || !streamLink.trim()) {
            return res.status(400).json({ ok: false, message: "streamLink is required" });
        }
        try { new URL(streamLink); } catch {
            // If it's not a full URL, you can reject or allow relative paths. Here we reject:
            return res.status(400).json({ ok: false, message: "streamLink must be a valid URL" });
        }

        let updated = await Odds.findByIdAndUpdate(id,
            {
                $set: {

                    streamLink:
                    {
                        link: streamLink,
                        type: linkType
                    }
                }
            }, { new: true });

        if (!updated) {
            return res.status(404).json({ ok: false, message: "Match not found" });
        }

        return res.json({
            ok: true,
            message: "Stream link updated",
        });


    } catch (error) {
        console.error("number cannot be updated:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
}


exports.createEmp = async (req, res) => {
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

        const { name, email, phone, password } = req.body;

        console.log(req.body);

        // console.log("USername: ", name);


        if (!name || !phone || !password || !email) {
            return res.status(400).json({ ok: false, message: "All fields are required" });
        }

        // Check if user exists
        const existingEmp = await Employee.findOne({ $or: [{ email }, { phone },] });
        if (existingEmp) {
            return res.status(409).json({ ok: false, message: "User already exists" });
        }

        let randomId = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
        let employeeID = `emp${randomId}`;

        const newEmp = new Employee({
            name,
            phone,
            email,
            password: password,
            employee_id: employeeID
        });

        await newEmp.save();

        return res.status(201).json({
            ok: true,
            message: "User created successfully",
            empData: {
                _id: newEmp._id,
                name: newEmp.name,
                phone: newEmp.phone,
            },
        });
    } catch (error) {
        console.error("Create employee error:", error);
        return res.status(500).json({ ok: false, message: "Server error" });
    }
};

exports.checkMaintainance = async (req, res) => {
    try {
        let getAdminData = await Admin.findOne({ role: "admin" }).select('maintenance');
        console.log(getAdminData);

        if (getAdminData) {
            let isMaintainance = getAdminData.maintenance.isOn;
            if (isMaintainance) {
                return res.status(200).json({
                    ok: true,
                    isMaintenance: true,
                    duration: getAdminData.maintenance.duration,
                    startedAt: getAdminData.maintenance.startedAt,
                    string: getAdminData.maintenance.string,
                })
            }
            return res.status(200).json({ ok: true, isMaintenance: false })
        }
        return res.status(200);

    } catch (error) {
        return res.status(400).json({ ok: false, isMaintenance: true, message: error.message });
    }
}

exports.setMaintainance = async (req, res) => {
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
        const { isOn, duration, string } = req.body;
        console.log("Initial Data:", req.body);

        let currentDate = new Date();
        let startedAt = currentDate.toISOString();

        let newMaintainceData = await Admin.findOneAndUpdate({ role: "admin" }, { maintenance: { isOn, duration, string, startedAt } }, { new: true }).select("maintenance");

        console.log(newMaintainceData);


        if (newMaintainceData) {
            return res.status(200).json({ ok: true, data: newMaintainceData.maintenance });
        }
        return res.status(400).json({ ok: false, message: "Error changing maintainnce" });
    } catch (error) {
        return res.status(500).json({ ok: false, message: "Error changing maintainnce" });
    }
}


exports.changeSlides = async (req, res) => {
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
        const { slidePathArray } = req.body;
        const updated = await Config.updateOne(
            { _id: "server_config_89263" },
            { $set: { slides: slidePathArray } },
            { upsert: true }
        );

        return res.status(200).json({ ok: true, message: "Slides updated" });

    } catch (error) {
        console.error("Error in changeSlides:", error.message);
        return res.status(500).json({ ok: false, message: "Server error", error: error.message });
    }
}

exports.fetchSlides = async (req, res) => {
    try {
        let slidesPathArray = await Config.findById("server_config_89263");
        return res.status(200).json({ ok: true, data: slidesPathArray });
    } catch (error) {
        console.error("Error in fetch slides:", error.message);
        return res.status(500).json({ ok: false, message: "Server error", error: error.message });
    }
}