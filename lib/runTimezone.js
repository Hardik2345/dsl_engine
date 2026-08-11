const { BUSINESS_TIME_ZONE, isSupportedTimeZone } = require('./timeWindowUtils');

function resolveTenantTimezone(timezone) {
  return isSupportedTimeZone(timezone) ? timezone : 'UTC';
}

function resolveManualRunTimezone({ rerun = false, contextTimezone, tenantTimezone }) {
  const resolvedTenantTimezone = resolveTenantTimezone(tenantTimezone);
  if (rerun && isSupportedTimeZone(contextTimezone)) {
    return contextTimezone;
  }
  return resolvedTenantTimezone;
}

function resolveLegacyExecutionTimezone(contextTimezone) {
  return isSupportedTimeZone(contextTimezone) ? contextTimezone : BUSINESS_TIME_ZONE;
}

module.exports = {
  resolveTenantTimezone,
  resolveManualRunTimezone,
  resolveLegacyExecutionTimezone,
};
