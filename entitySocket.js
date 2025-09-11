// entitySocket.js
require('dotenv').config();
const WebSocket = require('ws');
const { setMatch, getMatch, deleteMatch } = require('./cache');
const { add, remove, isWatched } = require('./isWatched');

const DEBUG = process.env.DEBUG_ENTITY === '1'; // set DEBUG_ENTITY=1 to see verbose logs

function getMatchId(msg) {
  return (
    msg.matchId ?? msg.match_id ?? msg.mid ??
    msg?.data?.matchId ?? msg?.data?.match_id ?? msg?.data?.mid ??
    msg?.response?.matchId ?? msg?.response?.match_id ?? msg?.response?.mid ??
    msg?.response?.match_info?.match_id ?? msg?.match_info?.match_id ??
    null
  );
}

function isNewer(prev, next) {
  if (typeof prev?.sequenceNumber === 'number' && typeof next?.sequenceNumber === 'number') {
    return next.sequenceNumber > prev.sequenceNumber;
  }
  const pt = prev?.ts || prev?.timestamp;
  const nt = next?.ts || next?.timestamp;
  if (pt && nt) return new Date(nt).getTime() >= new Date(pt).getTime();
  return true;
}

function summarize(msg) {
  const r = msg?.response || msg?.data || msg;
  const i = r?.match_info || msg?.match_info || {};
  const innings = r?.scorecard?.innings || [];

  return {
    matchId: getMatchId(msg),
    title: i.title || r?.title,
    status: i.status_str || r?.match_status || r?.status_str,
    ball_event: r?.ball_event || r?.event,
    over: r?.data?.over || r?.over || r?.overs,
    ball: r?.data?.ball || r?.ball,
    striker: r?.data?.striker_name,
    bowler: r?.data?.bowler_name,
    teamA: i?.teama?.short_name,
    teamB: i?.teamb?.short_name,
    odds: r?.live_odds?.matchodds ? {
      A: r.live_odds.matchodds.teama?.back ?? null,
      B: r.live_odds.matchodds.teamb?.back ?? null
    } : undefined,
    innings: innings.map(inn => ({
      number: inn.number,
      short: inn.short_name,
      score: inn.scores,
    })),
  };
}

function normalizeSnapshot(raw) {
  const r = raw?.response || {};
  const i = r?.match_info || {};
  const A = i?.teama || {};
  const B = i?.teamb || {};
  const odds = raw?.response?.live_odds?.matchodds || {};

  return {
    matchId: r?.match_id ?? i?.match_id,
    title: i?.title || i?.short_title,
    teamA: {
      short: A?.short_name || A?.name,
      scores: A?.scores || "-",
      overs: A?.overs || "-"
    },
    teamB: {
      short: B?.short_name || B?.name,
      scores: B?.scores || "-",
      overs: B?.overs || "-"
    },
    live_odds: {
      teama: odds?.teama || {},
      teamb: odds?.teamb || {}
    }
  };
}

/**
 * connectEntity(onUpdate)
 * - Connects to Entity Sports WS
 * - Logs SNAPSHOT and BALL events (like your entityLogger)
 * - Dedupes per-match messages
 * - Calls onUpdate(matchId, mergedMessage)
 */
function connectEntity(onUpdate) {
  const token = process.env.ENTITY_TOKEN || "a34a487cafbb7c1a67af8d50d67a360e";
  if (!token) {
    console.error('[entity] Missing ENTITY_TOKEN in .env');
  }
  const ENTITY_URL = `ws://webhook.entitysport.com:8087/connect?token=${token}`;

  let ws;
  let backoff = 1000;
  let heartbeatTimer = null;
  const latestByMatch = new Map();

  function start() {
    console.log('[entity] connecting…', ENTITY_URL);
    ws = new WebSocket(ENTITY_URL);

    ws.on('open', () => {
      console.log('[entity] connected');
      backoff = 1000;
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.ping();
      }, 25000);
    });

    ws.on('pong', () => { /* heartbeat ok */ });

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        if (DEBUG) console.log('[entity] non-JSON frame:', String(buf).slice(0, 120));
        return;
      }

      const matchId = getMatchId(msg);
      if (!matchId) {
        if (DEBUG) console.log('[entity] message without matchId:', msg?.api_type || msg?.status || 'unknown');
        return;
      }

      // Log like your entityLogger
      if (msg.api_type === 'match_push_obj') {
        // console.log('[Entity ▶ SNAPSHOT]', summarize(msg));
        // const snapshot = normalizeSnapshot(msg);
        let liveScore = msg.response.live.live_score;
        let liveOdds = msg.response.live_odds;
        let teamAName = msg.response.match_info.teama.name;
        let teamBName = msg.response.match_info.teamb.name;
        let teamBatting = msg.response.live.team_batting;
        let teamBowling = msg.response.live.team_bowling;
        let batsmenList = msg.response.live.batsmen
        let bowlersList = msg.response.live.bowlers
        let sessionOdds = msg.response.session_odds

        let data = {
          liveOdds,
          liveScore,
          batsmenList,
          bowlersList,
          sessionOdds,
          teamData: { teama: teamAName, teamb: teamBName },
          batBowl: { batting: teamBatting, bowling: teamBowling }
        }

        setMatch(matchId, {data:data})

        console.log(msg.response.live);
        onUpdate(matchId, { kind: 'snapshot', data: data });
        
        if (msg.response.match_info.status_note == 'Match completed') {
          deleteMatch(matchId);
          remove(matchId);
        }

      } else if (msg?.response?.ball_event || msg?.response?.data?.over) {
        // console.log('[Entity ▶ BALL]', summarize(msg));
        onUpdate(matchId, { kind: 'ball', data: msg.response });
      } else if (DEBUG) {
        // console.log('[Entity ▶ MISC]', summarize(msg));
      }

      // Dedupe / merge frames per match
      const prev = latestByMatch.get(String(matchId));
      if (prev && !isNewer(prev, msg)) return;

      const merged = { ...(prev || {}), ...msg };
      latestByMatch.set(String(matchId), merged);

      try {
        // onUpdate(String(matchId), merged);
      } catch (e) {
        // console.error('[entity] onUpdate handler error:', e?.message || e);
      }
    });

    ws.on('close', (code, reason) => {
      // console.error(`[entity] closed code=${code} reason=${reason}`);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[entity] error:', err?.message || err);
      try { ws.close(); } catch { }
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

  return {
    stop() {
      try { ws?.close(); } catch { }
      clearInterval(heartbeatTimer);
      latestByMatch.clear();
    },
    getLatest(matchId) {
      return latestByMatch.get(String(matchId));
    }
  };
}

module.exports = { connectEntity };
