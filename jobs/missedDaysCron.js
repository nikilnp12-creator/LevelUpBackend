/**
 * missedDaysCron.js
 * Runs daily at midnight UTC.
 * - Detects missions with missed days
 * - Updates at_risk / failed status
 * - Resets streaks for missed days
 * - Grants weekly shields on Mondays
 */
const cron = require('node-cron');
const Mission = require('../models/Mission');
const User = require('../models/User');

async function runMissedDaysCheck() {
  console.log('[CRON] Running missed-days check...');
  try {
    const activeMissions = await Mission.find({
      status: { $in: ['active', 'at_risk'] },
      isDeleted: false,
      isLocked: true,
    });

    let processed = 0;
    const now = new Date();
    const isMonday = now.getUTCDay() === 1;

    for (const mission of activeMissions) {
      try {
        const tz = mission.timezone || 'UTC';
        const todayDayNumber = mission.computeDayNumber(tz);
        if (todayDayNumber < 1) continue;

        const lastProofDay = mission.analytics.lastProofDay || 0;
        const expectedCompletedByNow = todayDayNumber - 1; // yesterday

        // Grant weekly shield on Mondays
        if (isMonday) mission.grantWeeklyShieldIfDue();

        if (lastProofDay < expectedCompletedByNow) {
          // There are missed days
          const missed = expectedCompletedByNow - lastProofDay;
          const todayStr = mission.todayString(tz);

          // Don't count rest days as missed
          const restDaysMissed = (mission.restDays || []).filter(d => {
            const dateObj = new Date(d);
            const daysSinceStart = Math.floor((dateObj - new Date(mission.startedAt)) / 86400000) + 1;
            return daysSinceStart > lastProofDay && daysSinceStart <= expectedCompletedByNow;
          }).length;

          const actualMissed = Math.max(0, missed - restDaysMissed);
          if (actualMissed > 0) {
            mission.analytics.missedDays += actualMissed;
            mission.analytics.currentStreak = 0;
            mission.analytics.identityScore = mission.computeIdentityScore();
            mission.streakCount = 0;
          }

          // at_risk: missed 2+ consecutive days
          const consecutiveMissed = todayDayNumber - lastProofDay - 1;
          if (consecutiveMissed >= 2 && mission.status === 'active') {
            mission.status = 'at_risk';
          }

          // failed: over half of days missed
          const failRatio = mission.analytics.missedDays / mission.durationDays;
          if (failRatio > 0.5 && mission.status !== 'completed') {
            mission.status = 'failed';
            mission.isActive = false;
          }
        }

        // Check if mission duration ended
        if (todayDayNumber > mission.durationDays && mission.status !== 'completed') {
          if (mission.analytics.completedDays < Math.ceil(mission.durationDays * 0.5)) {
            mission.status = 'failed';
            mission.isActive = false;
          }
        }

        await mission.save();
        processed++;
      } catch (mErr) {
        console.error(`[CRON] Error processing mission ${mission._id}:`, mErr.message);
      }
    }

    console.log(`[CRON] Processed ${processed}/${activeMissions.length} missions.`);
  } catch (err) {
    console.error('[CRON] missedDaysCheck failed:', err);
  }
}

function startCronJobs() {
  // Every day at midnight UTC
  cron.schedule('0 0 * * *', runMissedDaysCheck, { timezone: 'UTC' });

  // Run immediately on startup to catch up
  setTimeout(runMissedDaysCheck, 5000);

  console.log('✅ Cron jobs started');
}

module.exports = { startCronJobs, runMissedDaysCheck };
