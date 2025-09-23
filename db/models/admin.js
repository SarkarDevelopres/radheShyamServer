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
        enum: ['admin', 'sub-admin'],
        required: true
    },
    maintenance: {
        isOn: { type: Boolean, default: false },
        string: {type: String},
        duration: {type: String},
        startedAt: {type: Date},
    },
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

module.exports = mongoose.model('Admin', AdminSchema);
