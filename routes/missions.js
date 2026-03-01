const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const {
  getMyMissions, createMission, getMission, updateMission,
  startMission, completeMission, getMissionProofs, flagProof,
  getPublicFeed, getLeaderboard, checkIn, deleteMission,
} = require('../controllers/missionController');
const { uploadProof } = require('../controllers/proofController');

const router = express.Router();

// Multer: store in memory; client must pre-compress to ≤500KB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB server-side guard
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/'))
      return cb(new Error('Only images are accepted.'), false);
    cb(null, true);
  },
});

// Rate limiter for proof uploads: max 10 per minute per user
const proofRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Too many uploads. Please wait before uploading again.' },
});

router.use(protect);

// Public / leaderboard (still requires auth to avoid abuse)
router.get('/feed/public', getPublicFeed);
router.get('/leaderboard', getLeaderboard);

router.get('/', getMyMissions);
router.post('/', createMission);
router.get('/:id', getMission);
router.put('/:id', updateMission);
router.delete('/:id', deleteMission);
router.post('/:id/start', startMission);
router.post('/:id/complete', completeMission);
router.post('/:id/checkin', checkIn);     // legacy
router.post('/:id/proof', proofRateLimit, upload.single('file'), uploadProof);
router.get('/:id/proofs', getMissionProofs);
router.post('/:id/flag', flagProof);

module.exports = router;
