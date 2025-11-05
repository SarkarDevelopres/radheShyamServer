const express = require('express');
const router = express.Router();
const TestController = require('../controllers/test.controller');

router.get('/setMatch', TestController.setMatch);
router.get('/completeMatch', TestController.completeMatch);
router.get('/completeTennisMatch', TestController.completeTennisMatch);
module.exports = router;