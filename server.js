const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const authRoutes = require('./server/routes/auth');
const workflowRoutes = require('./server/routes/workflows');
const globalWorkflowRoutes = require('./server/routes/globalWorkflows');
const workflowBulkRoutes = require('./server/routes/workflowBulk');
const runRoutes = require('./server/routes/runs');
const insightRoutes = require('./server/routes/insights');
const tenantRoutes = require('./server/routes/tenants');
const scheduleRoutes = require('./server/routes/schedules');
const triggerRoutes = require('./server/routes/triggers');
const schedulerRoutes = require('./server/routes/scheduler');
const alertsIngestRoutes = require('./server/routes/alertsIngest');
const findingRoutes = require('./server/routes/findings');
const notificationRoutes = require('./server/routes/notifications');

const app = express();
app.set('trust proxy', 1);

// CORS configuration for UI
const allowedOrigins = (process.env.UI_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser or same-origin requests without an Origin header.
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));
// The signed-link confirmation page (server/lib/actionConfirmationPage.js) is a
// plain HTML <form> with no JS, so its POST arrives as
// application/x-www-form-urlencoded, not JSON -- without this, req.body would be
// empty for that one route.
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Version check endpoint - update this timestamp on each deploy to verify
app.get('/version', (req, res) => {
  res.json({ 
    version: '1.0.1',
    deployedAt: '2026-02-13T17:00:00Z',
    features: ['atc_sessions_delta_pct', 'branch_rule_evaluations']
  });
});

app.use('/auth', authRoutes);
app.use('/tenants', tenantRoutes);
app.use('/workflows/global', globalWorkflowRoutes);
app.use('/workflows', workflowBulkRoutes);
app.use('/tenants/:tenantId/workflows', workflowRoutes);
app.use('/tenants/:tenantId/workflows', runRoutes);
app.use('/tenants/:tenantId/workflows', scheduleRoutes);
app.use('/tenants/:tenantId/insights', insightRoutes);
app.use('/tenants/:tenantId/triggers', triggerRoutes);
app.use('/tenants/:tenantId/scheduler', schedulerRoutes);
app.use('/tenants', alertsIngestRoutes);
app.use('/tenants/:tenantId/findings', findingRoutes);
app.use('/tenants/:tenantId/notifications', notificationRoutes);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'internal_error'
  });
});

async function start() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
