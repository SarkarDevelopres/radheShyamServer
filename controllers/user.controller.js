const User = require('../db/models/user');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

exports.changePassword = async (req, res) => {
    try {
        const { usertoken, newpassword, oldpassword } = req.body;
        console.log(usertoken);
        
        const decoded = jwt.verify(usertoken, process.env.JWT_SECRET);
        const userId = decoded.userID;
        let user = await User.findById(userId).select('password');
        if (!user) {
            return res.status(300).json({ ok: false, message: "User not found" });
        }
        if (user.password != oldpassword) {
            return res.status(400).json({ ok: false, message: "Old password not matched" });
        }
        user.password = newpassword;
        await user.save();
        return res.status(200).json({ ok: true, message: 'Password changed' });
    } catch (error) {
        return res.status(400).json({ ok: false, message: error.message });
    }
}