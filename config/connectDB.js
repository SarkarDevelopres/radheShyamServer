const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ quiet: true });

const dbUrl = process.env.DB_URI + '?maxPoolSize=50&serverSelectionTimeoutMS=5000';

const connectDB = async () => {

    console.log('DB_URI:', `"${process.env.DB_URI}"`);

  try {
    if (mongoose.connection.readyState >= 1) {
      console.log('✅ MongoDB already connected');
      return;
    }

    await mongoose.connect(dbUrl, {
      dbName: 'RadheShyamExch',
      readPreference: 'primary',
    });

    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1); // Exit process if DB connection fails
  }
};

module.exports = connectDB;