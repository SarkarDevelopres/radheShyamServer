const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/admin.controller');

router.post('/latestFiveGameLogs', AdminController.gameLog);
router.post('/latestTransactions', AdminController.transLog);
router.post('/totalGames', AdminController.totalGames);
router.post('/totalUsersDetails', AdminController.totalUsersDetails);
router.post('/totalEmployeeDetails', AdminController.totalEmployeeDetails);
router.post('/totalTransactionDetails', AdminController.totalTransactionDetails);
router.post('/todayTransactions', AdminController.getTodayTotalTransactions);
router.post('/chngWhatsapp', AdminController.chngWhatsapp);
router.get('/getNum', AdminController.getNumber);
router.get('/getLiveOdds', AdminController.getLiveOdds);
router.get('/getLiveOdds', AdminController.getLiveOdds);
router.post('/updateOddsStream', AdminController.updateOddsStream);

// USER APIS
router.post('/createUser', AdminController.createUser);
router.post('/deleteUser', AdminController.deleteUser);
router.post('/addCoinsToUser', AdminController.addCoins);
router.post('/deductCoinsFromUser', AdminController.deductCoins);
router.post('/findSingleUser', AdminController.findUser);

// EMP APIS
router.post('/createEmp', AdminController.createEmp);
router.post('/deleteEmp', AdminController.deleteEmp);

module.exports = router;