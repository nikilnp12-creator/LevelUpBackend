const Mission = require('../models/Mission');
const Proof = require('../models/Proof');
const User = require('../models/User');
const streamifier = require('streamifier');

let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  cloudinary = require('../config/cloudinary');
}

// Grace window in days: accept proof for today OR (today-graceWindow) days
const GRACE_WINDOW_DAYS = parseInt(process.env.PROOF_GRACE_WINDOW_DAYS || '1', 10);

/**
 * Upload a buffer to Cloudinary and return the result.
 * Streams directly to avoid temp-file writes.
 */
const uploadToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });

// ── POST /api/missions/:id/proof ──────────────────────────────────────────────
// Multipart upload. Rate-limited externally (see routes).
const uploadProof = async (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  if (!cloudinary)
    return res.status(503).json({ success: false, message: 'Proof uploads require Cloudinary. Set CLOUDINARY_* env vars.' });

  try {
    // 1. Load & verify mission
    const mission = await Mission.findOne({
      _id: req.params.id, userId: req.user._id, isDeleted: false,
    });
    if (!mission)
      return res.status(404).json({ success: false, message: 'Mission not found.' });
    if (!mission.isLocked || mission.status !== 'active')
      return res.status(400).json({ success: false, message: 'Mission must be started and active.' });

    // 2. Server-side day number computation
    //    Accept proof for today or within the configured grace window
    const todayDayNumber = mission.computeDayNumber();
    const timezone = req.body.timezone || req.headers['x-timezone'] || 'UTC';

    if (todayDayNumber < 1 || todayDayNumber > mission.durationDays)
      return res.status(400).json({
        success: false,
        message: `Mission day out of range. Today is day ${todayDayNumber} but mission runs ${mission.durationDays} days.`,
      });

    // Allow proof for any day within the grace window that doesn't already have a proof
    const minAcceptableDay = Math.max(1, todayDayNumber - GRACE_WINDOW_DAYS);
    const requestedDay = parseInt(req.body.dayNumber, 10) || todayDayNumber;

    if (requestedDay < minAcceptableDay || requestedDay > todayDayNumber)
      return res.status(400).json({
        success: false,
        message: `Proof must be for day ${minAcceptableDay}–${todayDayNumber}. Requested: day ${requestedDay}.`,
      });

    // 3. Check: already have proof for that day?
    const existing = await Proof.findOne({
      missionId: mission._id, dayNumber: requestedDay, isDeleted: false,
    });
    if (existing)
      return res.status(400).json({
        success: false,
        message: `Proof for day ${requestedDay} already uploaded.`,
      });

    // 4. Upload main image to Cloudinary
    //    Client already compresses to ≤500KB; we store as-is + produce thumbnail via Cloudinary transforms
    const uploadResult = await uploadToCloudinary(req.file.buffer, {
      folder: `level_up/proofs/${req.user._id}/${mission._id}`,
      resource_type: 'auto',
      quality: 'auto:good',
      // TODO: add AI content moderation hook here (e.g., Azure AI or Cloudinary AI moderation add-on)
      transformation: [{ width: 1280, crop: 'limit' }],
    });

    // 5. Thumbnail URL via Cloudinary URL transformation
    const thumbnailUrl = cloudinary.url(uploadResult.public_id, {
      width: 300, height: 300, crop: 'fill', quality: 80, format: 'jpg',
    });

    // 6. Save proof document
    const proof = await Proof.create({
      missionId: mission._id,
      userId: req.user._id,
      dayNumber: requestedDay,
      mediaUrl: uploadResult.secure_url,
      thumbnailUrl,
      cloudinaryPublicId: uploadResult.public_id,
      meta: {
        size: req.file.size,
        width: uploadResult.width || 0,
        height: uploadResult.height || 0,
      },
    });

    // 7. Update mission analytics & streaks
    mission.analytics.completedDays += 1;

    // Streak logic: consecutive days
    if (requestedDay === mission.analytics.completedDays) {
      // Days are consecutive — increment streak
      mission.analytics.currentStreak += 1;
      if (mission.analytics.currentStreak > mission.analytics.bestStreak)
        mission.analytics.bestStreak = mission.analytics.currentStreak;
    } else {
      // Gap detected — calculate missed days
      const expectedCompleted = requestedDay; // if no gaps, completed = dayNumber
      const missed = expectedCompleted - mission.analytics.completedDays;
      if (missed > 0) {
        mission.analytics.missedDays += missed;
        mission.analytics.currentStreak = 1; // reset streak
      }
    }

    mission.analytics.identityScore = mission.computeIdentityScore();

    // Legacy fields update
    mission.currentDay = mission.analytics.completedDays;
    mission.streakCount = mission.analytics.currentStreak;
    mission.lastCheckIn = new Date();
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!mission.completedDays.includes(todayStr)) mission.completedDays.push(todayStr);

    // Check if mission is now complete
    if (mission.analytics.completedDays >= mission.durationDays) {
      mission.status = 'completed';
      mission.isActive = false;
      mission.endDate = new Date();
    }

    await mission.save();

    // 8. Award XP
    const user = await User.findById(req.user._id);
    const xpGain = 20 + mission.analytics.currentStreak * 2;
    await user.addXP(xpGain);
    if (mission.analytics.currentStreak > user.totalStreak) {
      user.totalStreak = mission.analytics.currentStreak;
      await user.save();
    }

    res.status(201).json({
      success: true,
      proof,
      mission,
      xpGained: xpGain,
      dayNumber: requestedDay,
      message: mission.status === 'completed'
        ? '🏆 Mission Complete!'
        : `Day ${requestedDay} proof uploaded! Streak: ${mission.analytics.currentStreak} 🔥`,
    });
  } catch (err) {
    console.error('Proof upload error:', err);
    res.status(500).json({ success: false, message: 'Proof upload failed.' });
  }
};

module.exports = { uploadProof };
