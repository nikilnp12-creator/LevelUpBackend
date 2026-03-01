const mongoose = require('mongoose');

/**
 * RefreshToken – stored server-side so we can invalidate on logout.
 * TTL index auto-purges expired tokens from DB.
 */
const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: '30d' }, // TTL: 30 days
  isRevoked: { type: Boolean, default: false },
});

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
