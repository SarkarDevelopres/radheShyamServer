const express = require('express');
const router = express.Router();
const EmpController = require('../controllers/employee.controller');

router.post('/totalUsersDetails', EmpController.totalUsersDetails);
router.post('/createUser', EmpController.createUser);
router.post('/deductCoinsFromUser', EmpController.deductCoins);
router.post('/addCoinsToUser', EmpController.addCoins);

module.exports = router;