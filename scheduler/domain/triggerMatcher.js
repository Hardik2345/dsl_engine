function extractTrigger(definition) {
  return definition && typeof definition === 'object' ? definition.trigger || null : null;
}

function matchesBrandScope(trigger, tenantId) {
  if (!trigger) return false;

  const scope = trigger.brandScope;
  if (scope === 'global') return true;

  const brandIds = Array.isArray(trigger.brandIds) ? trigger.brandIds : [];
  if (scope === 'single' || scope === 'multiple') {
    return brandIds.includes(tenantId);
  }

  return false;
}

function selectWorkflowMatch(candidates, tenantId, alertType) {
  const eligible = candidates.filter(({ definition }) => {
    const trigger = extractTrigger(definition);
    if (!trigger || trigger.alertType !== alertType) return false;
    return matchesBrandScope(trigger, tenantId);
  });

  if (!eligible.length) return null;

  const brandSpecific = eligible.filter(({ definition }) => {
    const scope = definition?.trigger?.brandScope;
    return scope === 'single' || scope === 'multiple';
  });

  const target = brandSpecific.length ? brandSpecific : eligible;

  target.sort((a, b) => {
    const aAt = new Date(a.workflow.updatedAt || 0).getTime();
    const bAt = new Date(b.workflow.updatedAt || 0).getTime();
    return bAt - aAt;
  });

  return target[0];
}

module.exports = {
  selectWorkflowMatch
};
