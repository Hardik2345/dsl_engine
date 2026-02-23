const TERMINAL_STATUSES = ['completed', 'terminated', 'failed', 'dead_letter', 'canceled'];

async function pruneWorkflowRuns(model, tenantId, workflowId, keep = 4) {
  const staleRuns = await model
    .find({
      tenantId,
      workflowId,
      status: { $in: TERMINAL_STATUSES }
    })
    .sort({ startedAt: -1 })
    .skip(keep)
    .select('_id')
    .lean();

  if (!staleRuns.length) return [];

  const ids = staleRuns.map(run => run._id);
  await model.deleteMany({ _id: { $in: ids } });

  return ids;
}

module.exports = { pruneWorkflowRuns };
