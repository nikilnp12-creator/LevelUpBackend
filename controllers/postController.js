const path = require('path');
const fs = require('fs');
const Post = require('../models/Post');
const Mission = require('../models/Mission');
const User = require('../models/User');
const Squad = require('../models/Squad');
const streamifier = require('streamifier');

// Cloudinary is optional
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

// ─── Helper: save buffer locally as fallback ──────────────────────────────────
const saveLocally = (buffer, filename) => {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, buffer);
  const serverBase = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${serverBase}/uploads/${filename}`;
};

// ─── Helper: build enriched post list ────────────────────────────────────────
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
        squads.forEach((s) =>
          s.members.forEach((m) => {
            const uid = (m.userId?._id || m.userId).toString();
            if (uid !== req.user._id.toString()) memberIds.push(m.userId?._id || m.userId);
          })
        );
        followingIds = memberIds;
      }
      followedFilter = { userId: { $in: followingIds } };
    }

    const baseMatch = { ...visibilityFilter, ...modeFilter, ...followedFilter };

    // filter=random: use $sample aggregation
    if (filter === 'random') {
      const pipeline = [
        { $match: baseMatch },
        { $sample: { size: limit } },
        {
          $lookup: {
            from: 'users', localField: 'userId', foreignField: '_id', as: '_userArr',
            pipeline: [{ $project: { username: 1, profileImageUrl: 1, level: 1, totalStreak: 1 } }],
          },
        },
        {
          $lookup: {
            from: 'missions', localField: 'missionId', foreignField: '_id', as: '_missionArr',
            pipeline: [{ $project: { title: 1, emoji: 1, currentDay: 1, streakCount: 1 } }],
          },
        },
        {
          $addFields: {
            userId: { $arrayElemAt: ['$_userArr', 0] },
            missionId: { $arrayElemAt: ['$_missionArr', 0] },
            likesCount: { $size: { $ifNull: ['$likes', []] } },
            commentsCount: { $size: { $ifNull: ['$comments', []] } },
            isLiked: { $in: [req.user._id, { $ifNull: ['$likes', []] }] },
          },
        },
        { $project: { _userArr: 0, _missionArr: 0 } },
      ];

      const posts = await Post.aggregate(pipeline);
      const enriched = posts.map((p) => ({ ...p, id: p._id, user: p.userId, mission: p.missionId }));
      return res.status(200).json({ success: true, posts: enriched, page, limit, total: enriched.length });
    }

    // Normal paginated query
    const [posts, total] = await Promise.all([
      Post.find(baseMatch)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
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

// ─── Squad feed (shared logic) ────────────────────────────────────────────────
const _getSquadFeed = async (req, res, squadId) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(10, parseInt(req.query.limit) || 3);
    const skip  = (page - 1) * limit;

    const filter = { squadId, visibility: { $ne: 'private' } };
    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
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

// Legacy route /api/posts/squad/:squadId
const getSquadFeed = (req, res) => _getSquadFeed(req, res, req.params.squadId);

// New route via squads /api/squads/:id/feed
const getSquadFeedById = (req, res) => _getSquadFeed(req, res, req.params.id);

// ─── @GET /api/posts/my ───────────────────────────────────────────────────────
const getMyPosts = async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('userId', 'username profileImageUrl level totalStreak')
      .populate('missionId', 'title emoji currentDay streakCount');
    const enriched = enrichPosts(posts, req.user._id);
    res.status(200).json({ success: true, posts: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch your posts.' });
  }
};

// ─── Core helper: validate mission, create post, trigger check-in ─────────────
const _createAndRespond = async (req, res, mediaUrl, mediaPublicId, mediaType, mediaWidth = null, mediaHeight = null, thumbnailUrl = null) => {
  const missionId  = req.body?.missionId || null;
  const caption    = req.body?.caption || '';
  const visibility = req.body?.visibility || 'public';

  let mission = null;
  if (missionId && missionId.toString().trim() !== '') {
    mission = await Mission.findOne({ _id: missionId.toString().trim(), userId: req.user._id });
    if (!mission) {
      return res.status(404).json({
        success: false,
        message: 'Mission not found. Make sure you selected your own active mission.',
      });
    }
  }

  try {
    const post = await Post.create({
      userId:         req.user._id,
      missionId:      mission ? mission._id : null,
      squadId:        mission?.squadId || null,
      caption,
      mediaUrl:       mediaUrl || null,
      mediaPublicId:  mediaPublicId || null,
      mediaType:      mediaType || null,
      mediaWidth:     mediaWidth || null,
      mediaHeight:    mediaHeight || null,
      thumbnailUrl:   thumbnailUrl || null,
      missionDay:     mission ? mission.currentDay + 1 : 0,
      visibility:     visibility || (mission?.visibility ?? 'public'),
    });

    let xpGained = 0;
    let updatedMission = null;

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
      post: {
        ...postObj,
        user: postObj.userId,
        mission: postObj.missionId,
        likesCount: 0,
        commentsCount: 0,
        isLiked: false,
      },
      mission: updatedMission,
      xpGained,
      message: updatedMission
        ? (updatedMission.isActive
            ? `Day ${updatedMission.currentDay} complete! +${xpGained} XP 🔥`
            : '🏆 MISSION COMPLETE! You did it!')
        : 'Post created! 🎉',
      missionCompleted: updatedMission ? !updatedMission.isActive : false,
    });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ success: false, message: 'Could not create post.' });
  }
};

// ─── @POST /api/posts ─────────────────────────────────────────────────────────
const createPostWithMedia = async (req, res) => {
  let mediaUrl      = null;
  let mediaPublicId = null;
  let mediaType     = null;
  let mediaWidth    = null;
  let mediaHeight   = null;
  let thumbnailUrl  = null;   // video poster frame (Cloudinary JPG)

  if (req.file) {
    const isVideo = req.file.mimetype.startsWith('video/');
    if (cloudinary) {
      try {
        const uploadOptions = {
          folder:        `level_up/posts/${req.user._id}`,
          resource_type: isVideo ? 'video' : 'image',
          quality:       'auto:good',
        };

        // For videos: request an eager poster frame (JPG, 800px wide, auto-chosen second).
        // eager_async:false means the thumbnail is available in this same response — no extra request.
        if (isVideo) {
          uploadOptions.eager = [{
            format: 'jpg',
            transformation: [
              { width: 800, crop: 'limit' },
              { fetch_format: 'jpg', quality: 'auto:good', start_offset: 'auto' },
            ],
          }];
          uploadOptions.eager_async = false;
        }

        const result  = await uploadToCloudinary(req.file.buffer, uploadOptions);
        mediaUrl      = result.secure_url;
        mediaPublicId = result.public_id;
        mediaType     = isVideo ? 'video' : 'image';
        // Store native dimensions so the client can reserve exact space before any byte loads.
        mediaWidth    = result.width  || null;
        mediaHeight   = result.height || null;
        // Store the server-generated poster (only present for video uploads).
        if (isVideo && result.eager && result.eager[0]?.secure_url) {
          thumbnailUrl = result.eager[0].secure_url;
        }
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({ success: false, message: 'Media upload failed.' });
      }
    } else {
      // Local fallback
      const ext = (req.file.originalname || '').split('.').pop() || (isVideo ? 'mp4' : 'jpg');
      const filename = `${req.user._id}_${Date.now()}.${ext}`;
      mediaUrl  = saveLocally(req.file.buffer, filename);
      mediaType = isVideo ? 'video' : 'image';
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

    const userId       = req.user._id;
    const alreadyLiked = post.likes.some((id) => id.toString() === userId.toString());

    if (alreadyLiked) {
      post.likes = post.likes.filter((id) => id.toString() !== userId.toString());
    } else {
      post.likes.push(userId);
      // Fire notification (fire-and-forget)
      try {
        const { createNotification } = require('./notificationController');
        createNotification({
          toUserId:      post.userId,
          fromUserId:    userId,
          type:          'like',
          referenceId:   post._id,
          referenceType: 'Post',
          message:       'liked your post',
        });
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

    const post = await Post.findById(req.params.id).select('comments');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    res.status(200).json({ success: true, comments: post.comments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch comments.' });
  }
};

// ─── @POST /api/posts/:id/comment ─────────────────────────────────────────────
const addComment = async (req, res) => {
  const { text } = req.body;
  if (!text?.trim())
    return res.status(400).json({ success: false, message: 'Comment text is required.' });

  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const user = await User.findById(req.user._id);
    const newComment = { userId: req.user._id, username: user.username, text: text.trim() };
    post.comments.push(newComment);
    await post.save();

    // Fire notification (fire-and-forget)
    try {
      const { createNotification } = require('./notificationController');
      createNotification({
        toUserId:      post.userId,
        fromUserId:    req.user._id,
        type:          'comment',
        referenceId:   post._id,
        referenceType: 'Post',
        message:       `commented: "${text.trim().substring(0, 50)}"`,
      });
    } catch (_) {}

    // Return the newly added comment with a proper id
    const savedComment = post.comments[post.comments.length - 1];
    res.status(201).json({
      success:       true,
      commentsCount: post.comments.length,
      comment: {
        _id:       savedComment._id,
        userId:    req.user._id,
        username:  user.username,
        text:      savedComment.text,
        createdAt: savedComment.createdAt,
      },
      comments: post.comments.slice(-10),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not add comment.' });
  }
};

module.exports = {
  getFeed, getSquadFeed, getSquadFeedById, getMyPosts,
  createPost, createPostWithMedia, toggleLike, addComment, getComments,
};
