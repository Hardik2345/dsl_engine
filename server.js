const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const workflowRoutes = require('./server/routes/workflows');
const runRoutes = require('./server/routes/runs');
const insightRoutes = require('./server/routes/insights');

const app = express();

app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

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
