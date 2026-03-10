const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

// Start cron jobs
const { startCronJobs } = require('./jobs/missedDaysCron');
startCronJobs();

// Seed templates
require('./jobs/seedTemplates')().catch(console.error);

const app = express();

app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
}));

// Stripe webhook must receive raw Buffer — apply inline raw() inside the router.
// Important: mount subscription routes BEFORE global express.json() so the
// webhook route's own express.raw() middleware can capture the raw body.
// All other routes under /api/subscriptions still work because the router
// only applies express.raw() to POST /webhook specifically.
app.use('/api/subscriptions', require('./routes/subscriptions'));

// Global body parsers — used by all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/user'));
app.use('/api/user', require('./routes/user'));
app.use('/api/missions', require('./routes/missions'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/squads', require('./routes/squads'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/challenges', require('./routes/challenges'));
app.use('/api/seasons', require('./routes/seasons'));
app.use('/api/invites', require('./routes/invites'));

app.get('/', (req, res) =>
  res.json({ message: '🚀 Level Up API v3.0', version: '4.0.0', features: ['missions', 'challenges', 'seasons', 'invites', 'ai-suggestions', 'streak-cards', 'comeback'] })
);

app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ success: false, message: 'File too large. Max 5MB.' });
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`✅ Level Up API v3.0 running on port ${PORT}`)
);
