const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    profileImageUrl: { type: String, default: null },
    profileImagePublicId: { type: String, default: null },
    bio: {
      type: String,
      maxlength: [200, 'Bio cannot exceed 200 characters'],
      default: '',
    },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    totalStreak: { type: Number, default: 0 },
    isPremium: { type: Boolean, default: false },
    squadIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Squad' }],
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Onboarding tracking
    onboardingCompleted: { type: Boolean, default: false },
    onboardingData: {
      identity: { type: String, default: null },
      goalDescription: { type: String, default: null },
      visibility: { type: String, default: 'public' },
    },

    isActive: { type: Boolean, default: true },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.addXP = async function (amount) {
  this.xp += amount;
  this.level = Math.floor(this.xp / 500) + 1;
  await this.save();
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.profileImagePublicId;
  delete obj.__v;
  obj.followersCount = (obj.followers || []).length;
  obj.followingCount = (obj.following || []).length;
  delete obj.followers;
  delete obj.following;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
