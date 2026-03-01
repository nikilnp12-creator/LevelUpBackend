const Proof = require('../models/Proof');
const User = require('../models/User');

// Simple admin guard: only users with isAdmin=true may access these routes
// (Add isAdmin field to User model or use a separate role system)

// ── GET /api/admin/flagged-proofs ─────────────────────────────────────────────
const getFlaggedProofs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const proofs = await Proof.find({ flagged: true, isDeleted: false })
      .populate('userId', 'username email profileImageUrl')
      .populate('missionId', 'title')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Proof.countDocuments({ flagged: true, isDeleted: false });
    res.json({ success: true, proofs, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch flagged proofs.' });
  }
};

// ── POST /api/admin/resolve-flag ──────────────────────────────────────────────
const resolveFlag = async (req, res) => {
  const { proofId, action, reason } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action))
    return res.status(400).json({ success: false, message: 'Action must be approve or reject.' });

  try {
    const proof = await Proof.findById(proofId);
    if (!proof) return res.status(404).json({ success: false, message: 'Proof not found.' });

    proof.moderation.status = action === 'approve' ? 'approved' : 'rejected';
    proof.moderation.reason = reason || '';
    proof.moderation.reviewedBy = req.user._id;
    proof.moderation.reviewedAt = new Date();

    if (action === 'reject') {
      proof.isDeleted = true; // soft-delete rejected proofs
    }

    await proof.save();
    res.json({ success: true, message: `Proof ${action}d.`, proof });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not resolve flag.' });
  }
};

module.exports = { getFlaggedProofs, resolveFlag };
