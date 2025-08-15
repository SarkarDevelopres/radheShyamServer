const User = require('../models/user');
const Bet = require('../models/bet');
const Transaction = require('../models/transaction');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

exports.placeBets = async(req,res) => {
    // POST /bets/place
// body: { matchId, selection, stake, odds, bookmakerKey }

  const { token, matchId, selection, stake, odds } = req.body;
  const decoded = jwt.verify(token,process.env.JWT_SECRET);
  const userId = decoded.userID;
  console.log(req.body);
  

  // sanity checks
  if (!Number.isInteger(stake) || stake <= 0) return res.status(400).json({ error: 'Invalid stake' });
  if (odds <= 1) return res.status(400).json({ error: 'Invalid odds' });

  // 1) Atomically deduct if balance >= stake
  const user = await User.findOneAndUpdate(
    { _id: userId, 'balance': { $gte: stake } },
    { $inc: { 'balance': -stake } },
    { new: true } // return updated doc
  );
  if (!user) return res.status(400).json({ error: 'Insufficient balance' });

  // 2) Create bet (freeze odds at placement time)
  const potentialPayout = Math.round(stake * odds); // still integer coins if stake is coins & odds decimal (round)
  const bet = await Bet.create({
    userId, matchId, market: 'h2h', selection, stake, odds, potentialPayout
  });

  // 3) Ledger record (debit)
  const tx = await Transaction.create({
    userId, type: 'bet_place', amount: -stake, balanceAfter: user.balance,
    meta: { betId: bet._id.toString(), matchId, selection, odds }
  });

  return res.json({ ok: true, betId: bet._id, balance: user.balance, potentialPayout });


}