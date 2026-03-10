const Mission = require('../models/Mission');
const MissionTemplate = require('../models/MissionTemplate');
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
  const {
    title, description, category, visibility, totalDays,
    squadId, rules, timezone, reminderTime, reminderEnabled,
  } = req.body;
  try {
    const user = await User.findById(req.user._id);
    const missionLimit = user.isPremium ? 5 : 1;
    const activeCount = await Mission.countDocuments({
      userId: req.user._id,
      status: { $in: ['active', 'draft', 'at_risk'] },
      isDeleted: false,
    });
    if (activeCount >= missionLimit)
      return res.status(400).json({
        success: false,
        message: `You can have at most ${missionLimit} active mission${missionLimit > 1 ? 's' : ''}. Upgrade to premium to increase.`,
      });

    const emoji = EMOJI_MAP[category] || '🎯';
    const mission = await Mission.create({
      userId: req.user._id,
      title, emoji,
      description: description || '',
      category: category || 'Custom Mission',
      visibility: mapVisibility(visibility),
      durationDays: totalDays || 30,
      totalDays: totalDays || 30,
      timezone: timezone || req.headers['x-timezone'] || 'UTC',
      reminderTime: reminderTime || null,
      reminderEnabled: !!reminderEnabled,
      rules: rules || { proofType: 'photo', proofCountPerDay: 1, dailyChecklist: [] },
      squadId: squadId || null,
      status: 'draft',
    });

    // Increment template usage if created from template
    if (req.body.templateId) {
      await MissionTemplate.findByIdAndUpdate(req.body.templateId, { $inc: { usageCount: 1 } });
    }

    await user.addXP(50);
    res.status(201).json({ success: true, mission });
  } catch (err) {
    console.error('Create mission error:', err);
    res.status(500).json({ success: false, message: 'Could not create mission.' });
  }
};

// ── GET /api/missions/templates ───────────────────────────────────────────────
const getTemplates = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = {};
    if (category) filter.category = category;
    const templates = await MissionTemplate.find(filter).sort({ isFeatured: -1, usageCount: -1 }).limit(20);
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch templates.' });
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
const updateMission = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });

    if (mission.isLocked) {
      const forbidden = ['rules', 'durationDays', 'totalDays', 'category'];
      const attempted = forbidden.filter((f) => req.body[f] !== undefined);
      if (attempted.length > 0)
        return res.status(403).json({ success: false, message: `Mission is locked. Cannot modify: ${attempted.join(', ')}.`, locked: true });
    }

    const { title, description, visibility, reminderTime, reminderEnabled, timezone } = req.body;
    if (title !== undefined) mission.title = title;
    if (description !== undefined) mission.description = description;
    if (visibility !== undefined) mission.visibility = mapVisibility(visibility);
    if (reminderTime !== undefined) mission.reminderTime = reminderTime;
    if (reminderEnabled !== undefined) mission.reminderEnabled = reminderEnabled;
    if (timezone !== undefined) mission.timezone = timezone;

    if (!mission.isLocked && req.body.rules !== undefined) mission.rules = req.body.rules;
    if (!mission.isLocked && req.body.durationDays !== undefined) {
      mission.durationDays = req.body.durationDays;
      mission.totalDays = req.body.durationDays;
    }

    await mission.save();
    res.json({ success: true, mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not update mission.' });
  }
};

// ── POST /api/missions/:id/start ──────────────────────────────────────────────
const startMission = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (mission.isLocked) return res.status(400).json({ success: false, message: 'Mission already started.' });

    const tz = req.body.timezone || req.headers['x-timezone'] || mission.timezone || 'UTC';
    const now = new Date();
    mission.startedAt = now;
    mission.startDate = now;
    mission.isLocked = true;
    mission.status = 'active';
    mission.isActive = true;
    mission.timezone = tz;
    mission.shields.lastGranted = now;
    await mission.save();

    res.json({ success: true, message: 'Mission started! Rules are now locked.', mission });
  } catch (err) {
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
    await user.awardBadge('mission_complete');

    res.json({ success: true, message: '🏆 Mission completed!', mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not complete mission.' });
  }
};

// ── POST /api/missions/:id/use-shield ─────────────────────────────────────────
const useShield = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (mission.status !== 'active' && mission.status !== 'at_risk')
      return res.status(400).json({ success: false, message: 'Mission is not active.' });

    const used = await mission.useShield();
    if (!used) return res.status(400).json({ success: false, message: 'No shields available.' });

    // Restore streak to 1 if it was at 0 due to missed day
    if (mission.analytics.currentStreak === 0) {
      mission.analytics.currentStreak = 1;
      mission.streakCount = 1;
    }
    if (mission.status === 'at_risk') mission.status = 'active';
    await mission.save();

    res.json({ success: true, message: '🛡️ Shield used! Streak protected.', mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not use shield.' });
  }
};

// ── POST /api/missions/:id/rest-day ───────────────────────────────────────────
const declareRestDay = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (!mission.isLocked || mission.status !== 'active')
      return res.status(400).json({ success: false, message: 'Mission must be active.' });
    if ((mission.restDays || []).length >= 2)
      return res.status(400).json({ success: false, message: 'Maximum 2 rest days per mission.' });

    const tz = req.body.timezone || req.headers['x-timezone'] || mission.timezone || 'UTC';
    const today = mission.todayString(tz);
    if ((mission.restDays || []).includes(today))
      return res.status(400).json({ success: false, message: 'Today is already a rest day.' });

    mission.restDays = [...(mission.restDays || []), today];
    await mission.save();

    res.json({ success: true, message: '😴 Rest day declared. Your streak is safe!', mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not declare rest day.' });
  }
};

// ── GET /api/missions/:id/proofs ──────────────────────────────────────────────
const getMissionProofs = async (req, res) => {
  try {
    const proofs = await Proof.find({ missionId: req.params.id, isDeleted: false })
      .populate('userId', 'username profileImageUrl')
      .sort({ dayNumber: -1 });
    res.json({ success: true, proofs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch proofs.' });
  }
};

// ── GET /api/missions/feed/public ─────────────────────────────────────────────
const getPublicFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const missions = await Mission.find({ visibility: 'public', status: { $in: ['active', 'at_risk'] }, isDeleted: false })
      .sort({ 'analytics.currentStreak': -1, updatedAt: -1 })
      .skip((page - 1) * limit).limit(limit)
      .populate('userId', 'username profileImageUrl xp level');
    res.json({ success: true, missions, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch feed.' });
  }
};

// ── GET /api/missions/leaderboard ─────────────────────────────────────────────
const getLeaderboard = async (req, res) => {
  const { sortBy = 'streak' } = req.query;
  try {
    const sortField = sortBy === 'identityScore' ? 'analytics.identityScore' : 'analytics.currentStreak';
    const missions = await Mission.find({ visibility: 'public', status: { $in: ['active', 'at_risk'] }, isDeleted: false })
      .sort({ [sortField]: -1 }).limit(50)
      .populate('userId', 'username profileImageUrl xp level');
    res.json({ success: true, missions, sortBy });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch leaderboard.' });
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

// Legacy check-in (kept for backwards compat)
const checkIn = async (req, res) => {
  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (!mission.isActive) return res.status(400).json({ success: false, message: 'Mission is not active.' });

    const tz = req.headers['x-timezone'] || mission.timezone || 'UTC';
    const dayNumber = mission.computeDayNumber(tz);
    const result = await mission.recordProof(dayNumber, tz);

    if (result.alreadyDone) return res.status(400).json({ success: false, message: 'Already checked in today!' });

    const user = await User.findById(req.user._id);
    const xpGain = 20 + mission.analytics.currentStreak * 2;
    await user.addXP(xpGain);

    if (mission.analytics.currentStreak > user.totalStreak) {
      user.totalStreak = mission.analytics.currentStreak;
      await user.save();
    }

    res.json({ success: true, mission, xpGained: xpGain, milestones: result.milestones });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Check-in failed.' });
  }
};


// ── AI Mission Suggestions ───────────────────────────────────────────────────
const getMissionSuggestions = async (req, res) => {
  try {
    const { getSuggestedMissions } = require('../services/missionSuggester');
    const user = await User.findById(req.user._id);
    const pastMissions = await Mission.find({ userId: req.user._id, isDeleted: false })
      .sort({ createdAt: -1 }).limit(10);
    const suggestions = await getSuggestedMissions(user, pastMissions);
    res.json({ success: true, suggestions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not generate suggestions.' });
  }
};

// ── AI Generate Mission from free text ───────────────────────────────────────
const generateMissionFromText = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'text is required' });
    const { generateMissionFromText: gen } = require('../services/missionSuggester');
    const mission = await gen(text, req.user);
    res.json({ success: true, mission });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not generate mission.' });
  }
};

module.exports = {
  getMyMissions, createMission, getMission, updateMission,
  startMission, completeMission, getMissionProofs, flagProof,
  getPublicFeed, getLeaderboard, checkIn, deleteMission,
  useShield, declareRestDay, getTemplates,
  getMissionSuggestions, generateMissionFromText,
};
