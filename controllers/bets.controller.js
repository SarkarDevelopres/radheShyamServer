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
  try {
    // console.log("Incoming bet request:", req.body);

    const { token, matchId, market, bookmakerKey, selectionName, selection, stake, odds, lay, minusAmnt } = req.body;
    // console.log("Stake received:", stake);

    if (!token) return res.status(400).json({ ok: false, message: "Missing token" });
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.log("JWT verification failed:", err.message);
      return res.status(401).json({ ok: false, message: "Invalid token" });
    }

    const userId = decoded.userID;
    // console.log("Decoded userId:", userId);

    // sanity checks
    if (!Number.isInteger(stake) || stake <= 0) {
      console.log("Invalid stake:", stake);
      return res.status(400).json({ ok: false, message: "Invalid stake" });
    }
    if (odds <= 1 || odds > 15 ) {
      console.log("Invalid odds:", odds);
      return res.status(400).json({ ok: false, message: "Invalid odds" });
    }

    let deductAmount = Number(minusAmnt);
    if (isNaN(deductAmount) || deductAmount <= 0) {
      console.log("❌ Invalid minusAmnt received:", minusAmnt);
      throw new Error("Invalid or missing minusAmnt; must be a positive number");
    }
    // console.log("Deduct Amount:", deductAmount);

    let findCashOut = await Bet.findOne({ userId, eventId: matchId, status: "OPEN", type: "cashout" });
    // console.log("findCashOut result:", findCashOut);

    if (!findCashOut || !findCashOut.profitHeld || findCashOut.profitHeld <= 0) {
      console.log("No active cashout or profitHeld ≤ 0, placing normal bet");
      let betPlacedData = await placeSportsBetTx({ userId, eventId: matchId, market, selection, selectionName, stake, odds, bookmakerKey, deductAmount, lay });
      console.log("Bet placed data:", betPlacedData);

      if (betPlacedData.ok) {
        await Bet.create({
          type: "cashout",
          stake: Number(stake),
          eventId: matchId,
          userId: userId,
          profitHeld: 0,
          status: "LOCKED",
        })
        const io = getIO();
        const sockets = await io.fetchSockets();
        sockets.forEach(sock => {
          if (!sock.userID) return;
          sock.emit("wallet:update", betPlacedData);
          sock.emit("exp:update", betPlacedData);
        });
        return res.status(200).json({ ok: true, data: betPlacedData, message: "Bet placed successfully!" });
      } else {
        console.log("Insufficient funds or placement failed");
        return res.status(400).json({ ok: false, message: "Insufficient Balance!" });
      }

    } else {
      // console.log("Existing cashout found:", findCashOut);
      const stakeNum = Number(stake);
      let profitHeld = Number(findCashOut.profitHeld || 0);
      let constProfitRecord = Number(findCashOut.profitHeld || 0);

      if (isNaN(stakeNum) || isNaN(profitHeld)) {
        throw new Error(`Invalid numeric values: stake=${stake}, profitHeld=${findCashOut.profitHeld}`);
      }

      if (stakeNum >= profitHeld) {
        // Case 1: stake uses up all profitHeld, remaining from wallet
        deductAmount = stakeNum - profitHeld;
        profitHeld = 0;
        
        console.log(`🟢 Stake (${stakeNum}) ≥ profitHeld (${findCashOut.profitHeld}) → deduct ${deductAmount}, profitHeld now 0`);
      } else {
        // Case 2: stake fully covered by profitHeld
        deductAmount = 0;
        profitHeld = profitHeld - stakeNum;
        console.log(`🟡 Stake (${stakeNum}) < profitHeld (${findCashOut.profitHeld}) → deduct 0, profitHeld now ${profitHeld}`);
      }

      // persist updated profitHeld
      // console.log(findCashOut);

      findCashOut.profitHeld = profitHeld;
      findCashOut.status = "SETTLED";
      // await findCashOut.save();
      // console.log("Adjusted profitHeld:", findCashOut.profitHeld, "Deduct:", deductAmount);

      let betPlacedData = await placeSportsBetTx({ userId, eventId: matchId, market, selection, selectionName, stake: Number(stake), odds, bookmakerKey, deductAmount, lay });
      console.log("Bet placed data:", betPlacedData);

      if (betPlacedData.ok) {

        if (findCashOut.profitHeld > 0) {
          findCashOut.status = "OPEN";
        } else {
          findCashOut.status = "SETTLED";
        }
        await findCashOut.save().catch(e => console.log("Error saving cashout:", e.message));
        await Bet.create({
          type: "cashout",
          stake: Number(stake),
          eventId: matchId,
          userId: userId,
          profitHeld: Number(constProfitRecord),
          status: "LOCKED",
        })

        const io = getIO();
        const sockets = await io.fetchSockets();
        sockets.forEach(sock => {
          if (!sock.userID) return;
          sock.emit("wallet:update", betPlacedData);
          sock.emit("exp:update", betPlacedData);
        });
        return res.status(200).json({ ok: true, data: betPlacedData, message: "Bet placed successfully!" });
      } else {
        console.log("Insufficient funds or placement failed (cashout)");
        return res.status(400).json({ ok: false, message: "Insufficient Balance!" });
      }
    }

  } catch (error) {
    console.log("❌ Unhandled error in placeBets:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};


exports.takeBet = async (req, res) => {
  try {
    console.log("I am called");

    const { token, matchId, oddsBook } = req.body;
    // oddsBook should be sent from frontend: { "Team A": { back:2.0, lay:2.02 }, ... }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userID;

    // 1. Find all OPEN bets for this user + match
    const bets = await Bet.find({ eventId: matchId, userId, type: "sports", status: "OPEN" });
    if (!bets.length) {
      return res.status(404).json({ ok: false, message: "No open bets found" });
    }

    // 2. Run cashout calculation
    const result = cashoutPortfolio(bets, oddsBook);
    console.log(result);


    if (result.unavailable) {
      return res.status(400).json({ ok: false, message: "Cashout unavailable" });
    }
    let user = await User.findById(userId);

    if (!user) throw new Error("User not found");

    const prevCashOut = await Bet.findOne({ eventId: matchId, userId, type: "cashout", status: "LOCKED" });
    
    console.log(prevCashOut);
    let prevProfitLoss = Number(prevCashOut.profitHeld);
    let profitNow = Number(result.profitNow) + Number(prevCashOut.profitHeld)
    console.log("Profit Prev: ", profitNow);

    let newProfit = Number(result.profitNow);


    if (profitNow > 1) {
      if (prevProfitLoss>0) {
        let balanceUpdate = Number(result.held) - prevProfitLoss;
        console.log("Balance Updt: ",balanceUpdate);        
        user.balance += balanceUpdate;
      }else{
        user.balance += result.held
      }      
    } else {
      if (result.payoutNow > 0) {
        user.balance += result.payoutNow;
      }
    }
    console.log("Balance: ", user.balance);

    await user.save();

    const openCashOut = await Bet.findOne({ eventId: matchId, userId, type: "cashout", status: "OPEN" });

    if (openCashOut) {
      newProfit += Number(openCashOut.profitHeld)
    }
    // 4. Mark bets as cashed out
    await Bet.updateMany(
      { eventId: matchId, userId, type: "sports", status: "OPEN" },
      { $set: { status: "SETTLED" } }
    );

    await Bet.findOneAndUpdate(
      { eventId: matchId, userId, type: "cashout", status: "LOCKED"  },
      {
        $set: {
          status: "SETTLED"
        }
      }
    );

    await Bet.findOneAndUpdate(
      { eventId: matchId, userId, type: "cashout", status: "OPEN"  },
      {
        $set: {
          profitHeld: newProfit,
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
        sock.emit("exp:update", { ok: true, _doc: { balance: user.balance } });
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