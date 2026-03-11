const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  day:       { type: Number, required: true },
  label:     { type: String, required: true },
  xpBonus:   { type: Number, default: 0 },
  achieved:  { type: Boolean, default: false },
  achievedAt:{ type: Date, default: null },
}, { _id: false });

const missionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: {
      type: String, required: [true, 'Mission title is required'],
      trim: true, maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    description: { type: String, default: '', maxlength: [500, 'Description cannot exceed 500 characters'] },
    category:    { type: String, default: 'Custom Mission' },
    emoji:       { type: String, default: '🎯' },

    rules: {
      dailyChecklist: [{ type: String }],
      proofType: { type: String, enum: ['photo', 'video', 'text', 'any'], default: 'photo' },
      proofCountPerDay: { type: Number, default: 1, min: 1, max: 5 },
    },

    durationDays: { type: Number, default: 30, min: 1, max: 365 },
    visibility: { type: String, enum: ['public', 'squad', 'private'], default: 'public' },

    // ── Timezone & Reminders ──────────────────────────────────────────────────
    timezone: { type: String, default: 'UTC' },
    reminderTime:    { type: String, default: null },
    reminderEnabled: { type: Boolean, default: false },

    // ── State machine ─────────────────────────────────────────────────────────
    startedAt: { type: Date, default: null },
    startDate: { type: Date, default: null },
    isLocked:  { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'failed', 'at_risk'],
      default: 'draft',
    },
    isActive:  { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },

    // ── Analytics ─────────────────────────────────────────────────────────────
    analytics: {
      completedDays: { type: Number, default: 0 },
      missedDays:    { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      bestStreak:    { type: Number, default: 0 },
      identityScore: { type: Number, default: 0, min: 0, max: 100 },
      lastProofDay:  { type: Number, default: 0 }, // last day number that had proof
    },

    // ── Milestones ─────────────────────────────────────────────────────────────
    milestones: {
      type: [milestoneSchema],
      default: () => [
        { day: 3,  label: '3-Day Spark',     xpBonus: 50,  achieved: false },
        { day: 7,  label: '1-Week Warrior',  xpBonus: 100, achieved: false },
        { day: 14, label: '2-Week Grind',    xpBonus: 150, achieved: false },
        { day: 21, label: '21-Day Habit',    xpBonus: 200, achieved: false },
        { day: 30, label: '30-Day Champion', xpBonus: 300, achieved: false },
        { day: 60, label: '60-Day Legend',   xpBonus: 500, achieved: false },
        { day: 90, label: '90-Day GOAT',     xpBonus: 750, achieved: false },
      ],
    },

    // ── Streak Shields ─────────────────────────────────────────────────────────
    shields: {
      available:   { type: Number, default: 1 },
      used:        { type: Number, default: 0 },
      lastGranted: { type: Date, default: null },
      usedOnDays:  [{ type: Number }],
    },

    // ── Rest Days (max 2 per mission) ─────────────────────────────────────────
    restDays: [{ type: String }], // 'YYYY-MM-DD' strings

    // ── Legacy fields ─────────────────────────────────────────────────────────
    currentDay:   { type: Number, default: 0 },
    streakCount:  { type: Number, default: 0 },
    lastCheckIn:  { type: Date, default: null },
    totalDays:    { type: Number, default: 30 },
    completedDays:[{ type: String }],
    endDate:      { type: Date, default: null },
    squadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', default: null },
  },
  { timestamps: true }
);

missionSchema.index({ userId: 1 });
missionSchema.index({ startedAt: 1 });
missionSchema.index({ status: 1, isDeleted: 1 });

// ── Utility: get today's date string in the mission's timezone ─────────────────
missionSchema.methods.todayString = function (timezone) {
  const tz = timezone || this.timezone || 'UTC';
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const p = parts.reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    return `${p.year}-${p.month}-${p.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

/**
 * Compute today's day number, timezone-aware.
 */
missionSchema.methods.computeDayNumber = function (timezone) {
  if (!this.startedAt) return -1;
  const tz = timezone || this.timezone || 'UTC';
  const now = new Date();
  const startDay = new Date(this.startedAt);

  let startMidnight, todayMidnight;
  try {
    const toDateParts = (date, tzStr) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tzStr, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date);
      return parts.reduce((acc, p) => { acc[p.type] = parseInt(p.value); return acc; }, {});
    };
    const sp = toDateParts(startDay, tz);
    const np = toDateParts(now, tz);
    startMidnight = Date.UTC(sp.year, sp.month - 1, sp.day);
    todayMidnight = Date.UTC(np.year, np.month - 1, np.day);
  } catch {
    startMidnight = Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate());
    todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  return Math.floor((todayMidnight - startMidnight) / (24 * 60 * 60 * 1000)) + 1;
};

missionSchema.methods.computeIdentityScore = function () {
  const { completedDays, missedDays, currentStreak } = this.analytics;
  const total = completedDays + missedDays;
  if (total === 0) return 0;
  return Math.round((completedDays / total) * 80 + Math.min(currentStreak / 30, 1) * 20);
};

missionSchema.methods.getIdentityTitle = function () {
  const score = this.analytics.identityScore;
  if (score >= 90) return 'LEGEND';
  if (score >= 75) return 'WARRIOR';
  if (score >= 60) return 'DISCIPLINED';
  if (score >= 40) return 'COMMITTED';
  return 'BEGINNER';
};

/** Check and award newly reached milestones. Returns array of newly achieved. */
missionSchema.methods.checkMilestones = function () {
  const newlyAchieved = [];
  const current = this.analytics.completedDays;
  for (const m of this.milestones) {
    if (!m.achieved && current >= m.day) {
      m.achieved = true;
      m.achievedAt = new Date();
      newlyAchieved.push({ day: m.day, label: m.label, xpBonus: m.xpBonus });
    }
  }
  return newlyAchieved;
};

/**
 * recordProof — single source of truth for check-in logic.
 * Called by proofController and checkIn (legacy).
 * Returns { alreadyDone, milestones: [{day, label, xpBonus}] }
 */
missionSchema.methods.recordProof = async function (dayNumber, timezone) {
  const tz = timezone || this.timezone || 'UTC';
  const todayStr = this.todayString(tz);

  if (this.completedDays.includes(todayStr)) {
    return { alreadyDone: true, milestones: [] };
  }

  // Add today
  this.completedDays.push(todayStr);
  this.analytics.completedDays += 1;
  this.analytics.lastProofDay = dayNumber;

  // Consecutive? Check if yesterday was completed
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  const hadYesterday = this.completedDays.includes(yStr);

  this.analytics.currentStreak = hadYesterday ? this.analytics.currentStreak + 1 : 1;
  if (this.analytics.currentStreak > this.analytics.bestStreak)
    this.analytics.bestStreak = this.analytics.currentStreak;
  this.analytics.identityScore = this.computeIdentityScore();

  // Legacy
  this.currentDay = Math.min(this.currentDay + 1, this.totalDays || this.durationDays);
  this.streakCount = this.analytics.currentStreak;
  this.lastCheckIn = new Date();

  // Revert at_risk
  if (this.status === 'at_risk') { this.status = 'active'; this.isActive = true; }

  // Milestones
  const newMilestones = this.checkMilestones();

  // Completion check
  if (this.analytics.completedDays >= (this.durationDays || this.totalDays || 30)) {
    this.status = 'completed';
    this.isActive = false;
    this.endDate = new Date();
  }

  await this.save();
  return { alreadyDone: false, milestones: newMilestones };
};

/** Use a streak shield. Returns true if successful. */
missionSchema.methods.useShield = async function (dayNumber) {
  if (this.shields.available <= 0) return false;
  const day = dayNumber || this.computeDayNumber();
  if (this.shields.usedOnDays.includes(day)) return false;

  this.shields.available -= 1;
  this.shields.used += 1;
  this.shields.usedOnDays.push(day);

  // Shield absorbs the miss — preserve streak
  this.analytics.currentStreak = (this.analytics.currentStreak || 0) + 1;
  if (this.analytics.currentStreak > this.analytics.bestStreak)
    this.analytics.bestStreak = this.analytics.currentStreak;
  this.analytics.identityScore = this.computeIdentityScore();
  this.streakCount = this.analytics.currentStreak;

  if (this.status === 'at_risk') { this.status = 'active'; this.isActive = true; }
  return true;
};

/** Grant a weekly shield every Monday if one hasn't been granted this week. */
missionSchema.methods.grantWeeklyShieldIfDue = function () {
  const now = new Date();
  if (!this.shields.lastGranted) {
    this.shields.available += 1;
    this.shields.lastGranted = now;
    return true;
  }
  const last = new Date(this.shields.lastGranted);
  const msSince = now - last;
  const daysSince = msSince / (1000 * 60 * 60 * 24);
  if (daysSince >= 7) {
    this.shields.available = Math.min(this.shields.available + 1, 5); // cap at 5
    this.shields.lastGranted = now;
    return true;
  }
  return false;
};

missionSchema.methods.isTodayDone = function () {
  const today = new Date().toISOString().slice(0, 10);
  return this.completedDays.includes(today);
};

// Legacy checkIn method (used by post creation flow)
missionSchema.methods.checkIn = async function (timezone) {
  const result = await this.recordProof(this.computeDayNumber(timezone), timezone);
  return { mission: this, newMilestones: result.milestones };
};

module.exports = mongoose.model('Mission', missionSchema);
