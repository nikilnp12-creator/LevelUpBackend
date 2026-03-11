// backend/controllers/seasonController.js
const Season  = require('../models/Season');
const Mission = require('../models/Mission');
const User    = require('../models/User');

// GET /api/seasons/active
const getActiveSeason = async (req, res) => {
  try {
    let season = await Season.findOne({ isActive: true });

    // Auto-create first season if none exists
    if (!season) {
      const now = new Date();
      const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      season = await Season.create({
        name: 'The Discipline Season',
        theme: 'discipline',
        emoji: '⚔️',
        description: '90 days. One mission. Who shows up every day?',
        number: 1,
        startDate: now,
        endDate: end,
        isActive: true,
      });
    }

    // Check if current user is participating
    const isParticipant = season.participants.some(
      p => p.userId.toString() === req.user._id.toString()
    );

    res.json({ success: true, season, isParticipant });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/seasons/leaderboard  — top 50 participants
const getSeasonLeaderboard = async (req, res) => {
  try {
    const season = await Season.findOne({ isActive: true })
      .populate('participants.userId', 'username profileImageUrl level levelTitle');

    if (!season) return res.json({ success: true, leaderboard: [] });

    // Aggregate xpEarned from missions for all participants
    const userIds = season.participants.map(p => p.userId?._id || p.userId);
    const missionStats = await Mission.aggregate([
      { $match: { userId: { $in: userIds }, status: { $in: ['active', 'completed', 'at_risk'] } } },
      { $group: { _id: '$userId', totalCheckins: { $sum: '$analytics.completedDays' }, bestStreak: { $max: '$analytics.bestStreak' }, xp: { $sum: '$analytics.identityScore' } } },
    ]);
    const statsMap = {};
    missionStats.forEach(s => { statsMap[s._id.toString()] = s; });

    const leaderboard = season.participants
      .map(p => {
        const uid = (p.userId?._id || p.userId).toString();
        const stats = statsMap[uid] || {};
        const user = p.userId;
        return {
          userId: uid,
          username: user?.username || '',
          profileImageUrl: user?.profileImageUrl || null,
          level: user?.level || 1,
          levelTitle: user?.levelTitle || '',
          totalCheckins: stats.totalCheckins || 0,
          bestStreak: stats.bestStreak || 0,
          xp: stats.xp || 0,
          score: (stats.totalCheckins || 0) * 10 + (stats.bestStreak || 0) * 5 + (stats.xp || 0),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    // Mark current user's rank
    const myRank = leaderboard.findIndex(e => e.userId === req.user._id.toString()) + 1;

    res.json({ success: true, leaderboard, myRank, season });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/seasons/join
const joinSeason = async (req, res) => {
  try {
    const season = await Season.findOne({ isActive: true });
    if (!season) return res.status(404).json({ success: false, message: 'No active season.' });

    const already = season.participants.some(p => p.userId.toString() === req.user._id.toString());
    if (already) return res.json({ success: true, message: 'Already joined!', season });

    season.participants.push({ userId: req.user._id });
    await season.save();

    res.json({ success: true, message: 'Joined the season!', season });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/seasons/all
const getAllSeasons = async (req, res) => {
  try {
    const seasons = await Season.find().sort({ number: -1 }).limit(10).select('-participants');
    res.json({ success: true, seasons });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getActiveSeason, getSeasonLeaderboard, joinSeason, getAllSeasons };
