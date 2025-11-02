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
        console.log(`Error while fetching last 5 rounds in ANDAR_BAHAR_CLASSIC: `, error.message);
        return [];
    }
}

class TwoPhaseLockBetRoundEngine {
    constructor({
        io,
        game,
        tableId = 'default',
        roundMs = 50000,
        betMs = 20000,
        lockMs = 5000,
        resetMs = 3000,
        hooks = {},
    }) {
        this.io = io;
        this.game = game;
        this.tableId = tableId;
        this.id = null;

        this.ROUND_MS = Number(roundMs);
        this.BET_MS = Number(betMs);
        this.LOCK_MS = Number(lockMs);
        this.RESULT_SHOW_MS = Number(roundMs);

        this.hooks = hooks;
        this.round = null;
        this.running = false;

        // timers
        this._lockJT = null;
        this._lockT = null;
        this._resultT = null;

        // per-round deadlines (ms epoch for client display)
        this._resetTime = resetMs;
        this._lockJokerAt = 0;
        this._lockAt = 0;
        this._resultAt = 0;
        this._endAt = 0;

        this.phase = 'betting_joker',
            this.winner = null,
            this.andarArray = [],
            this.baharArray = [],
            this.jokerCard = {},

            // monotonic start ref for this round (performance.now)
            this._t0 = 0;

        // idempotent guards
        this._lock1Emitted = false;
        this._jokerEmitted = false;
        this._lock2Emitted = false;
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
        if (this._showJoker) clearTimeout(this._showJoker);
        if (this._lockJT) clearTimeout(this._lockJT);
        if (this._resultT) clearTimeout(this._resultT);
        this._lockT = this._lockJT = this._showJoker = this._resultT = null;
    }

    async nextRound() {
        if (!this.running) return;
        console.log("NEW ROUND");


        // reset phases
        this._lock1Emitted = false;
        this._jokerEmitted = false;
        this._lock2Emitted = false;
        this._resultEmitted = false;
        this._endEmitted = false;

        // set timestamp
        const startAtEpoch = Date.now();

        // setTimers
        this._lockJokerAt = this.BET_MS;
        this._showJokerAt = this._lockJokerAt + this.LOCK_MS;
        this._lockAt = this._showJokerAt + this.BET_MS;
        this._resultAt = this._lockAt + this.LOCK_MS;

        // console.log("Time when locks shall apply: ", this._lockJokerAt);
        // console.log("Time when joker shall reveal: ", this._showJokerAt);


        // schedule timers IMMEDIATELY
        this._clearTimers();
        this._lockJT = setTimeout(() => this.lockIfCurrent(), this._lockJokerAt);
        this._showJoker = setTimeout(() => this.revealJoker(), this._showJokerAt);
        this._lockT = setTimeout(() => this.lockBetsAndarBahar(), this._lockAt);
        this._resultT = setTimeout(() => this.roundResult(), this._resultAt);

        const payload = {
            game: this.game,
            tableId: this.tableId,
            startAt: startAtEpoch,
            betsCloseAt: startAtEpoch + this._resultAt,
            resultAt: startAtEpoch + this._resultAt,
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

            this.io.to(this.roomKey()).emit('round:start', finalSnap);
        }
        else {
            console.log(`ROUND CANNOT BE GENERATED FOR ${this.game}. Trying again`);
            this.nextRound();
        }


    }

    async cardEmittor() {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < this.andarArray.length; i++) {
            const result = {
                andarCard: this.andarArray[i],
                baharCard: this.baharArray[i],
                index: i,
            };
            this.io.to(this.roomKey()).emit('round:revealDeck', result);
            // console.log("Card Emit Event: ", result);
            await delay(1000);
        }

    }

    // ----- PHASES -----

    async lockIfCurrent() {
        // console.log("I am called from Lock ! ");

        if (this._lock1Emitted) return;
        try {
            this._lock1Emitted = true;
            this.phase = "locked_joker";
            if (this.round) this.round.status = 'LOCKED';

            this.io.to(this.roomKey()).emit('round:lock', {
                roundId: this.id || null,
                game: this.game,
                tableId: this.tableId
            });

            await this.hooks.onLock(this.id);
        } catch (error) {
            console.log('ERROR IN ANDAR BAHAR CLASSIC 1st Lock: ', error.message);

        }
    }

    async revealJoker() {
        // console.log("I am called from Reveal Joker ! ");
        if (this._jokerEmitted) return;

        try {
            this._jokerEmitted = true;
            this.phase = "reveal_joker";
            if (this.round) this.round.status = 'OPEN';

            let joker = await this.hooks.onRevealJoker(this.id);

            if (joker) {
                this.io.to(this.roomKey()).emit('round:showJoker', {
                    joker: joker,
                });

                let results = await this.hooks.onComputeNaturalResult(this.id);
                // console.log("Result is: ", results);
                if (results) {
                    this.andarArray = results.andarArray;
                    this.baharArray = results.baharArray;
                    this.winner = results.winner;
                }
            }

        } catch (error) {
            console.log('ERROR IN ANDAR BAHAR CLASSIC joker reveal: ', error.message)
            console.log(error);
            ;
        }


    }

    async lockBetsAndarBahar() {
        if (this._lock2Emitted) return;

        try {
            this._lock2Emitted = true;
            this.phase = "locked_andar-bahar";
            if (this.round) this.round.status = 'LOCKED';

            this.io.to(this.roomKey()).emit('round:lock', {
                roundId: this.id || null,
                game: this.game,
                tableId: this.tableId
            });

            let getBiasedData = await this.hooks.onComputeBiasedResults(this.id, this.andarArray, this.baharArray, this.winner);

            this.andarArray = getBiasedData.andarArray;
            this.baharArray = getBiasedData.baharArray;
            this.winner = getBiasedData.winner;


        } catch (error) {
            console.log('ERROR IN ANDAR BAHAR CLASSIC 2nd lock: ', error.message);

        }
    }

    async roundResult() {
        try {
            this.phase = "cards_emitting";
            await this.cardEmittor();
            this._resultEmitted = true;
            let fakeList = generateRandomWinnerLoser(this.viewers)
            this.io.to(this.roomKey()).emit('round:result', {
                roundId: this.id || null,
                game: this.game,
                tableId: this.tableId,
                winner: this.winner,
                winners: fakeList.winners,
                losers: fakeList.losers
            });
            await this.hooks.onSettle(this.id, this.winner);
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
            console.log('ERROR IN ANDAR BAHAR CLASSIC results: ', error.message);
        }
    }
}

module.exports = { TwoPhaseLockBetRoundEngine };