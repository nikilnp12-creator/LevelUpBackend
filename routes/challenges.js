const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getChallenges, createChallenge, getChallenge,
  joinChallenge, submitChallengeProof, getMyChallenges,
} = require('../controllers/challengeController');

const router = express.Router();
router.use(protect);

router.get('/', getChallenges);
router.post('/', createChallenge);
router.get('/my', getMyChallenges);
router.get('/:id', getChallenge);
router.post('/:id/join', joinChallenge);
router.post('/:id/proof', submitChallengeProof);

module.exports = router;
