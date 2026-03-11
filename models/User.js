const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Level title system
const LEVEL_TITLES = [
  { minLevel: 1,  title: 'Starter',    emoji: '🌱' },
  { minLevel: 5,  title: 'Committed',  emoji: '💪' },
  { minLevel: 10, title: 'Warrior',    emoji: '⚔️' },
  { minLevel: 20, title: 'Champion',   emoji: '🏆' },
  { minLevel: 35, title: 'Legend',     emoji: '⭐' },
  { minLevel: 50, title: 'GOAT',       emoji: '🐐' },
];

const badgeSchema = new mongoose.Schema({
  id:         { type: String, required: true },
  name:       { type: String, required: true },
  emoji:      { type: String, required: true },
  description:{ type: String, default: '' },
  earnedAt:   { type: Date, default: Date.now },
}, { _id: false });

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String, required: [true, 'Username is required'], unique: true,
      trim: true, minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
    },
    email: {
      type: String, required: [true, 'Email is required'], unique: true,
      lowercase: true, trim: true, match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String, required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'], select: false,
    },
    profileImageUrl: { type: String, default: null },
    profileImagePublicId: { type: String, default: null },
    bio: { type: String, maxlength: [200, 'Bio cannot exceed 200 characters'], default: '' },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    totalStreak: { type: Number, default: 0 },
    isPremium: { type: Boolean, default: false },
    squadIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Squad' }],
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // ── FCM Push Notifications ────────────────────────────────────────────────
    fcmToken: { type: String, default: null },
    notificationSettings: {
      dailyReminder: { type: Boolean, default: true },
      milestoneAlerts: { type: Boolean, default: true },
      socialActivity: { type: Boolean, default: true },
      weeklyWrapup: { type: Boolean, default: true },
    },

    // ── Badges / Achievements ─────────────────────────────────────────────────
    badges: [badgeSchema],

    // ── Weekly shield quota (earned each Sunday) ──────────────────────────────
    weeklyShields: {
      earned: { type: Number, default: 0 },
      lastEarnedWeek: { type: String, default: null }, // ISO week string 'YYYY-WW'
    },

    // ── Weekly Stats (populated by cron) ──────────────────────────────────────
    weeklyStats: {
      completedDays: { type: Number, default: 0 },
      missedDays: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      xpEarned: { type: Number, default: 0 },
      generatedAt: { type: Date, default: null },
    },

    // ── Onboarding ────────────────────────────────────────────────────────────
    onboardingCompleted: { type: Boolean, default: false },
    onboardingData: {
      identity: { type: String, default: null },
      goalDescription: { type: String, default: null },
      visibility: { type: String, default: 'public' },
    },

    // ── Engagement profile for "For You" algorithmic feed ─────────────────────
    engagementProfile: {
      // How many times the user interacted with each mood  { "motivated": 5, "proud": 3, ... }
      moodPreferences:     { type: Map, of: Number, default: {} },
      // Category interaction counts  { "Get Fit": 10, "Study Discipline": 4, ... }
      categoryPreferences: { type: Map, of: Number, default: {} },
      // Users most interacted with   { "<userId>": 8, ... }
      userInteractions:    { type: Map, of: Number, default: {} },
      lastUpdated:         { type: Date, default: null },
    },

    isActive: { type: Boolean, default: true },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.addXP = async function (amount) {
  this.xp += amount;
  this.level = Math.floor(this.xp / 500) + 1;
  await this.save();
};

/** Get level title info based on current level */
userSchema.methods.getLevelTitle = function () {
  let title = LEVEL_TITLES[0];
  for (const t of LEVEL_TITLES) {
    if (this.level >= t.minLevel) title = t;
  }
  return title;
};

/** XP needed to reach next level */
userSchema.methods.xpToNextLevel = function () {
  return (this.level * 500) - this.xp;
};

/** Award badge if not already earned */
const BADGE_REGISTRY = {
  'first_checkin': { name: 'First Check-in', emoji: '✅', description: 'Uploaded your first proof!' },
  'streak_7':      { name: '7-Day Streak',   emoji: '🔥', description: 'Maintained a 7-day streak!' },
  'streak_21':     { name: '21-Day Habit',   emoji: '💪', description: 'Built a 21-day habit!' },
  'streak_30':     { name: '30-Day Warrior', emoji: '⚔️', description: 'Completed a 30-day streak!' },
  'early_bird':    { name: 'Early Bird',     emoji: '🌅', description: 'Uploaded proof before 8am!' },
  'mission_complete': { name: 'Mission Complete', emoji: '🏆', description: 'Completed a full mission!' },
  'social_starter':{ name: 'Social Starter', emoji: '👋', description: 'Connected with others!' },
  'challenge_winner': { name: 'Challenge Winner', emoji: '🥇', description: 'Won a community challenge!' },
};

userSchema.methods.awardBadge = async function (badgeId, name, emoji, description = '') {
  const alreadyHas = this.badges.some(b => b.id === badgeId);
  if (alreadyHas) return false;
  // Use registry if no name/emoji provided
  const reg = BADGE_REGISTRY[badgeId];
  this.badges.push({
    id: badgeId,
    name: name || reg?.name || badgeId,
    emoji: emoji || reg?.emoji || '🏅',
    description: description || reg?.description || '',
  });
  await this.save();
  return true;
};

/**
 * Record an engagement signal for the "For You" feed algorithm.
 * Call this whenever the user likes, comments, or reacts to a post.
 * @param {object} post – the Post document (with mood, missionId populated)
 */
userSchema.methods.recordEngagement = async function (post) {
  if (!this.engagementProfile) {
    this.engagementProfile = { moodPreferences: {}, categoryPreferences: {}, userInteractions: {} };
  }
  const ep = this.engagementProfile;

  // Track mood preference
  if (post.mood) {
    const cur = ep.moodPreferences.get(post.mood) || 0;
    ep.moodPreferences.set(post.mood, cur + 1);
  }

  // Track category preference (from populated mission or raw missionId)
  const missionTitle = post.missionId?.title || post._missionTitle;
  if (missionTitle) {
    const cur = ep.categoryPreferences.get(missionTitle) || 0;
    ep.categoryPreferences.set(missionTitle, cur + 1);
  }

  // Track user interaction (who they engage with)
  const postAuthor = (post.userId?._id || post.userId)?.toString();
  if (postAuthor && postAuthor !== this._id.toString()) {
    const cur = ep.userInteractions.get(postAuthor) || 0;
    ep.userInteractions.set(postAuthor, cur + 1);
  }

  ep.lastUpdated = new Date();
  await this.save();
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.profileImagePublicId;
  delete obj.__v;
  obj.followersCount = (obj.followers || []).length;
  obj.followingCount = (obj.following || []).length;
  delete obj.followers;
  delete obj.following;
  const levelTitle = this.getLevelTitle();
  obj.levelTitle = levelTitle.title;
  obj.levelEmoji = levelTitle.emoji;
  obj.xpToNextLevel = this.xpToNextLevel();
  obj.xpForCurrentLevel = (this.level - 1) * 500;
  obj.xpProgress = this.xp - obj.xpForCurrentLevel;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
module.exports.LEVEL_TITLES = LEVEL_TITLES;
