const express = require('express');
const multer  = require('multer');
const {
  getProfile, updateProfile, uploadAvatar,
  getUserById, getUserPosts,
  followUser, unfollowUser,
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/'))
      return cb(new Error('Only image files are allowed.'), false);
    cb(null, true);
  },
});

// Own profile
router.get('/me',       getProfile);
router.put('/me',       updateProfile);
router.get('/profile',  getProfile);
router.put('/profile',  updateProfile);
router.post('/avatar',  avatarUpload.single('avatar'), uploadAvatar);

// Other user – MUST come before /:id so /me isn't caught
router.get('/:id',        getUserById);
router.get('/:id/posts',  getUserPosts);

// Follow / unfollow
router.post('/:id/follow',   followUser);
router.post('/:id/unfollow', unfollowUser);

module.exports = router;
