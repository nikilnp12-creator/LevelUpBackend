const Mission = require('../models/Mission');
const User = require('../models/User');
const Proof = require('../models/Proof');

const EMOJI_MAP = {
  'Earn Money': '💰', 'Get Fit': '💪', 'Wake Up Early': '🌅',
  'Launch Project': '🚀', 'Create Content': '📱',
  'Study Discipline': '📚', 'Custom Mission': '🎯',
};

const mapVisibility = (v) => {
  const map = {
    'public mode': 'public', 'public': 'public',
    'squad only': 'squad', 'squad mode': 'squad', 'squad': 'squad',
    'silent mode': 'private', 'private mode': 'private', 'private': 'private',
  };
  return map[(v || '').toLowerCase()] || 'public';
};

// ── GET /api/missions ─────────────────────────────────────────────────────────
const getMyMissions = async (req, res) => {
  try {
    const missions = await Mission.find({ userId: req.user._id, isDeleted: false }).sort({ createdAt: -1 });
    res.json({ success: true, missions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch missions.' });
  }
};

// ── POST /api/missions ────────────────────────────────────────────────────────
const createMission = async (req, res) => {
  const { title, description, category, visibility, totalDays, squadId, rules } = req.body;
  try {
    const user = await User.findById(req.user._id);
    const missionLimit = user.isPremium ? 3 : 1;
    // Count active + draft missions (both count toward the limit)
    const activeCount = await Mission.countDocuments({
      userId: req.user._id,
      status: { $in: ['active', 'draft'] },
      isDeleted: false,
    });
    if (activeCount >= missionLimit)
      return res.status(400).json({
        success: false,
        message: `You can have at most ${missionLimit} active mission${missionLimit > 1 ? "s" : ""}. Upgrade to premium to increase.`,
      });

    const emoji = EMOJI_MAP[category] || '🎯';
    const mission = await Mission.create({
      userId: req.user._id,
      title,
      description: description || '',
      category: category || 'Custom Mission',
      emoji,
      visibility: mapVisibility(visibility),
      durationDays: totalDays || 30,
      totalDays: totalDays || 30,
      rules: rules || { proofType: 'photo', proofCountPerDay: 1, dailyChecklist: [] },
      squadId: squadId || null,
      status: 'draft',
    });

    await user.addXP(50);
    res.status(201).json({ success: true, mission });
  } catch (err) {
    console.error('Create mission error:', err);
    res.status(500).json({ success: false, message: 'Could not create mission.' });
  }
};

// ── GET /api/missions/:id ─────────────────────────────────────────────────────
const getMission = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    res.json({ success: true, mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch mission.' });
  }
};

// ── PUT /api/missions/:id ─────────────────────────────────────────────────────
// SERVER-SIDE ENFORCEMENT: reject edits to rules/durationDays if isLocked=true
const updateMission = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });

    // ⚠️ LOCKING ENFORCEMENT: rules and durationDays are immutable after start
    if (mission.isLocked) {
      const forbidden = ['rules', 'durationDays', 'totalDays', 'category'];
      const attempted = forbidden.filter((f) => req.body[f] !== undefined);
      if (attempted.length > 0)
        return res.status(403).json({
          success: false,
          message: `Mission is locked. Cannot modify: ${attempted.join(', ')}. Mission rules are frozen after starting.`,
          locked: true,
        });
    }

    const { title, description, visibility } = req.body;
    if (title !== undefined) mission.title = title;
    if (description !== undefined) mission.description = description;
    if (visibility !== undefined) mission.visibility = mapVisibility(visibility);

    // Only allow rule edits before start
    if (!mission.isLocked && req.body.rules !== undefined) mission.rules = req.body.rules;
    if (!mission.isLocked && req.body.durationDays !== undefined) {
      mission.durationDays = req.body.durationDays;
      mission.totalDays = req.body.durationDays;
    }

    mission.updatedAt = new Date();
    await mission.save();
    res.json({ success: true, mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not update mission.' });
  }
};

// ── POST /api/missions/:id/start ──────────────────────────────────────────────
// Locks the mission — rules and duration cannot be changed after this point
const startMission = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (mission.isLocked)
      return res.status(400).json({ success: false, message: 'Mission already started.' });

    const now = new Date();
    mission.startedAt = now;
    mission.startDate = now;
    mission.isLocked = true;        // ← THE LOCK
    mission.status = 'active';
    mission.isActive = true;
    await mission.save();

    res.json({ success: true, message: 'Mission started! Rules are now locked.', mission });
  } catch (err) {
    console.error('Start mission error:', err);
    res.status(500).json({ success: false, message: 'Could not start mission.' });
  }
};

// ── POST /api/missions/:id/complete ───────────────────────────────────────────
const completeMission = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });

    mission.status = 'completed';
    mission.isActive = false;
    mission.endDate = new Date();
    await mission.save();

    const user = await User.findById(req.user._id);
    await user.addXP(500);
    res.json({ success: true, message: '🏆 Mission completed!', mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not complete mission.' });
  }
};

// ── GET /api/missions/:id/proofs ──────────────────────────────────────────────
const getMissionProofs = async (req, res) => {
  try {
    const proofs = await Proof.find({ missionId: req.params.id, isDeleted: false }).sort({ dayNumber: -1 });
    res.json({ success: true, proofs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch proofs.' });
  }
};

// ── POST /api/missions/:id/flag ───────────────────────────────────────────────
const flagProof = async (req, res) => {
  const { proofId, reason } = req.body;
  try {
    const proof = await Proof.findOne({ _id: proofId, missionId: req.params.id });
    if (!proof) return res.status(404).json({ success: false, message: 'Proof not found.' });

    proof.flagged = true;
    proof.moderation.status = 'pending';
    proof.moderation.reason = reason || 'Flagged by user';
    await proof.save();

    res.json({ success: true, message: 'Proof flagged for review.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not flag proof.' });
  }
};

// ── GET /api/missions/feed/public ─────────────────────────────────────────────
const getPublicFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const missions = await Mission.find({ visibility: 'public', status: 'active', isDeleted: false })
      .sort({ 'analytics.currentStreak': -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'username profileImageUrl xp level');

    res.json({ success: true, missions, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch feed.' });
  }
};

// ── GET /api/missions/leaderboard ─────────────────────────────────────────────
const getLeaderboard = async (req, res) => {
  const { sortBy = 'streak' } = req.query; // streak | identityScore
  try {
    const sortField = sortBy === 'identityScore'
      ? 'analytics.identityScore'
      : 'analytics.currentStreak';

    const missions = await Mission.find({ visibility: 'public', status: 'active', isDeleted: false })
      .sort({ [sortField]: -1 })
      .limit(50)
      .populate('userId', 'username profileImageUrl xp level');

    res.json({ success: true, missions, sortBy });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch leaderboard.' });
  }
};

// ── Legacy check-in (kept for backwards compat) ───────────────────────────────
const checkIn = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (!mission.isActive) return res.status(400).json({ success: false, message: 'Mission is completed.' });
    if (mission.isTodayDone())
      return res.status(400).json({ success: false, message: 'Already checked in today!' });

    const today = new Date().toISOString().slice(0, 10);
    mission.completedDays.push(today);
    mission.currentDay = Math.min(mission.currentDay + 1, mission.totalDays);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    mission.streakCount = mission.completedDays.includes(yStr) ? mission.streakCount + 1 : 1;
    mission.lastCheckIn = new Date();
    if (mission.currentDay >= mission.totalDays) { mission.isActive = false; mission.endDate = new Date(); }
    await mission.save();

    const user = await User.findById(req.user._id);
    const xpGain = 20 + mission.streakCount * 2;
    await user.addXP(xpGain);
    if (mission.streakCount > user.totalStreak) { user.totalStreak = mission.streakCount; await user.save(); }

    res.json({ success: true, mission, xpGained: xpGain });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Check-in failed.' });
  }
};

const deleteMission = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    mission.isDeleted = true;
    await mission.save();
    res.json({ success: true, message: 'Mission deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not delete mission.' });
  }
};

module.exports = {
  getMyMissions, createMission, getMission, updateMission,
  startMission, completeMission, getMissionProofs, flagProof,
  getPublicFeed, getLeaderboard, checkIn, deleteMission,
};
