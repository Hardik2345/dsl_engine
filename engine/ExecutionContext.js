const context = {
  meta: {
    tenantId: 'TMC',
    metric: 'cvr',
    triggeredAt: '2026-01-16 23:59:59',
    window: {
      start: '2026-01-18 00:00:00',
      end: '2026-01-19 00:00:00'
    },
    baselineWindow: {
      type: 'previous_day_same_hour',
      start: '2026-01-17 00:00:00',
      end: '2026-01-18 00:00:00'
    }
  },
  filters: [],
  metrics: {},
  rootCausePath: [],
  scratch: {}
};

module.exports = context;
