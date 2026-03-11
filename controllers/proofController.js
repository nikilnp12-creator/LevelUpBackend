const Mission = require('../models/Mission');
const Proof = require('../models/Proof');
const User = require('../models/User');
const streamifier = require('streamifier');

let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  cloudinary = require('../config/cloudinary');
}

const GRACE_WINDOW_DAYS = parseInt(process.env.PROOF_GRACE_WINDOW_DAYS || '1', 10);

const uploadToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err); else resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });

// ── Gemini AI Proof Verification ──────────────────────────────────────────────
async function verifyProofWithGemini(imageUrl, missionTitle, missionCategory) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return { verified: true, confidence: 0, reason: 'AI verification not configured' };

  try {
    const fetch = require('node-fetch');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `You are a proof verification AI for a habit-tracking app called "Level".
A user is on a mission titled "${missionTitle}" (category: ${missionCategory}).
They uploaded this image as daily proof. Analyze the image and determine:
1. Does the image appear to be genuine proof related to the mission goal?
2. Is it a real photo (not a screenshot of someone else's content, not AI-generated, not a stock image)?
3. Confidence score from 0 to 100.

Respond in JSON only: {"verified": true/false, "confidence": 0-100, "reason": "brief explanation"}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: await fetchImageAsBase64(imageUrl) } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
      })
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { verified: true, confidence: 50, reason: 'Could not parse AI response' };
  } catch (err) {
    console.error('Gemini verification error:', err.message);
    return { verified: true, confidence: 0, reason: 'AI verification unavailable' };
  }
}

async function fetchImageAsBase64(url) {
  const fetch = require('node-fetch');
  const response = await fetch(url);
  const buffer = await response.buffer();
  return buffer.toString('base64');
}

// ── POST /api/missions/:id/proof ──────────────────────────────────────────────
const uploadProof = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
  if (!cloudinary) return res.status(503).json({ success: false, message: 'Proof uploads require Cloudinary config.' });

  try {
    const mission = await Mission.findOne({ _id: req.params.id, userId: req.user._id, isDeleted: false });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (!mission.isLocked || mission.status === 'completed')
      return res.status(400).json({ success: false, message: 'Mission must be active.' });
    if (mission.status === 'failed')
      return res.status(400).json({ success: false, message: 'Mission has failed. Cannot submit proof.' });

    // Timezone-aware day number
    const tz = req.body.timezone || req.headers['x-timezone'] || mission.timezone || 'UTC';
    const todayDayNumber = mission.computeDayNumber(tz);

    if (todayDayNumber < 1 || todayDayNumber > mission.durationDays)
      return res.status(400).json({ success: false, message: `Day out of range. Today is day ${todayDayNumber}.` });

    const minDay = Math.max(1, todayDayNumber - GRACE_WINDOW_DAYS);
    const requestedDay = parseInt(req.body.dayNumber, 10) || todayDayNumber;

    if (requestedDay < minDay || requestedDay > todayDayNumber)
      return res.status(400).json({ success: false, message: `Proof must be for day ${minDay}–${todayDayNumber}.` });

    // Duplicate check
    const existing = await Proof.findOne({ missionId: mission._id, dayNumber: requestedDay, isDeleted: false });
    if (existing) return res.status(400).json({ success: false, message: `Proof for day ${requestedDay} already submitted.` });

    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(req.file.buffer, {
      folder: `level_up/proofs/${req.user._id}/${mission._id}`,
      resource_type: 'auto',
      quality: 'auto:good',
      transformation: [{ width: 1280, crop: 'limit' }],
    });

    const thumbnailUrl = cloudinary.url(uploadResult.public_id, {
      width: 300, height: 300, crop: 'fill', quality: 80, format: 'jpg',
    });

    // ── AI Verification with Gemini ───────────────────────────────────────────
    let aiVerification = { verified: true, confidence: 0, reason: 'Skipped' };
    if (req.file.mimetype.startsWith('image/')) {
      aiVerification = await verifyProofWithGemini(
        uploadResult.secure_url, mission.title, mission.category
      );
    }

    // Save proof
    const proof = await Proof.create({
      missionId: mission._id,
      userId: req.user._id,
      dayNumber: requestedDay,
      mediaUrl: uploadResult.secure_url,
      thumbnailUrl,
      cloudinaryPublicId: uploadResult.public_id,
      caption: req.body.caption || '',
      meta: { size: req.file.size, width: uploadResult.width || 0, height: uploadResult.height || 0 },
      aiVerification,
    });

    // Record proof using single consolidated method
    const { alreadyDone, milestones } = await mission.recordProof(requestedDay, tz);

    // Award XP
    const user = await User.findById(req.user._id);
    const xpGain = 20 + mission.analytics.currentStreak * 2;

    // Milestone XP bonus
    let milestoneXpBonus = 0;
    for (const m of milestones) milestoneXpBonus += m.xpBonus || 0;

    await user.addXP(xpGain + milestoneXpBonus);

    // Badge checks
    if (mission.analytics.completedDays === 1) await user.awardBadge('first_checkin');
    if (mission.analytics.currentStreak >= 7) await user.awardBadge('streak_7');
    if (mission.analytics.currentStreak >= 21) await user.awardBadge('streak_21');
    if (mission.analytics.currentStreak >= 30) await user.awardBadge('streak_30');

    // Early bird badge: upload before 8am
    const now = new Date();
    if (now.getHours() < 8) await user.awardBadge('early_bird');

    if (mission.analytics.currentStreak > user.totalStreak) {
      user.totalStreak = mission.analytics.currentStreak;
      await user.save();
    }

    res.status(201).json({
      success: true,
      proof,
      mission,
      xpGained: xpGain + milestoneXpBonus,
      dayNumber: requestedDay,
      milestones,
      aiVerification,
      message: mission.status === 'completed'
        ? '🏆 Mission Complete!'
        : `Day ${requestedDay} proof uploaded! Streak: ${mission.analytics.currentStreak} 🔥`,
    });
  } catch (err) {
    console.error('Proof upload error:', err);
    res.status(500).json({ success: false, message: 'Proof upload failed.' });
  }
};

// ── POST /api/proofs/:proofId/react ───────────────────────────────────────────
const reactToProof = async (req, res) => {
  const { type } = req.body;
  const { REACTION_TYPES } = require('../models/Proof');
  if (!REACTION_TYPES.includes(type))
    return res.status(400).json({ success: false, message: `Invalid reaction type. Use: ${REACTION_TYPES.join(', ')}` });

  try {
    const proof = await Proof.findOne({ _id: req.params.proofId, isDeleted: false });
    if (!proof) return res.status(404).json({ success: false, message: 'Proof not found.' });

    const existingIdx = proof.reactions.findIndex(
      r => r.userId.toString() === req.user._id.toString()
    );

    if (existingIdx >= 0) {
      // Toggle off if same type, switch if different
      if (proof.reactions[existingIdx].type === type) {
        proof.reactions.splice(existingIdx, 1);
      } else {
        proof.reactions[existingIdx].type = type;
      }
    } else {
      proof.reactions.push({ userId: req.user._id, type });
    }

    await proof.save();
    res.json({ success: true, reactionCounts: proof.reactionCounts, totalReactions: proof.reactions.length });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not react to proof.' });
  }
};

// ── POST /api/proofs/:proofId/comments ────────────────────────────────────────
const addComment = async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length === 0)
    return res.status(400).json({ success: false, message: 'Comment text is required.' });

  try {
    const proof = await Proof.findOne({ _id: req.params.proofId, isDeleted: false });
    if (!proof) return res.status(404).json({ success: false, message: 'Proof not found.' });

    proof.comments.push({ userId: req.user._id, text: text.trim() });
    await proof.save();

    const populated = await Proof.findById(proof._id)
      .populate('comments.userId', 'username profileImageUrl');

    const newComment = populated.comments[populated.comments.length - 1];
    res.status(201).json({ success: true, comment: newComment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not add comment.' });
  }
};

// ── GET /api/proofs/:proofId/comments ─────────────────────────────────────────
const getComments = async (req, res) => {
  try {
    const proof = await Proof.findOne({ _id: req.params.proofId, isDeleted: false })
      .populate('comments.userId', 'username profileImageUrl');
    if (!proof) return res.status(404).json({ success: false, message: 'Proof not found.' });

    const comments = proof.comments.filter(c => !c.isDeleted);
    res.json({ success: true, comments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch comments.' });
  }
};

module.exports = { uploadProof, reactToProof, addComment, getComments };
