const SQL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function parseSqlDateTime(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace('T', ' ').replace('Z', '');
  const match = normalized.match(SQL_DATETIME_RE);
  if (!match) return null;

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second = '00'
  ] = match;

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    normalized: `${year}-${month}-${day} ${hour}:${minute}:${second}`
  };
}

function toUtcMs(parts) {
  if (!parts) return NaN;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

function isHourAligned(value) {
  const parts = typeof value === 'string' ? parseSqlDateTime(value) : value;
  return Boolean(parts) && parts.minute === 0 && parts.second === 0;
}

function isFullDayAlignedWindow(start, end) {
  const startParts = typeof start === 'string' ? parseSqlDateTime(start) : start;
  const endParts = typeof end === 'string' ? parseSqlDateTime(end) : end;
  if (!startParts || !endParts) return false;
  if (!isHourAligned(startParts) || !isHourAligned(endParts)) return false;
  if (startParts.hour !== 0 || endParts.hour !== 0) return false;

  const durationMs = toUtcMs(endParts) - toUtcMs(startParts);
  if (durationMs <= 0) return false;

  const hourMs = 60 * 60 * 1000;
  const durationHours = durationMs / hourMs;
  return Number.isInteger(durationHours) && durationHours % 24 === 0;
}

function isPartialDayWindow(start, end) {
  const startParts = typeof start === 'string' ? parseSqlDateTime(start) : start;
  const endParts = typeof end === 'string' ? parseSqlDateTime(end) : end;
  if (!startParts || !endParts) return false;
  if (!isHourAligned(startParts) || !isHourAligned(endParts)) return false;
  return !isFullDayAlignedWindow(startParts, endParts);
}

function hasPositiveDuration(start, end) {
  const startParts = typeof start === 'string' ? parseSqlDateTime(start) : start;
  const endParts = typeof end === 'string' ? parseSqlDateTime(end) : end;
  if (!startParts || !endParts) return false;
  return toUtcMs(endParts) > toUtcMs(startParts);
}

function listHourlyProductUnsupportedFilters(filters = []) {
  return (Array.isArray(filters) ? filters : [])
    .filter((filter) => filter?.dimension && filter.dimension !== 'product_id')
    .map((filter) => filter.dimension);
}

module.exports = {
  parseSqlDateTime,
  isHourAligned,
  isFullDayAlignedWindow,
  isPartialDayWindow,
  hasPositiveDuration,
  listHourlyProductUnsupportedFilters,
};
