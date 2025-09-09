// entitySlimLogger.js
require('dotenv').config();
const WebSocket = require('ws');

function connectEntityInspector() {
  const token = process.env.ENTITY_TOKEN;
  if (!token) {
    console.error('[entity] Missing ENTITY_TOKEN in .env');
    return;
  }

  const url = `ws://webhook.entitysport.com:8087/connect?token=${token}`;
  let ws;

  function start() {
    console.log('[entity] connecting…', url);
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log('[entity] connected');
    });

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }

      // 1) SNAPSHOT
      if (msg.api_type === 'match_push_obj') {
        const r = msg.response || {};
        const i = r.match_info || {};
        const innings = r.scorecard?.innings || [];
        const liveOdds = r.live_odds?.matchodds || {};

        const snapshot = {
          matchId: r.match_id || i.match_id,
          title: i.title,
          subtitle: i.subtitle,
          format: i.format_str,
          status: i.status_str,
          note: i.status_note,
          toss: i.toss?.text,
          venue: i.venue?.name,
          teamA: {
            name: i.teama?.name,
            short: i.teama?.short_name,
            score: i.teama?.scores,
            overs: i.teama?.overs,
          },
          teamB: {
            name: i.teamb?.name,
            short: i.teamb?.short_name,
            score: i.teamb?.scores,
            overs: i.teamb?.overs,
          },
          innings: innings.map((inn) => ({
            number: inn.number,
            name: inn.short_name,
            score: inn.scores,
            overs: inn.scores_full?.match(/\((.*?)\)/)?.[1] || '',
          })),
          live_odds: {
            teama_back: liveOdds.teama?.back || null,
            teamb_back: liveOdds.teamb?.back || null,
          },
        };

        console.log('[Entity ▶ SNAPSHOT]', snapshot);
        return;
      }

      // 2) BALL EVENT
      if (msg?.response?.ball_event || msg?.response?.data?.over) {
        const r = msg.response;
        const d = r.data || {};
        const ballEvent = {
          matchId: r.match_id,
          event: r.ball_event || r.code,
          over: d.over,
          ball: d.ball,
          striker: d.striker_name,
          bowler: d.bowler_name,
        };
        console.log('[Entity ▶ BALL]', ballEvent);
        return;
      }
    });

    ws.on('close', (code, reason) => {
      console.error(`[entity] closed code=${code} reason=${reason}`);
      setTimeout(start, 2000);
    });

    ws.on('error', (err) => {
      console.error('[entity] error:', err?.message || err);
    });
  }

  start();
}

module.exports = { connectEntityInspector };
