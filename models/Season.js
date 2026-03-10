// backend/models/Season.js
const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalCheckins:{ type: Number, default: 0 },
  totalStreak:  { type: Number, default: 0 },
  xpEarned:     { type: Number, default: 0 },
  joinedAt:     { type: Date, default: Date.now },
}, { _id: false });

const seasonSchema = new mongoose.Schema({
  name:        { type: String, required: true },   // e.g. "The Discipline Season"
  theme:       { type: String, default: '' },
  emoji:       { type: String, default: '🏆' },
  description: { type: String, default: '' },
  number:      { type: Number, default: 1 },
  startDate:   { type: Date, required: true },
  endDate:     { type: Date, required: true },
  isActive:    { type: Boolean, default: false },
  participants:{ type: [participantSchema], default: [] },
  topBadge:    { type: String, default: '👑' },    // badge for top finishers
  rewards: {
    top1:   { type: String, default: 'Season Champion' },
    top3:   { type: String, default: 'Top 3 Finisher' },
    top10:  { type: String, default: 'Top 10 Finisher' },
    joined: { type: String, default: 'Season Participant' },
  },
}, { timestamps: true });

// Virtual: days remaining
seasonSchema.virtual('daysRemaining').get(function () {
  if (!this.isActive) return 0;
  return Math.max(0, Math.ceil((this.endDate - Date.now()) / 86400000));
});

// Virtual: total participants count
seasonSchema.virtual('participantCount').get(function () {
  return this.participants.length;
});

seasonSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Season', seasonSchema);
