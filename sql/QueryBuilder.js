// sql/QueryBuilder.js
const templates = require('./templates');

module.exports = {
  buildMetricQuery({ tenantId, metrics, window, baselineWindow, filters = [] }) {
    return templates.metricQuery({
      tenantId,
      metrics,
      window,
      baselineWindow,
      filters
    });
  },

  buildDimensionBreakdownQuery({ tenantId, dimension, window, baselineWindow, filters }) {
    return templates.dimensionBreakdownQuery({
      tenantId,
      dimension,
      window,
      baselineWindow,
      filters
    });
  }
};
