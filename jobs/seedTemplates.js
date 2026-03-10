const MissionTemplate = require('../models/MissionTemplate');

const TEMPLATES = [
  { title: 'Daily Gym Workout', category: 'Get Fit', emoji: '💪', durationDays: 30, proofType: 'photo', isFeatured: true,
    description: 'Show up to the gym every single day for 30 days', dailyChecklist: ['Complete 30 min workout', 'Take progress photo', 'Log water intake'] },
  { title: 'Morning Run 5km', category: 'Get Fit', emoji: '🏃', durationDays: 21, proofType: 'photo', isFeatured: true,
    description: 'Run 5km every morning before 8am', dailyChecklist: ['Complete 5km run', 'Track time and distance', 'Stretch for 10 mins'] },
  { title: 'Wake Up at 5am', category: 'Wake Up Early', emoji: '🌅', durationDays: 30, proofType: 'photo', isFeatured: true,
    description: 'Transform your mornings with a 5am wakeup challenge', dailyChecklist: ['Wake up by 5am', 'Take selfie as proof', 'Plan top 3 tasks for the day'] },
  { title: 'Read 20 Pages Daily', category: 'Study Discipline', emoji: '📚', durationDays: 30, proofType: 'photo', isFeatured: true,
    description: 'Build a daily reading habit that sticks', dailyChecklist: ['Read 20 pages', 'Write one key takeaway', 'Update reading log'] },
  { title: 'No Social Media', category: 'Study Discipline', emoji: '📵', durationDays: 7, proofType: 'text', isFeatured: false,
    description: 'Detox from social media for a full week', dailyChecklist: ['No scrolling after waking up', 'Write what you did instead', 'Journal 5 mins'] },
  { title: 'Build & Ship MVP', category: 'Launch Project', emoji: '🚀', durationDays: 30, proofType: 'photo', isFeatured: true,
    description: 'Code every day and ship your MVP', dailyChecklist: ['Code for min 1 hour', 'Push at least one commit', 'Share progress screenshot'] },
  { title: 'Save Money Daily', category: 'Earn Money', emoji: '💰', durationDays: 30, proofType: 'text', isFeatured: false,
    description: 'Build the habit of saving every single day', dailyChecklist: ['Track all expenses', 'Transfer savings amount', 'No impulse purchases'] },
  { title: 'Post Content Daily', category: 'Create Content', emoji: '📱', durationDays: 30, proofType: 'photo', isFeatured: true,
    description: 'Grow your audience by posting every day', dailyChecklist: ['Create one piece of content', 'Post to your platform', 'Engage with 5 comments'] },
];

async function seedTemplates() {
  const count = await MissionTemplate.countDocuments();
  if (count === 0) {
    await MissionTemplate.insertMany(TEMPLATES);
    console.log('✅ Mission templates seeded');
  }
}

module.exports = seedTemplates;
