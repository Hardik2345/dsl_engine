const { escapeHtml } = require('./emailPresets/findingV1');

const ACTION_COPY = {
  ack: { verb: 'acknowledge', done: 'Acknowledged' },
  snooze: { verb: 'snooze this finding for 24 hours', done: 'Snoozed' },
  mute: { verb: 'mute this finding', done: 'Muted' },
  unmute: { verb: 'un-mute this finding', done: 'Un-muted' },
  resolve: { verb: 'mark this finding as resolved', done: 'Resolved' },
};

function pageShell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f5f3;margin:0;padding:0;}
.card{max-width:440px;margin:60px auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);}
h1{font-size:20px;margin:0 0 12px;}
p{color:#374151;font-size:14px;line-height:1.5;}
button{margin-top:20px;padding:10px 20px;background:#111827;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;}
</style></head><body><div class="card">${body}</div></body></html>`;
}

// design §13.2: this GET only ever renders a form -- the action is applied by the
// POST it submits to, never by loading this page itself, so mail-scanner
// prefetching of the link cannot trigger the action.
function renderConfirmationPage({ tenantId, stateKey, action, token }) {
  const copy = ACTION_COPY[action] || { verb: 'apply this action', done: 'Done' };
  const body = `
    <h1>Confirm action</h1>
    <p>Click confirm to ${escapeHtml(copy.verb)}.</p>
    <form method="POST" action="/tenants/${encodeURIComponent(tenantId)}/findings/${encodeURIComponent(stateKey)}/confirm">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <input type="hidden" name="action" value="${escapeHtml(action)}">
      <button type="submit">Confirm</button>
    </form>`;
  return pageShell('Confirm action', body);
}

function renderConfirmedPage({ action }) {
  const copy = ACTION_COPY[action] || { done: 'Done' };
  return pageShell(copy.done, `<h1>${escapeHtml(copy.done)}</h1><p>You can close this page.</p>`);
}

function renderErrorPage(message) {
  return pageShell('Link error', `<h1>Link error</h1><p>${escapeHtml(message)}</p>`);
}

module.exports = { renderConfirmationPage, renderConfirmedPage, renderErrorPage };
