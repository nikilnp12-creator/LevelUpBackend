// backend/controllers/inviteController.js
const Invite = require('../models/Invite');
const User   = require('../models/User');
const Squad  = require('../models/Squad');

// POST /api/invites  — create invite link
const createInvite = async (req, res) => {
  try {
    const { type = 'squad', refId, message = '' } = req.body;
    const invite = await Invite.create({
      createdBy: req.user._id,
      type, refId: refId || null, message,
    });
    const inviteUrl = `${process.env.APP_DEEP_LINK || 'levelapp://invite'}/${invite.code}`;
    res.status(201).json({ success: true, code: invite.code, url: inviteUrl, invite });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/invites/:code  — preview invite
const getInvite = async (req, res) => {
  try {
    const invite = await Invite.findOne({ code: req.params.code })
      .populate('createdBy', 'username profileImageUrl level levelTitle');
    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found or expired.' });
    if (invite.expiresAt < new Date()) return res.status(410).json({ success: false, message: 'This invite has expired.' });
    if (invite.usedBy.length >= invite.maxUses) return res.status(410).json({ success: false, message: 'Invite limit reached.' });

    let refDetails = null;
    if (invite.type === 'squad' && invite.refId) {
      refDetails = await Squad.findById(invite.refId).select('name emoji memberCount');
    }

    res.json({ success: true, invite, refDetails });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/invites/:code/use  — accept invite
const useInvite = async (req, res) => {
  try {
    const invite = await Invite.findOne({ code: req.params.code });
    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found.' });
    if (invite.expiresAt < new Date()) return res.status(410).json({ success: false, message: 'This invite has expired.' });
    if (invite.usedBy.includes(req.user._id)) return res.status(400).json({ success: false, message: 'Already used.' });
    if (invite.usedBy.length >= invite.maxUses) return res.status(410).json({ success: false, message: 'Invite limit reached.' });

    invite.usedBy.push(req.user._id);
    await invite.save();

    // Auto-join squad if squad invite
    let result = null;
    if (invite.type === 'squad' && invite.refId) {
      const squad = await Squad.findById(invite.refId);
      if (squad && !squad.members.some(m => m.userId.toString() === req.user._id.toString())) {
        squad.members.push({ userId: req.user._id, role: 'member', joinedAt: new Date() });
        await squad.save();
        await User.findByIdAndUpdate(req.user._id, { $addToSet: { squadIds: squad._id } });
        result = { type: 'squad', squad };
      }
    }

    res.json({ success: true, message: 'Invite accepted!', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createInvite, getInvite, useInvite };
