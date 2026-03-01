const express = require('express');
const multer  = require('multer');
const { protect } = require('../middleware/auth');
const {
  getFeed, getSquadFeed, getMyPosts,
  createPost, createPostWithMedia,
  toggleLike, addComment, getComments,
} = require('../controllers/postController');

const router = express.Router();
router.use(protect);

// Multer: accept photo/video up to 50MB, store in memory.
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/'))
      return cb(new Error('Only image or video files are allowed.'), false);
    cb(null, true);
  },
});

// Feed (must be before /:id routes)
router.get('/feed', getFeed);
router.get('/my',   getMyPosts);
router.get('/squad/:squadId', getSquadFeed);

// Create post with optional media upload
router.post('/', mediaUpload.single('media'), createPostWithMedia);

// Post interactions
router.get('/:id/comments', getComments);
router.post('/:id/like',    toggleLike);
router.post('/:id/comment', addComment);

module.exports = router;
