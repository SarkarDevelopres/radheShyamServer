const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/connectDB');

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/odds', require('./routes/odds.routes'));
app.use('/api/bets', require('./routes/bets.routes'));
app.use('/api/data', require('./routes/data.routes'));
// app.use('/api/detail', require('./routes/detail.routes'));
// app.use('/api/admin/', require('./routes/admin.routes'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});