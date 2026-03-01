const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const { getFlaggedProofs, resolveFlag } = require('../controllers/adminController');

const router = express.Router();
router.use(protect, adminOnly);

router.get('/flagged-proofs', getFlaggedProofs);
router.post('/resolve-flag', resolveFlag);

module.exports = router;
