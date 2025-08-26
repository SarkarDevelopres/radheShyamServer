const User = require('../db/models/user');
const Bet = require('../db/models/bet');
const Transaction = require('../db/models/transaction');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { placeSportsBetTx, fetchBalance } = require('../db/store')
dotenv.config();
const { getIO } = require('../socket');

exports.placeBets = async (req, res) => {
  // POST /bets/place
  // body: { matchId, selection, stake, odds, bookmakerKey }

  const { token, matchId, market, bookmakerKey, selection, stake, odds } = req.body;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const userId = decoded.userID;
  console.log(req.body);


  // sanity checks
  if (!Number.isInteger(stake) || stake <= 0) return res.status(400).json({ error: 'Invalid stake' });
  if (odds <= 1) return res.status(400).json({ error: 'Invalid odds' });

  let betPlacedData = await placeSportsBetTx({ userId, eventId: matchId, market, selection, stake, odds });

  console.log(betPlacedData);

  // try {
  //   const io = getIO();
  //   const sockets = await io.fetchSockets();

  //   for (const sock of sockets) {
  //     // console.log("I AM CALLED !");
  //     // console.log("SOCK: ", sock.userID);

  //     if (!sock.userID) continue;  // skip game sockets
  //     const data = await fetchBalance(sock.userId);

  //     sock.emit("wallet:update", { ok: true, ...data });
  //   }
  // } catch (error) {

  // }

  res.status(200).json({ ok: true, data: betPlacedData, message: "Bet placed successfully !" });


}