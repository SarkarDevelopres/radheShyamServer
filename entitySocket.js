// entitySocket.js
require('dotenv').config();
const WebSocket = require('ws');

/**
 * Decide if 'next' is newer than 'prev'.
 * If Entity gives you a clear order field (e.g., sequenceNumber, over.ball),
 * prefer that here.
 */
function isNewer(prev, next) {
  if (typeof prev?.sequenceNumber === 'number' && typeof next?.sequenceNumber === 'number') {
    return next.sequenceNumber > prev.sequenceNumber;
  }
  // Fallback: compare timestamps if present
  const pt = prev?.ts || prev?.timestamp;
  const nt = next?.ts || next?.timestamp;
  if (pt && nt) return new Date(nt).getTime() >= new Date(pt).getTime();

  // If no comparison field, accept as newer
  return true;
}

/**
 * connectEntity(onUpdate)
 * - Connects to Entity Sports WS
 * - Auto-reconnect with backoff
 * - Keeps last snapshot per match (drops dupes/older)
 * - Calls onUpdate(matchId, latestSnapshot) on new info
 */
function connectEntity(onUpdate) {
  const token = "a34a487cafbb7c1a67af8d50d67a360e";
  if (!token) {
    console.error('[entity] Missing ENTITY_TOKEN in .env');
  }

  // Replace if your provider gave a different URL
  const ENTITY_URL = `ws://webhook.entitysport.com:8087/connect?token=${token}`;

  let ws;
  let backoff = 1000; // grows to 10s
  let heartbeatTimer = null;

  const latestByMatch = new Map();

  function start() {
    console.log('[entity] connecting…', ENTITY_URL);
    ws = new WebSocket(ENTITY_URL);

    ws.on('open', () => {
      console.log('[entity] connected');
      backoff = 1000;
      // If a subscribe handshake is required, send here:
      // ws.send(JSON.stringify({ action: 'subscribe', matches: ['MATCH_ID_1'] }));

      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.ping();
      }, 25000);
    });

    ws.on('pong', () => {
      // socket-level heartbeat ok
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // ignore non-JSON pings/text
      }

      // Map possible keys to a canonical matchId
      const matchId =
        msg.matchId ||
        msg.match_id ||
        msg.mid ||
        (msg.data && (msg.data.matchId || msg.data.match_id || msg.data.mid));

      if (!matchId) return;

      const prev = latestByMatch.get(matchId);
      if (prev && !isNewer(prev, msg)) return;

      const merged = { ...(prev || {}), ...msg };
      latestByMatch.set(matchId, merged);

      try {
        onUpdate(matchId, merged);
      } catch (e) {
        console.error('[entity] onUpdate handler error:', e?.message || e);
      }
    });

    ws.on('close', (code, reason) => {
      console.error(`[entity] closed code=${code} reason=${reason}`);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[entity] error:', err?.message || err);
      try { ws.close(); } catch {}
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    const delay = Math.min(backoff, 10000);
    console.log(`[entity] reconnecting in ${delay}ms…`);
    setTimeout(() => {
      backoff = Math.min(backoff * 2, 10000);
      start();
    }, delay);
  }

  start();

  // Teardown for graceful shutdowns (pm2 reloads, etc.)
  return () => {
    try { ws?.close(); } catch {}
    clearInterval(heartbeatTimer);
    latestByMatch.clear();
  };
}

module.exports = { connectEntity };
