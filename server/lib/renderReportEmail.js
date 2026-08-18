const { resolveBinding } = require('./emailBindings');
const { resolveEmailBranding } = require('./emailBranding');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requireBinding(root, path) {
  const resolved = resolveBinding(root, path);
  if (!resolved.found || resolved.value === undefined || resolved.value === null) {
    throw new Error(`missing required binding: ${path}`);
  }
  return resolved.value;
}

function formatValue(value, format = 'text') {
  if (format === 'text') return String(value ?? '');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`value is not numeric for format ${format}`);
  if (format === 'integer') return Math.round(number).toLocaleString('en-US');
  if (format === 'decimal') return number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (format === 'percent_ratio') return `${(number * 100).toFixed(2)}%`;
  if (format === 'percent') return `${number.toFixed(2)}%`;
  if (format === 'delta_percent') return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
  throw new Error(`unsupported value format: ${format}`);
}

function formatDate(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid report date: ${value}`);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: timezone || 'UTC'
  }).format(date).toUpperCase();
}

function formatRange(range, timezone) {
  return `${formatDate(range.start, timezone)} – ${formatDate(range.end, timezone)}`;
}

function buildReportViewModel({ context, template, branding }) {
  if (template?.preset !== 'performance_report_v1') {
    throw new Error(`unsupported report preset: ${template?.preset || 'missing'}`);
  }
  const timezone = context?.meta?.timezone || 'UTC';
  const currentPeriod = requireBinding(context, template.period.current);
  const comparisonPeriod = requireBinding(context, template.period.comparison);
  if (!currentPeriod?.start || !currentPeriod?.end || !comparisonPeriod?.start || !comparisonPeriod?.end) {
    throw new Error('report period bindings must resolve to start/end objects');
  }

  const metrics = template.metrics.map((item) => {
    const rawValue = requireBinding(context, item.value);
    const rawChange = item.change ? requireBinding(context, item.change) : null;
    return {
      label: item.label,
      icon: item.icon || 'metric',
      value: formatValue(rawValue, item.format),
      change: rawChange == null ? null : formatValue(rawChange, 'delta_percent'),
      changeValue: rawChange == null ? null : Number(rawChange),
    };
  });

  const tables = template.tables.map((table) => {
    const source = requireBinding(context, table.source);
    if (!Array.isArray(source)) throw new Error(`table source must resolve to an array: ${table.source}`);
    return {
      title: table.title,
      tone: table.tone || 'neutral',
      columns: table.columns.map((column) => ({ label: column.label })),
      rows: source.slice(0, table.limit).map((entry, index) => ({
        rank: index + 1,
        cells: table.columns.map((column) => {
          const rawValue = requireBinding(entry, column.path);
          return {
            value: formatValue(rawValue, column.format),
            numericValue: column.format === 'delta_percent' ? Number(rawValue) : null,
            format: column.format,
          };
        })
      }))
    };
  });

  return {
    branding: resolveEmailBranding({
      displayName: context?.meta?.brandName,
      ...(context?.meta?.emailBranding || {}),
    }, branding),
    eyebrow: template.eyebrow,
    title: template.title,
    description: template.description || '',
    timezone,
    currentPeriod,
    comparisonPeriod,
    currentDate: formatDate(currentPeriod.start, timezone),
    comparisonDate: formatDate(comparisonPeriod.start, timezone),
    currentRange: formatRange(currentPeriod, timezone),
    comparisonRange: formatRange(comparisonPeriod, timezone),
    metrics,
    tables,
  };
}

function changeColor(value) {
  if (value > 0) return '#4fbd19';
  if (value < 0) return '#ef2929';
  return '#6b7280';
}

function iconGlyph(icon) {
  return { sessions: '◎', orders: '▣', conversion: '↗', trend: '↗', metric: '●' }[icon] || '●';
}

function renderMetricCards(metrics, primaryColor) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;"><tr>${metrics.map((metric, index) => `
    <td width="${Math.floor(100 / metrics.length)}%" align="center" style="padding:24px 10px;border-left:${index ? '1px solid #e5e7eb' : 'none'};">
      <div aria-hidden="true" style="font-size:22px;line-height:1;color:${primaryColor};">${iconGlyph(metric.icon)}</div>
      <div style="font-size:12px;font-weight:700;color:${primaryColor};text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(metric.label)}</div>
      <div style="margin-top:12px;font-size:27px;font-weight:800;color:#111827;">${escapeHtml(metric.value)}</div>
      ${metric.change == null ? '' : `<div style="margin-top:8px;font-size:15px;font-weight:700;color:${changeColor(metric.changeValue)};">${metric.changeValue > 0 ? '↑' : metric.changeValue < 0 ? '↓' : '—'} ${escapeHtml(metric.change)}</div>`}
    </td>`).join('')}</tr></table>`;
}

function renderTable(table, primaryColor) {
  const toneColor = table.tone === 'negative' ? '#ef2929' : table.tone === 'positive' ? primaryColor : '#374151';
  const header = [`<th align="left" style="padding:10px;width:36px;color:#4b5563;font-size:11px;">#</th>`, ...table.columns.map((column) => `<th align="left" style="padding:10px;color:#4b5563;font-size:11px;text-transform:uppercase;">${escapeHtml(column.label)}</th>`)].join('');
  const rows = table.rows.length ? table.rows.map((row) => `<tr style="border-top:1px solid #e5e7eb;"><td style="padding:13px 10px;"><span style="display:inline-block;width:25px;height:25px;line-height:25px;text-align:center;border-radius:3px;background:${toneColor};color:#fff;font-weight:700;">${row.rank}</span></td>${row.cells.map((cell) => `<td style="padding:13px 10px;font-size:14px;color:${cell.format === 'delta_percent' ? changeColor(cell.numericValue) : '#111827'};font-weight:${cell.format === 'delta_percent' ? '700' : '500'};">${cell.format === 'delta_percent' ? (cell.numericValue > 0 ? '↑ ' : cell.numericValue < 0 ? '↓ ' : '— ') : ''}${escapeHtml(cell.value)}</td>`).join('')}</tr>`).join('') : `<tr style="border-top:1px solid #e5e7eb;"><td colspan="${table.columns.length + 1}" align="center" style="padding:22px;color:#6b7280;font-size:13px;">No data available</td></tr>`;
  return `<div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:8px;padding:20px;"><div style="font-size:16px;font-weight:800;color:${toneColor};text-transform:uppercase;">${escapeHtml(table.title)}</div><table role="table" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-collapse:collapse;"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderReportEmail({ context, template, branding, subject }) {
  const view = buildReportViewModel({ context, template, branding });
  const brand = view.branding;
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.displayName)}" style="max-height:42px;max-width:190px;display:block;">`
    : `<div style="font-size:24px;font-weight:900;letter-spacing:.22em;color:#111827;">${escapeHtml(brand.displayName.toUpperCase())}</div>`;
  const html = `<!doctype html><html><head><meta name="color-scheme" content="light only"></head><body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,sans-serif;color:#111827;"><div style="max-width:760px;margin:0 auto;background:#fff;padding:30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>${logo}<div style="margin-top:5px;color:${brand.primaryColor};font-size:11px;font-weight:700;letter-spacing:.12em;">${escapeHtml(brand.tagline.toUpperCase())}</div></td><td align="right"><div style="font-size:13px;color:#4b5563;text-transform:uppercase;">Daily Report</div><div style="font-size:19px;font-weight:800;color:${brand.primaryColor};">${escapeHtml(view.currentDate)}</div><div style="font-size:12px;color:#4b5563;">vs ${escapeHtml(view.comparisonDate)}</div></td></tr></table>
    <div style="height:1px;background:#e5e7eb;margin:22px -30px 28px;"></div>
    <div style="font-size:15px;font-weight:800;text-transform:uppercase;color:${brand.primaryColor};">${escapeHtml(view.eyebrow)}</div>
    <div style="margin-top:12px;font-size:38px;line-height:1.08;font-weight:900;color:#050505;">${escapeHtml(view.title)}</div>
    ${view.description ? `<div style="margin:16px 0 26px;font-size:16px;line-height:1.5;color:#5b5b5b;">${escapeHtml(view.description)}</div>` : '<div style="height:24px;"></div>'}
    ${renderMetricCards(view.metrics, brand.primaryColor)}
    ${view.tables.map((table) => renderTable(table, brand.primaryColor)).join('')}
    <div style="margin-top:22px;padding:15px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#4b5563;">Comparisons use ${escapeHtml(view.comparisonRange)} in ${escapeHtml(view.timezone)}.</div>
    <table role="presentation" width="100%" style="margin-top:26px;border-collapse:collapse;"><tr><td style="font-weight:800;letter-spacing:.15em;">${escapeHtml(brand.displayName.toUpperCase())}</td><td align="right" style="font-size:12px;color:#6b7280;">${escapeHtml(brand.footerText)}</td></tr></table>
  </div></body></html>`;

  const text = [
    brand.displayName,
    brand.tagline,
    `${view.eyebrow}: ${view.title}`,
    view.description,
    `Current period: ${view.currentRange} (${view.timezone})`,
    `Comparison period: ${view.comparisonRange} (${view.timezone})`,
    '',
    ...view.metrics.map((metric) => `${metric.label}: ${metric.value}${metric.change == null ? '' : ` (${metric.change})`}`),
    ...view.tables.flatMap((table) => ['', table.title, ...(table.rows.length ? table.rows.map((row) => `${row.rank}. ${row.cells.map((cell, index) => `${table.columns[index].label}: ${cell.value}`).join(' | ')}`) : ['No data available'])]),
    '',
    brand.footerText,
  ].filter((line) => line !== undefined && line !== null).join('\n');

  return { subject, html, text, viewModel: view };
}

module.exports = { renderReportEmail, buildReportViewModel, formatValue };
