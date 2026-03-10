// backend/services/pushNotifications.js
// Social-aware push notification copy
// Uses FCM token stored on User model

const getSocialCopy = (type, data = {}) => {
  const copies = {
    daily_reminder_squad: [
      `${data.squadMate || 'Your squad mate'} just uploaded Day ${data.day || '?'} proof. You're the only one left today.`,
      `${data.squadMate || 'Someone'} showed up. Will you?`,
      `Your squad is watching. Day ${data.day || '?'} proof still needed.`,
    ],
    daily_reminder_solo: [
      `Your streak is at ${data.streak || 0} days. Don't break it today.`,
      `Day ${data.day || '?'} is waiting. Upload your proof before midnight.`,
      `${data.streak || 0}-day streak on the line. Show up.`,
    ],
    at_risk: [
      `Your mission is at risk ⚠️. Upload today or your streak resets.`,
      `${data.missionTitle || 'Your mission'} is at risk. One proof saves everything.`,
    ],
    milestone: [
      `🎉 Day ${data.day}! You've hit a milestone. The squad is watching.`,
      `${data.day}-day milestone unlocked 🏆 Keep going.`,
    ],
    squad_upload: [
      `${data.username || 'A squad mate'} just uploaded their Day ${data.day || '?'} proof.`,
      `${data.username || 'Someone'} in your squad is grinding. Don't fall behind.`,
    ],
    comeback: [
      `It's been ${data.days || 'a few'} days. Your squad still has a slot for you.`,
      `You've done it before. Start your comeback now.`,
    ],
  };

  const options = copies[type] || [`Level update: ${type}`];
  return options[Math.floor(Math.random() * options.length)];
};

// Send a single FCM push (fire and forget)
async function sendPush(fcmToken, title, body, data = {}) {
  if (!fcmToken || !process.env.FCM_SERVER_KEY) return;
  try {
    const fetch = require('node-fetch');
    await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${process.env.FCM_SERVER_KEY}`,
      },
      body: JSON.stringify({
        to: fcmToken,
        notification: { title, body, sound: 'default' },
        data,
      }),
    });
  } catch (err) {
    console.error('Push error:', err.message);
  }
}

// Notify all squad members that someone uploaded (social pressure copy)
async function notifySquadUpload(uploadedUser, squadMembers, missionDay) {
  const body = getSocialCopy('squad_upload', { username: uploadedUser.username, day: missionDay });
  for (const member of squadMembers) {
    if (member._id?.toString() === uploadedUser._id?.toString()) continue;
    if (member.fcmToken && member.notificationSettings?.socialActivity !== false) {
      await sendPush(member.fcmToken, 'Squad activity 👀', body, { type: 'squad_upload' });
    }
  }
}

// Daily reminder — squad-aware copy
async function sendDailyReminder(user, squadMate, streak, day, missionTitle) {
  if (!user.fcmToken) return;
  if (user.notificationSettings?.dailyReminder === false) return;

  const type = squadMate ? 'daily_reminder_squad' : 'daily_reminder_solo';
  const body = getSocialCopy(type, { squadMate: squadMate?.username, streak, day });
  await sendPush(user.fcmToken, 'Time to show up ⚡', body, { type: 'daily_reminder', missionTitle });
}

module.exports = { sendPush, notifySquadUpload, sendDailyReminder, getSocialCopy };
