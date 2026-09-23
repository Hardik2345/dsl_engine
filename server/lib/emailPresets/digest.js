const { resolveEmailBranding } = require('../emailBranding');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TRANSITION_LABELS = {
  new: 'NEW', active: 'ACTIVE', escalation: 'WORSENING', recurrence: 'RECURRENCE', resolved: 'RESOLVED',
};

// design §12.3. One mail listing burst overflow and flap-demoted findings, grouped
// by transition, one line per finding, linking into the UI. `items` is
// NotificationSpool.items[]: { stateKey, transition, snapshot: {label, deltaPct} }.
function renderDigestEmail({ items, branding, brandNameOverride, subject: subjectOverride }) {
  const brand = resolveEmailBranding({ displayName: brandNameOverride }, branding);
  const subject = subjectOverride || `[DIGEST] ${brand.displayName}: ${items.length} finding${items.length === 1 ? '' : 's'}`;

  const grouped = new Map();
  for (const item of items) {
    const key = item.transition || 'active';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  const sections = Array.from(grouped.entries()).map(([transition, groupItems]) => {
    const rows = groupItems.map((item) => {
      const label = item.snapshot?.label || item.stateKey;
      const delta = item.snapshot?.deltaPct;
      const deltaText = delta == null ? '' : ` (${delta > 0 ? '+' : ''}${Number(delta).toFixed(2)}%)`;
      return `<li style="margin-bottom:6px;">${escapeHtml(label)}${escapeHtml(deltaText)}</li>`;
    }).join('');
    return `<div style="margin-top:16px;"><div style="font-size:13px;font-weight:800;text-transform:uppercase;color:${brand.primaryColor};">${escapeHtml(TRANSITION_LABELS[transition] || transition)}</div><ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:#111827;">${rows}</ul></div>`;
  }).join('');

  const html = `<!doctype html><html><head><meta name="color-scheme" content="light only"></head><body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,sans-serif;color:#111827;"><div style="max-width:640px;margin:0 auto;background:#fff;padding:28px;">
    <div style="font-size:22px;font-weight:800;">${escapeHtml(items.length)} finding${items.length === 1 ? '' : 's'} rolled into this digest</div>
    ${sections}
    <div style="margin-top:22px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">See the workflow dashboard for full detail on each finding.</div>
    <div style="margin-top:18px;font-size:11px;color:#9ca3af;">${escapeHtml(brand.footerText)}</div>
  </div></body></html>`;

  const text = [
    `${items.length} finding${items.length === 1 ? '' : 's'} rolled into this digest`,
    '',
    ...Array.from(grouped.entries()).flatMap(([transition, groupItems]) => [
      `${(TRANSITION_LABELS[transition] || transition).toUpperCase()}:`,
      ...groupItems.map((item) => `- ${item.snapshot?.label || item.stateKey}`),
      '',
    ]),
    brand.footerText,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { renderDigestEmail };
