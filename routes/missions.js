const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const {
  getMyMissions, createMission, getMission, updateMission,
  startMission, completeMission, getMissionProofs, flagProof,
  getPublicFeed, getLeaderboard, checkIn, deleteMission,
  useShield, declareRestDay, getTemplates,
  getMissionSuggestions, generateMissionFromText,
} = require('../controllers/missionController');
const { uploadProof, reactToProof, addComment, getComments } = require('../controllers/proofController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/'))
      return cb(new Error('Only images/videos are accepted.'), false);
    cb(null, true);
  },
});

const proofRateLimit = rateLimit({
  windowMs: 60 * 1000, max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Too many uploads. Please wait.' },
});

router.use(protect);

router.get('/feed/public', getPublicFeed);
router.get('/leaderboard', getLeaderboard);
router.get('/templates', getTemplates);

router.get('/', getMyMissions);
router.post('/', createMission);
router.get('/:id', getMission);
router.put('/:id', updateMission);
router.delete('/:id', deleteMission);
router.post('/:id/start', startMission);
router.post('/:id/complete', completeMission);
router.post('/:id/checkin', checkIn);
router.post('/:id/use-shield', useShield);
router.post('/:id/rest-day', declareRestDay);
router.post('/:id/proof', proofRateLimit, upload.single('file'), uploadProof);
router.get('/:id/proofs', getMissionProofs);
router.post('/:id/flag', flagProof);

// Proof reactions & comments (via mission route)
router.post('/proofs/:proofId/react', reactToProof);
router.get('/proofs/:proofId/comments', getComments);
router.post('/proofs/:proofId/comments', addComment);

router.get('/suggestions', getMissionSuggestions);
router.post('/generate', generateMissionFromText);

module.exports = router;
