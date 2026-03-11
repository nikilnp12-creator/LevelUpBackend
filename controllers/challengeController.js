const Challenge = require('../models/Challenge');
const User = require('../models/User');

// ── GET /api/challenges ───────────────────────────────────────────────────────
const getChallenges = async (req, res) => {
  try {
    const { filter = 'active' } = req.query;
    const now = new Date();
    let query = { isDeleted: false, visibility: 'public' };

    if (filter === 'active') query = { ...query, isActive: true, endDate: { $gte: now } };
    else if (filter === 'upcoming') query = { ...query, startDate: { $gt: now } };
    else if (filter === 'featured') query = { ...query, isFeatured: true, isActive: true };

    const challenges = await Challenge.find(query)
      .populate('creatorId', 'username profileImageUrl')
      .sort({ isFeatured: -1, startDate: -1 })
      .limit(30);

    res.json({ success: true, challenges });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch challenges.' });
  }
};

// ── POST /api/challenges ──────────────────────────────────────────────────────
const createChallenge = async (req, res) => {
  const { title, description, category, emoji, durationDays, proofType, rules, startDate } = req.body;
  try {
    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + (parseInt(durationDays) || 7));

    const challenge = await Challenge.create({
      title, description: description || '', category: category || 'Custom',
      emoji: emoji || '🏆', durationDays: parseInt(durationDays) || 7,
      proofType: proofType || 'photo', rules: rules || '',
      startDate: start, endDate: end,
      creatorId: req.user._id,
      participants: [{ userId: req.user._id }], // creator auto-joins
    });

    await User.findByIdAndUpdate(req.user._id, { $inc: { xp: 100 } });
    res.status(201).json({ success: true, challenge });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Could not create challenge.' });
  }
};

// ── GET /api/challenges/:id ───────────────────────────────────────────────────
const getChallenge = async (req, res) => {
  try {
    const challenge = await Challenge.findOne({ _id: req.params.id, isDeleted: false })
      .populate('creatorId', 'username profileImageUrl')
      .populate('participants.userId', 'username profileImageUrl level xp');
    if (!challenge) return res.status(404).json({ success: false, message: 'Challenge not found.' });

    const userId = req.user._id.toString();
    const isParticipant = challenge.isUserParticipant(userId);

    // Leaderboard sorted by completedDays then streak
    const leaderboard = [...challenge.participants]
      .sort((a, b) => b.completedDays - a.completedDays || b.currentStreak - a.currentStreak)
      .map((p, idx) => ({ ...p.toObject(), rank: idx + 1 }));

    res.json({ success: true, challenge: { ...challenge.toJSON(), leaderboard }, isParticipant });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch challenge.' });
  }
};

// ── POST /api/challenges/:id/join ─────────────────────────────────────────────
const joinChallenge = async (req, res) => {
  try {
    const challenge = await Challenge.findOne({ _id: req.params.id, isDeleted: false });
    if (!challenge) return res.status(404).json({ success: false, message: 'Challenge not found.' });
    if (!challenge.isActive) return res.status(400).json({ success: false, message: 'Challenge is not active.' });
    if (challenge.participants.length >= challenge.maxParticipants)
      return res.status(400).json({ success: false, message: 'Challenge is full.' });
    if (challenge.isUserParticipant(req.user._id))
      return res.status(400).json({ success: false, message: 'Already joined.' });

    challenge.participants.push({ userId: req.user._id });
    await challenge.save();

    // Award badge for joining first squad-level challenge
    const user = await User.findById(req.user._id);
    await user.awardBadge('social_starter');

    res.json({ success: true, message: 'Joined challenge!', challenge });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not join challenge.' });
  }
};

// ── POST /api/challenges/:id/proof ────────────────────────────────────────────
const submitChallengeProof = async (req, res) => {
  try {
    const challenge = await Challenge.findOne({ _id: req.params.id, isDeleted: false });
    if (!challenge) return res.status(404).json({ success: false, message: 'Challenge not found.' });
    if (!challenge.isActive) return res.status(400).json({ success: false, message: 'Challenge is not active.' });

    const participant = challenge.getParticipant(req.user._id);
    if (!participant) return res.status(400).json({ success: false, message: 'You have not joined this challenge.' });

    const today = new Date().toISOString().slice(0, 10);
    if ((participant.proofDays || []).includes(today))
      return res.status(400).json({ success: false, message: 'Already submitted proof today.' });

    participant.completedDays += 1;
    participant.proofDays = [...(participant.proofDays || []), today];
    participant.lastProofAt = new Date();

    // Update streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    if ((participant.proofDays || []).includes(yStr)) {
      participant.currentStreak += 1;
    } else {
      participant.currentStreak = 1;
    }
    if (participant.currentStreak > participant.bestStreak)
      participant.bestStreak = participant.currentStreak;

    await challenge.save();

    const user = await User.findById(req.user._id);
    await user.addXP(15 + participant.currentStreak);

    res.json({ success: true, message: `Day ${participant.completedDays} proof submitted!`, participant });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not submit proof.' });
  }
};

// ── GET /api/challenges/my ────────────────────────────────────────────────────
const getMyChallenges = async (req, res) => {
  try {
    const challenges = await Challenge.find({
      'participants.userId': req.user._id,
      isDeleted: false,
    }).populate('creatorId', 'username profileImageUrl').sort({ startDate: -1 }).limit(20);
    res.json({ success: true, challenges });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch your challenges.' });
  }
};

module.exports = { getChallenges, createChallenge, getChallenge, joinChallenge, submitChallengeProof, getMyChallenges };
