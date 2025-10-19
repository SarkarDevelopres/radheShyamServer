const express = require('express');
const router = express.Router();
const TestController = require('../controllers/test.controller');

router.get('/setMatch', TestController.setMatch);
router.post('/completeMatch', TestController.completeMatch);
module.exports = router;