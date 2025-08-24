const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/admin.controller');

router.post('/latestFiveGameLogs', AdminController.gameLog);
router.post('/latestTransactions', AdminController.transLog);
router.post('/totalGames', AdminController.totalGames);
router.post('/totalUsersDetails', AdminController.totalUsersDetails);
router.post('/totalTransactionDetails', AdminController.totalTransactionDetails);

module.exports = router;