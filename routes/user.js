const express = require('express');
const multer  = require('multer');
const { getProfile, updateProfile, uploadAvatar, followUser, unfollowUser } = require('../controllers/userController');
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

router.get('/profile',  getProfile);
router.put('/profile',  updateProfile);
router.get('/me',       getProfile);   // Flutter alias
router.put('/me',       updateProfile);
router.post('/avatar',  avatarUpload.single('avatar'), uploadAvatar);

// Follow / unfollow
router.post('/:id/follow',   followUser);
router.post('/:id/unfollow', unfollowUser);

module.exports = router;
