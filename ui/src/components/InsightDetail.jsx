function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeDetail(detail) {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return {
      title: String(detail.title || '').trim(),
      items: Array.isArray(detail.items) ? detail.items.flatMap(splitLines) : [],
    };
  }

  const lines = splitLines(detail);
  return {
    title: lines[0] || '',
    items: lines.slice(1),
  };
}

function formatLargeIntegers(value) {
  return String(value || '')
    .replace(/\s*->\s*/g, ' → ')
    .replace(/\b\d{4,}\b/g, (token) => Number(token).toLocaleString('en-US'));
}

function parseMetricSegment(segment) {
  const normalized = formatLargeIntegers(segment);
  const metricMatch = normalized.match(/^([^\d+-]*?)([+-]?\d.*)$/);
  const label = metricMatch?.[1]?.trim() || '';
  const rawValue = metricMatch?.[2]?.trim() || normalized;
  const deltaMatch = rawValue.match(/^(.*?)\s+\((?:change\s+)?([+-]?\d+(?:\.\d+)?%)\)$/i);

  if (!deltaMatch) {
    return { label, value: rawValue, delta: null, deltaValue: null };
  }

  const deltaValue = Number(deltaMatch[2].replace('%', ''));
  return {
    label,
    value: deltaMatch[1].trim(),
    delta: `${deltaValue > 0 ? '+' : ''}${deltaMatch[2]}`,
    deltaValue,
  };
}

function parseRankedItem(item) {
  const match = String(item || '').match(/^(\d+)\.\s+(.+)$/);
  if (!match) return null;

  const parts = match[2].split(' | ').map((part) => part.trim()).filter(Boolean);
  return {
    rank: Number(match[1]),
    label: parts[0] || `Rank ${match[1]}`,
    metrics: parts.slice(1).map(parseMetricSegment),
  };
}

function DeltaBadge({ value, numericValue }) {
  if (!value) return null;
  const tone = numericValue > 0
    ? 'bg-emerald-50 text-emerald-700'
    : numericValue < 0
      ? 'bg-red-50 text-red-700'
      : 'bg-gray-100 text-gray-600';

  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}>
      {value}
    </span>
  );
}

function RankedEntry({ entry, compact }) {
  return (
    <div className="rounded-md border border-primary-100 bg-white/80 p-2.5">
      <div className="flex items-start gap-2.5">
        <span className="flex h-6 min-w-6 items-center justify-center rounded bg-primary-100 px-1.5 text-[11px] font-bold text-primary-700">
          {entry.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-xs font-semibold text-primary-950">{entry.label}</div>
          {entry.metrics.length > 0 && (
            <dl className={`mt-2 grid gap-1.5 ${compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
              {entry.metrics.map((metric, index) => (
                <div key={index} className="flex min-w-0 items-center justify-between gap-2 rounded bg-primary-50/70 px-2 py-1.5">
                  {metric.label && (
                    <dt className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary-600">
                      {metric.label}
                    </dt>
                  )}
                  <dd className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-right text-[11px] font-medium tabular-nums text-primary-900">
                    <span>{metric.value}</span>
                    <DeltaBadge value={metric.delta} numericValue={metric.deltaValue} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InsightDetail({ detail, compact = false, maxItems }) {
  const normalized = normalizeDetail(detail);
  const parsedItems = normalized.items.map((item) => ({ raw: item, ranked: parseRankedItem(item) }));
  const visibleItems = Number.isFinite(maxItems) ? parsedItems.slice(0, maxItems) : parsedItems;
  const hiddenCount = parsedItems.length - visibleItems.length;

  return (
    <section className="rounded-md border border-primary-100 bg-primary-50/40 p-3">
      {normalized.title && (
        <h4 className="text-xs font-semibold text-primary-900">{normalized.title}</h4>
      )}
      {visibleItems.length > 0 && (
        <div className="mt-2 space-y-2">
          {visibleItems.map(({ raw, ranked }, index) => ranked
            ? <RankedEntry key={index} entry={ranked} compact={compact} />
            : (
              <div key={index} className="rounded bg-white/80 px-2.5 py-2 text-xs leading-5 text-primary-800">
                {String(raw).replace(/\s*->\s*/g, ' → ')}
              </div>
            ))}
        </div>
      )}
      {hiddenCount > 0 && (
        <div className="mt-2 text-[11px] font-medium text-primary-600">+{hiddenCount} more</div>
      )}
    </section>
  );
}
