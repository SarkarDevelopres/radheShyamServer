// isWatched.js
const watchers = new Map();

/**
 * Increase watcher count for a match.
 * @param {string} matchId 
 */
function add(matchId) {
  const count = watchers.get(matchId) || 0;
  watchers.set(matchId, count + 1);
}

/**
 * Decrease watcher count for a match.
 * If no watchers remain, removes the match from the map.
 * @param {string} matchId 
 * @returns {boolean} true if match is now un-watched (count = 0)
 */
function remove(matchId) {
  const count = (watchers.get(matchId) || 1) - 1;
  if (count <= 0) {
    watchers.delete(matchId);
    return true;
  } else {
    watchers.set(matchId, count);
    return false;
  }
}

/**
 * Check if a match is currently being watched.
 * @param {string} matchId 
 * @returns {boolean}
 */
function isWatched(matchId) {
  return watchers.has(matchId);
}

module.exports = {
  add,
  remove,
  isWatched,
};
