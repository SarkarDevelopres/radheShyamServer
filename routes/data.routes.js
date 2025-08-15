const express = require('express');
const router = express.Router();
const DataController = require('../controllers/data.controller');

router.post('/balance', DataController.balance);

module.exports = router;