const mongoose = require('mongoose');

const joinRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  requestedAt: { type: Date, default: Date.now },
});

const squadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Squad name is required'],
      trim: true,
      maxlength: [50, 'Squad name cannot exceed 50 characters'],
    },
    description: { type: String, maxlength: 300, default: '' },
    emoji: { type: String, default: '⚡' },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        joinedAt: { type: Date, default: Date.now },
        role: { type: String, enum: ['admin', 'member'], default: 'member' },
      },
    ],
    joinRequests: [joinRequestSchema],
    inviteCode: {
      type: String,
      unique: true,
      default: () => Math.random().toString(36).substring(2, 8).toUpperCase(),
    },
    maxMembers: { type: Number, default: 20 },
    isPublic: { type: Boolean, default: true },  // public = discoverable/searchable
    isActive: { type: Boolean, default: true },
    tags: [{ type: String, trim: true, lowercase: true }],  // goal/identity tags for auto-matching
  },
  { timestamps: true }
);

squadSchema.virtual('memberCount').get(function () {
  return this.members.length;
});
squadSchema.virtual('pendingRequestCount').get(function () {
  return (this.joinRequests || []).filter(r => r.status === 'pending').length;
});

squadSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Squad', squadSchema);
