const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username:  String,
  profileImageUrl: { type: String, default: null },
  text:      { type: String, maxlength: 300 },
  likes:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
});

const commentSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username:  String,
  profileImageUrl: { type: String, default: null },
  text:      { type: String, maxlength: 300 },
  likes:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  replies:   [replySchema],
  createdAt: { type: Date, default: Date.now },
});

const postSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    missionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mission',
      default: null,
    },
    squadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Squad',
      default: null,
    },
    caption: {
      type: String,
      maxlength: [500, 'Caption cannot exceed 500 characters'],
      default: '',
    },
    mediaUrl:       { type: String, default: null },
    mediaPublicId:  { type: String, default: null },
    mediaType:      { type: String, enum: ['image', 'video', null], default: null },
    mediaWidth:     { type: Number, default: null },
    mediaHeight:    { type: Number, default: null },
    thumbnailUrl:   { type: String, default: null },
    missionDay:     { type: Number, required: true },
    visibility: {
      type: String,
      enum: ['public', 'squad', 'private'],
      default: 'public',
    },
    likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [commentSchema],
  },
  { timestamps: true }
);

postSchema.virtual('likesCount').get(function () { return this.likes.length; });
postSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Post', postSchema);
