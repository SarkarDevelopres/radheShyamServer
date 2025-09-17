const User = require('../db/models/user');
const Bet = require('../db/models/bet');
const Transaction = require('../db/models/transaction');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { placeSportsBetTx, fetchBalance } = require('../db/store');
const { cashoutPortfolio } = require('../cashout')
dotenv.config();
const { getIO } = require('../socket');

exports.placeBets = async (req, res) => {
  // POST /bets/place
  // body: { matchId, selection, stake, odds, bookmakerKey }

  try {
    const { token, matchId, market, bookmakerKey,selectionName, selection, stake, odds, lay, deductAmount } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userID;
    console.log(req.body);

    console.log(userId);



    // sanity checks
    if (!Number.isInteger(stake) || stake <= 0) return res.status(400).json({ error: 'Invalid stake' });
    if (odds <= 1) return res.status(400).json({ error: 'Invalid odds' });

    let betPlacedData = await placeSportsBetTx({ userId, eventId: matchId, market, selection,selectionName, stake, odds, lay, deductAmount });
    console.log(betPlacedData);

    if (betPlacedData.ok) {
      const io = getIO();
      const sockets = await io.fetchSockets();

      for (const sock of sockets) {
        // console.log("I AM CALLED !");
        // console.log("SOCK: ", sock.userID);

        if (!sock.userID) continue;  // skip game sockets

        sock.emit("wallet:update", betPlacedData);
      }
      res.status(200).json({ ok: true, data: betPlacedData, message: "Bet placed successfully !" });
    }
    else {
      res.status(300).json({ ok: false, message: "Insufficeint Balance !" });
    }
  } catch (error) {
    res.status(200).json({ ok: false, message: error.message });
  }

  // try {

  // } catch (error) {

  // }




}

exports.takeBet = async (req, res) => {
  try {
    const { token, matchId, oddsBook } = req.body;
    // oddsBook should be sent from frontend: { "Team A": { back:2.0, lay:2.02 }, ... }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userID;

    // 1. Find all OPEN bets for this user + match
    const bets = await Bet.find({ eventId: matchId, userId, status: "OPEN" });
    if (!bets.length) {
      return res.status(404).json({ ok: false, message: "No open bets found" });
    }

    // 2. Run cashout calculation
    const result = cashoutPortfolio(bets, oddsBook);

    if (result.unavailable) {
      return res.status(400).json({ ok: false, message: "Cashout unavailable" });
    }

    // 3. Update user balance with payoutNow
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { balance: result.payoutNow } },
      { new: true }
    );

    // 4. Mark bets as cashed out
    await Bet.updateMany(
      { eventId: matchId, userId, status: "OPEN" },
      { $set: { status: "SETTLED" } }
    );

    // 5. Emit wallet update to socket clients
    const io = getIO();
    const sockets = await io.fetchSockets();
    for (const sock of sockets) {
      if (!sock.userID) continue;
      if (sock.userID.toString() === userId.toString()) {
        sock.emit("wallet:update", { ok: true, _doc: { balance: user.balance } });
      }
    }

    res.status(200).json({
      ok: true,
      message: "Cashout successful",
      result,
      balance: user.balance,
    });

  } catch (error) {
    console.error("Cashout error:", error);
    res.status(500).json({ ok: false, message: "Cashout failed" });
  }
};

exports.findBets = async (req, res) => {
  try {
    const { matchId, userToken } = req.body;
    const decoded = jwt.verify(userToken, process.env.JWT_SECRET);
    const userId = decoded.userID;

    let matchBets = await Bet.find({ userId: userId, eventId: matchId, status:"OPEN" })
    res.status(200).json({ ok: true, data: matchBets });

  } catch (error) {
    res.status(500).json({ ok: false, message: error.message })
  }
}