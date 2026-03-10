const cron = require('node-cron');
const Mission = require('../models/Mission');
const User = require('../models/User');
const { applyStreakBreak, computeDayNumber, getTodayStr } = require('./streakUtils');

/**
 * Daily job — runs at 00:05 UTC every day.
 * Detects missions where no proof was uploaded yesterday,
 * resets streaks, increments missed days, and flags at_risk/failed.
 */
function startDailyMissedDayJob() {
  cron.schedule('5 0 * * *', async () => {
    console.log('[CRON] Running daily missed-day detection…');
    try {
      const activeMissions = await Mission.find({
        status: 'active',
        isDeleted: false,
        isLocked: true,
      }).populate('userId', 'timezone username');

      let processed = 0, streaksReset = 0, markedFailed = 0, markedAtRisk = 0;

      for (const mission of activeMissions) {
        const timezone = mission.userId?.timezone || 'UTC';
        const todayStr = getTodayStr(timezone);
        const dayNumber = computeDayNumber(mission, timezone);

        // If mission hasn't started yet or today is Day 1, skip
        if (dayNumber < 2) continue;

        // If user already uploaded today, skip
        if (mission.completedDays.includes(todayStr)) continue;

        // Check if there's a rest day declared for yesterday
        const { DateTime } = require('luxon');
        let tz = 'UTC';
        try { tz = timezone; } catch {}
        const yesterdayStr = DateTime.now().setZone(tz).minus({ days: 1 }).toISODate();
        if (mission.restDays && mission.restDays.includes(yesterdayStr)) continue;

        // Check if streak shield is active for yesterday
        if (mission.streakShieldActive && mission.shieldUsedDate === yesterdayStr) continue;

        // Calculate how many days have passed since last check-in
        const totalCompleted = mission.analytics.completedDays || 0;
        const expectedByNow = Math.max(0, dayNumber - 1); // days that should be done by yesterday
        if (totalCompleted >= expectedByNow) continue; // all caught up

        // Apply streak break
        applyStreakBreak(mission);

        // Check if mission should be marked failed
        const totalDays = mission.durationDays || mission.totalDays || 30;
        const missedDays = mission.analytics.missedDays || 0;
        const missedRatio = missedDays / totalDays;

        if (dayNumber > totalDays) {
          // Mission period ended — mark based on completion
          const completionRatio = totalCompleted / totalDays;
          mission.status = completionRatio >= 0.8 ? 'completed' : 'failed';
          mission.isActive = false;
          mission.endDate = new Date();
          markedFailed++;
        } else if (missedRatio > 0.4) {
          // More than 40% missed — mark failed
          mission.status = 'failed';
          mission.isActive = false;
          mission.endDate = new Date();
          markedFailed++;
        } else if (missedRatio > 0.2 || (mission.analytics.currentStreak === 0 && dayNumber > 3)) {
          mission.status = 'at_risk';
          markedAtRisk++;
        }

        await mission.save();
        processed++;
        if (mission.analytics.currentStreak === 0) streaksReset++;
      }

      console.log(`[CRON] Done. Processed: ${processed}, Streaks reset: ${streaksReset}, At-risk: ${markedAtRisk}, Failed: ${markedFailed}`);
    } catch (err) {
      console.error('[CRON] Daily missed-day job failed:', err);
    }
  }, { timezone: 'UTC' });

  console.log('✅ Daily missed-day cron scheduled (00:05 UTC)');
}

/**
 * Weekly job — runs every Sunday at 20:00 UTC.
 * Creates weekly summary data per user (stored on User model for in-app display).
 * In production, also trigger push notifications here via FCM.
 */
function startWeeklyWrapUpJob() {
  cron.schedule('0 20 * * 0', async () => {
    console.log('[CRON] Running weekly wrap-up…');
    try {
      const users = await User.find({ isActive: true }).select('_id');
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      for (const user of users) {
        const missions = await Mission.find({
          userId: user._id,
          status: { $in: ['active', 'completed'] },
          isDeleted: false,
          startedAt: { $lte: new Date() },
        });

        let weeklyCompleted = 0;
        let weeklyMissed = 0;
        let maxStreak = 0;

        for (const m of missions) {
          // Count check-ins in the past 7 days
          const recent = (m.completedDays || []).filter(d => {
            const date = new Date(d);
            return date >= weekAgo;
          });
          weeklyCompleted += recent.length;
          const expectedThisWeek = Math.min(7, computeDayNumber(m) - 1);
          weeklyMissed += Math.max(0, expectedThisWeek - recent.length);
          if (m.analytics.currentStreak > maxStreak) maxStreak = m.analytics.currentStreak;
        }

        const weeklyXp = weeklyCompleted * 22; // approx

        await User.findByIdAndUpdate(user._id, {
          'weeklyStats.completedDays': weeklyCompleted,
          'weeklyStats.missedDays': weeklyMissed,
          'weeklyStats.bestStreak': maxStreak,
          'weeklyStats.xpEarned': weeklyXp,
          'weeklyStats.generatedAt': new Date(),
        });
      }

      console.log(`[CRON] Weekly wrap-up done for ${users.length} users`);
    } catch (err) {
      console.error('[CRON] Weekly wrap-up failed:', err);
    }
  }, { timezone: 'UTC' });

  console.log('✅ Weekly wrap-up cron scheduled (Sun 20:00 UTC)');
}

/**
 * Hourly reminder job — checks users who set a reminder time and haven't uploaded yet.
 * In production, send FCM push here.
 */
function startReminderJob() {
  cron.schedule('0 * * * *', async () => {
    const nowHour = new Date().getUTCHours();
    try {
      const missions = await Mission.find({
        status: 'active',
        isDeleted: false,
        isLocked: true,
        reminderHour: nowHour,
      }).populate('userId', 'fcmToken timezone username');

      for (const mission of missions) {
        const timezone = mission.userId?.timezone || 'UTC';
        const todayStr = getTodayStr(timezone);
        if (!mission.completedDays.includes(todayStr)) {
          // TODO: send FCM push to mission.userId.fcmToken
          // "Hey! Don't forget to upload proof for ${mission.title} today 🔥"
          console.log(`[REMINDER] User ${mission.userId?.username} - Mission: ${mission.title}`);
        }
      }
    } catch (err) {
      console.error('[CRON] Reminder job failed:', err);
    }
  }, { timezone: 'UTC' });

  console.log('✅ Hourly reminder cron scheduled');
}

function initAllCronJobs() {
  startDailyMissedDayJob();
  startWeeklyWrapUpJob();
  startReminderJob();
}

module.exports = { initAllCronJobs };
