const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const Mission = require('../models/Mission');
const RefreshToken = require('../models/RefreshToken');

const EMOJI_MAP = {
  'Earn Money': '💰', 'Get Fit': '💪', 'Wake Up Early': '🌅',
  'Launch Project': '🚀', 'Create Content': '📱',
  'Study Discipline': '📚', 'Custom Mission': '🎯',
};

// ── Token helpers ─────────────────────────────────────────────────────────────

const generateAccessToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });

const generateRefreshToken = () => crypto.randomBytes(40).toString('hex');

const storeRefreshToken = async (userId, token) => {
  await RefreshToken.create({ userId, token });
};

// ── @POST /api/auth/register ──────────────────────────────────────────────────
const register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, errors: errors.array() });

  const { username, email, password } = req.body;
  try {
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      const field = existing.email === email ? 'Email' : 'Username';
      return res.status(400).json({ success: false, message: `${field} is already taken.` });
    }

    const user = await User.create({ username, email, password });
    const accessToken  = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(user._id, refreshToken);

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token: accessToken,
      accessToken,
      refreshToken,
      user: user.toJSON(),
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

// ── @POST /api/auth/login ─────────────────────────────────────────────────────
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, errors: errors.array() });

  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const accessToken  = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(user._id, refreshToken);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully!',
      token: accessToken,
      accessToken,
      refreshToken,
      user: user.toJSON(),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// ── @POST /api/auth/refresh ───────────────────────────────────────────────────
const refreshToken = async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token)
    return res.status(400).json({ success: false, message: 'Refresh token required.' });

  try {
    const stored = await RefreshToken.findOne({ token, isRevoked: false });
    if (!stored)
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });

    const accessToken = generateAccessToken(stored.userId);
    const newRefresh  = generateRefreshToken();
    stored.isRevoked  = true;
    await stored.save();
    await storeRefreshToken(stored.userId, newRefresh);

    res.json({ success: true, token: accessToken, accessToken, refreshToken: newRefresh });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ success: false, message: 'Token refresh failed.' });
  }
};

// ── @POST /api/auth/logout ────────────────────────────────────────────────────
const logout = async (req, res) => {
  const { refreshToken: token } = req.body;
  try {
    if (token) await RefreshToken.updateOne({ token }, { isRevoked: true });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Logout failed.' });
  }
};

// ── @GET /api/auth/me ─────────────────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, user: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch user.' });
  }
};

// ── @POST /api/auth/onboarding ────────────────────────────────────────────────
const VISIBILITY_MAP = {
  'public mode': 'public', 'public': 'public',
  'squad only': 'squad', 'squad mode': 'squad', 'squad': 'squad',
  'silent mode': 'private', 'private mode': 'private', 'private': 'private',
};

const completeOnboarding = async (req, res) => {
  // Support both old-style (identity/goalDescription) and new-style (missionTitle/durationDays)
  const {
    identity, goalDescription, visibility,
    missionTitle, durationDays,
  } = req.body;

  const title    = missionTitle || identity;
  const duration = parseInt(durationDays) || 30;

  if (!title)
    return res.status(400).json({ success: false, message: 'Mission title / identity is required.' });

  const mappedVisibility = VISIBILITY_MAP[(visibility || '').toLowerCase()] || 'public';

  try {
    const user = await User.findById(req.user._id);

    // Enforce mission limit even on onboarding (skip if already completed)
    if (!user.onboardingCompleted) {
      const missionLimit = user.isPremium ? 3 : 1;
      const activeCount  = await Mission.countDocuments({
        userId: req.user._id,
        status: { $in: ['active', 'draft'] },
        isDeleted: false,
      });
      if (activeCount >= missionLimit) {
        return res.status(400).json({
          success: false,
          message: `You can have at most ${missionLimit} active mission${missionLimit > 1 ? 's' : ''}. Upgrade to premium to increase.`,
        });
      }
    }

    user.onboardingCompleted = true;
    user.onboardingData = {
      identity:        identity || title,
      goalDescription: goalDescription || '',
      visibility:      mappedVisibility,
    };
    await user.save();

    const emoji = EMOJI_MAP[title] || '🎯';
    const now   = new Date();

    // Create mission in ACTIVE state (started, locked) so it's immediately usable
    const mission = await Mission.create({
      userId:      req.user._id,
      title,
      description: goalDescription || `My ${duration}-day ${title} journey`,
      category:    identity || title,
      emoji,
      visibility:  mappedVisibility,
      durationDays: duration,
      totalDays:    duration,
      status:      'active',
      isActive:    true,
      isLocked:    true,
      startedAt:   now,
      startDate:   now,
    });

    await user.addXP(100);
    res.json({
      success: true,
      message: 'Onboarding complete!',
      user:    user.toJSON(),
      mission,
    });
  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ success: false, message: 'Onboarding failed.' });
  }
};

module.exports = { register, login, refreshToken, logout, getMe, completeOnboarding };
