const INSIGHT_TOP_TOKEN_COUNT = 4;

const INSIGHT_TOP_TOKEN_SUFFIXES = [
  'dimension',
  'dimension_label',
  'value',
  'parent_dimension',
  'parent_dimension_label',
  'parent_value',
  'path',
  'path_labels',
  'cvr_delta_pct_fmt',
  'atc_rate_delta_pct_fmt',
  'sessions_delta_pct',
  'sessions_delta_pct_fmt',
  'orders_delta_pct',
  'orders_delta_pct_fmt',
];

const DIMENSION_LABELS = {
  product_id: 'Product',
  utm_source: 'UTM Source',
  utm_medium: 'UTM Medium',
  utm_campaign: 'UTM Campaign',
  utm_content: 'UTM Content',
  utm_term: 'UTM Term',
  landing_page_path: 'Landing Page',
  landing_page_type: 'Landing Page Type',
  referrer_name: 'Referrer',
};

module.exports = {
  INSIGHT_TOP_TOKEN_COUNT,
  INSIGHT_TOP_TOKEN_SUFFIXES,
  DIMENSION_LABELS,
};
