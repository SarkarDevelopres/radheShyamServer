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

  try {
    const { token, matchId, market, bookmakerKey, selection, stake, odds, lay, deductAmount } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userID;
    console.log(req.body);

    console.log(userId);



    // sanity checks
    if (!Number.isInteger(stake) || stake <= 0) return res.status(400).json({ error: 'Invalid stake' });
    if (odds <= 1) return res.status(400).json({ error: 'Invalid odds' });

    let betPlacedData = await placeSportsBetTx({ userId, eventId: matchId, market, selection, stake, odds, lay, deductAmount });
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
  console.log("called ?");

  try {
    const { token, matchId } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userID;
    let betDetails = await Bet.findOne({ eventId: matchId, userId: userId });
    if (betDetails) {
      let odds = betDetails.odds;
      let stake = betDetails.stake;
      console.log("Odds: ", odds);
      let balanceAdd = Math.round(stake - (2 * odds));
      console.log("Added balance: ", balanceAdd);
      await betDetails.deleteOne();
      let user = await User.findByIdAndUpdate(userId, { $inc: { balance: balanceAdd } }, { new: true });
      const io = getIO();
      const sockets = await io.fetchSockets();

      for (const sock of sockets) {
        if (!sock.userID) continue;  // skip game sockets

        sock.emit("wallet:update", { ok: true, _doc: { balance: user.balance } });
      }
      console.log("balance taken: ", user);
      res.status(200).json({ ok: true, message: "Bet Cashed Out" });
    }
    else {
      res.status(300).json({ ok: false, message: "Bet Don't Exists" });
    }

  } catch (error) {
    res.status(300).json({ ok: false, message: "Cashed Out Failed" });
  }

}

exports.findBets = async (req, res) => {
  try {
    const { matchId, userToken } = req.body;
    const decoded = jwt.verify(userToken, process.env.JWT_SECRET);
    const userId = decoded.userID;

    let matchBets = await Bet.find({userId:userId, eventId:matchId})
    res.status(200).json({ok:true, data:matchBets});

  } catch (error) {
    res.status(500).json({ok:false, message:error.message})
  }
}