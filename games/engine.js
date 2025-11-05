// engine.js
'use strict';
const { performance, monitorEventLoopDelay } = require('perf_hooks');
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
  let resultData = await Round.find({ game: game_name })
    .sort({ createdAt: -1 })
    .skip(1)
    .limit(5)
    .select('result status -_id');

  let finalResultList = resultData.reverse().map(r => r.result?.winner);

  return finalResultList;
}
class RoundEngine {
  constructor({
    io,
    game,
    tableId = 'default',
    roundMs = 15000,      // start -> result
    betMs = 12000,        // start -> lock
    resultShowMs = 3000, // result -> end
    hooks = {}
  }) {
    this.io = io;
    this.game = game;
    this.tableId = tableId;

    this.ROUND_MS = roundMs;
    this.BET_MS = betMs;
    this.RESULT_SHOW_MS = resultShowMs;

    this.hooks = hooks;
    this.round = null;
    this.running = false;

    // timers
    this._lockT = null;
    this._resultT = null;
    this._endT = null;

    // per-round deadlines (ms epoch for client display)
    this._lockAt = 0;
    this._resultAt = 0;
    this._endAt = 0;

    // monotonic start ref for this round (performance.now)
    this._t0 = 0;

    // idempotent guards
    this._lockEmitted = false;
    this._resultEmitted = false;
    this._endEmitted = false;

    // round nonce to invalidate old timers
    this._nonce = 0;

    // small tolerance
    this._tolerance = 30; // ms

    // Optional: lightweight event-loop lag monitor (dev)
    if (process.env.ENGINE_MONITOR_LAG === '1') {
      this._lag = monitorEventLoopDelay({ resolution: 10 });
      this._lag.enable();
      setInterval(() => {
        const p95 = Math.round(this._lag.percentile(95));
        if (p95 > 50) console.warn(`[loop] p95 lag ~${p95}ms`);
        this._lag.reset();
      }, 2000).unref();
    }

    // random viewer
    this.viewers = 1;
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
      endAt: this._endAt,
      status: status || 'OPEN'
    };
  }

  // start is sync; don’t await flows from here
  start() {
    if (this.running) return;
    this.running = true;
    setImmediate(() => this.nextRound().catch(console.error));
  }

  stop() {
    this.running = false;
    this._clearTimers();
  }

  _clearTimers() {
    if (this._lockT) clearTimeout(this._lockT);
    if (this._resultT) clearTimeout(this._resultT);
    if (this._endT) clearTimeout(this._endT);
    this._lockT = this._resultT = this._endT = null;
  }

  async nextRound() {
    if (!this.running) return;

    // new nonce to invalidate any stray timers from old rounds
    this._nonce += 1;
    const nonce = this._nonce;

    // reset phase guards
    this._lockEmitted = false;
    this._resultEmitted = false;
    this._endEmitted = false;

    // establish timestamps
    const startAtEpoch = Date.now();        // for clients
    this._t0 = performance.now();           // monotonic base for internal checks

    this._lockAt = startAtEpoch + this.BET_MS;
    this._resultAt = startAtEpoch + this.ROUND_MS;
    this._endAt = this._resultAt + this.RESULT_SHOW_MS;

    // schedule timers IMMEDIATELY (no awaits before this)
    this._clearTimers();
    this._lockT = setTimeout(() => this.lockIfCurrent(nonce).catch(console.error), this.BET_MS);
    this._resultT = setTimeout(() => this.resultIfCurrent(nonce).catch(console.error), this.ROUND_MS);
    this._endT = setTimeout(() => this.endIfCurrent(nonce).catch(console.error), this.ROUND_MS + this.RESULT_SHOW_MS);

    // Persist round ASYNC (do not block scheduling)
    const payload = {
      game: this.game,
      tableId: this.tableId,
      startAt: startAtEpoch,
      betsCloseAt: this._lockAt,
      resultAt: this._resultAt,
      endAt: this._endAt,
      status: 'OPEN'
    };

    Promise.resolve()
      .then(async () => {
        // ✅ mark callback async so we can use await inside
        const round = await this.hooks.onCreateRound?.(payload);
        if (this._nonce !== nonce) return; // stale create

        this.round = round || { _id: null, startAt: startAtEpoch, status: 'OPEN' };
        let snap = this.publicRound();

        if (this.hooks.decorateSnapshot) {
          try {
            snap = this.hooks.decorateSnapshot(snap) || snap;
          } catch (e) {
            console.error("decorateSnapshot error", e);
          }
        }

        this.viewers = generateRandomNo();
        const resultList = await fetchLast5RoundsResult(this.game);
        // console.log(`Last 5 results for ${this.game}: `, resultList);

        const viewrSnap = { ...snap, viewers: this.viewers, resultList };
        this.io.to(this.roomKey()).emit('round:start', viewrSnap);
      })
      .catch(err => {
        console.error(`[engine ${this.roomKey()}] onCreateRound error:`, err);
        if (this._nonce === nonce) {
          this.round = { _id: null, startAt: startAtEpoch, status: 'OPEN' };
          this.io.to(this.roomKey()).emit('round:start', this.publicRound());
        }
      });
  }


  // ---- PHASES ----

  async lockIfCurrent(nonce) {
    if (this._nonce !== nonce || this._lockEmitted) return;

    const elapsed = performance.now() - this._t0;
    if (elapsed + this._tolerance < this.BET_MS) {
      const rem = Math.max(0, this.BET_MS - elapsed);
      clearTimeout(this._lockT);
      this._lockT = setTimeout(() => this.lockIfCurrent(nonce).catch(console.error), rem);
      return;
    }

    this._lockEmitted = true;

    // console.log(`Lock Called @ ${new Date().toISOString()} (expected ~${new Date(this._lockAt).toISOString()})`);

    // local state + emit ASAP
    if (this.round) this.round.status = 'LOCKED';

    this.io.to(this.roomKey()).emit('round:lock', {
      roundId: this.round?._id || null,
      game: this.game,
      tableId: this.tableId
    });

    // fire-and-forget persist
    if (this.hooks.onLock && this.round?._id) {
      Promise.resolve()
        .then(() => this.hooks.onLock(this.round._id))
        .catch(err => console.error(`[engine ${this.roomKey()}] onLock error:`, err));
    }
  }

  async resultIfCurrent(nonce) {
    if (this._nonce !== nonce || this._resultEmitted) return;

    const elapsed = performance.now() - this._t0;
    if (elapsed + this._tolerance < this.ROUND_MS) {
      const rem = Math.max(0, this.ROUND_MS - elapsed);
      clearTimeout(this._resultT);
      this._resultT = setTimeout(() => this.resultIfCurrent(nonce).catch(console.error), rem);
      return;
    }

    this._resultEmitted = true;

    // console.log(`Result Called @ ${new Date().toISOString()} (expected ~${new Date(this._resultAt).toISOString()})`);

    let result = null;

    if (this.hooks.onComputeResult) {
      // Preferred: pure, synchronous RNG (no DB)
      try {
        result = await this.hooks.onComputeResult(this.round?._id);

      } catch (err) {
        console.error(`[engine ${this.roomKey()}] onComputeResult error:`, err);
      }
      let randomWinnersLosers = generateRandomWinnerLoser(this.viewers);
      // console.log("Result Is: ", result);
      // Emit RESULT immediately
      this.io.to(this.roomKey()).emit('round:result', {
        roundId: this.round?._id || null,
        game: this.game,
        tableId: this.tableId,
        ...(result || { noResult: true }),
        ...randomWinnersLosers
      });


      // console.log("ROUND ID: ", result);


      // Persist settlement asynchronously using the SAME result
      if (this.hooks.onSettle && this.round?._id) {
        Promise.resolve()
          .then(async () => {
            // console.log("RESULT SETLEMENT CALLED!!");

            this.hooks.onSettle(this.round._id, result);
          })
          .catch(err => console.error(`[engine ${this.roomKey()}] onSettle error:`, err));
      }

    } else if (this.hooks.onSettle && this.round?._id) {


      // Legacy mode: let onSettle compute & return a lightweight result
      Promise.resolve()
        .then(() => this.hooks.onSettle(this.round._id))
        .then(async (res) => {

          this.io.to(this.roomKey()).emit('round:result', {
            roundId: this.round?._id || null,
            game: this.game,
            tableId: this.tableId,
            ...(res || { noResult: true }),
          });



        })
        .catch(err => {
          console.error(`[engine ${this.roomKey()}] onSettle error:`, err);
          this.io.to(this.roomKey()).emit('round:result', {
            roundId: this.round?._id || null,
            game: this.game,
            tableId: this.tableId,
            noResult: true,
          });
        });
    } else {
      // No hooks → still emit a placeholder so UI progresses
      this.io.to(this.roomKey()).emit('round:result', {
        roundId: this.round?._id || null,
        game: this.game,
        tableId: this.tableId,
        noResult: true,
      });
    }
  }

  async endIfCurrent(nonce) {
    if (this._nonce !== nonce || this._endEmitted) return;

    const must = this.ROUND_MS + this.RESULT_SHOW_MS;
    const elapsed = performance.now() - this._t0;
    if (elapsed + this._tolerance < must) {
      const rem = Math.max(0, must - elapsed);
      clearTimeout(this._endT);
      this._endT = setTimeout(() => this.endIfCurrent(nonce).catch(console.error), rem);
      return;
    }

    this._endEmitted = true;

    // console.log(`End Called @ ${new Date().toISOString()} (expected ~${new Date(this._endAt).toISOString()})`);

    // fire-and-forget onEnd
    if (this.hooks.onEnd && this.round?._id) {
      Promise.resolve()
        .then(async () => {
          this.hooks.onEnd(this.round._id)

          const sockets = await this.io.fetchSockets();

          for (const sock of sockets) {
            if (!sock.userID) continue;  // skip game sockets            
            const data = await fetchBalance(sock.userID);
            sock.emit("wallet:update", { ok: true, ...data });
          }
        })
        .catch(err => console.error(`[engine ${this.roomKey()}] onEnd error:`, err));
    }

    // notify clients round finished
    this.io.to(this.roomKey()).emit('round:end', {
      roundId: this.round?._id || null,
      game: this.game,
      tableId: this.tableId
    });

    // schedule next round without awaiting to keep loop crisp
    if (this.running) {
      setImmediate(() => this.nextRound().catch(console.error));
    }
  }
}

module.exports = { RoundEngine };
