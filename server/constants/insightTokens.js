const INSIGHT_TOP_TOKEN_COUNT = 4;

const INSIGHT_TOP_TOKEN_SUFFIXES = [
  'dimension',
  'dimension_label',
  'value',
  'cvr_delta_pct_fmt',
  'atc_rate_delta_pct_fmt',
  'sessions_delta_pct',
  'sessions_delta_pct_fmt',
  'orders_delta_pct',
  'orders_delta_pct_fmt',
];

const DIMENSION_LABELS = {
  product_id: 'Product',
};

module.exports = {
  INSIGHT_TOP_TOKEN_COUNT,
  INSIGHT_TOP_TOKEN_SUFFIXES,
  DIMENSION_LABELS,
};
