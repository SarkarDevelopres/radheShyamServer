const express = require('express');
const router = express.Router();
const BetsController = require('../controllers/bets.controller');

router.post('/place', BetsController.placeBets);

module.exports = router;