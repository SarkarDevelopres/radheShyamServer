const Bet = require("../db/models/bet");
const { fetchBalance } = require("../db/store");

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

function generateRandomRoundTIme() {
    const seconds = Math.random() * (20 - 8) + 8;
    return seconds.toFixed(2) * 1000;
}

const random = (min, max) => Math.random() * (max - min) + min;

function checkProfit(stakes, potentialPayouts) {
    const totalStake = stakes.reduce((sum, b) => sum + Number(b), 0);
    const totalPayout = potentialPayouts.reduce((sum, b) => sum + Number(b), 0);
    // console.log("Is Profit: ", totalStake > totalPayout);
    return totalStake > totalPayout;
}

async function lookForProfitMarginToCrash(roundId) {
    try {
        // console.log("Profit/Loss Check Called");
        const bets = await Bet.find({ _id: roundId, status: "OPEN" })
            .select('stake potentialPayout -_id')
            .lean();
        const stakes = bets.map(b => Number(b.stake));
        const potentialPayouts = bets.map(b => Number(b.potentialPayout));
        return checkProfit(stakes, potentialPayouts);
    } catch (err) {
        console.error("Profit check failed:", err.message);
        return false;
    }
}



class AviatorEngine {
    constructor({
        io,
        game,
        tableId,
        resetMs,
        hooks = {},
    }) {
        this.io = io;
        this.game = game;
        this.tableId = tableId;
        this.id = null;
        this.CRASH_MS = null;
        this.TICK_MS = 1000;
        this.CHECK_MS = 2000;
        this.multiplier = 1;

        this.hooks = hooks;
        this.round = null;
        this.running = false;

        // timers
        this._tickInterval = null;
        this._checkInterval = null;

        this._crashT = null;
        this._tickT = null;
        this._checkT = null;
        this._endT = null;

        // per-round deadlines (ms epoch for client display)
        this._resetTime = resetMs;
        this._tickAt = 0;
        this._checkAt = 0;
        this._crashAt = 0;
        this._endAt = 0;

        // idempotent guards
        this._crashEmitted = false;
        this._endEmitted = false;

        // random viewer
        this.viewers = 10;
    }

    roomKey() {
        return `${this.game}:${this.tableId}`;
    }


    start() {
        if (this.running) {
            return;
        }
        this.running = true;
        setImmediate(() => this.nextRound().catch(console.error));
    }

    stop() {
        this.running = false;
        this._clearTimers();
    }

    _clearTimers() {
        // Clear all running timers and intervals safely
        if (this._tickT) clearTimeout(this._tickT);
        if (this._checkT) clearTimeout(this._checkT);
        if (this._crashT) clearTimeout(this._crashT);
        if (this._endT) clearTimeout(this._endT);
        if (this._tickInterval) clearInterval(this._tickInterval);
        if (this._checkInterval) clearInterval(this._checkInterval);

        this._tickT = null;
        this._checkT = null;
        this._crashT = null;
        this._endT = null;
        this._tickInterval = null;
        this._checkInterval = null;
    }


    incrementMultiplier() {
        // console.log("Multiplier Called");
        this.multiplier += random(0.01, 0.4)
        // console.log("Multipleir Value:  ", this.multiplier);
        this.io.to(this.roomKey()).emit("aviator:update", { multiplier: this.multiplier })
    }

    // ----- PHASES -----


    async nextRound() {
        if (!this.running) return;
        console.log("NEW ROUND");


        // reset phases
        this._crashEmitted = false;
        this._endEmitted = false;

        // set timestamp
        const startAtEpoch = Date.now();

        // setTimers
        this._tickAt = 3000;
        this._checkAt = 5000;
        this._crashAt = generateRandomRoundTIme();
        console.log("Natutal Crash Time: ", this._crashAt);

        this._endAt = this._crashAt + 3000;

        // schedule timers IMMEDIATELY
        this._clearTimers();

        const payload = {
            game: this.game,
            tableId: this.tableId,
            startAt: startAtEpoch,
            settleAt: startAtEpoch + this._crashAt,
            betsCloseAt: startAtEpoch + this._crashAt,
            status: 'OPEN',
        };
        const round = await this.hooks.onCreateRound(payload);
        if (!round) {
            console.log(`ROUND CREATION FAILED FOR ${this.game}. RETRYING...`);
            return setTimeout(() => this.nextRound(), 500);
        }
        if (round) {

            if (this._tickInterval || this._tickT) {
                console.warn("⚠️ Overlapping round detected, clearing timers...");
                this._clearTimers();
            }
            this._tickT = setTimeout(() => {
                console.log(">>> startMultiplier() firing at", Date.now() - startAtEpoch, "ms since round start");
                this.startMultiplier();
            }, this._tickAt);

            this._checkT = setTimeout(() => this.startChecks(), this._checkAt);
            this._crashT = setTimeout(() => this.crash(), this._crashAt);

            this.round = round;
            this.id = String(round._id)
            console.log("Round stored in engine: ", round);

            this.viewers = generateRandomNo();
            let finalSnap = { ...round._doc, viewers: this.viewers, multiplier: this.multiplier };
            console.log("Final Snap: ",finalSnap);
            

            this.io.to(this.roomKey()).emit('round:start', finalSnap);
        }
        else {
            console.log(`ROUND CANNOT BE GENERATED FOR ${this.game}. Trying again`);
            this.nextRound();
        }


    }


    startMultiplier() {
        if (this._crashEmitted) return;
        try {
            this._tickInterval = setInterval(() => {
                this.incrementMultiplier();
            }, this.TICK_MS);
        } catch (error) {
            console.log('ERROR IN Aviator_Engine multiplier: ', error.message);
        }
    }

    async startChecks() {
        if (this._crashEmitted) return;
        try {
            this._checkInterval = setInterval(async () => {
                if (this._crashEmitted) return;
                let isProfit = await lookForProfitMarginToCrash(this.id);
                if (isProfit) this.crash();
            }, this.CHECK_MS);
        } catch (error) {
            console.log('ERROR IN Aviator_Engine checks: ', error.message);
        }
    }

    async crash() {
        console.log("CRASHED !!");

        if (this._crashEmitted) return;
        this._crashEmitted = true;
        try {
            this.io.to(this.roomKey()).emit('aviator:crash', { message: "Crashed" });
            await this.hooks.onEndRound(this.id, this.multiplier);
            this._clearTimers();
            this.multiplier = 1;

            const sockets = await this.io.fetchSockets();
            await Promise.all(sockets.map(async (sock) => {
                if (!sock.userID) return;
                const data = await fetchBalance(sock.userID);
                sock.emit("wallet:update", { ok: true, ...data });
            }));

            setTimeout(async () => {
                this.io.to(this.roomKey()).emit('round:end', { message: "Round Ended" });
                this._endEmitted = true;
                if (this.running) {
                    setImmediate(() => this.nextRound().catch(console.error));
                }
            }, this._resetTime);
        } catch (error) {
            console.log('ERROR IN Aviator_Engine results: ', error.message);
        }
    }
}

module.exports = { AviatorEngine };