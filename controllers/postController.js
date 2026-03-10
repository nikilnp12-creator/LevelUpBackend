const path = require('path');
const fs   = require('fs');
const Post = require('../models/Post');
const Mission = require('../models/Mission');
const User    = require('../models/User');
const Squad   = require('../models/Squad');
const streamifier = require('streamifier');

let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  cloudinary = require('../config/cloudinary');
}

const uploadToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err); else resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });

const saveLocally = (buffer, filename) => {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, buffer);
  const serverBase = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${serverBase}/uploads/${filename}`;
};

const enrichPosts = (posts, requesterId) =>
  posts.map((p) => ({
    ...p.toJSON(),
    user: p.userId,
    mission: p.missionId,
    likesCount: p.likes.length,
    commentsCount: p.comments.length,
    isLiked: p.likes.some((id) => id.toString() === requesterId.toString()),
  }));

// ─── @GET /api/posts/feed ─────────────────────────────────────────────────────
const getFeed = async (req, res) => {
  try {
    const user   = await User.findById(req.user._id);
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(10, parseInt(req.query.limit) || 3);
    const skip   = (page - 1) * limit;
    const mode   = req.query.mode   || 'normal';
    const filter = req.query.filter || 'all';

    const visibilityFilter = {
      $or: [
        { visibility: 'public' },
        { visibility: 'squad', squadId: { $in: user.squadIds || [] } },
      ],
    };
    const modeFilter = mode === 'proofs' ? { mediaUrl: { $ne: null } } : {};
    let followedFilter = {};
    if (filter === 'followed') {
      let followingIds = (user.following || []).map((id) => id);
      if (followingIds.length === 0 && (user.squadIds || []).length > 0) {
        const squads = await Squad.find({ _id: { $in: user.squadIds }, isActive: true });
        const memberIds = [];
        squads.forEach((s) => s.members.forEach((m) => {
          const uid = (m.userId?._id || m.userId).toString();
          if (uid !== req.user._id.toString()) memberIds.push(m.userId?._id || m.userId);
        }));
        followingIds = memberIds;
      }
      followedFilter = { userId: { $in: followingIds } };
    }

    const baseMatch = { ...visibilityFilter, ...modeFilter, ...followedFilter };

    if (filter === 'random') {
      const pipeline = [
        { $match: baseMatch },
        { $sample: { size: limit } },
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: '_userArr',
            pipeline: [{ $project: { username: 1, profileImageUrl: 1, level: 1, totalStreak: 1 } }] } },
        { $lookup: { from: 'missions', localField: 'missionId', foreignField: '_id', as: '_missionArr',
            pipeline: [{ $project: { title: 1, emoji: 1, currentDay: 1, streakCount: 1 } }] } },
        { $addFields: {
            userId: { $arrayElemAt: ['$_userArr', 0] },
            missionId: { $arrayElemAt: ['$_missionArr', 0] },
            likesCount: { $size: { $ifNull: ['$likes', []] } },
            commentsCount: { $size: { $ifNull: ['$comments', []] } },
            isLiked: { $in: [req.user._id, { $ifNull: ['$likes', []] }] },
          } },
        { $project: { _userArr: 0, _missionArr: 0 } },
      ];
      const posts = await Post.aggregate(pipeline);
      const enriched = posts.map((p) => ({ ...p, id: p._id, user: p.userId, mission: p.missionId }));
      return res.status(200).json({ success: true, posts: enriched, page, limit, total: enriched.length });
    }

    const [posts, total] = await Promise.all([
      Post.find(baseMatch).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .populate('userId', 'username profileImageUrl level totalStreak')
        .populate('missionId', 'title emoji currentDay streakCount'),
      Post.countDocuments(baseMatch),
    ]);
    const enriched = enrichPosts(posts, req.user._id);
    res.status(200).json({ success: true, posts: enriched, page, limit, total });
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch feed.' });
  }
};

const _getSquadFeed = async (req, res, squadId) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(10, parseInt(req.query.limit) || 3);
    const skip  = (page - 1) * limit;
    const filter = { squadId, visibility: { $ne: 'private' } };
    const [posts, total] = await Promise.all([
      Post.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .populate('userId', 'username profileImageUrl level totalStreak')
        .populate('missionId', 'title emoji currentDay streakCount'),
      Post.countDocuments(filter),
    ]);
    const enriched = enrichPosts(posts, req.user._id);
    res.status(200).json({ success: true, posts: enriched, page, limit, total });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch squad feed.' });
  }
};

const getSquadFeed = (req, res) => _getSquadFeed(req, res, req.params.squadId);
const getSquadFeedById = (req, res) => _getSquadFeed(req, res, req.params.id);

const getMyPosts = async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.user._id }).sort({ createdAt: -1 })
      .populate('userId', 'username profileImageUrl level totalStreak')
      .populate('missionId', 'title emoji currentDay streakCount');
    const enriched = enrichPosts(posts, req.user._id);
    res.status(200).json({ success: true, posts: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch your posts.' });
  }
};

const _createAndRespond = async (req, res, mediaUrl, mediaPublicId, mediaType, mediaWidth = null, mediaHeight = null, thumbnailUrl = null) => {
  const missionId  = req.body?.missionId || null;
  const caption    = req.body?.caption || '';
  const visibility = req.body?.visibility || 'public';

  let mission = null;
  if (missionId && missionId.toString().trim() !== '') {
    mission = await Mission.findOne({ _id: missionId.toString().trim(), userId: req.user._id });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
  }

  try {
    const post = await Post.create({
      userId: req.user._id, missionId: mission ? mission._id : null,
      squadId: mission?.squadId || null, caption,
      mediaUrl: mediaUrl || null, mediaPublicId: mediaPublicId || null,
      mediaType: mediaType || null, mediaWidth: mediaWidth || null,
      mediaHeight: mediaHeight || null, thumbnailUrl: thumbnailUrl || null,
      missionDay: mission ? mission.currentDay + 1 : 0,
      visibility: visibility || (mission?.visibility ?? 'public'),
    });

    let xpGained = 0, updatedMission = null;
    if (mission && !mission.isTodayDone()) {
      await mission.checkIn();
      const user = await User.findById(req.user._id);
      xpGained = 20 + (mission.streakCount > 1 ? mission.streakCount * 2 : 0);
      await user.addXP(xpGained);
      if (mission.streakCount > user.totalStreak) {
        user.totalStreak = mission.streakCount;
        await user.save();
      }
      updatedMission = await Mission.findById(mission._id);
    } else if (mission) {
      updatedMission = mission;
    }

    const populated = await Post.findById(post._id)
      .populate('userId', 'username profileImageUrl level totalStreak')
      .populate('missionId', 'title emoji currentDay streakCount');
    const postObj = populated.toJSON();

    res.status(201).json({
      success: true,
      post: { ...postObj, user: postObj.userId, mission: postObj.missionId, likesCount: 0, commentsCount: 0, isLiked: false },
      mission: updatedMission, xpGained,
      message: updatedMission
        ? (updatedMission.isActive ? `Day ${updatedMission.currentDay} complete! +${xpGained} XP 🔥` : '🏆 MISSION COMPLETE! You did it!')
        : 'Post created! 🎉',
      missionCompleted: updatedMission ? !updatedMission.isActive : false,
    });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ success: false, message: 'Could not create post.' });
  }
};

const createPostWithMedia = async (req, res) => {
  let mediaUrl = null, mediaPublicId = null, mediaType = null;
  let mediaWidth = null, mediaHeight = null, thumbnailUrl = null;

  if (req.file) {
    const isVideo = req.file.mimetype.startsWith('video/');
    if (cloudinary) {
      try {
        const uploadOptions = {
          folder: `level_up/posts/${req.user._id}`,
          resource_type: isVideo ? 'video' : 'image',
          quality: 'auto:good',
        };
        if (isVideo) {
          uploadOptions.eager = [{ format: 'jpg', transformation: [
            { width: 800, crop: 'limit' },
            { fetch_format: 'jpg', quality: 'auto:good', start_offset: 'auto' },
          ]}];
          uploadOptions.eager_async = false;
        }
        const result = await uploadToCloudinary(req.file.buffer, uploadOptions);
        mediaUrl = result.secure_url; mediaPublicId = result.public_id;
        mediaType = isVideo ? 'video' : 'image';
        mediaWidth = result.width || null; mediaHeight = result.height || null;
        if (isVideo && result.eager && result.eager[0]?.secure_url) {
          thumbnailUrl = result.eager[0].secure_url;
        }
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({ success: false, message: 'Media upload failed.' });
      }
    } else {
      const ext = (req.file.originalname || '').split('.').pop() || (req.file.mimetype.startsWith('video/') ? 'mp4' : 'jpg');
      const filename = `${req.user._id}_${Date.now()}.${ext}`;
      mediaUrl = saveLocally(req.file.buffer, filename);
      mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    }
  }
  await _createAndRespond(req, res, mediaUrl, mediaPublicId, mediaType, mediaWidth, mediaHeight, thumbnailUrl);
};

const createPost = createPostWithMedia;

// ─── @POST /api/posts/:id/like ────────────────────────────────────────────────
const toggleLike = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const userId = req.user._id;
    const alreadyLiked = post.likes.some((id) => id.toString() === userId.toString());
    if (alreadyLiked) {
      post.likes = post.likes.filter((id) => id.toString() !== userId.toString());
    } else {
      post.likes.push(userId);
      try {
        const { createNotification } = require('./notificationController');
        createNotification({ toUserId: post.userId, fromUserId: userId, type: 'like',
          referenceId: post._id, referenceType: 'Post', message: 'liked your post' });
      } catch (_) {}
    }
    await post.save();
    res.status(200).json({ success: true, likesCount: post.likes.length, isLiked: !alreadyLiked });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not toggle like.' });
  }
};

// ─── @GET /api/posts/:id/comments ─────────────────────────────────────────────
const getComments = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    const requesterId = req.user._id.toString();
    const post = await Post.findById(req.params.id).select('comments');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const comments = post.comments.map((c) => ({
      _id: c._id,
      userId: c.userId,
      username: c.username,
      profileImageUrl: c.profileImageUrl || null,
      text: c.text,
      likesCount: (c.likes || []).length,
      isLiked: (c.likes || []).some((id) => id.toString() === requesterId),
      replies: (c.replies || []).map((r) => ({
        _id: r._id,
        userId: r.userId,
        username: r.username,
        profileImageUrl: r.profileImageUrl || null,
        text: r.text,
        likesCount: (r.likes || []).length,
        isLiked: (r.likes || []).some((id) => id.toString() === requesterId),
        createdAt: r.createdAt,
      })),
      createdAt: c.createdAt,
    }));
    res.status(200).json({ success: true, comments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch comments.' });
  }
};

// ─── @POST /api/posts/:id/comment ─────────────────────────────────────────────
const addComment = async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, message: 'Comment text is required.' });

  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const user = await User.findById(req.user._id);
    const newComment = {
      userId: req.user._id,
      username: user.username,
      profileImageUrl: user.profileImageUrl || null,
      text: text.trim(),
      likes: [],
      replies: [],
    };
    post.comments.push(newComment);
    await post.save();

    try {
      const { createNotification } = require('./notificationController');
      createNotification({ toUserId: post.userId, fromUserId: req.user._id, type: 'comment',
        referenceId: post._id, referenceType: 'Post', message: `commented: "${text.trim().substring(0, 50)}"` });
    } catch (_) {}

    const saved = post.comments[post.comments.length - 1];
    res.status(201).json({
      success: true, commentsCount: post.comments.length,
      comment: {
        _id: saved._id, userId: req.user._id, username: user.username,
        profileImageUrl: user.profileImageUrl || null,
        text: saved.text, likesCount: 0, isLiked: false, replies: [], createdAt: saved.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not add comment.' });
  }
};

// ─── @POST /api/posts/:id/comments/:commentId/like ────────────────────────────
const toggleCommentLike = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.commentId))
      return res.status(400).json({ success: false, message: 'Invalid ID.' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });

    const userId = req.user._id;
    const alreadyLiked = comment.likes.some((id) => id.toString() === userId.toString());
    if (alreadyLiked) {
      comment.likes = comment.likes.filter((id) => id.toString() !== userId.toString());
    } else {
      comment.likes.push(userId);
    }
    await post.save();
    res.status(200).json({ success: true, likesCount: comment.likes.length, isLiked: !alreadyLiked });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not toggle comment like.' });
  }
};

// ─── @DELETE /api/posts/:id/comments/:commentId ────────────────────────────────
const deleteComment = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.commentId))
      return res.status(400).json({ success: false, message: 'Invalid ID.' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });

    const isOwner = comment.userId.toString() === req.user._id.toString();
    const isPostOwner = post.userId.toString() === req.user._id.toString();
    if (!isOwner && !isPostOwner)
      return res.status(403).json({ success: false, message: 'Not allowed.' });

    post.comments.pull(req.params.commentId);
    await post.save();
    res.status(200).json({ success: true, commentsCount: post.comments.length });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not delete comment.' });
  }
};

// ─── @POST /api/posts/:id/comments/:commentId/reply ───────────────────────────
const replyToComment = async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, message: 'Reply text is required.' });

  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.commentId))
      return res.status(400).json({ success: false, message: 'Invalid ID.' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });

    const user = await User.findById(req.user._id);
    comment.replies.push({
      userId: req.user._id, username: user.username,
      profileImageUrl: user.profileImageUrl || null,
      text: text.trim(), likes: [],
    });
    await post.save();

    const saved = comment.replies[comment.replies.length - 1];
    res.status(201).json({
      success: true,
      reply: {
        _id: saved._id, userId: req.user._id, username: user.username,
        profileImageUrl: user.profileImageUrl || null,
        text: saved.text, likesCount: 0, isLiked: false, createdAt: saved.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not add reply.' });
  }
};

// ─── @POST /api/posts/:id/comments/:commentId/replies/:replyId/like ──────────
const toggleReplyLike = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ success: false, message: 'Reply not found.' });

    const userId = req.user._id;
    const alreadyLiked = reply.likes.some((id) => id.toString() === userId.toString());
    if (alreadyLiked) {
      reply.likes = reply.likes.filter((id) => id.toString() !== userId.toString());
    } else {
      reply.likes.push(userId);
    }
    await post.save();
    res.status(200).json({ success: true, likesCount: reply.likes.length, isLiked: !alreadyLiked });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not toggle reply like.' });
  }
};

// ─── @POST /api/posts/:id/react ───────────────────────────────────────────────
// Toggle an emoji reaction (🔥👏💪🐐❤️😮). One reaction type per user per post.
const toggleReaction = async (req, res) => {
  const { emoji } = req.body;
  const VALID = ['🔥', '👏', '💪', '🐐', '❤️', '😮'];
  if (!emoji || !VALID.includes(emoji))
    return res.status(400).json({ success: false, message: `Invalid emoji. Allowed: ${VALID.join(' ')}` });

  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const userId = req.user._id.toString();
    const existingIdx = (post.reactions || []).findIndex(r => r.userId.toString() === userId);

    if (existingIdx >= 0) {
      const existing = post.reactions[existingIdx];
      if (existing.emoji === emoji) {
        // Same emoji — remove reaction (toggle off)
        post.reactions.splice(existingIdx, 1);
      } else {
        // Different emoji — replace
        post.reactions[existingIdx].emoji = emoji;
      }
    } else {
      // New reaction
      if (!post.reactions) post.reactions = [];
      post.reactions.push({ userId: req.user._id, emoji });
    }

    await post.save();

    // Build summary
    const summary = {};
    for (const r of post.reactions) {
      summary[r.emoji] = (summary[r.emoji] || 0) + 1;
    }
    const userReaction = (post.reactions || []).find(r => r.userId.toString() === userId)?.emoji || null;

    res.status(200).json({
      success: true,
      reactionsCount: post.reactions.length,
      reactionSummary: summary,
      userReaction,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not toggle reaction.' });
  }
};

// ─── @GET /api/posts/:id/reactions ───────────────────────────────────────────
const getReactions = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .select('reactions')
      .populate('reactions.userId', 'username profileImageUrl');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    res.status(200).json({ success: true, reactions: post.reactions || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch reactions.' });
  }
};


// ── Today's upload stats (for home screen counter) ────────────────────────────
const getTodayStats = async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const Post = require('../models/Post');
    const count = await Post.countDocuments({ createdAt: { $gte: startOfDay } });
    res.json({ success: true, todayUploads: count });
  } catch (err) {
    res.status(500).json({ success: false, todayUploads: 0 });
  }
};

module.exports = {
  getFeed, getSquadFeed, getSquadFeedById, getMyPosts,
  createPost, createPostWithMedia, toggleLike,
  getComments, addComment, toggleCommentLike, deleteComment,
  replyToComment, toggleReplyLike,
  toggleReaction, getReactions,
  getTodayStats,
};
