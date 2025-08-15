const express = require('express');
const router = express.Router();
const OddsController = require('../controllers/odds.controller');

router.get('/cricket', OddsController.cricket);
router.get('/soccer', OddsController.football);
router.get('/tennis', OddsController.tennis);

module.exports = router;