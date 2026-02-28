export const REQUIRED_OUTPUT_KEYS = [
  'orders_product_drops',
  'atc_rate_product_drops',
  'sessions_product_drops',
  'cvr_product_drops',
];

export const OPTIONAL_OUTPUT_KEYS = [
  'baseline_top5_pages',
  'baseline_bottom5_pages',
  'top_pages',
  'bottom_pages',
  'top_segments',
  'bottom_segments',
];

export const OUTPUT_KEY_SUGGESTIONS = [
  ...REQUIRED_OUTPUT_KEYS,
  ...OPTIONAL_OUTPUT_KEYS,
];

export const sanitizeOutputKeySegment = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'key';

export const buildDefaultBreakdownOutputKey = ({ baseMetric, dimension, filterMode }) => {
  const metricPart = sanitizeOutputKeySegment(baseMetric || 'cvr');
  const dimensionPart = sanitizeOutputKeySegment(dimension || 'dimension');
  let direction = 'all';
  if (filterMode === 'drop') direction = 'drops';
  else if (filterMode === 'increase') direction = 'increases';
  return `${metricPart}_${dimensionPart}_${direction}`;
};
