const express = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { register, login, refreshToken, logout, getMe, completeOnboarding } = require('../controllers/authController');

const router = express.Router();

router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Username 3-30 chars'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
], register);

router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty(),
], login);

router.post('/refresh', refreshToken);
router.post('/logout', logout);
router.get('/me', protect, getMe);
router.post('/onboarding', protect, completeOnboarding);

module.exports = router;
