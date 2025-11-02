const { createRound, lockRound, unlockRound, settleRoundTx, lockBetsForRound } = require("../db/store");
const Bet = require("../db/models/bet");
const { TeenpattiEngine } = require("./engine.tp");

const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

const resultCache = new Map();
const deckCache = new Map();
let lastRoundId = null;

function makeDeck() {
    const deck = [];
    for (const s of SUITS) {
        for (const r of RANKS) {
            const val = RANK_VAL[r];
            const group = (s === "hearts" || s === "diamonds") ? "red" : "black";
            deck.push({ rank: r, suit: s, val, group });
        }
    }
    return deck;
}

function drawRandomCard(deck) {
    const idx = Math.floor(Math.random() * deck.length);
    const card = deck[idx];
    deck.splice(idx, 1);
    return card;
}

function replaceOneCard(player, deck) {
    // pick a random card from the player's hand
    const replaceIndex = Math.floor(Math.random() * player.cards.length);
    const existingRanks = player.cards.map(c => c.rank);
    const existingSuits = player.cards.map(c => c.suit);

    // filter deck to exclude same rank (so Trio/Pairs break)
    const allowedDeck = deck.filter(c => !existingRanks.includes(c.rank) && !existingSuits.includes(c.suit));
    if (!allowedDeck.length) return; // failsafe

    // choose a new random card from allowedDeck
    const newCard = allowedDeck[Math.floor(Math.random() * allowedDeck.length)];

    // replace the card
    const removed = player.cards[replaceIndex];
    player.cards[replaceIndex] = newCard;

    // remove chosen card from deck and return removed back
    deck.splice(deck.indexOf(newCard), 1);
    deck.push(removed);

    return player;
}

function replaceOneCardPair(player, deck) {
    // Count card ranks
    const rankCounts = {};
    player.cards.forEach((c, i) => {
        if (!rankCounts[c.rank]) rankCounts[c.rank] = [];
        rankCounts[c.rank].push(i); // store indexes for that rank
    });

    // Find which rank forms the pair
    const pairRank = Object.keys(rankCounts).find(r => rankCounts[r].length === 2);
    if (pairRank) {
        const pairIndexes = rankCounts[pairRank];
        const replaceIndex = pairIndexes[1]; // replace the last index of the pair

        // Filter deck to exclude cards having same rank (so pair breaks)
        const allowedDeck = deck.filter(c => c.rank !== pairRank);
        if (allowedDeck.length === 0) return; // failsafe if no eligible card left

        // Pick random card from remaining eligible deck
        const newCard = allowedDeck[Math.floor(Math.random() * allowedDeck.length)];

        // Perform replacement
        const removed = player.cards[replaceIndex];
        player.cards[replaceIndex] = newCard;

        // Update deck: remove new card, return replaced one
        deck.splice(deck.indexOf(newCard), 1);
        deck.push(removed);

        // console.log(
        //     `Pair correction: replaced ${removed.rank} (${removed.suit}) with ${newCard.rank} (${newCard.suit})`
        // );
    }
    return player;
}

function replaceOneQCard(player, deck) {
    let indexOfQ = null
    for (let i = 0; i < player.cards.length; i++) {
        if (player.cards[i].rank == "Q") {
            indexOfQ = i;
            break;
        }
    }
    const allowedDeck = deck.filter(c => c.rank !== "Q");
    const newCard = allowedDeck[Math.floor(Math.random() * allowedDeck.length)];
    const removed = player.cards[indexOfQ];
    player.cards[indexOfQ] = newCard;

    deck.splice(deck.indexOf(newCard), 1);
    deck.push(removed);

    return player;
}

function evaluatePlayer(cards) {
    const ranks = cards.map(c => c.val).sort((a, b) => a - b);
    const suits = cards.map(c => c.suit);
    const counts = ranks.reduce((acc, r) => ((acc[r] = (acc[r] || 0) + 1), acc), {});
    const uniqRanks = Object.keys(counts).map(Number);

    const isTrio = uniqRanks.length === 1;
    const isPair = uniqRanks.length === 2;
    const isFlush = new Set(suits).size === 1;
    const isStraight = (ranks[2] - ranks[0] === 2 && uniqRanks.length === 3)
        || (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 14); // A-2-3 low

    const isStraightFlush = isStraight && isFlush;

    const highestRank = Math.max(...ranks);
    const KandQ = uniqRanks.includes(13) && uniqRanks.includes(12);
    const JandQ = uniqRanks.includes(11) && uniqRanks.includes(12);

    return {
        Trio: isTrio,
        StraightFlush: isStraightFlush,
        Straight: isStraight && !isFlush,
        Flush: isFlush && !isStraight,
        Pair: isPair,
        Highcard: !isTrio && !isPair && !isFlush && !isStraight,
        HighestRank: RANKS.find(k => RANK_VAL[k] === highestRank),
        KandQ,
        JandQ,
        cards
    };
}

function checkWinner(playerA, playerB) {

    let playerAPoints = 0;
    let playerBPoints = 0;
    for (let i = 0; i < 3; i++) {
        playerAPoints += playerA.cards[i].val;
        playerBPoints += playerB.cards[i].val;
    }

    if (playerAPoints > playerBPoints) {
        return "WINNER_PLAYERA";
    }
    if (playerBPoints > playerAPoints) {
        return "WINNER_PLAYERB";
    }

    return "TIE";
}

function computeResult(roundId) {
    let deck = makeDeck();

    const cardsA = [drawRandomCard(deck), drawRandomCard(deck), drawRandomCard(deck)];
    const cardsB = [drawRandomCard(deck), drawRandomCard(deck), drawRandomCard(deck)];

    const playerA = evaluatePlayer(cardsA);
    const playerB = evaluatePlayer(cardsB);

    const winner = checkWinner(playerA, playerB);

    let resultData = {
        playerA,
        playerB,
        winner
    }

    resultCache.set(roundId, resultData);
    deckCache.set(roundId, deck);

    return resultData;
}

async function checkWorstMarket(roundId) {
    const bets = await Bet.find({ roundId, type: "casino", status: "OPEN" });

    // // Aggregate totals
    const totals = {};
    for (const b of bets) {
        const pick = String(b.market || "");
        totals[pick] = (totals[pick] || 0) + Number(b.stake);
    }

    // // Find worst exposure
    let worst = null;
    let maxStake = 0;
    for (const [market, amt] of Object.entries(totals)) {
        if (amt > maxStake) {
            worst = market;
            maxStake = amt;
        }
    }
    // console.log("Worst Market: ", worst);

    return worst;
}


async function computeBiasedResult(roundId) {
    let worst = await checkWorstMarket(roundId);
    console.log("WORST IS: ", worst);

    let { playerA, playerB, winner } = resultCache.get(roundId);
    let currentDeck = deckCache.get(roundId);
    if (worst) {
        let houseAtRisk = false;
        const [a, b] = worst.split("_");
        if (a == "WINNER" && worst == winner) {
            let temp = { ...playerA };
            playerA = { ...playerB };
            playerB = { ...temp };
            winner = b == "PLAYERA" ? "WINNER_PLAYERB" : "WINNER_PLAYERA";
            data = {
                playerA,
                playerB,
                winner
            }
            return data;
        }
        else if (b == "TRIO" || b == "STRAIGHT" || b == "FLUSH" || b == "STRAIGHTFLUSH") {
            if (a == "PLAYERA" && (playerA.Trio || playerA.Straight || playerA.Flush || playerA.StraightFlush)) {
                houseAtRisk = true;
                let newPlayerData = replaceOneCard(playerA, currentDeck);
                playerA = { ...newPlayerData };
            }
            else if (a == "PLAYERB" && (playerB.Trio || playerB.Straight || playerB.Flush || playerB.StraightFlush)) {
                houseAtRisk = true;
                let newPlayerData = replaceOneCard(playerB, currentDeck);
                playerB = { ...newPlayerData };
            }
        }
        else if (b == "PAIR") {
            if (a == "PLAYERA" && playerA.Pair) {
                houseAtRisk = true;
                let newPlayerData = replaceOneCardPair(playerA, currentDeck);
                playerA = { ...newPlayerData };
            }
            else if (a == "PLAYERB" && playerB.Pair) {
                houseAtRisk = true;
                let newPlayerData = replaceOneCardPair(playerB, currentDeck);
                playerB = { ...newPlayerData };
            }
        }
        else if (b == "KANDQ" || b == "JANDQ") {
            if (a == "PlayerA" && (playerA.KandQ || playerA.JandQ)) {
                houseAtRisk = true;
                let newPlayerData = replaceOneQCard(playerA, currentDeck);
                playerA = { ...newPlayerData };
            }
            else if (a == "PLAYERB" && (playerB.KandQ || playerB.JandQ)) {
                houseAtRisk = true;
                let newPlayerData = replaceOneCard(playerB, currentDeck);
                playerB = { ...newPlayerData };
            }
        }

        if (houseAtRisk) {
            let newPlayerAData = evaluatePlayer(playerA.cards);
            let newPlayerBData = evaluatePlayer(playerB.cards);
            let newWinner = checkWinner(newPlayerAData, newPlayerBData);

            playerA = { ...newPlayerAData };
            playerB = { ...newPlayerBData };
            winner = newWinner
        }
    }
    let finalData = {
        playerA,
        playerB,
        winner
    }
    return finalData;
}

function initTeenpattiPoint(io, tableId) {
    const GAME = "TEENPATTI_POINT";
    const room = `${GAME}:${tableId}`;
    const engine = new TeenpattiEngine({
        io,
        game: GAME,
        tableId: tableId,
        betMs: 20000,
        lockMs: 5000,
        resetMs: 10000,
        hooks: {

            onCreateRound: async (payload) => {
                const round = await createRound(payload);
                const roundId = String(round?._id || Date.now());
                lastRoundId = roundId;
                return round;
            },

            onLock: async (roundId) => {
                const rid = roundId || lastRoundId;
                await lockRound(rid);
            },

            onComputeNaturalResult: (roundId) => {
                let result = computeResult(roundId);
                return result;
            },

            onComputeBiasedResult: async (roundId) => {
                let newResults = await computeBiasedResult(roundId);
                return newResults;
            },

            onSettle: async (roundId, result) => {
                let resultNow = result || resultCache.get(roundId);
                await settleRoundTx({
                    roundId,
                    game: GAME,
                    outcome: {
                        firstOutcome: resultNow.winner,
                    },
                    meta: { playerA: result.playerA, playerB: result.playerB },
                })

            },
            onEnd: (roundId) => {
                if (roundId) {
                    resultCache.delete(String(roundId));
                    deckCache.delete(String(roundId));
                }
            }
        }
    })

    engine.start();
    return engine;
}

module.exports = { initTeenpattiPoint }