// games/andarBahar.js
const { RoundEngine } = require("./engine");
const { createRound, lockRound, settleRoundTx } = require("../db/store");
const Bet = require("../db/models/bet");

const jokerCache = new Map();
let lastRoundId = null;

// ---------- helpers ----------
const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 1]));
const RED_SUITS = ["hearts", "diamonds"];
const BLACK_SUITS = ["clubs", "spades"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rankValue = (r) =>
    r === "A" ? 1 : r === "J" ? 11 : r === "Q" ? 12 : r === "K" ? 13 : Number(r);
const suitGroup = (s) =>
    s === "hearts" || s === "diamonds" ? "red" : "black";

const makeCard = (rank, suit) => ({
    rank,
    suit,
    val: rankValue(rank),
    group: suitGroup(suit),
});
function drawCard() {
    const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const val = RANK_VAL[rank];
    const group = (suit === "hearts" || suit === "diamonds") ? "red" : "black";
    return { rank, suit, val, group };
}
// ---------- bias-based RNG ----------
async function computeAndarBaharResult(roundId, joker) {
    // 1️⃣ Fetch all OPEN casino bets
    const bets = await Bet.find({ roundId, type: "casino", status: "OPEN" });

    // 2️⃣ Aggregate stakes per market
    const totals = {};
    for (const b of bets) {
        const pick = String(b.market || "").toUpperCase();
        totals[pick] = (totals[pick] || 0) + Number(b.stake);
    }

    // 3️⃣ Find worst exposure
    let worst = null;
    let maxStake = 0;
    for (const [market, amt] of Object.entries(totals)) {
        if (amt > maxStake) {
            worst = market;
            maxStake = amt;
        }
    }

    // console.log("🎯 Worst exposure:", worst);

    // 4️⃣ Canonical data
    let andarSuits = [...SUITS];
    let baharSuits = [...SUITS];
    let worstSide, worstSuit;

    if (worst !== "ANDAR" && worst !== "BAHAR") {
        [worstSide, worstSuit] = (worst || "").split("_");
        
        const isColorBet = worstSuit === "RED" || worstSuit === "BLACK";
        
        if (worstSide && worstSuit) {
            let lowSuitName = worstSuit.toLowerCase();
            if (isColorBet) {
                const blockedSuits = worstSuit === "RED" ? RED_SUITS : BLACK_SUITS;
                // console.log("BLOCKED SUITS: ",blockedSuits);
                
                if (worstSide === "ANDAR") andarSuits = SUITS.filter(s => !blockedSuits.includes(s));
                if (worstSide === "BAHAR") baharSuits = SUITS.filter(s => !blockedSuits.includes(s));
            } else if (SUITS.includes(lowSuitName)) {
                if (worstSide === "ANDAR") andarSuits = SUITS.filter(s => s !== lowSuitName);
                if (worstSide === "BAHAR") baharSuits = SUITS.filter(s => s !== lowSuitName);
            }
        }
    }

    // console.log("ANDAR SUITS: ",andarSuits);
    // console.log("BAHAR SUITS: ",baharSuits);
    

    // 5️⃣ Random suits
    const andarSuit = andarSuits[Math.floor(Math.random() * andarSuits.length)];
    const baharSuit = baharSuits[Math.floor(Math.random() * baharSuits.length)];

    // 6️⃣ Winner logic (with 70% bias)
    let winner, andarCard, baharCard;
    // console.log("JOKER: ",joker);
    
    const rank = joker.rank;

    if (worst === "ANDAR") {
        winner = "BAHAR";
    } else if (worst === "BAHAR") {
        winner = "ANDAR";
    } else {
        winner = Math.random() < 0.5 ? "ANDAR" : "BAHAR";
    }

    // 7️⃣ Card assignment
    if (winner === "ANDAR") {
        andarCard = makeCard(rank, andarSuit.toLowerCase());
        baharCard = makeCard(RANKS[Math.floor(Math.random() * RANKS.length)], baharSuit.toLowerCase());
    } else {
        andarCard = makeCard(RANKS[Math.floor(Math.random() * RANKS.length)], andarSuit.toLowerCase());
        baharCard = makeCard(rank, baharSuit.toLowerCase());
    }

    // 8️⃣ Final outcome
    const outcome = {
        firstOutcome: winner,
        andarCard,
        baharCard,
        joker: {
            rank: joker.rank,
            suit: joker.suit,
            val: rankValue(joker.rank),
            group: suitGroup(joker.suit),
        },
    };

    // console.log("🏁 Final biased outcome:", outcome);

    return { andarCard, baharCard, winner };
}

// ---------- Game initialization ----------
function initAndarBahar(io, tableId = "table-1") {
    const GAME = "ANDAR_BAHAR";
    const room = `${GAME}:${tableId}`;
    const engine = new RoundEngine({
        io,
        game: GAME,
        tableId,
        roundMs: 30000,
        betMs: 25000,
        resultShowMs: 5000,

        hooks: {
            // 1️⃣  Create round (assign Joker immediately)
            onCreateRound: async (payload) => {
                const round = await createRound(payload);
                const rid = String(round?._id || Date.now()); // fallback unique key
                lastRoundId = rid;
                // console.log(round._id);


                const joker = makeCard(pick(RANKS), pick(SUITS));
                jokerCache.set(rid, joker);

                io.to(room).emit("andarbahar:joker", {
                    rid,
                    joker,
                });

                return round;
            },

            // 2️⃣  Lock betting
            onLock: async (roundId) => {
                await lockRound(roundId);
                const key = lastRoundId ? String(lastRoundId) : null;
                const joker = key ? jokerCache.get(key) : null;
                const result = await computeAndarBaharResult(key, joker)
                engine._preResults.set(key, result)
            },

            // 3️⃣  Compute result at round:result phase
            onComputeResult: async() => {
                // roundId missing? use lastRoundId
                const key = lastRoundId ? String(lastRoundId) : null;
                // console.log("[AndarBahar] Using key:", key);
                let result = engine._preResults.get(key);
                // console.log("RESULT: ",result);
                
                if (!result) {
                    console.warn(`[${key}] No cached result found — using fallback`);
                    const joker = jokerCache.get(key);
                    result = await computeAndarBaharResult(key, joker)
                }
                return { ...result };
            },



            // 4️⃣  Settlement (runs async after emit)
            onSettle: async (roundId, result) => {
                const { joker, andar, bahar, winner } = result;
                await settleRoundTx({
                    roundId,
                    game: GAME,
                    outcome: { firstOutcome: winner, joker, andar, bahar },
                    meta: { winner, joker, andar, bahar },
                });
            },

            onEnd: (roundId) => {
                if (roundId) jokerCache.delete(String(roundId));
            },
        },
    });
    engine._preResults = new Map();
    io.on("connection", (socket) => {
        socket.on("join", ({ game, tableId: t }) => {
            if (String(game).toUpperCase() === GAME && t === tableId) {
                socket.join(room);
            }
        });
    });

    // Start the game loop
    engine.start();
    return engine;
}

module.exports = { initAndarBahar };