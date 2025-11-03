const express = require('express');
const router = express.Router();
const BetsController = require('../controllers/bets.controller');

router.post('/place', BetsController.placeBets);
router.post('/take', BetsController.takeBet);
router.post('/findMany', BetsController.findBets);
router.post('/findCashout', BetsController.findCashout);
router.post('/cashInAviator', BetsController.cashInAviator);

module.exports = router;