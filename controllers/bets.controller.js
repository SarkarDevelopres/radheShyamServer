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
    const { token, matchId, market, bookmakerKey, selectionName, selection, stake, odds, lay, minusAmnt } = req.body;
    let deductAmount = minusAmnt;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userID;
    console.log(req.body);

    console.log(userId);



    // sanity checks
    if (!Number.isInteger(stake) || stake <= 0) return res.status(400).json({ error: 'Invalid stake' });
    if (odds <= 1) return res.status(400).json({ error: 'Invalid odds' });

    let findCashOut = await Bet.findOne({ userId: userId, eventId: matchId, status: "OPEN", type: "cashout" });

    if (!findCashOut || findCashOut.stake <= 0) {

      let betPlacedData = await placeSportsBetTx({ userId, eventId: matchId, market, selection, selectionName, stake, odds, lay, deductAmount });
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
    }
    else {
      if (stake >= findCashOut.stake) {
        deductAmount = stake - findCashOut.stake;
        findCashOut.stake = 0;
      }
      else {
        deductAmount = 0;
        findCashOut.stake = findCashOut.stake - stake;

      }
      let betPlacedData = await placeSportsBetTx({ userId, eventId: matchId, market, selection, selectionName, stake, odds, lay, deductAmount });
      console.log(betPlacedData);

      if (betPlacedData.ok) {

        if (findCashOut.stake>0) {
          await findCashOut.save();
        } else {
          findCashOut.status = "CLOSED";
          await findCashOut.save();
        }
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
    // CASHOUT: {
    //   held: 500,
    //     payoutNow: 570.83,
    //       profitNow: 70.83,
    //         perTeam: {
    //     'Tehri Queens Women': {
    //       held: 500,
    //         payoutNow: 570.83,
    //           profitNow: 70.83,
    //             unavailable: false,
    //               any: true
    //     }
    //   }
    // }

    // CASHOUT: {
    //   held: 500,
    //   payoutNow: 494.99,
    //     profitNow: -5.01,
    //       perTeam: {
    //   'Haridwar Storm Women': {
    //     held: 500,
    //       payoutNow: 494.99,
    //         profitNow: -5.01,
    //           unavailable: false,
    //             any: true
    //   }
    // }
    console.log("CASHOUT: ", result);
    let user = await User.findById(userId);

    if (!user) throw new Error("User not found");

    if (result.profitNow > 1) {
      user.balance += result.held;
    } else {
      user.balance += result.payoutNow;
    }

    await user.save();
    // 4. Mark bets as cashed out
    await Bet.updateMany(
      { eventId: matchId, userId, status: "OPEN" },
      { $set: { status: "SETTLED" } }
    );

    await Bet.findOneAndUpdate(
      { eventId: matchId, userId, type: "cashout" },
      {
        $set: {
          stake: result.profitNow,
          status: "OPEN"
        }
      },
      {
        new: true,     // return the updated doc
        upsert: true   // create if not exists
      }
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

    let matchBets = await Bet.find({ userId: userId, eventId: matchId, status: "OPEN", type: "sports" })
    let cashOutBets = await Bet.find({ userId: userId, eventId: matchId, status: "OPEN", type: "cashout" })
    res.status(200).json({ ok: true, data: matchBets, profitLoss: cashOutBets });

  } catch (error) {
    res.status(500).json({ ok: false, message: error.message })
  }
}
exports.findCashout = async (req, res) => {
  try {
    const { matchId, userToken } = req.body;
    const decoded = jwt.verify(userToken, process.env.JWT_SECRET);
    const userId = decoded.userID;

    let matchBets = await Bet.find({ userId: userId, eventId: matchId, status: "OPEN", type: "cashout" })
    res.status(200).json({ ok: true, data: matchBets });

  } catch (error) {
    res.status(500).json({ ok: false, message: error.message })
  }
}