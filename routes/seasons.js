// backend/routes/seasons.js
const express = require('express');
const { protect } = require('../middleware/auth');
const { getActiveSeason, getSeasonLeaderboard, joinSeason, getAllSeasons } = require('../controllers/seasonController');
const router = express.Router();

router.use(protect);
router.get('/active', getActiveSeason);
router.get('/leaderboard', getSeasonLeaderboard);
router.get('/all', getAllSeasons);
router.post('/join', joinSeason);

module.exports = router;
