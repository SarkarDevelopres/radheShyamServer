const { TwoPhaseLockBetRoundEngine } = require("./engine.2PLB");
const { createRound, lockRound, unlockRound, settleRoundTx, lockBetsForRound } = require("../db/store");
const Bet = require("../db/models/bet");

const jokerCache = new Map();
let lastRoundId = null;

// ---------- helpers ----------
const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 1]));


function drawCard(Ranks, Suits) {
    const rank = Ranks[Math.floor(Math.random() * RANKS.length)];
    const suit = Suits[Math.floor(Math.random() * SUITS.length)];
    const val = RANK_VAL[rank];
    const group = (suit === "hearts" || suit === "diamonds") ? "red" : "black";
    return { rank, suit, val, group };
}

function makeDeck() {
    const deck = [];
    for (const s of SUITS) {
        for (const r of RANKS) {
            const val = RANK_VAL[r];
            const group = (s === "hearts" || s === "diamonds") ? "red" : "black";
            deck.push({ rank: r, suit: s, val: val, group: group });
        }
    }
    return deck;
}

const evaluateWorstCase = async (roundId) => {
    // First time only joker bets exists and second time joker cards bets are marked as LOCKED
    const bets = await Bet.find({ roundId: roundId, type: "casino", status: "OPEN" });

    // Aggregate totals
    const totals = {};
    for (const b of bets) {
        const pick = String(b.market || "").toUpperCase();
        totals[pick] = (totals[pick] || 0) + Number(b.stake);
    }

    // Find worst exposure
    let worst = null;
    let maxStake = 0;
    for (const [market, amt] of Object.entries(totals)) {
        if (amt > maxStake) {
            worst = market;
            maxStake = amt;
        }
    }

    return worst;
}

// Compute Results

const computeJokerCard = async (roundId) => {
    let worst = await evaluateWorstCase(roundId);

    let deck = makeDeck();
    let filtered;
    if (worst === "ODD") {
        filtered = deck.filter(c => c.val % 2 == 0);
    } else if (worst === "EVEN") {
        filtered = deck.filter(c => c.val % 2 != 0);
    } else if (worst === "BLACK") {
        filtered = deck.filter(c => c.suit === "hearts" || c.suit === "diamonds");
    } else if (worst === "RED") {
        filtered = deck.filter(c => c.suit === "clubs" || c.suit === "spades");
    } else if (["HEARTS", "DIAMONDS", "CLUBS", "SPADES"].includes(worst)) {
        filtered = deck.filter(c => c.suit.toUpperCase() !== worst);
    } else {
        filtered = deck;
    }
    const joker = filtered[Math.floor(Math.random() * filtered.length)];

    jokerCache.set(roundId, joker);

    return joker;
}

const computeAndarBaharNaturalResult = (roundId) => {
    let deck = makeDeck();
    let andarArray = [];
    let baharArray = [];
    let winner = "TIE";
    let rid = String(roundId);
    // console.log("RoundID: ",rid);

    let joker = jokerCache.get(rid);
    // console.log("Joker Called during Calculations: ", joker);

    let deckWithoutJoker = deck.filter(d => !(d.rank === joker.rank && d.suit === joker.suit))
    let i = 0;
    let andarWins, baharWins;
    do {
        let randomAndarCard = deckWithoutJoker[Math.floor(Math.random() * deckWithoutJoker.length)];
        let andarIndex = deckWithoutJoker.indexOf(randomAndarCard);
        deckWithoutJoker.splice(andarIndex, 1);
        let randomBaharCard = deckWithoutJoker[Math.floor(Math.random() * deckWithoutJoker.length)];
        let baharIndex = deckWithoutJoker.indexOf(randomBaharCard);
        deckWithoutJoker.splice(baharIndex, 1);
        andarArray.push(randomAndarCard);
        baharArray.push(randomBaharCard);
        andarWins = randomAndarCard.rank == joker.rank ? true : false;
        baharWins = randomBaharCard.rank == joker.rank ? true : false;

        if (andarWins) winner = "ANDAR";
        if (baharWins) winner = "BAHAR";
        i++;
    }
    while (!andarWins && !baharWins && i < 15);

    return { andarArray: andarArray, baharArray: baharArray, winner: winner };
}

const biasedAndarBaharCheckSwap = async (roundId, andarArray, baharArray, winner) => {
    let worst = await evaluateWorstCase(roundId);
    let andarFinalArray = [];
    let baharFinalArray = [];
    if (worst && worst == winner) {
        andarFinalArray = [...baharArray];
        baharFinalArray = [...andarArray];
        winner = worst == "BAHAR" ? "ANDAR" : worst == "TIE" ? worst : "BAHAR";
        return { andarArray: andarFinalArray, baharArray: baharFinalArray, winner: winner }
    }
    else {
        return { andarArray: andarArray, baharArray: baharArray, winner: winner }
    }
}

// ---------- Game initialization ----------

function initAndarBaharClassic(io, tableId = 'default',) {
    // console.log("I am called");

    const GAME = "ANDAR_BAHAR_CLASSIC";
    const room = `${GAME}:${tableId}`;
    const engine = new TwoPhaseLockBetRoundEngine({
        io,
        game: GAME,
        tableId: tableId,
        betMs: 10000,
        lockMs: 5000,
        resetMs: 3000,
        roundMs: 50000,
        hooks: {
            onCreateRound: async (payload) => {
                const round = await createRound(payload);
                const roundId = String(round?._id || Date.now());
                lastRoundId = roundId;
                // console.log("Round Created: ",roundId);

                return round;
            },

            onLock: async (roundId) => {
                const rid = roundId || lastRoundId;
                await lockRound(rid);
                await computeJokerCard(rid);
                await lockBetsForRound(rid); // Mark bets on joker as LOCKED and so oly bets on ANDAR/BAHAR/TIE will be OPEN when placed after this.
            },

            onRevealJoker: async (roundId) => {
                await unlockRound(roundId);
                let joker = roundId ? jokerCache.get(roundId) : null;
                if (!joker) {
                    joker = drawCard(RANKS, SUITS); //select random joker in case of null
                }
                // console.log("Joker Created: ",jokerCache.get(roundId));

                return joker;
            },

            onComputeNaturalResult: (roundId) => {
                let result = computeAndarBaharNaturalResult(roundId);
                // result = { andarArray, baharArray, winner }
                // console.log("Natural Result: ", result);

                return result
            },

            onComputeBiasedResults: async (roundId, andarArray, baharArray, winner) => {
                const rid = roundId || lastRoundId;
                await lockRound(rid);
                let biasedResult = await biasedAndarBaharCheckSwap(rid, andarArray, baharArray, winner);
                // console.log("Biased Result: ", biasedResult);
                return biasedResult;
            },

            onSettle: async (roundId, winner) => {
                let joker = jokerCache.get(roundId);
                let group = (['hearts', 'diamonds'].includes(joker?.suit)) ? 'RED' : 'BLACK';
                let isEven = joker?.val % 2 == 0;
                await settleRoundTx({
                    roundId,
                    game: GAME,

                    outcome: {
                        firstOutcome: winner,
                        card: joker,
                        suit: joker?.suit,
                        group: group,
                        odd: isEven ? "EVEN" : "ODD"
                    },
                    meta: { winner, joker },
                })
            },

            onEnd: (roundId) => {
                if (roundId) {
                    jokerCache.delete(String(roundId));
                }
            }
        }
    })

    engine.start();
    return engine;
}

module.exports = { initAndarBaharClassic }