const { resolveEmailBranding } = require('./emailBranding');

// Renders the single email the state engine sends for one execution. The workflow's
// own email/insight nodes still produce the business analysis -- their rendered
// output is captured during the run (server/lib/notificationCapture.js) and wrapped
// here with a reason banner and subject prefix. Only when no email node ran (the
// usual case for RECOVERY, since recovered runs rarely reach the RCA branch) does
// this fall back to a built-in email carrying just the transition metadata.

const SUBJECT_PREFIX = {
  INITIAL_TRIGGER: '[TRIGGERED]',
  ESCALATION: '[CRITICAL]',
  DE_ESCALATION: '[IMPROVED]',
  RECOVERY: '[RECOVERED]'
};

const STATE_LABEL = { NORMAL: 'Normal', TRIGGERED: 'Triggered', CRITICAL: 'Critical' };

const BANNER_COLOR = {
  INITIAL_TRIGGER: '#d97706',
  ESCALATION: '#dc2626',
  REMINDER: '#d97706',
  DE_ESCALATION: '#2563eb',
  RECOVERY: '#16a34a'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(2))}` : 'unknown';
}

function subjectPrefix(decision) {
  const reason = decision.notification.reason;
  if (reason === 'REMINDER') return `[REMINDER · ${decision.resulting_state}]`;
  return SUBJECT_PREFIX[reason] || '';
}

function metricLabel(decision) {
  return decision.finding?.metric || 'metric';
}

// One-line headline per reason. Recovery wording differs by what it recovered from
// (spec §15), which evaluateState reports as recovery.from_state.
function headline(decision) {
  const metric = metricLabel(decision);
  const value = formatNumber(decision.finding?.value);
  const { normal, critical } = decision.finding?.thresholds || {};
  switch (decision.notification.reason) {
    case 'INITIAL_TRIGGER':
      return `${metric} crossed the alert threshold: ${value} (threshold ${formatNumber(normal)}).`;
    case 'ESCALATION':
      return `${metric} reached the critical threshold: ${value} (critical ${formatNumber(critical)}).`;
    case 'REMINDER':
      return `${metric} is still ${STATE_LABEL[decision.resulting_state]?.toLowerCase() || 'breaching'}: ${value}.`;
    case 'DE_ESCALATION':
      return `${metric} has improved from critical but is still above the alert threshold: ${value}.`;
    case 'RECOVERY':
      return decision.recovery?.from_state === 'CRITICAL'
        ? `${metric} has recovered to its normal trend.`
        : `${metric} has recovered from the previously detected deviation.`;
    default:
      return `${metric} state changed to ${decision.resulting_state}.`;
  }
}

function transitionLine(decision) {
  const from = decision.notification.reason === 'RECOVERY' && decision.recovery?.from_state
    ? decision.recovery.from_state
    : decision.previous_state;
  return `${STATE_LABEL[from] || from} → ${STATE_LABEL[decision.resulting_state] || decision.resulting_state}`;
}

function renderBannerHtml(decision) {
  const color = BANNER_COLOR[decision.notification.reason] || '#475569';
  const { normal, critical } = decision.finding?.thresholds || {};
  return [
    `<div style="border-left:4px solid ${color};background:#f8fafc;padding:12px 16px;margin:0 0 16px;font-family:Arial,sans-serif;">`,
    `<div style="font-size:12px;font-weight:bold;letter-spacing:0.04em;color:${color};text-transform:uppercase;">${escapeHtml(decision.notification.reason.replace(/_/g, ' '))} · ${escapeHtml(transitionLine(decision))}</div>`,
    `<div style="font-size:14px;color:#0f172a;margin-top:4px;">${escapeHtml(headline(decision))}</div>`,
    `<div style="font-size:12px;color:#64748b;margin-top:4px;">Value ${escapeHtml(formatNumber(decision.finding?.value))} · Alert at ${escapeHtml(formatNumber(normal))} · Critical at ${escapeHtml(formatNumber(critical))}</div>`,
    '</div>'
  ].join('');
}

function renderBannerText(decision) {
  return [
    `${decision.notification.reason.replace(/_/g, ' ')} (${transitionLine(decision)})`,
    headline(decision),
    `Value ${formatNumber(decision.finding?.value)} · Alert at ${formatNumber(decision.finding?.thresholds?.normal)} · Critical at ${formatNumber(decision.finding?.thresholds?.critical)}`
  ].join('\n');
}

// Keeps a captured email's own <html>/<body> wrapper intact by injecting the banner
// just inside <body> when there is one.
function injectBanner(html, bannerHtml) {
  const source = String(html || '');
  const bodyOpen = /<body[^>]*>/i.exec(source);
  if (!bodyOpen) return bannerHtml + source;
  const insertAt = bodyOpen.index + bodyOpen[0].length;
  return source.slice(0, insertAt) + bannerHtml + source.slice(insertAt);
}

function uniqueRecipients(lists) {
  const seen = new Set();
  const result = [];
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const email = String(value || '').trim();
      if (email && !seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase());
        result.push(email);
      }
    }
  }
  return result;
}

function renderFallback({ decision, workflowName, brandName, branding }) {
  const resolved = resolveEmailBranding(branding);
  const name = workflowName || 'Workflow';
  const subjectBody = `${name}${brandName ? ` · ${brandName}` : ''}: ${headline(decision)}`;
  const html = [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;">',
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;padding:24px;font-family:Arial,sans-serif;">',
    `<div style="font-size:16px;font-weight:bold;color:${resolved.primaryColor};margin-bottom:16px;">${escapeHtml(resolved.displayName)}</div>`,
    renderBannerHtml(decision),
    `<p style="font-size:14px;color:#334155;">Workflow: <strong>${escapeHtml(name)}</strong>${brandName ? ` · Brand: <strong>${escapeHtml(brandName)}</strong>` : ''}</p>`,
    `<p style="font-size:12px;color:#94a3b8;margin-top:24px;">${escapeHtml(resolved.footerText)}</p>`,
    '</div></body></html>'
  ].join('');
  const text = [renderBannerText(decision), '', `Workflow: ${name}${brandName ? ` · Brand: ${brandName}` : ''}`].join('\n');
  return { subject: subjectBody, html, text };
}

// intents: [{ to, subject, html, text }] captured from the run's email nodes.
// fallbackRecipients: used when nothing was captured.
function renderStateEmail({ decision, intents = [], fallbackRecipients = [], workflowName, brandName, branding }) {
  const prefix = subjectPrefix(decision);
  const bannerHtml = renderBannerHtml(decision);
  const bannerText = renderBannerText(decision);

  if (intents.length) {
    const [first] = intents;
    return {
      to: uniqueRecipients(intents.map((intent) => intent.to)),
      subject: `${prefix} ${first.subject || workflowName || 'Workflow alert'}`.trim(),
      html: injectBanner(intents.map((intent) => intent.html || '').join('<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">'), bannerHtml),
      text: [bannerText, ...intents.map((intent) => intent.text || '')].join('\n\n')
    };
  }

  const fallback = renderFallback({ decision, workflowName, brandName, branding });
  return {
    to: uniqueRecipients([fallbackRecipients]),
    subject: `${prefix} ${fallback.subject}`.trim(),
    html: fallback.html,
    text: fallback.text
  };
}

// Recipients for the built-in fallback email: whatever the workflow itself would
// have mailed -- every email node's `to` plus every insight node's `email.to`.
function collectWorkflowRecipients(definition = {}) {
  const lists = [];
  for (const node of definition.nodes || []) {
    if (node.type === 'email') lists.push(node.to);
    if (node.type === 'insight' && node.email?.enabled) lists.push(node.email.to);
  }
  return uniqueRecipients(lists);
}

module.exports = {
  renderStateEmail,
  collectWorkflowRecipients,
  headline
};
