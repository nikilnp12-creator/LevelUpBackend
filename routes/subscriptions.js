const express = require('express');
const { protect } = require('../middleware/auth');
const { createSubscription, handleWebhook, getSubscriptionStatus, cancelSubscription } = require('../controllers/subscriptionController');

const router = express.Router();

// Webhook receives raw body from Stripe — must be before express.json()
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);
router.get('/status', protect, getSubscriptionStatus);
router.post('/create', protect, createSubscription);
router.post('/cancel', protect, cancelSubscription);

module.exports = router;
