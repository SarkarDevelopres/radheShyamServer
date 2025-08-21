const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AdminSchema = new mongoose.Schema({
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
    role: {
        type: String,
        enum:['admin', 'sub-admin'],
        required:true
    },
    blocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

AdminSchema.index(
  { role: 1 }, 
  { unique: true, partialFilterExpression: { role: 'admin' } }
);

AdminSchema.pre('save', async function (next) {
    var salt = bcrypt.genSaltSync(10);
    var hash = bcrypt.hashSync(`${this.password}`, salt);
    this.Password = hash;
    next();
});
AdminSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.Password);
};
// AdminSchema.methods.SignAccessToken = function () {
//     return jwt.sign({ id: this._id }, process.env.ACCESS_TOKEN || "");
// };
// AdminSchema.methods.SignRefreshToken = async function () {
//     return jwt.sign({ id: this._id }, process.env.REFRESH_TOKEN || "");
// };

module.exports = mongoose.model('Admin', AdminSchema);
