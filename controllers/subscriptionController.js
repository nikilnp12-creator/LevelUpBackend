const Subscription = require('../models/Subscription');
const User = require('../models/User');

// Stripe integration — uses STRIPE_SECRET_KEY if available, otherwise test mode
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || null,
  annual: process.env.STRIPE_PRICE_ANNUAL || null,
};

// ── POST /api/subscriptions/create ────────────────────────────────────────────
const createSubscription = async (req, res) => {
  const { plan = 'monthly' } = req.body;
  try {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (plan === 'annual' ? 12 : 1));

    // If Stripe is configured, create a checkout session
    if (stripe && PRICE_IDS[plan]) {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
        success_url: `${process.env.APP_DEEP_LINK || 'levelapp://'}subscription/success`,
        cancel_url: `${process.env.APP_DEEP_LINK || 'levelapp://'}subscription/cancel`,
        metadata: { userId: req.user._id.toString(), plan },
      });

      return res.status(201).json({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.id,
        message: 'Stripe checkout session created.',
      });
    }

    // Test mode: activate immediately without Stripe
    const subscription = await Subscription.create({
      userId: req.user._id,
      plan,
      status: 'active',
      providerId: `TEST_${Date.now()}`,
      expiresAt,
    });

    const user = await User.findById(req.user._id);
    user.isPremium = true;
    await user.save();

    res.status(201).json({
      success: true,
      subscription,
      message: 'Subscription activated (test mode).',
    });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ success: false, message: 'Could not create subscription.' });
  }
};

// ── GET /api/subscriptions/status ─────────────────────────────────────────────
const getSubscriptionStatus = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      userId: req.user._id,
      status: 'active',
    }).sort({ createdAt: -1 });

    const user = await User.findById(req.user._id);

    // Check if subscription expired
    if (subscription && subscription.expiresAt < new Date()) {
      subscription.status = 'expired';
      await subscription.save();
      user.isPremium = false;
      await user.save();
    }

    res.json({
      success: true,
      isPremium: user.isPremium,
      subscription: subscription || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch subscription status.' });
  }
};

// ── POST /api/subscriptions/cancel ────────────────────────────────────────────
const cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      userId: req.user._id,
      status: 'active',
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'No active subscription found.' });
    }

    // If Stripe subscription, cancel on Stripe
    if (stripe && subscription.providerId && !subscription.providerId.startsWith('TEST_')) {
      await stripe.subscriptions.cancel(subscription.providerId).catch(() => {});
    }

    subscription.status = 'canceled';
    await subscription.save();

    const user = await User.findById(req.user._id);
    user.isPremium = false;
    await user.save();

    res.json({ success: true, message: 'Subscription canceled.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not cancel subscription.' });
  }
};

// ── POST /api/subscriptions/webhook ──────────────────────────────────────────
const handleWebhook = async (req, res) => {
  if (!stripe) return res.json({ received: true });

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    return res.status(400).json({ success: false, message: 'Webhook signature verification failed.' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        if (userId) {
          const plan = session.metadata?.plan || 'monthly';
          const expiresAt = new Date();
          expiresAt.setMonth(expiresAt.getMonth() + (plan === 'annual' ? 12 : 1));

          await Subscription.create({
            userId,
            plan,
            status: 'active',
            providerId: session.subscription || session.id,
            expiresAt,
          });

          await User.findByIdAndUpdate(userId, { isPremium: true });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = await Subscription.findOne({ providerId: event.data.object.id });
        if (sub) {
          sub.status = 'canceled';
          await sub.save();
          await User.findByIdAndUpdate(sub.userId, { isPremium: false });
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).json({ success: false, message: 'Webhook handling failed.' });
  }
};

module.exports = { createSubscription, handleWebhook, getSubscriptionStatus, cancelSubscription };
