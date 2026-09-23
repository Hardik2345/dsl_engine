const { renderEmail } = require('../server/lib/renderEmail');
const { sendEmail } = require('../server/services/emailService');
const { resolveBinding } = require('../server/lib/emailBindings');

// Per-finding fan-out (design doc §9.3). Declares one notification intent per item
// in the referenced array rather than sending -- "no SMTP call happens during
// execution" holds even in fan-out mode; the post-run notifier renders and delivers.
// Kept as its own function (rather than interleaved into the legacy single-send path
// below) since this is a genuinely different mode for what is otherwise a small,
// single-path file.
function handleForEach(def, context) {
  const resolved = resolveBinding(context, def.for_each);
  const items = Array.isArray(resolved.value) ? resolved.value : [];
  // Only items the state machine actually decided to notify about -- iterating every
  // observed finding regardless of `notify` would defeat the suppression pipeline
  // this whole node type exists to respect.
  const notifyItems = items.filter((item) => item?.notify !== false);

  const notifications = notifyItems.map((item, index) => ({
    intentId: item.stateKey || item.intentId || `${def.id}-${index}`,
    nodeId: def.id,
    channel: 'email',
    format: def.format === 'finding' ? 'finding' : def.format,
    forEach: def.for_each,
    transition: item.transition,
    criticalBypass: item.criticalBypass,
    finding: item.finding || item,
    to: def.to,
    subject: def.subject,
    branding: def.branding,
  }));

  return {
    status: 'pass',
    delta: { notifications },
    next: def.next,
  };
}

async function EmailNode(def, context, runtime = {}) {
  if (def.for_each) {
    return handleForEach(def, context);
  }

  let rendered;
  try {
    rendered = renderEmail({
      format: def.format,
      template: def.template,
      context,
      branding: def.branding,
      subject: def.subject,
    });
  } catch (error) {
    return { status: 'fail', reason: `EmailNode: ${error.message}` };
  }

  const emailSender = runtime.emailSender || sendEmail;
  let delivery;
  try {
    delivery = await emailSender({
      to: def.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (error) {
    return { status: 'fail', reason: `EmailNode: ${error.message}` };
  }
  const acceptedStatuses = new Set(['sent', 'skipped', 'suppressed']);
  if (!delivery || !acceptedStatuses.has(delivery.status)) {
    return { status: 'fail', reason: `EmailNode: ${delivery?.error || 'email delivery failed'}`, delivery };
  }

  const scratch = context.scratch || {};
  return {
    status: 'pass',
    delta: {
      scratch: {
        ...scratch,
        emailDeliveries: {
          ...(scratch.emailDeliveries || {}),
          [def.id]: delivery,
        }
      }
    },
    delivery,
    next: def.next,
  };
}

module.exports = EmailNode;
