const { formatEvidencePath } = require('../insightUtils');
const { resolveEmailBranding } = require('../emailBranding');
const { signActionToken } = require('../signedActionLink');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TRANSITION_LABELS = {
  new: 'NEW',
  active: 'ACTIVE',
  escalation: 'WORSENING',
  recurrence: 'RECURRENCE',
  resolved: 'RESOLVED',
};

// Design doc §12.1. Subject prefix communicates the transition at a glance so the
// inbox itself carries information without opening the mail.
function buildSubject({ finding, brandName }) {
  const prefix = TRANSITION_LABELS[finding.transition] || finding.transition?.toUpperCase() || 'UPDATE';
  const dayNote = finding.daysOpen > 1 ? ` day ${finding.daysOpen}` : '';
  return `[${prefix}]${dayNote} ${brandName || ''}: ${finding.label}`.replace(/\s+/g, ' ').trim();
}

function formatPct(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return 'unknown';
  return `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
}

function renderTrendLine(trend) {
  if (!Array.isArray(trend) || !trend.length) return null;
  return trend.map((point) => formatPct(point)).join(' → ');
}

// design §13.2/§9.1. Builds one-click confirmation links per action. Falls back to
// no links (not a crash) when FINDING_ACTION_JWT_SECRET isn't configured -- a dev
// environment without it configured should still be able to send finding mail, it
// just won't have working action links until the secret is set.
function buildActionLinks({ tenantId, stateKey }) {
  if (!tenantId || !stateKey) return null;
  const baseUrl = process.env.APP_PUBLIC_URL;
  if (!baseUrl) return null;

  const actions = [
    { action: 'ack', label: 'Ack', expiresIn: '24h' },
    { action: 'snooze', label: 'Snooze 24h', expiresIn: '7d' },
    { action: 'mute', label: 'Mute', expiresIn: '7d' },
  ];

  try {
    return actions.map(({ action, label, expiresIn }) => {
      const token = signActionToken({ tenantId, stateKey, action, expiresIn });
      const url = `${baseUrl.replace(/\/$/, '')}/tenants/${encodeURIComponent(tenantId)}/findings/${encodeURIComponent(stateKey)}/confirm?action=${action}&token=${encodeURIComponent(token)}`;
      return { label, url };
    });
  } catch (error) {
    return null; // signing secret not configured -- fall back to no links
  }
}

// design §12.2 finding_v1 preset. `finding` shape:
// { label, entry (breakdown-entry shaped for formatEvidencePath), transition,
//   firstSeenAt, daysOpen, episodeCount, severityTier, trend[], current, baseline,
//   deltaPct, stateKey }
function renderFindingEmail({ finding, branding, brandNameOverride, subject: subjectOverride }) {
  const brand = resolveEmailBranding({ displayName: brandNameOverride }, branding);
  const subject = subjectOverride || buildSubject({ finding, brandName: brand.displayName });
  const evidencePath = formatEvidencePath(finding.entry, { includeLabels: true }) || finding.label;
  const trendLine = renderTrendLine(finding.trend);
  const actionLinks = buildActionLinks({ tenantId: finding.tenantId, stateKey: finding.stateKey });
  const actionFooterHtml = actionLinks
    ? actionLinks.map((link) => `<a href="${escapeHtml(link.url)}" style="color:${brand.primaryColor};text-decoration:none;font-weight:700;margin-right:16px;">${escapeHtml(link.label)}</a>`).join('')
    : 'Manage this finding in the workflow dashboard.';

  const html = `<!doctype html><html><head><meta name="color-scheme" content="light only"></head><body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,sans-serif;color:#111827;"><div style="max-width:640px;margin:0 auto;background:#fff;padding:28px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:${brand.primaryColor};text-transform:uppercase;">${escapeHtml(TRANSITION_LABELS[finding.transition] || finding.transition)}</div>
    <div style="margin-top:8px;font-size:24px;font-weight:800;color:#050505;">${escapeHtml(finding.label)}</div>
    <div style="margin-top:6px;font-size:13px;color:#6b7280;">${escapeHtml(evidencePath)}</div>
    <div style="margin-top:18px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#374151;">
      First seen: ${escapeHtml(finding.firstSeenAt || 'unknown')}<br>
      Days open: ${escapeHtml(finding.daysOpen ?? 'unknown')}<br>
      Episode: ${escapeHtml(finding.episodeCount ?? 1)}<br>
      Severity: ${escapeHtml(finding.severityTier || 'n/a')}
    </div>
    ${trendLine ? `<div style="margin-top:14px;font-size:14px;color:#374151;">Trend: ${escapeHtml(trendLine)}</div>` : ''}
    <div style="margin-top:14px;font-size:14px;color:#111827;">Current: ${escapeHtml(finding.current ?? 'unknown')} &middot; Baseline: ${escapeHtml(finding.baseline ?? 'unknown')} &middot; Change: ${escapeHtml(formatPct(finding.deltaPct))}</div>
    <div style="margin-top:22px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:13px;">${actionFooterHtml}</div>
    <div style="margin-top:18px;font-size:11px;color:#9ca3af;">${escapeHtml(brand.footerText)}</div>
  </div></body></html>`;

  const text = [
    `[${TRANSITION_LABELS[finding.transition] || finding.transition}] ${finding.label}`,
    evidencePath,
    '',
    `First seen: ${finding.firstSeenAt || 'unknown'}`,
    `Days open: ${finding.daysOpen ?? 'unknown'}`,
    `Episode: ${finding.episodeCount ?? 1}`,
    `Severity: ${finding.severityTier || 'n/a'}`,
    trendLine ? `Trend: ${trendLine}` : null,
    `Current: ${finding.current ?? 'unknown'} | Baseline: ${finding.baseline ?? 'unknown'} | Change: ${formatPct(finding.deltaPct)}`,
    '',
    actionLinks ? actionLinks.map((link) => `${link.label}: ${link.url}`).join('\n') : 'Manage this finding in the workflow dashboard.',
    '',
    brand.footerText,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

module.exports = { renderFindingEmail, buildSubject, escapeHtml };
