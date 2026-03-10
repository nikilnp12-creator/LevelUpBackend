// backend/routes/invites.js
const express = require('express');
const { protect } = require('../middleware/auth');
const { createInvite, getInvite, useInvite } = require('../controllers/inviteController');
const router = express.Router();

router.use(protect);
router.post('/', createInvite);
router.get('/:code', getInvite);
router.post('/:code/use', useInvite);

module.exports = router;
