const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const workflowRoutes = require('./server/routes/workflows');
const globalWorkflowRoutes = require('./server/routes/globalWorkflows');
const runRoutes = require('./server/routes/runs');
const insightRoutes = require('./server/routes/insights');
const tenantRoutes = require('./server/routes/tenants');

const app = express();

// CORS configuration for UI
app.use(cors({
  origin: process.env.UI_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/tenants', tenantRoutes);
app.use('/workflows/global', globalWorkflowRoutes);
app.use('/tenants/:tenantId/workflows', workflowRoutes);
app.use('/tenants/:tenantId/workflows', runRoutes);
app.use('/tenants/:tenantId/insights', insightRoutes);

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
