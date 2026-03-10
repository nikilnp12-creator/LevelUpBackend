const mongoose = require('mongoose');

const REACTION_TYPES = ['fire', 'clap', 'strong', 'goat'];

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: REACTION_TYPES, required: true },
  createdAt: { type: Date, default: Date.now },
});

const commentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 200, trim: true },
  isDeleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const proofSchema = new mongoose.Schema(
  {
    missionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mission', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dayNumber: { type: Number, required: true },
    mediaUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    cloudinaryPublicId: { type: String, default: null },
    caption: { type: String, default: '', maxlength: 300 },
    meta: {
      size: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    reactions: [reactionSchema],
    comments: [commentSchema],
    flagged: { type: Boolean, default: false },
    moderation: {
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      reason: { type: String, default: '' },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

proofSchema.index({ missionId: 1, dayNumber: 1 });
proofSchema.index({ flagged: 1, 'moderation.status': 1 });
proofSchema.index({ userId: 1, createdAt: -1 });

// Virtual: reaction counts grouped by type
proofSchema.virtual('reactionCounts').get(function () {
  const counts = { fire: 0, clap: 0, strong: 0, goat: 0 };
  for (const r of this.reactions) if (counts[r.type] !== undefined) counts[r.type]++;
  return counts;
});

proofSchema.virtual('totalReactions').get(function () {
  return this.reactions.length;
});

proofSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Proof', proofSchema);
module.exports.REACTION_TYPES = REACTION_TYPES;
