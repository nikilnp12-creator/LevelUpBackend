const { DateTime } = require('luxon');

/**
 * Get today's date string in a given timezone (YYYY-MM-DD).
 * Defaults to UTC if timezone is invalid.
 */
function getTodayStr(timezone = 'UTC') {
  try {
    return DateTime.now().setZone(timezone).toISODate();
  } catch {
    return DateTime.now().toUTC().toISODate();
  }
}

/**
 * Get yesterday's date string in a given timezone.
 */
function getYesterdayStr(timezone = 'UTC') {
  try {
    return DateTime.now().setZone(timezone).minus({ days: 1 }).toISODate();
  } catch {
    return DateTime.now().toUTC().minus({ days: 1 }).toISODate();
  }
}

/**
 * Compute which calendar day (1-based) a mission is on, using the user's timezone.
 * Returns -1 if mission not started.
 */
function computeDayNumber(mission, timezone = 'UTC') {
  if (!mission.startedAt) return -1;
  try {
    const start = DateTime.fromJSDate(mission.startedAt).setZone(timezone).startOf('day');
    const today = DateTime.now().setZone(timezone).startOf('day');
    const diff = Math.floor(today.diff(start, 'days').days);
    return diff + 1; // 1-based
  } catch {
    const msPerDay = 86400000;
    const startMs = new Date(mission.startedAt).setHours(0, 0, 0, 0);
    const todayMs = new Date().setHours(0, 0, 0, 0);
    return Math.floor((todayMs - startMs) / msPerDay) + 1;
  }
}

/**
 * Core streak updater — call this from proofController.
 * Mutates mission.analytics and legacy fields.
 * Returns { xpGain, milestoneHit }
 */
function applyCheckIn(mission, timezone = 'UTC') {
  const todayStr = getTodayStr(timezone);
  const yesterdayStr = getYesterdayStr(timezone);

  // Idempotent — don't double count
  if (mission.completedDays.includes(todayStr)) {
    return { xpGain: 0, milestoneHit: null, alreadyDone: true };
  }

  // Legacy
  mission.completedDays.push(todayStr);
  mission.lastCheckIn = new Date();

  // Streak logic
  const hadYesterday = mission.completedDays.includes(yesterdayStr);
  const newStreak = hadYesterday ? (mission.analytics.currentStreak || 0) + 1 : 1;

  mission.analytics.currentStreak = newStreak;
  mission.analytics.completedDays = (mission.analytics.completedDays || 0) + 1;
  if (newStreak > (mission.analytics.bestStreak || 0)) {
    mission.analytics.bestStreak = newStreak;
  }

  // Recalculate missed days
  const dayNumber = computeDayNumber(mission, timezone);
  const expectedCompleted = dayNumber;
  const actualCompleted = mission.analytics.completedDays;
  mission.analytics.missedDays = Math.max(0, expectedCompleted - actualCompleted);

  // Identity score
  mission.analytics.identityScore = computeIdentityScore(mission.analytics);

  // Legacy mirrors
  mission.currentDay = mission.analytics.completedDays;
  mission.streakCount = mission.analytics.currentStreak;
  mission.totalStreak = mission.analytics.bestStreak;

  // XP: base 20 + streak bonus
  const xpGain = 20 + Math.min(newStreak * 2, 60); // cap bonus at 60

  // Milestone check
  const milestoneHit = checkMilestone(mission.analytics.completedDays);

  // Check completion
  const totalDays = mission.durationDays || mission.totalDays || 30;
  if (mission.analytics.completedDays >= totalDays) {
    mission.status = 'completed';
    mission.isActive = false;
    mission.endDate = new Date();
  }

  return { xpGain, milestoneHit, alreadyDone: false };
}

/**
 * Apply a streak break (called by cron when a day is missed).
 * Mutates mission.analytics.
 */
function applyStreakBreak(mission) {
  if (mission.analytics.currentStreak > 0) {
    mission.analytics.missedDays = (mission.analytics.missedDays || 0) + 1;
    mission.analytics.currentStreak = 0;
    mission.streakCount = 0;
    mission.analytics.identityScore = computeIdentityScore(mission.analytics);
  }
}

/**
 * Identity score formula: 0-100
 * 80% completion ratio + 20% streak bonus (caps at 30-day streak)
 */
function computeIdentityScore(analytics) {
  const { completedDays = 0, missedDays = 0, currentStreak = 0 } = analytics;
  const total = completedDays + missedDays;
  if (total === 0) return 0;
  const completionRatio = completedDays / total;
  const streakBonus = Math.min(currentStreak / 30, 1);
  return Math.round(completionRatio * 80 + streakBonus * 20);
}

/**
 * Milestone days and their rewards
 */
const MILESTONES = [
  { day: 3,  label: 'First Spark 🔥',      xpBonus: 100,  badge: 'first_spark'   },
  { day: 7,  label: 'One Week Strong 💪',   xpBonus: 200,  badge: 'week_warrior'  },
  { day: 14, label: 'Fortnight Fighter ⚔️', xpBonus: 350,  badge: 'fortnight'     },
  { day: 21, label: 'Habit Formed 🧠',      xpBonus: 500,  badge: 'habit_formed'  },
  { day: 30, label: 'Legend 👑',            xpBonus: 1000, badge: 'legend_30'     },
  { day: 60, label: 'Diamond 💎',           xpBonus: 2000, badge: 'diamond_60'    },
  { day: 90, label: 'GOAT 🐐',             xpBonus: 5000, badge: 'goat_90'       },
];

function checkMilestone(completedDays) {
  return MILESTONES.find(m => m.day === completedDays) || null;
}

/**
 * Level title based on user level number
 */
function getLevelTitle(level) {
  if (level >= 20) return { title: 'GOAT 🐐',       color: '#FFD700' };
  if (level >= 15) return { title: 'Legend 👑',     color: '#FF6B35' };
  if (level >= 10) return { title: 'Champion 🏆',   color: '#BC13FE' };
  if (level >= 6)  return { title: 'Warrior ⚔️',    color: '#22C55E' };
  if (level >= 3)  return { title: 'Committed 🔥',  color: '#3B82F6' };
  return { title: 'Starter 🌱', color: '#6B7280' };
}

/**
 * Identity title based on identity score
 */
function getIdentityTitle(score) {
  if (score >= 81) return 'Legend';
  if (score >= 61) return 'Warrior';
  if (score >= 41) return 'Disciplined';
  if (score >= 21) return 'Committed';
  return 'Beginner';
}

module.exports = {
  getTodayStr, getYesterdayStr, computeDayNumber,
  applyCheckIn, applyStreakBreak, computeIdentityScore,
  checkMilestone, MILESTONES, getLevelTitle, getIdentityTitle,
};
