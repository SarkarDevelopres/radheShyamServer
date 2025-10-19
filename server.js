// server.js
process.env.DOTENV_CONFIG_QUIET = 'true';
require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const { connectTennis } = require('./tennisSocket');
const { connectEntity } = require('./entitySocket');
const { getIO } = require('./socket');

const connectDB = require('./config/connectDB'); // must return a Promise!
const authenticateUser = require('./middlewares/authenticateUser');
const { attachSocket } = require('./socket');

const { Worker } = require('worker_threads');

mongoose.set('bufferCommands', false); // fail fast instead of buffering

const app = express();
app.use(cors());
app.use(express.json());

const debouncers = new Map();
function debounceBroadcast(matchId, payload, delay = 120) {
  clearTimeout(debouncers.get(matchId));
  const t = setTimeout(() => {
    const io = getIO();
    io.to(`live:match:${matchId}`).emit('score:update', payload);
  }, delay);
  debouncers.set(matchId, t);
}

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
const employeeRouter = require('./routes/employee.routes');
const userRouter = require('./routes/user.routes');

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Public routes
app.use('/api/auth', authRouter);
app.use('/api/odds', oddsRouter);
app.use('/api/data', dataRouter);
app.use('/api/admin', adminRouter);
app.use('/api/emp', employeeRouter);
app.use('/api/user', userRouter);

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

  // connectEntityInspector();


  // const path = require('path');
  // startWorker(path.resolve(__dirname, 'workers/worker.js'));

  // 2) Only then start HTTP & sockets (which start the game engines)
  const server = http.createServer(app);
  attachSocket(server);

  connectEntity((matchId, latestSnapshot) => {
    // emit immediately:
    getIO().to(`live:match:${matchId}`).emit('score:update', latestSnapshot);
    debounceBroadcast(matchId, latestSnapshot);

  });

  connectTennis((matchId, latestSnapshot) => {
    // emit immediately:
    getIO().to(`live:match:${matchId}`).emit('score:update', latestSnapshot);
    debounceBroadcast(matchId, latestSnapshot);

  });

  const PORT = process.env.PORT || 4000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
