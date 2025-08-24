// controllers/auth.controller.js
const User = require('../db/models/user');
const jwt = require('jsonwebtoken');
const Admin = require('../db/models/admin');
const dotenv = require('dotenv');
dotenv.config();

exports.login = async (req, res) => {

    try {
        const { username, password } = req.body;

        let existingUser = await User.findOne({ "username": username }).select('password balance');

        console.log(existingUser);

        if (!existingUser) {
            return res.status(400).json({ error: 'Invalid Credentials', success: false });
        }

        if (existingUser.password != password) {
            return res.status(400).json({ error: 'Invalid Credentials', success: false });
        }
        const token = jwt.sign(
            { userID: existingUser._id }, // payload
            process.env.JWT_SECRET,        // secret key
            { expiresIn: '1d' }            // expiry
        );

        console.log(existingUser);
        res.status(201).json({ message: 'User logged In', success: true, token, balance: existingUser.balance });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err });
    }

};

exports.createUser = async (req, res) => {
    try {
        const { username, password, phone, email } = req.body;
        const newUser = new User({
            username,
            password,
            phone,
            email,
        })
        await newUser.save();
        res.status(200).json({ message: "User Created Successfully", success: true })
    }
    catch (err) {
        console.error("user Creation Error: ", err);
        res.status(500).json({ message: err.message || err, success: false })
    }
}


exports.adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        console.log(email, password);
        

        let exisitingAdmin = await User.findOne({ "email": email }).select('password');

        console.log(exisitingAdmin);

        if (!exisitingAdmin) {
            return res.status(400).json({ message: 'Invalid Credentials', success: false });
        }

        if (exisitingAdmin.password != password) {
            return res.status(400).json({ message: 'Invalid Credentials', success: false });
        }
        const token = jwt.sign(
            { adminID: exisitingAdmin._id }, // payload
            process.env.JWT_SECRET,        // secret key
            { expiresIn: '1d' }            // expiry
        );

        console.log(req.body);
        res.status(201).json({ message: 'Admin logged In', success: true, token });

    } catch (error) {

    }
}

exports.adminSignUp = async (req, res) => {
    try {
        const { email, password, phone, role } = req.body;
        const newAdmin = new Admin({
            email,
            phone,
            password,
            role
        })
        await newAdmin.save();
        return res.status(200).json({ message: 'Admin Created !', success: true });
    } catch (error) {
        return res.status(400).json({ message: error.message, success: false });
    }
}

