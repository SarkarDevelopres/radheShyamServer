const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const EmployeeSchema = new mongoose.Schema({
    employee_id: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    name: {
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
    role: {
        type: String,
        default:"general"
    },
    password: {
        type: String,
        required: [true, "Please enter a password"],
        minlength: [6, "Password should have atleast 6 characters"],
        select: false
    },
    blocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

EmployeeSchema.pre('save', async function (next) {
    var salt = bcrypt.genSaltSync(10);
    var hash = bcrypt.hashSync(`${this.password}`, salt);
    this.Password = hash;
    next();
});
EmployeeSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.Password);
};

module.exports = mongoose.model('Employee', EmployeeSchema);
