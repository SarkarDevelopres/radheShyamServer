const WebSocket = require('ws');
require('dotenv').config();
const { setMatch, getMatch, deleteMatch } = require('./cache');
const { isWatched, watchedList, remove } = require('./isWatched');
const Matchs = require('./db/models/match');

function connectTennis(onUpdate) {
  const TENNIS_WS = `wss://wss.api-tennis.com/live?APIkey=${process.env.API_TENNIS_KEY}`;
  let ws;

  function start() {
    console.log("[TENNIS] Connecting...");

    ws = new WebSocket(TENNIS_WS);

    ws.on("open", () => {
      console.log("[TENNIS] Connected");
    });

    ws.on("message", async(data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log("Data Came: True");
        // getMatch(matchId, { data: data })
        let watchList = watchedList();
        // console.log(watchList);

        const filteredMatches = msg.filter(match =>
          watchList.includes(String(match.event_key))
        );

        for (const match of filteredMatches) {

          const matchData = {
            id: match.event_key,
            teama: match.event_first_player,
            teamaId: match.first_player_key,
            teamb: match.event_second_player,
            teambId: match.second_player_key,
            serve: match.event_serve,
            status: match.event_status,
            score: match.event_game_result,
            stats: match.statistics,
            final: match.event_final_result,
            winner: match.event_winner,
            live: match.event_live === "1",
            points: match.pointbypoint || [],
            sets: match.scores || []
          };

          setMatch(match.event_key,{data:matchData});

          if (match.event_status == "Finished") {
            remove(match.event_key);
            deleteMatch(match.event_key);
            await Matchs.updateOne(
              { matchId:match.event_key },
              { $set: { game_state: { code: 4, string: 'Match Completed wait for 30mins for bets' }, updatedAt: new Date() } }
            );
          }

          onUpdate(match.event_key, matchData);

        }

        // if (!msg.event_key) return;

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
