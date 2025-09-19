const express = require('express');
const router = express.Router();
const UserController = require('../controllers/user.controller');

router.post('/chngpassword', UserController.changePassword);
module.exports = router;