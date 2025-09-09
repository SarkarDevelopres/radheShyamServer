// entityInspector.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// ---------- knobs ----------
const THROTTLE_MS = Number(process.env.ENTITY_LOG_THROTTLE_MS || 1500);   // per match
const LOG_DIR = process.env.ENTITY_LOG_DIR || path.resolve(__dirname, 'entity_logs');
const PRINT_FIRST_N_FULL = Number(process.env.ENTITY_LOG_FIRST_VERBOSE || 3);

// ensure dir
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// helper
const safeJSON = (v) => {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

// Pick best-guess id fields commonly seen in feeds.
// If your payload includes explicit match info elsewhere, add it here.
function getMatchId(msg) {
  return (
    msg.matchId ||
    msg.match_id ||
    msg.mid ||
    msg.event_id ||
    msg?.data?.matchId ||
    msg?.data?.match_id ||
    'unknown'
  );
}

function briefProjected(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '—';
  // print 2–3 points as preview
  const take = arr.slice(0, 3).map(s => `${s.runrate}@${s.score}`).join(', ');
  return `${take}${arr.length > 3 ? ` …(+${arr.length-3})` : ''}`;
}

function summarize(msg) {
  const matchId = getMatchId(msg);
  const etag = msg.etag || msg.Etag || msg.ETag;
  const ts = msg.timestamp || msg.ts || msg.datetime || msg.modified || Date.now();

  // score-ish hints (many providers differ; adapt once you see stable keys)
  const score = msg.score || msg.data?.score || {};
  const runs = score.runs ?? msg.runs ?? msg.data?.runs;
  const overs = score.overs ?? msg.overs ?? msg.data?.overs;
  const wkts = score.wickets ?? score.wkts ?? msg.wickets ?? msg.data?.wickets;

  const projected = briefProjected(msg.projected_score || msg.data?.projected_score);
  const liveOddsLen = Array.isArray(msg.live_odds) ? msg.live_odds.length : (Array.isArray(msg.data?.live_odds) ? msg.data.live_odds.length : 0);
  const sessionOddsLen = Array.isArray(msg.session_odds) ? msg.session_odds.length : (Array.isArray(msg.data?.session_odds) ? msg.data.session_odds.length : 0);
  const teamWinLen = Array.isArray(msg.teamwinpercentage) ? msg.teamwinpercentage.length : (Array.isArray(msg.data?.teamwinpercentage) ? msg.data.teamwinpercentage.length : 0);
  const featuredLen = Array.isArray(msg.featured_session) ? msg.featured_session.length : (Array.isArray(msg.data?.featured_session) ? msg.data.featured_session.length : 0);
  const players = msg.players || msg.data?.players || [];
  const pCount = Array.isArray(players) ? players.length : 0;
  const pSample = players?.slice(0, 2)?.map(p => p.short_name || p.title || p.first_name)?.join(', ') || '';

  return {
    matchId,
    etag,
    ts,
    score: runs != null || overs != null || wkts != null ? `${runs}/${wkts ?? 0} (${overs ?? '—'} ov)` : '—',
    projected,
    live_odds: liveOddsLen,
    session_odds: sessionOddsLen,
    team_win_entries: teamWinLen,
    featured_session: featuredLen,
    players: `${pCount}${pSample ? ` [${pSample}]` : ''}`,
  };
}

// shallow signature to drop obvious dupes if etag missing
function signature(msg) {
  const key = {
    etag: msg.etag || msg.ETag || msg.Etag,
    timestamp: msg.timestamp || msg.ts || msg.modified || msg.datetime,
    // include things that change often
    projected: msg.projected_score,
    live_odds: Array.isArray(msg.live_odds) ? msg.live_odds.length : undefined,
  };
  return JSON.stringify(key);
}

function connectEntityInspector() {
  const token = process.env.ENTITY_TOKEN;
  if (!token) {
    console.error('[entity] Missing ENTITY_TOKEN in .env');
  }
  const url = `ws://webhook.entitysport.com:8087/connect?token=${token}`;

  let ws;
  let backoff = 1000;
  let firstFull = 0;

  // caches
  const nextLogAt = new Map();  // matchId -> epoch ms
  const lastSigByMatch = new Map();

  function writeLatestFile(matchId, msg) {
    const file = path.join(LOG_DIR, `match_${String(matchId).replace(/[^\w-]/g, '_')}.json`);
    try { fs.writeFileSync(file, safeJSON(msg)); } catch { /* ignore */ }
  }

  function maybeLog(msg) {
    const matchId = getMatchId(msg);
    const now = Date.now();
    const due = nextLogAt.get(matchId) || 0;
    if (now < due) return; // throttle

    // dedupe
    const sig = msg.etag || signature(msg);
    if (sig && lastSigByMatch.get(matchId) === sig) {
      // identical to last important shape; just refresh file & skip console
      writeLatestFile(matchId, msg);
      return;
    }
    lastSigByMatch.set(matchId, sig);

    // throttle window
    nextLogAt.set(matchId, now + THROTTLE_MS);

    // console brief
    const brief = summarize(msg);
    console.log('[Entity ▶]', brief);

    // full file (open in editor to inspect)
    writeLatestFile(matchId, msg);

    // print a few full samples globally at the start
    if (firstFull < PRINT_FIRST_N_FULL) {
      console.log('[Entity full sample]', safeJSON(msg));
      firstFull++;
    }
  }

  function start() {
    console.log('[entity] connecting…', url);
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log('[entity] connected');
      backoff = 1000;
      // If subscription is required, uncomment:
      // ws.send(JSON.stringify({ action: 'subscribe', matches: ['MATCH_ID_1'] }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch {
        // ignore non-JSON or show first few if you like
        return;
      }
      maybeLog(msg);
    });

    ws.on('error', (err) => {
      console.error('[entity] error:', err?.message || err);
    });

    ws.on('close', (code, reason) => {
      console.error(`[entity] closed code=${code} reason=${reason}`);
      setTimeout(() => {
        backoff = Math.min(backoff * 2, 10000);
        start();
      }, backoff);
    });
  }

  start();

  return {
    stop() { try { ws?.close(); } catch {} }
  };
}

module.exports = { connectEntityInspector };
