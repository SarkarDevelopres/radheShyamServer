// cache.js
const cache = new Map();

/**
 * Store match data in cache.
 * @param {string} matchId 
 * @param {object} data 
 */
function setMatch(matchId, data) {
    // console.log(`Match Added: ${matchId} `,data);
        
    cache.set(String(matchId), { data, updated: Date.now() });
}

/**
 * Get match data from cache (or null if not found).
 * @param {string} matchId 
 * @returns {object|null}
*/
function getMatch(matchId) {
    const key = String(matchId);
    console.log("Match Cache ID: ", matchId);
    const entry = cache.get(key);
    console.log("Match Data Cache: ", entry);
    if (!entry) return null;
    return entry.data;
}

/**
 * Remove match data from cache.
 * @param {string} matchId 
 */
function deleteMatch(matchId) {
    cache.delete(matchId);
}

module.exports = {
    setMatch,
    getMatch,
    deleteMatch,
};
