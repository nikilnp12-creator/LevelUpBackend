const Notification = require('../models/Notification');
const User = require('../models/User');

// ─── Helper: send a notification (fire-and-forget safe) ───────────────────────
// Call this from post/user controllers whenever an action should notify someone.
const createNotification = async ({ toUserId, fromUserId, type, referenceId = null, referenceType = null, message = '' }) => {
  try {
    // Never notify yourself
    if (toUserId.toString() === fromUserId.toString()) return;

    // Dedup: don't re-send the same like/follow_request notification
    if (type === 'like' || type === 'follow_request') {
      const exists = await Notification.findOne({
        toUser: toUserId,
        fromUser: fromUserId,
        type,
        referenceId: referenceId || null,
      });
      if (exists) return;
    }

    await Notification.create({
      toUser: toUserId,
      fromUser: fromUserId,
      type,
      referenceId: referenceId || null,
      referenceType: referenceType || null,
      message,
    });
  } catch (err) {
    // Never crash the calling request due to notification failure
    console.error('createNotification error:', err.message);
  }
};

// ─── @GET /api/notifications ──────────────────────────────────────────────────
const getNotifications = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 30);
    const skip  = (page - 1) * limit;

    const notifications = await Notification.find({ toUser: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('fromUser', 'username profileImageUrl')
      .lean();

    // Mark all fetched as read in background
    Notification.updateMany(
      { toUser: req.user._id, isRead: false },
      { $set: { isRead: true } }
    ).catch(() => {});

    const formatted = notifications.map((n) => ({
      _id: n._id,
      type: n.type,
      fromUser: n.fromUser
        ? { _id: n.fromUser._id, username: n.fromUser.username, profileImageUrl: n.fromUser.profileImageUrl }
        : null,
      fromUserId: n.fromUser?._id ?? null,
      fromUsername: n.fromUser?.username ?? '',
      referenceId: n.referenceId,
      message: n.message || _defaultMessage(n.type),
      isRead: n.isRead,
      createdAt: n.createdAt,
    }));

    res.status(200).json({ success: true, notifications: formatted });
  } catch (err) {
    console.error('getNotifications error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch notifications.' });
  }
};

// ─── @GET /api/notifications/unread-count ─────────────────────────────────────
const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ toUser: req.user._id, isRead: false });
    res.status(200).json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch unread count.' });
  }
};

// ─── @POST /api/notifications/:id/read ────────────────────────────────────────
const markRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, toUser: req.user._id },
      { isRead: true }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not mark notification as read.' });
  }
};

// ─── @POST /api/notifications/read-all ────────────────────────────────────────
const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ toUser: req.user._id, isRead: false }, { isRead: true });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not mark all as read.' });
  }
};

// ─── @POST /api/notifications/:id/accept  (accept follow request) ─────────────
const acceptFollowRequest = async (req, res) => {
  try {
    const notif = await Notification.findOne({
      _id: req.params.id,
      toUser: req.user._id,
      type: 'follow_request',
    }).populate('fromUser', 'username');

    if (!notif) {
      return res.status(404).json({ success: false, message: 'Follow request not found.' });
    }

    const requesterId = notif.fromUser._id;

    // Add to followers / following
    await User.findByIdAndUpdate(req.user._id,  { $addToSet: { followers: requesterId } });
    await User.findByIdAndUpdate(requesterId,    { $addToSet: { following: req.user._id } });

    // Remove the follow_request notification
    await notif.deleteOne();

    // Send a "follow_accepted" notification back to the requester
    await createNotification({
      toUserId: requesterId,
      fromUserId: req.user._id,
      type: 'follow_accepted',
      message: 'accepted your follow request',
    });

    res.status(200).json({ success: true, message: 'Follow request accepted.' });
  } catch (err) {
    console.error('acceptFollowRequest error:', err);
    res.status(500).json({ success: false, message: 'Could not accept follow request.' });
  }
};

// ─── @POST /api/notifications/:id/reject  (reject follow request) ─────────────
const rejectFollowRequest = async (req, res) => {
  try {
    const notif = await Notification.findOne({
      _id: req.params.id,
      toUser: req.user._id,
      type: 'follow_request',
    });

    if (!notif) {
      return res.status(404).json({ success: false, message: 'Follow request not found.' });
    }

    await notif.deleteOne();
    res.status(200).json({ success: true, message: 'Follow request declined.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not decline follow request.' });
  }
};

// ─── Default message per type ─────────────────────────────────────────────────
const _defaultMessage = (type) => {
  switch (type) {
    case 'follow_request':  return 'wants to follow you';
    case 'follow_accepted': return 'accepted your follow request';
    case 'like':            return 'liked your post';
    case 'comment':         return 'commented on your post';
    default:                return '';
  }
};

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  acceptFollowRequest,
  rejectFollowRequest,
};
