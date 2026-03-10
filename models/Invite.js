// backend/models/Invite.js
const mongoose = require('mongoose');
const crypto   = require('crypto');

const inviteSchema = new mongoose.Schema({
  code:       { type: String, unique: true, default: () => crypto.randomBytes(5).toString('hex').toUpperCase() },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:       { type: String, enum: ['squad', 'challenge', 'mission'], default: 'squad' },
  refId:      { type: mongoose.Schema.Types.ObjectId, default: null }, // squadId / challengeId
  message:    { type: String, default: '' },
  usedBy:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxUses:    { type: Number, default: 10 },
  expiresAt:  { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // 7 days
}, { timestamps: true });

module.exports = mongoose.model('Invite', inviteSchema);
