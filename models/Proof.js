const mongoose = require('mongoose');

/**
 * Proof – one daily check-in submission for a mission.
 * dayNumber is computed server-side from mission.startDate; never trusted from client.
 */
const proofSchema = new mongoose.Schema(
  {
    missionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mission',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    dayNumber: { type: Number, required: true }, // 1-based, server-computed
    mediaUrl: { type: String, required: true },   // Cloudinary secure URL
    thumbnailUrl: { type: String, default: null },
    cloudinaryPublicId: { type: String, default: null },
    meta: {
      size: { type: Number, default: 0 },         // bytes
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    flagged: { type: Boolean, default: false },
    moderation: {
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
      },
      reason: { type: String, default: '' },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Compound index: one proof per mission per day (enforced at app level too)
proofSchema.index({ missionId: 1, dayNumber: 1 });
// For moderation queries
proofSchema.index({ flagged: 1, 'moderation.status': 1 });

module.exports = mongoose.model('Proof', proofSchema);
