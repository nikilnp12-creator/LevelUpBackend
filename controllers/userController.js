const User = require('../models/User');
const Post = require('../models/Post');
const streamifier = require('streamifier');

// Lazy-load to avoid circular dependency
const getNotificationController = () => require('./notificationController');

// Cloudinary is optional
let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  cloudinary = require('../config/cloudinary');
}

// ─── @GET /api/users/me ────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({ success: true, user: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch profile.' });
  }
};

// ─── @PUT /api/users/me ────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  const { username, bio } = req.body;
  try {
    if (username) {
      const existing = await User.findOne({ username, _id: { $ne: req.user._id } });
      if (existing)
        return res.status(400).json({ success: false, message: 'Username is already taken.' });
    }
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { ...(username && { username }), ...(bio !== undefined && { bio }) },
      { new: true, runValidators: true }
    );
    res.status(200).json({ success: true, user: updated.toJSON() });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: 'Could not update profile.' });
  }
};

// ─── @POST /api/user/avatar ────────────────────────────────────────────────
const uploadAvatar = async (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  if (!cloudinary)
    return res.status(503).json({ success: false, message: 'Image upload not configured. Set Cloudinary env vars.' });
  try {
    const user = await User.findById(req.user._id);
    if (user.profileImagePublicId) {
      await cloudinary.uploader.destroy(user.profileImagePublicId).catch(() => {});
    }
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `level_up/avatars/${req.user._id}`, resource_type: 'image', quality: 'auto:good', width: 400, crop: 'fill' },
        (err, result) => { if (err) reject(err); else resolve(result); }
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { profileImageUrl: result.secure_url, profileImagePublicId: result.public_id },
      { new: true }
    );
    res.status(200).json({ success: true, user: updated.toJSON() });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ success: false, message: 'Avatar upload failed.' });
  }
};

// ─── @GET /api/users/:id ──────────────────────────────────────────────────────
// Returns any user's public profile with isFollowing / isRequested
const getUserById = async (req, res) => {
  try {
    const targetId    = req.params.id;
    const requesterId = req.user._id;

    const target = await User.findById(targetId)
      .select('-password -profileImagePublicId -__v')
      .lean();

    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const followersArr = target.followers || [];
    const followingArr = target.following || [];

    const isFollowing = followersArr.some(
      (id) => id.toString() === requesterId.toString()
    );

    // Check for a pending follow_request notification
    const Notification = require('../models/Notification');
    const pendingRequest = await Notification.findOne({
      toUser:   targetId,
      fromUser: requesterId,
      type:     'follow_request',
    }).lean();

    const profile = {
      _id:             target._id,
      username:        target.username,
      email:           target.email,
      bio:             target.bio || '',
      profileImageUrl: target.profileImageUrl || null,
      xp:              target.xp || 0,
      level:           target.level || 1,
      totalStreak:     target.totalStreak || 0,
      isPremium:       target.isPremium || false,
      onboardingCompleted: target.onboardingCompleted || false,
      followersCount:  followersArr.length,
      followingCount:  followingArr.length,
      isFollowing,
      isRequested:     !!pendingRequest,
    };

    res.status(200).json({ success: true, user: profile });
  } catch (err) {
    console.error('getUserById error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch user profile.' });
  }
};

// ─── @GET /api/users/:id/posts ────────────────────────────────────────────────
const getUserPosts = async (req, res) => {
  try {
    const targetId    = req.params.id;
    const requesterId = req.user._id;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(30, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const posts = await Post.find({ userId: targetId, visibility: 'public' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId',    'username profileImageUrl level totalStreak')
      .populate('missionId', 'title emoji currentDay')
      .lean();

    const enriched = posts.map((p) => {
      const u = p.userId    || {};
      const m = p.missionId || {};
      return {
        _id:             p._id,
        id:              p._id,
        userId:          u._id?.toString() || targetId,
        username:        u.username || '',
        profileImageUrl: u.profileImageUrl || null,
        userStreak:      u.totalStreak || 0,
        missionId:       m._id?.toString() || '',
        missionTitle:    m.title || '',
        missionEmoji:    m.emoji || '🎯',
        missionDay:      p.missionDay || 0,
        caption:         p.caption || '',
        mediaUrl:        p.mediaUrl || null,
        mediaType:       p.mediaType || null,
        thumbnailUrl:    p.thumbnailUrl || null,
        mediaAspectRatio: p.mediaWidth && p.mediaHeight
          ? parseFloat((p.mediaWidth / p.mediaHeight).toFixed(4))
          : null,
        visibility:      p.visibility || 'public',
        likesCount:      (p.likes || []).length,
        commentsCount:   (p.comments || []).length,
        isLiked:         (p.likes || []).some((id) => id.toString() === requesterId.toString()),
        createdAt:       p.createdAt,
      };
    });

    res.status(200).json({ success: true, posts: enriched });
  } catch (err) {
    console.error('getUserPosts error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch user posts.' });
  }
};

// ─── @POST /api/users/:id/follow ──────────────────────────────────────────────
const followUser = async (req, res) => {
  try {
    const targetId    = req.params.id;
    const requesterId = req.user._id;

    if (targetId === requesterId.toString())
      return res.status(400).json({ success: false, message: 'You cannot follow yourself.' });

    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    // Already following?
    const alreadyFollowing = (target.followers || []).some(
      (id) => id.toString() === requesterId.toString()
    );
    if (alreadyFollowing) {
      return res.status(200).json({ success: true, isFollowing: true, isRequested: false });
    }

    // Existing pending request?
    const Notification = require('../models/Notification');
    const existingReq = await Notification.findOne({
      toUser: targetId, fromUser: requesterId, type: 'follow_request',
    });
    if (existingReq) {
      return res.status(200).json({ success: true, isFollowing: false, isRequested: true });
    }

    // Follow directly (public accounts)
    await User.findByIdAndUpdate(requesterId, { $addToSet: { following: targetId } });
    await User.findByIdAndUpdate(targetId,    { $addToSet: { followers: requesterId } });

    // Send notification
    getNotificationController().createNotification({
      toUserId:   targetId,
      fromUserId: requesterId,
      type:       'follow_accepted',
      message:    'started following you',
    });

    res.json({ success: true, isFollowing: true, isRequested: false });
  } catch (err) {
    console.error('followUser error:', err);
    res.status(500).json({ success: false, message: 'Could not follow user.' });
  }
};

// ─── @POST /api/users/:id/unfollow ────────────────────────────────────────────
const unfollowUser = async (req, res) => {
  try {
    const targetId    = req.params.id;
    const requesterId = req.user._id;

    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    await User.findByIdAndUpdate(requesterId, { $pull: { following: targetId } });
    await User.findByIdAndUpdate(targetId,    { $pull: { followers: requesterId } });

    // Cancel any pending follow_request
    const Notification = require('../models/Notification');
    await Notification.deleteOne({ toUser: targetId, fromUser: requesterId, type: 'follow_request' });

    res.json({ success: true, message: `Unfollowed @${target.username}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not unfollow user.' });
  }
};



// ─── @GET /api/users/:id/followers ────────────────────────────────────────────
const getFollowers = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('followers').populate('followers', 'username profileImageUrl level bio');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.status(200).json({ success: true, users: user.followers || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch followers.' });
  }
};

// ─── @GET /api/users/:id/following ────────────────────────────────────────────
const getFollowing = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('following').populate('following', 'username profileImageUrl level bio');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.status(200).json({ success: true, users: user.following || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch following.' });
  }
};

// ─── @GET /api/users/search?q= ────────────────────────────────────────────────
const searchUsers = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(200).json({ success: true, users: [] });
    const users = await User.find({
      username: { $regex: q, $options: 'i' },
      _id: { $ne: req.user._id },
      isActive: true,
    }).select('username profileImageUrl level bio').limit(20);
    res.status(200).json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Search failed.' });
  }
};

// ─── @GET /api/users/weekly-wrapup ────────────────────────────────────────────
const getWeeklyWrapUp = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const Mission = require('../models/Mission');
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const missions = await Mission.find({
      userId: req.user._id,
      status: { $in: ['active', 'completed', 'at_risk'] },
      isDeleted: false,
      startedAt: { $lte: new Date() },
    });

    let weeklyCompleted = 0;
    let weeklyMissed = 0;
    let maxStreak = 0;
    let totalXpThisWeek = 0;
    const missionSummaries = [];

    for (const m of missions) {
      const recent = (m.completedDays || []).filter(d => new Date(d) >= weekAgo);
      const weekDays = Math.min(7, Math.max(0, Math.floor((new Date() - new Date(m.startedAt)) / 86400000)));
      const expectedThisWeek = Math.min(7, weekDays);
      const missed = Math.max(0, expectedThisWeek - recent.length);

      weeklyCompleted += recent.length;
      weeklyMissed += missed;
      if (m.analytics.currentStreak > maxStreak) maxStreak = m.analytics.currentStreak;

      missionSummaries.push({
        id: m._id,
        title: m.title,
        emoji: m.emoji,
        completedThisWeek: recent.length,
        currentStreak: m.analytics.currentStreak,
        status: m.status,
      });
    }

    totalXpThisWeek = weeklyCompleted * 22;

    // Also update the stored weeklyStats
    await User.findByIdAndUpdate(req.user._id, {
      'weeklyStats.completedDays': weeklyCompleted,
      'weeklyStats.missedDays': weeklyMissed,
      'weeklyStats.bestStreak': maxStreak,
      'weeklyStats.xpEarned': totalXpThisWeek,
      'weeklyStats.generatedAt': new Date(),
    });

    res.json({
      success: true,
      wrapUp: {
        completedDays: weeklyCompleted,
        missedDays: weeklyMissed,
        bestStreak: maxStreak,
        xpEarned: totalXpThisWeek,
        totalMissions: missions.length,
        missions: missionSummaries,
        level: user.level,
        totalXp: user.xp,
      },
    });
  } catch (err) {
    console.error('Weekly wrapup error:', err);
    res.status(500).json({ success: false, message: 'Could not generate weekly wrap-up.' });
  }
};

// ─── @PUT /api/users/fcm-token ─────────────────────────────────────────────────
const registerFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ success: false, message: 'fcmToken is required.' });

    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    res.json({ success: true, message: 'FCM token registered.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not register FCM token.' });
  }
};

// ─── @GET /api/users/me/identity-score ────────────────────────────────────────
const getIdentityScore = async (req, res) => {
  try {
    const Mission = require('../models/Mission');
    const missions = await Mission.find({
      userId: req.user._id,
      isDeleted: false,
      status: { $in: ['active', 'completed', 'at_risk'] },
    });

    if (missions.length === 0) {
      return res.json({ success: true, identityScore: 0, title: 'BEGINNER', missions: [] });
    }

    let totalScore = 0;
    const missionScores = [];
    for (const m of missions) {
      const score = m.computeIdentityScore();
      totalScore += score;
      missionScores.push({
        id: m._id,
        title: m.title,
        emoji: m.emoji,
        identityScore: score,
        identityTitle: m.getIdentityTitle(),
      });
    }

    const avgScore = Math.round(totalScore / missions.length);
    let title = 'BEGINNER';
    if (avgScore >= 90) title = 'LEGEND';
    else if (avgScore >= 75) title = 'WARRIOR';
    else if (avgScore >= 60) title = 'DISCIPLINED';
    else if (avgScore >= 40) title = 'COMMITTED';

    res.json({ success: true, identityScore: avgScore, title, missions: missionScores });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not compute identity score.' });
  }
};

module.exports = { getProfile, updateProfile, uploadAvatar, getUserById, getUserPosts, followUser, unfollowUser, getFollowers, getFollowing, searchUsers, getWeeklyWrapUp, registerFcmToken, getIdentityScore };
