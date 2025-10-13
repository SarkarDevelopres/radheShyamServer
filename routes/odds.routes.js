const express = require('express');
const router = express.Router();
const OddsController = require('../controllers/odds.controller');

router.get('/cricket', OddsController.cricket);
router.get('/soccer', OddsController.football);
router.get('/tennis', OddsController.tennis);
router.get('/basketball', OddsController.basketball);
router.get('/baseball', OddsController.tennis);
router.get('/live', OddsController.live);
router.get('/cricLive', OddsController.cricketLive);
router.get('/tennisLive', OddsController.tennisLive);
router.post('/matchOdds', OddsController.matchOdds);
router.post('/all', OddsController.allSports);

module.exports = router;