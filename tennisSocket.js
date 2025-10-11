const WebSocket = require('ws');
require('dotenv').config();
function connectTennis(onUpdate) {
  const TENNIS_WS = `wss://wss.api-tennis.com/live?APIkey=${process.env.API_TENNIS_KEY}`;
  let ws;

  function start() {
    console.log("[TENNIS] Connecting...");

    ws = new WebSocket(TENNIS_WS);

    ws.on("open", () => {
      console.log("[TENNIS] Connected");
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.event_key) return;

        const matchData = {
          id: msg.event_key,
          teama: msg.event_first_player,
          teamb: msg.event_second_player,
          serve: msg.event_serve,
          status: msg.event_status,
          score: msg.event_game_result,
          final: msg.event_final_result,
          winner: msg.event_winner,
          live: msg.event_live === "1",
          points: msg.pointbypoint || [],
          sets: msg.scores || []
        };

        console.log(msg);
        

        onUpdate(msg.event_key, matchData);
      } catch (err) {
        console.log("[TENNIS] Bad message:", err.message);
      }
    });

    ws.on("close", () => {
      console.log("[TENNIS] Disconnected, reconnecting...");
      setTimeout(start, 5000);
    });

    ws.on("error", (err) => {
      console.log("[TENNIS] Error:", err.message);
      ws.close();
    });
  }

  start();
}

module.exports = { connectTennis };
