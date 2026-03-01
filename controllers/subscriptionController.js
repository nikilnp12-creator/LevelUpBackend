const Subscription = require('../models/Subscription');
const User = require('../models/User');

// TODO: Replace placeholder with real Stripe keys
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ── POST /api/subscriptions/create ────────────────────────────────────────────
const createSubscription = async (req, res) => {
  const { plan = 'monthly' } = req.body;
  try {
    // TODO: Create actual Stripe checkout session
    // const session = await stripe.checkout.sessions.create({ ... });

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (plan === 'annual' ? 12 : 1));

    const subscription = await Subscription.create({
      userId: req.user._id,
      plan,
      status: 'active',
      providerId: `PLACEHOLDER_${Date.now()}`, // replace with Stripe subscription ID
      expiresAt,
    });

    // Mark user as premium
    const user = await User.findById(req.user._id);
    user.isPremium = true;
    await user.save();

    res.status(201).json({
      success: true,
      subscription,
      // checkoutUrl: session.url, // return Stripe checkout URL in production
      message: 'Subscription created (test mode).',
    });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ success: false, message: 'Could not create subscription.' });
  }
};

// ── POST /api/subscriptions/webhook ──────────────────────────────────────────
// Handle Stripe webhooks (test mode)
const handleWebhook = async (req, res) => {
  // TODO: Verify Stripe webhook signature
  // const sig = req.headers['stripe-signature'];
  // const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

  const event = req.body; // placeholder

  try {
    if (event.type === 'customer.subscription.deleted') {
      await Subscription.updateOne(
        { providerId: event.data?.object?.id },
        { status: 'canceled' }
      );
    }
    res.json({ received: true });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Webhook handling failed.' });
  }
};

module.exports = { createSubscription, handleWebhook };
