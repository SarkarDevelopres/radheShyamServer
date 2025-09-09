// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('./config/connectDB'); // must return a Promise!
const authenticateUser = require('./middlewares/authenticateUser');
const { attachSocket } = require('./socket');

const { Worker } = require('worker_threads');

mongoose.set('bufferCommands', false); // fail fast instead of buffering

const app = express();
app.use(cors());
app.use(express.json());

function startWorker(file) {
  const worker = new Worker(file);
  worker.on('message', (msg) => console.log(`[worker]${msg}`));
  worker.on('error', (err) => console.error(`[worker error]`, err));
  worker.on('exit', (code) => {
    if (code !== 0) console.error(`[worker exited] code=${code}`);
  });
  return worker;
}

// Routes
const authRouter = require('./routes/auth.routes');
const oddsRouter = require('./routes/odds.routes');
const dataRouter = require('./routes/data.routes');
const betsRouter = require('./routes/bets.routes');
const adminRouter = require('./routes/admin.routes');

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Public routes
app.use('/api/auth', authRouter);
app.use('/api/odds', oddsRouter);
app.use('/api/data', dataRouter);
app.use('/api/admin', adminRouter);

// Protected routes
app.use('/api/bets', authenticateUser, betsRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// --- DB diagnostics (optional) ---
mongoose.connection.on('error', (e) => console.error('[db] error:', e.message));
mongoose.connection.on('disconnected', () => console.error('[db] disconnected'));

async function main() {
  // 1) Connect to Mongo FIRST
  await connectDB(); // must resolve only when connected
  console.log('[db] connected');

  const path = require('path');
  startWorker(path.resolve(__dirname, 'workers/worker.js'));

  // 2) Only then start HTTP & sockets (which start the game engines)
  const server = http.createServer(app);
  attachSocket(server);

  const PORT = process.env.PORT || 4000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
