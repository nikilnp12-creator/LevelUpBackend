const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  joinedAt: { type: Date, default: Date.now },
  completedDays: { type: Number, default: 0 },
  currentStreak: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 },
  lastProofAt: { type: Date, default: null },
  proofDays: [{ type: String }], // 'YYYY-MM-DD'
});

const challengeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 500 },
    emoji: { type: String, default: '🏆' },
    category: { type: String, default: 'Custom' },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    durationDays: { type: Number, required: true, min: 3, max: 90 },
    maxParticipants: { type: Number, default: 500 },
    proofType: { type: String, enum: ['photo', 'video', 'text', 'any'], default: 'photo' },
    rules: { type: String, default: '', maxlength: 500 },
    participants: [participantSchema],
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    visibility: { type: String, enum: ['public', 'squad'], default: 'public' },
    squadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', default: null },
  },
  { timestamps: true }
);

challengeSchema.virtual('participantCount').get(function () {
  return this.participants.length;
});

challengeSchema.methods.isUserParticipant = function (userId) {
  return this.participants.some(p => p.userId.toString() === userId.toString());
};

challengeSchema.methods.getParticipant = function (userId) {
  return this.participants.find(p => p.userId.toString() === userId.toString());
};

challengeSchema.methods.computeDayNumber = function () {
  if (!this.startDate) return -1;
  const msPerDay = 86400000;
  const start = new Date(this.startDate);
  const startMid = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const now = new Date();
  const nowMid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((nowMid - startMid) / msPerDay) + 1;
};

challengeSchema.set('toJSON', { virtuals: true });
challengeSchema.index({ isActive: 1, isFeatured: -1, startDate: -1 });
challengeSchema.index({ creatorId: 1 });

module.exports = mongoose.model('Challenge', challengeSchema);
