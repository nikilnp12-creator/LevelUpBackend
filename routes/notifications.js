const express = require('express');
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  acceptFollowRequest,
  rejectFollowRequest,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

router.get('/',              getNotifications);
router.get('/unread-count',  getUnreadCount);
router.post('/read-all',     markAllRead);
router.post('/:id/read',     markRead);
router.post('/:id/accept',   acceptFollowRequest);
router.post('/:id/reject',   rejectFollowRequest);

module.exports = router;
