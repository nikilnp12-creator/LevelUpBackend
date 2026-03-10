const express = require('express');
const multer  = require('multer');
const { protect } = require('../middleware/auth');
const {
  getFeed, getSquadFeed, getMyPosts,
  createPost, createPostWithMedia,
  toggleLike, getComments, addComment,
  toggleCommentLike, deleteComment, replyToComment, toggleReplyLike,
  toggleReaction, getReactions,
} = require('../controllers/postController');

const router = express.Router();
router.use(protect);

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/'))
      return cb(new Error('Only image or video files are allowed.'), false);
    cb(null, true);
  },
});

router.get('/feed',              getFeed);
router.get('/my',                getMyPosts);
router.get('/squad/:squadId',    getSquadFeed);
router.post('/', mediaUpload.single('media'), createPostWithMedia);

router.get('/:id/comments',                                    getComments);
router.post('/:id/like',                                       toggleLike);
router.post('/:id/react',                                      toggleReaction);
router.get('/:id/reactions',                                   getReactions);
router.post('/:id/comment',                                    addComment);
router.post('/:id/comments/:commentId/like',                   toggleCommentLike);
router.delete('/:id/comments/:commentId',                      deleteComment);
router.post('/:id/comments/:commentId/reply',                  replyToComment);
router.post('/:id/comments/:commentId/replies/:replyId/like',  toggleReplyLike);

module.exports = router;

const router = express.Router();
router.use(protect);

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/'))
      return cb(new Error('Only image or video files are allowed.'), false);
    cb(null, true);
  },
});

router.get('/feed',              getFeed);
router.get('/my',                getMyPosts);
router.get('/squad/:squadId',    getSquadFeed);
router.post('/', mediaUpload.single('media'), createPostWithMedia);

router.get('/:id/comments',                                    getComments);
router.post('/:id/like',                                       toggleLike);
router.post('/:id/comment',                                    addComment);
router.post('/:id/comments/:commentId/like',                   toggleCommentLike);
router.delete('/:id/comments/:commentId',                      deleteComment);
router.post('/:id/comments/:commentId/reply',                  replyToComment);
router.post('/:id/comments/:commentId/replies/:replyId/like',  toggleReplyLike);

module.exports = router;
