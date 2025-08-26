const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    phone: {
        type: Number,
        required: true,
        unique: true,
    },
    email: {
        type: String,
        unique: true,
        sparse: true
    },
    password: {
        type: String,
        required: [true, "Please enter a password"],
        minlength: [6, "Password should have atleast 6 characters"],
        select: false
    },
    balance: { type: Number, default: 0 },
    exp: { type: Number, default: 0 },
    blocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

UserSchema.pre('save', async function (next) {
    var salt = bcrypt.genSaltSync(10);
    var hash = bcrypt.hashSync(`${this.password}`, salt);
    this.Password = hash;
    next();
});
UserSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.Password);
};
// UserSchema.methods.SignAccessToken = function () {
//     return jwt.sign({ id: this._id }, process.env.ACCESS_TOKEN || "");
// };
// UserSchema.methods.SignRefreshToken = async function () {
//     return jwt.sign({ id: this._id }, process.env.REFRESH_TOKEN || "");
// };

module.exports = mongoose.model('User', UserSchema);
