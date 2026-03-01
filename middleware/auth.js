const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protect middleware – validates JWT access token.
 * Attach req.user for downstream handlers.
 */
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer '))
    token = req.headers.authorization.split(' ')[1];

  if (!token)
    return res.status(401).json({ success: false, message: 'Not authorized – no token.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user)
      return res.status(401).json({ success: false, message: 'User not found.' });
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.';
    return res.status(401).json({ success: false, message: msg, expired: err.name === 'TokenExpiredError' });
  }
};

/**
 * Admin guard middleware – must be used after protect.
 */
const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin)
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  next();
};

module.exports = { protect, adminOnly };
