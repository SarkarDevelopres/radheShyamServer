const { fetchBalance } = require("../db/store");
const Round = require('../db/models/round');

const generateRandomNo = () => {
  let randomViewer = Math.floor(Math.random() * 66) + 10
  return randomViewer;
}

const generateRandomWinnerLoser = (viewers) => {
  const winPercent = Math.floor(Math.random() * 31) + 40; // 40–70%
  const winners = Math.floor((viewers * winPercent) / 100);
  const losers = viewers - winners;

  return { winners: winners, losers: losers }
}

const fetchLast5RoundsResult = async (game_name) => {
  try {
    let resultData = await Round.find({ game: game_name })
      .sort({ createdAt: -1 })
      .skip(1)
      .limit(5)
      .select('result status -_id');

    let finalResultList = resultData.reverse().map(r => r.result?.winner);
    return finalResultList;
  } catch (error) {
    console.log(`Error while fetching last 5 rounds in TeenPatti_Engine: `, error.message);
    return [];
  }
}

class TeenpattiEngine {
  constructor({
    io,
    game,
    tableId = 'default',
    betMs = 20000,
    lockMs = 5000,
    resetMs = 5000,
    hooks = {},
  }) {
    this.io = io;
    this.game = game;
    this.tableId = tableId;
    this.id = null;
    this.BET_MS = Number(betMs);
    this.LOCK_MS = Number(lockMs);

    this.hooks = hooks;
    this.round = null;
    this.running = false;

    // timers
    this._lockT = null;
    this._resultT = null;

    // per-round deadlines (ms epoch for client display)
    this._resetTime = resetMs;
    this._lockAt = 0;
    this._resultAt = 0;
    this._endAt = 0;

    this.phase = 'betting',
      this.winner = null,
      this.result = null;

    // monotonic start ref for this round (performance.now)
    this._t0 = 0;

    // idempotent guards
    this._lockEmitted = false;
    this._resultEmitted = false;
    this._endEmitted = false;

    // random viewer
    this.viewers = 10;
  }

  roomKey() {
    return `${this.game}:${this.tableId}`;
  }


  publicRound() {
    const { _id, startAt, status } = this.round || {};
    // console.log("ID: ", _id);

    return {
      id: _id || null,
      game: this.game,
      tableId: this.tableId,
      startAt: startAt || Date.now(),
      betsCloseAt: this._lockAt,
      resultAt: this._resultAt,
      status: status || 'OPEN'
    };
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true,
      setImmediate(() => this.nextRound().catch(console.error));
  }

  stop() {
    this.running = false;
    this._clearTimers();
  }

  _clearTimers() {
    if (this._lockT) clearTimeout(this._lockT);
    if (this._resultT) clearTimeout(this._resultT);
    this._lockT = this._resultT = null;
  }

  cardEmittor() {
    this.io.to(this.roomKey()).emit('round:revealDeck', this.result);
    // console.log("Card Emit Event: ", this.result);
  }

  // ----- PHASES -----


  async nextRound() {
    if (!this.running) return;
    // console.log("NEW ROUND");


    // reset phases
    this._lockEmitted = false;
    this._resultEmitted = false;
    this._endEmitted = false;

    // set timestamp
    const startAtEpoch = Date.now();

    // setTimers
    this._lockAt = this.BET_MS;
    this._resultAt = this._lockAt + this.LOCK_MS;

    // schedule timers IMMEDIATELY
    this._clearTimers();
    this._locktT = setTimeout(() => this.lockIfCurrent(), this._lockAt);
    this._resultT = setTimeout(() => this.roundResult(), this._resultAt);

    const payload = {
      game: this.game,
      tableId: this.tableId,
      startAt: startAtEpoch,
      betsCloseAt: startAtEpoch+this._lockAt,
      resultAt: startAtEpoch+this._resultAt,
      status: 'OPEN',
    };
    const round = await this.hooks.onCreateRound(payload);

    if (round) {
      this.round = round;
      this.id = String(round._id)
      // console.log("ID stored in engine: ", this.id);

      this.viewers = generateRandomNo();
      const resultList = await fetchLast5RoundsResult(this.game);
      let finalSnap = { ...round, viewers: this.viewers, resultList };
      // console.log(finalSnap);
      

      this.io.to(this.roomKey()).emit('round:start', finalSnap);

      let results = await this.hooks.onComputeNaturalResult(this.id);
      this.result = results;
    }
    else {
      console.log(`ROUND CANNOT BE GENERATED FOR ${this.game}. Trying again`);
      this.nextRound();
    }


  }


  async lockIfCurrent() {
    if (this._lockEmitted) return;
    try {
      this._lockEmitted = true;
      this.phase = "locked_joker";
      if (this.round) this.round.status = 'LOCKED';

      this.io.to(this.roomKey()).emit('round:lock', {
        roundId: this.id || null,
        game: this.game,
        tableId: this.tableId
      });

      await this.hooks.onLock(this.id);
      let newResults = await this.hooks.onComputeBiasedResult(this.id);
      if (newResults) {
        this.result = newResults;
      }
    } catch (error) {
      console.log('ERROR IN TeenPatti_Engine Lock: ', error.message);

    }
  }

  async roundResult() {
    try {
      this.phase = "cards_emitting";
      this.cardEmittor();
      this._resultEmitted = true;
      let fakeList = generateRandomWinnerLoser(this.viewers)
      this.io.to(this.roomKey()).emit('round:result', {
        roundId: this.id || null,
        game: this.game,
        tableId: this.tableId,
        result: this.result,
        winners: fakeList.winners,
        losers: fakeList.losers
      });
      await this.hooks.onSettle(this.id, this.result);
      const sockets = await this.io.fetchSockets();

      for (const sock of sockets) {
        if (!sock.userID) continue;  // skip game sockets            
        const data = await fetchBalance(sock.userID);
        sock.emit("wallet:update", { ok: true, ...data });
      }
      setTimeout(async () => {
        await this.hooks.onEnd(this.id);
        this.io.to(this.roomKey()).emit('round:end', { message: "Round Ended" });
        this._endEmitted = true;
        this._clearTimers();
        if (this.running) {
          setImmediate(() => this.nextRound().catch(console.error));
        }
      }, this._resetTime);
    } catch (error) {
      console.log('ERROR IN TeenPatti_Engine results: ', error.message);
    }
  }
}

module.exports = { TeenpattiEngine };