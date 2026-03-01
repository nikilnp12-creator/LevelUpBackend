const mongoose = require('mongoose');

/**
 * Mission – the core data model.
 * IMPORTANT: once isLocked=true (set by /start endpoint), rules and durationDays
 * CANNOT be modified. The server enforces this in PUT /api/missions/:id.
 */
const missionSchema = new mongoose.Schema(
  {
    userId: {                                 // renamed from ownerId for backwards compat (keep both indexed)
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Mission title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    description: {
      type: String,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    category: {
      type: String,
      default: 'Custom Mission',
    },
    emoji: { type: String, default: '🎯' },

    // ── Rules (locked after mission starts) ───────────────────────────────────
    rules: {
      dailyChecklist: [{ type: String }],   // checklist items user must do each day
      proofType: {
        type: String,
        enum: ['photo', 'video', 'text', 'any'],
        default: 'photo',
      },
      proofCountPerDay: { type: Number, default: 1, min: 1, max: 5 },
    },

    durationDays: { type: Number, default: 30, min: 1, max: 365 },

    visibility: {
      type: String,
      enum: ['public', 'squad', 'private'],
      default: 'public',
    },

    // ── State machine ─────────────────────────────────────────────────────────
    startedAt: { type: Date, default: null },
    startDate: { type: Date, default: null },  // same as startedAt, kept for compat
    isLocked: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'failed', 'at_risk'],
      default: 'draft',
    },
    isActive: { type: Boolean, default: true },   // legacy, mirrors status=active
    isDeleted: { type: Boolean, default: false },

    // ── Analytics (updated each proof upload) ─────────────────────────────────
    analytics: {
      completedDays: { type: Number, default: 0 },
      missedDays: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      identityScore: { type: Number, default: 0, min: 0, max: 100 },
    },

    // Legacy fields kept for compat with existing Flutter app
    currentDay: { type: Number, default: 0 },
    streakCount: { type: Number, default: 0 },
    lastCheckIn: { type: Date, default: null },
    totalDays: { type: Number, default: 30 },
    completedDays: [{ type: String }],   // 'YYYY-MM-DD' strings
    endDate: { type: Date, default: null },
    squadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', default: null },
  },
  { timestamps: true }
);

// Indexes specified in the requirements
missionSchema.index({ userId: 1 });
missionSchema.index({ startedAt: 1 });
missionSchema.index({ status: 1, isDeleted: 1 });

/**
 * Compute which day number it currently is for this mission.
 * @param {string} timezone  IANA timezone string (default UTC)
 * @returns {number} 1-based day number, or -1 if not started
 */
missionSchema.methods.computeDayNumber = function (timezone = 'UTC') {
  if (!this.startedAt) return -1;

  // Get today's date in the user's timezone
  const now = new Date();
  const startDay = new Date(this.startedAt);

  // Calculate day difference using UTC dates truncated to midnight
  const msPerDay = 24 * 60 * 60 * 1000;
  const startMidnight = Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate());
  const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const dayNumber = Math.floor((todayMidnight - startMidnight) / msPerDay) + 1;
  return dayNumber;
};

/**
 * Compute identityScore (0-100) from analytics.
 * Formula: (completedDays / max(1, completedDays+missedDays)) * 80 
 *          + streakBonus(currentStreak) * 20
 */
missionSchema.methods.computeIdentityScore = function () {
  const { completedDays, missedDays, currentStreak } = this.analytics;
  const total = completedDays + missedDays;
  if (total === 0) return 0;
  const completionRatio = completedDays / total;
  const streakBonus = Math.min(currentStreak / 30, 1); // caps at 30-day streak
  return Math.round(completionRatio * 80 + streakBonus * 20);
};

/**
 * Legacy: isTodayDone checks completedDays string array
 */
missionSchema.methods.isTodayDone = function () {
  const today = new Date().toISOString().slice(0, 10);
  return this.completedDays.includes(today);
};

/**
 * checkIn — idempotent daily check-in. Updates both legacy and analytics fields.
 * Called by postController when a post is submitted for a mission.
 */
missionSchema.methods.checkIn = async function () {
  const today = new Date().toISOString().slice(0, 10);
  if (this.completedDays.includes(today)) return this; // already done today

  // Legacy fields
  this.completedDays.push(today);
  this.currentDay = Math.min(this.currentDay + 1, this.totalDays || this.durationDays);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  this.streakCount = this.completedDays.includes(yStr) ? this.streakCount + 1 : 1;
  this.lastCheckIn = new Date();

  // Analytics fields (new)
  this.analytics.completedDays = (this.analytics.completedDays || 0) + 1;
  if (this.completedDays.includes(yStr)) {
    this.analytics.currentStreak = (this.analytics.currentStreak || 0) + 1;
  } else {
    this.analytics.currentStreak = 1;
  }
  if (this.analytics.currentStreak > (this.analytics.bestStreak || 0)) {
    this.analytics.bestStreak = this.analytics.currentStreak;
  }
  this.analytics.identityScore = this.computeIdentityScore();

  // Check mission completion
  const totalDays = this.totalDays || this.durationDays || 30;
  if (this.currentDay >= totalDays) {
    this.status = 'completed';
    this.isActive = false;
    this.endDate = new Date();
  }

  await this.save();
  return this;
};

module.exports = mongoose.model('Mission', missionSchema);