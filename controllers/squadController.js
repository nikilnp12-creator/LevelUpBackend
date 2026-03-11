const Squad = require('../models/Squad');
const User = require('../models/User');
const Mission = require('../models/Mission');

// ─── Helper: enrich squad members with mission data ──────────────────────────
async function enrichSquad(squad) {
  const memberIds = squad.members.map((m) =>
    m.userId?._id || m.userId
  );
  const missionStreaks = await Mission.aggregate([
    { $match: { userId: { $in: memberIds }, isActive: true } },
    { $group: { _id: '$userId', maxStreak: { $max: '$streakCount' }, currentDay: { $max: '$currentDay' } } },
  ]);
  const streakMap = {};
  missionStreaks.forEach((s) => { streakMap[s._id.toString()] = s; });

  const enrichedMembers = squad.members.map((m) => {
    const uId = (m.userId?._id || m.userId).toString();
    const mObj = m.toJSON ? m.toJSON() : m;
    return {
      ...mObj,
      missionStreak: streakMap[uId]?.maxStreak || 0,
      missionDay: streakMap[uId]?.currentDay || 0,
    };
  }).sort((a, b) => b.missionStreak - a.missionStreak);

  const squadObj = squad.toJSON ? squad.toJSON() : squad;
  return { ...squadObj, members: enrichedMembers };
}

// ─── @GET /api/squads/my ──────────────────────────────────────────────────────
const getMySquads = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const squads = await Squad.find({ _id: { $in: user.squadIds }, isActive: true })
      .populate('members.userId', 'username profileImageUrl totalStreak level xp');

    const enriched = await Promise.all(squads.map(enrichSquad));
    res.status(200).json({ success: true, squads: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Could not fetch squads.' });
  }
};

// ─── @GET /api/squads/search?q=query ─────────────────────────────────────────
const searchSquads = async (req, res) => {
  try {
    const { q = '' } = req.query;
    const query = {
      isActive: true,
      isPublic: true,
    };
    if (q.trim()) {
      query.$or = [
        { name: { $regex: q.trim(), $options: 'i' } },
        { description: { $regex: q.trim(), $options: 'i' } },
      ];
    }
    const squads = await Squad.find(query)
      .select('name description emoji members maxMembers inviteCode createdAt isPublic')
      .limit(30)
      .sort({ createdAt: -1 });

    const userId = req.user._id.toString();
    const result = squads.map((s) => {
      const sObj = s.toJSON();
      const isMember = s.members.some((m) => m.userId.toString() === userId);
      const hasPendingRequest = s.joinRequests?.some(
        (r) => r.userId.toString() === userId && r.status === 'pending'
      );
      return {
        ...sObj,
        memberCount: s.members.length,
        isMember,
        hasPendingRequest: hasPendingRequest || false,
        members: undefined, // don't return full member list in search
        joinRequests: undefined,
      };
    });

    res.status(200).json({ success: true, squads: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Search failed.' });
  }
};

// ─── @POST /api/squads ────────────────────────────────────────────────────────
const createSquad = async (req, res) => {
  const { name, description, emoji, isPublic, memberIds } = req.body;
  try {
    // Build initial members list: creator is admin + any provided memberIds
    const initialMembers = [{ userId: req.user._id, role: 'admin' }];
    const extraIds = Array.isArray(memberIds) ? memberIds : [];
    extraIds.forEach((uid) => {
      if (uid.toString() !== req.user._id.toString()) {
        initialMembers.push({ userId: uid, role: 'member' });
      }
    });

    const squad = await Squad.create({
      name,
      description: description || '',
      emoji: emoji || '⚡',
      isPublic: isPublic !== false,
      creatorId: req.user._id,
      members: initialMembers,
    });

    // Update squadIds for all members
    const allMemberIds = initialMembers.map((m) => m.userId);
    await User.updateMany(
      { _id: { $in: allMemberIds } },
      { $addToSet: { squadIds: squad._id } }
    );
    res.status(201).json({ success: true, squad });
  } catch (err) {
    console.error('Create squad error:', err);
    res.status(500).json({ success: false, message: 'Could not create squad.' });
  }
};

// ─── @POST /api/squads/join  (by invite code) ─────────────────────────────────
const joinSquad = async (req, res) => {
  const { inviteCode } = req.body;
  try {
    const squad = await Squad.findOne({ inviteCode: inviteCode?.toUpperCase(), isActive: true });
    if (!squad) return res.status(404).json({ success: false, message: 'Invalid invite code.' });

    const alreadyMember = squad.members.some(
      (m) => m.userId.toString() === req.user._id.toString()
    );
    if (alreadyMember) return res.status(400).json({ success: false, message: 'You are already in this squad.' });
    if (squad.members.length >= squad.maxMembers) return res.status(400).json({ success: false, message: 'Squad is full.' });

    squad.members.push({ userId: req.user._id, role: 'member' });
    // Remove any pending request
    squad.joinRequests = squad.joinRequests.filter(
      (r) => r.userId.toString() !== req.user._id.toString()
    );
    await squad.save();
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { squadIds: squad._id } });

    res.status(200).json({ success: true, squad });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not join squad.' });
  }
};

// ─── @POST /api/squads/:id/request  (request to join public squad) ────────────
const requestJoin = async (req, res) => {
  try {
    const squad = await Squad.findById(req.params.id);
    if (!squad) return res.status(404).json({ success: false, message: 'Squad not found.' });

    const userId = req.user._id.toString();
    const alreadyMember = squad.members.some((m) => m.userId.toString() === userId);
    if (alreadyMember) return res.status(400).json({ success: false, message: 'Already a member.' });

    const hasPending = squad.joinRequests.some(
      (r) => r.userId.toString() === userId && r.status === 'pending'
    );
    if (hasPending) return res.status(400).json({ success: false, message: 'Request already sent.' });

    if (squad.members.length >= squad.maxMembers) {
      return res.status(400).json({ success: false, message: 'Squad is full.' });
    }

    squad.joinRequests.push({ userId: req.user._id, message: req.body.message || '' });
    await squad.save();
    res.status(200).json({ success: true, message: 'Join request sent!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not send request.' });
  }
};

// ─── @POST /api/squads/:id/requests/:requestId/accept ─────────────────────────
const acceptRequest = async (req, res) => {
  try {
    const squad = await Squad.findById(req.params.id);
    if (!squad) return res.status(404).json({ success: false, message: 'Squad not found.' });

    const isAdmin = squad.members.some(
      (m) => m.userId.toString() === req.user._id.toString() && m.role === 'admin'
    );
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not authorized.' });

    const request = squad.joinRequests.id(req.params.requestId);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    if (squad.members.length >= squad.maxMembers) {
      return res.status(400).json({ success: false, message: 'Squad is full.' });
    }

    request.status = 'accepted';
    squad.members.push({ userId: request.userId, role: 'member' });
    await squad.save();
    await User.findByIdAndUpdate(request.userId, { $addToSet: { squadIds: squad._id } });

    res.status(200).json({ success: true, message: 'Request accepted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not accept request.' });
  }
};

// ─── @POST /api/squads/:id/requests/:requestId/reject ─────────────────────────
const rejectRequest = async (req, res) => {
  try {
    const squad = await Squad.findById(req.params.id);
    if (!squad) return res.status(404).json({ success: false, message: 'Squad not found.' });

    const isAdmin = squad.members.some(
      (m) => m.userId.toString() === req.user._id.toString() && m.role === 'admin'
    );
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not authorized.' });

    const request = squad.joinRequests.id(req.params.requestId);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    request.status = 'rejected';
    await squad.save();
    res.status(200).json({ success: true, message: 'Request rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not reject request.' });
  }
};

// ─── @GET /api/squads/:id ─────────────────────────────────────────────────────
const getSquad = async (req, res) => {
  try {
    const squad = await Squad.findById(req.params.id)
      .populate('members.userId', 'username profileImageUrl totalStreak level xp isPremium')
      .populate('joinRequests.userId', 'username profileImageUrl level');

    if (!squad) return res.status(404).json({ success: false, message: 'Squad not found.' });

    const enriched = await enrichSquad(squad);
    res.status(200).json({ success: true, squad: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch squad.' });
  }
};

// ─── @GET /api/squads/:id/invite ─────────────────────────────────────────────
const getInviteCode = async (req, res) => {
  try {
    const squad = await Squad.findById(req.params.id);
    if (!squad) return res.status(404).json({ success: false, message: 'Squad not found.' });

    const isMember = squad.members.some((m) => m.userId.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ success: false, message: 'Not a member.' });

    res.status(200).json({ success: true, inviteCode: squad.inviteCode, squadName: squad.name });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not get invite code.' });
  }
};

// ─── @DELETE /api/squads/:id/leave ───────────────────────────────────────────
const leaveSquad = async (req, res) => {
  try {
    const squad = await Squad.findById(req.params.id);
    if (!squad) return res.status(404).json({ success: false, message: 'Squad not found.' });

    squad.members = squad.members.filter(
      (m) => m.userId.toString() !== req.user._id.toString()
    );
    await squad.save();
    await User.findByIdAndUpdate(req.user._id, { $pull: { squadIds: squad._id } });

    res.status(200).json({ success: true, message: 'Left squad.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not leave squad.' });
  }
};

// ─── @GET /api/squads/:id/requests ───────────────────────────────────────────
const getJoinRequests = async (req, res) => {
  try {
    const squad = await Squad.findById(req.params.id)
      .populate('joinRequests.userId', 'username profileImageUrl level totalStreak');
    if (!squad) return res.status(404).json({ success: false, message: 'Squad not found.' });

    const isAdmin = squad.members.some(
      (m) => m.userId.toString() === req.user._id.toString() && m.role === 'admin'
    );
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Not authorized.' });

    const pending = squad.joinRequests.filter((r) => r.status === 'pending');
    res.status(200).json({ success: true, requests: pending });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch requests.' });
  }
};

// ─── @GET /api/squads/match ────────────────────────────────────────────────────
// Auto-match squads based on user's identity/goal tags
const autoMatchSquad = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const identity = (user.onboardingData?.identity || '').toLowerCase();
    const goal = (user.onboardingData?.goalDescription || '').toLowerCase();

    // Build search tags from user's identity and goal
    const userTags = [];
    if (identity) userTags.push(...identity.split(/[\s,]+/).filter(Boolean));
    if (goal) userTags.push(...goal.split(/[\s,]+/).filter(Boolean));

    let squads = [];

    if (userTags.length > 0) {
      // Find squads with matching tags that user isn't already in
      squads = await Squad.find({
        isActive: true,
        isPublic: true,
        tags: { $in: userTags },
        'members.userId': { $ne: req.user._id },
        $expr: { $lt: [{ $size: '$members' }, '$maxMembers'] },
      })
        .populate('members.userId', 'username profileImageUrl totalStreak level')
        .sort({ updatedAt: -1 })
        .limit(5);
    }

    // Fallback: if no tag matches, find popular public squads with open spots
    if (squads.length === 0) {
      squads = await Squad.find({
        isActive: true,
        isPublic: true,
        'members.userId': { $ne: req.user._id },
        $expr: { $lt: [{ $size: '$members' }, '$maxMembers'] },
      })
        .populate('members.userId', 'username profileImageUrl totalStreak level')
        .sort({ updatedAt: -1 })
        .limit(5);
    }

    const enriched = await Promise.all(squads.map(enrichSquad));
    res.json({ success: true, squads: enriched, matchedTags: userTags });
  } catch (err) {
    console.error('Auto-match error:', err);
    res.status(500).json({ success: false, message: 'Could not find matching squads.' });
  }
};

module.exports = {
  getMySquads, searchSquads, createSquad, joinSquad, requestJoin,
  getSquad, getInviteCode, leaveSquad, getJoinRequests, acceptRequest, rejectRequest,
  autoMatchSquad,
};
