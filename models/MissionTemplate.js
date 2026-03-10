const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, required: true },
    emoji: { type: String, default: '🎯' },
    durationDays: { type: Number, default: 30 },
    proofType: { type: String, enum: ['photo', 'video', 'text', 'any'], default: 'photo' },
    dailyChecklist: [{ type: String }],
    usageCount: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

templateSchema.index({ category: 1, usageCount: -1 });

module.exports = mongoose.model('MissionTemplate', templateSchema);
