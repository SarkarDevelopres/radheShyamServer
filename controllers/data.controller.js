const User = require('../db/models/user');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

exports.balance = async (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userID;

        const userBalanceData = await User.findById(userId).select('balance');

        console.log(userBalanceData);
        

        res.status(200).json({success: true, data:userBalanceData})
        
    } catch (error) {
        res.status(400).json({success: false, message: error.message})

    }
}