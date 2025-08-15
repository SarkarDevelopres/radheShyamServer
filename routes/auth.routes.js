const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/auth.controller');

router.post('/login', AuthController.login);
router.post('/createuser', AuthController.createUser);
router.post('/adminLogin', AuthController.adminLogin);
router.post('/adminSignUp', AuthController.adminSignUp);

module.exports = router;