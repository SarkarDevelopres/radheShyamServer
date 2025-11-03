// games/aviator.js
const { AviatorEngine } = require("./aviator.engine");
const { createRound, settleRoundTx, lockRound } = require('../db/store');

function initAviator(io, tableId = 'table-1') {
    const GAME = 'AVIATOR';

    const engine = new AviatorEngine({
        io,
        game:GAME,
        tableId,
        resetMs:5000,
        hooks: {
            onCreateRound: async (roundData) => {
                let round = await createRound(roundData);
                return round;
            },
            onEndRound: async (roundId, multiplier) => {
                await lockRound(roundId)
                await settleRoundTx({
                    roundId,
                    game: GAME,
                    outcome: { firstOutcome: multiplier },
                    meta: {multiplier},
                });
            }
        }
    });

    engine.start();
    return engine;
}

module.exports = { initAviator };
