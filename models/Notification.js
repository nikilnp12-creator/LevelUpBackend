const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    toUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['follow_request', 'follow_accepted', 'like', 'comment'],
      required: true,
    },
    // Generic reference (post id for likes/comments, user id for follow)
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    referenceType: {
      type: String,
      enum: ['Post', 'User', null],
      default: null,
    },
    message: {
      type: String,
      default: '',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound index: quickly find unread notifications for a user
notificationSchema.index({ toUser: 1, isRead: 1, createdAt: -1 });

// Prevent duplicate like/comment notifications (optional dedup)
notificationSchema.index(
  { toUser: 1, fromUser: 1, type: 1, referenceId: 1 },
  { unique: false }
);

module.exports = mongoose.model('Notification', notificationSchema);
