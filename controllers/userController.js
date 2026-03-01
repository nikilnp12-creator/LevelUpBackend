const User = require('../models/User');
const streamifier = require('streamifier');

// Cloudinary is optional – only loaded when credentials are present
let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  cloudinary = require('../config/cloudinary');
}

// ─── @GET /api/users/me ────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({ success: true, user: user.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch profile.' });
  }
};

// ─── @PUT /api/users/me ────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  const { username, bio } = req.body;
  try {
    if (username) {
      const existing = await User.findOne({ username, _id: { $ne: req.user._id } });
      if (existing)
        return res.status(400).json({ success: false, message: 'Username is already taken.' });
    }
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { ...(username && { username }), ...(bio !== undefined && { bio }) },
      { new: true, runValidators: true }
    );
    res.status(200).json({ success: true, user: updated.toJSON() });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: 'Could not update profile.' });
  }
};

// ─── @POST /api/user/avatar ────────────────────────────────────────────────
const uploadAvatar = async (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, message: 'No file uploaded.' });

  if (!cloudinary)
    return res.status(503).json({ success: false, message: 'Image upload not configured. Set Cloudinary env vars.' });

  try {
    const user = await User.findById(req.user._id);

    // Delete old Cloudinary image if it exists
    if (user.profileImagePublicId) {
      await cloudinary.uploader.destroy(user.profileImagePublicId).catch(() => {});
    }

    // Upload buffer to Cloudinary via stream
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `level_up/avatars/${req.user._id}`, resource_type: 'image', quality: 'auto:good', width: 400, crop: 'fill' },
        (err, result) => { if (err) reject(err); else resolve(result); }
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { profileImageUrl: result.secure_url, profileImagePublicId: result.public_id },
      { new: true }
    );

    res.status(200).json({ success: true, user: updated.toJSON() });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ success: false, message: 'Avatar upload failed.' });
  }
};



// ─── @POST /api/users/:id/follow ──────────────────────────────────────────────
const followUser = async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user._id.toString())
      return res.status(400).json({ success: false, message: 'You cannot follow yourself.' });

    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    await User.findByIdAndUpdate(req.user._id, { $addToSet: { following: targetId } });
    await User.findByIdAndUpdate(targetId,      { $addToSet: { followers: req.user._id } });

    res.json({ success: true, message: `Now following @${target.username}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not follow user.' });
  }
};

// ─── @POST /api/users/:id/unfollow ────────────────────────────────────────────
const unfollowUser = async (req, res) => {
  try {
    const targetId = req.params.id;

    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    await User.findByIdAndUpdate(req.user._id, { $pull: { following: targetId } });
    await User.findByIdAndUpdate(targetId,      { $pull: { followers: req.user._id } });

    res.json({ success: true, message: `Unfollowed @${target.username}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not unfollow user.' });
  }
};

module.exports = { getProfile, updateProfile, uploadAvatar, followUser, unfollowUser };
