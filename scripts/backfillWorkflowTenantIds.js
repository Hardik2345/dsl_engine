const mongoose = require('mongoose');
require('dotenv').config();

const Workflow = require('../server/models/Workflow');
const WorkflowVersion = require('../server/models/WorkflowVersion');

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);

  const tenantWorkflows = await Workflow.find({
    scope: { $ne: 'global' },
    tenantId: { $ne: null },
    $or: [
      { tenantIds: { $exists: false } },
      { tenantIds: { $size: 0 } }
    ]
  }).lean();

  let workflowsModified = 0;
  let versionsModified = 0;

  for (const workflow of tenantWorkflows) {
    const tenantIds = [workflow.tenantId];

    const workflowResult = await Workflow.updateOne(
      { _id: workflow._id },
      { $set: { tenantIds } }
    );
    workflowsModified += workflowResult.modifiedCount || 0;

    const versionResult = await WorkflowVersion.updateMany(
      {
        workflowId: workflow.workflowId,
        tenantId: workflow.tenantId,
        $or: [
          { tenantIds: { $exists: false } },
          { tenantIds: { $size: 0 } }
        ]
      },
      { $set: { tenantIds } }
    );
    versionsModified += versionResult.modifiedCount || 0;
  }

  const globalWorkflowResult = await Workflow.updateMany(
    { scope: 'global', tenantId: null, tenantIds: { $exists: false } },
    { $set: { tenantIds: [] } }
  );

  const globalVersionResult = await WorkflowVersion.updateMany(
    { scope: 'global', tenantId: null, tenantIds: { $exists: false } },
    { $set: { tenantIds: [] } }
  );

  console.log(JSON.stringify({
    tenantWorkflowsMatched: tenantWorkflows.length,
    workflowsModified,
    versionsModified,
    globalWorkflowsModified: globalWorkflowResult.modifiedCount || 0,
    globalVersionsModified: globalVersionResult.modifiedCount || 0
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
