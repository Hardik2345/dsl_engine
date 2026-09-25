const { renderEmail } = require('../server/lib/renderEmail');
const { sendEmail } = require('../server/services/emailService');
const { sendTelegram } = require('../server/services/telegramService');

async function MessagingNode(def, context, runtime = {}) {
  const channels = def.channels || {};
  const emailEnabled = channels.email === true;
  const telegramEnabled = channels.telegram === true;

  if (!emailEnabled && !telegramEnabled) {
    return { status: 'fail', reason: 'MessagingNode: select at least one channel' };
  }

  let rendered;
  try {
    rendered = renderEmail({
      format: def.format,
      template: def.template,
      context,
      branding: def.branding,
      subject: def.subject
    });
  } catch (error) {
    return { status: 'fail', reason: `MessagingNode: ${error.message}` };
  }

  const deliveries = {};
  if (emailEnabled) {
    const emailSender = runtime.emailSender || sendEmail;
    deliveries.email = await emailSender({
      to: def.email?.to || [],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text
    });
  }
  if (telegramEnabled) {
    const telegramSender = runtime.telegramSender || sendTelegram;
    deliveries.telegram = await telegramSender({
      title: rendered.subject,
      message: rendered.text,
      severity: def.telegram?.severity || 'info',
      users: def.telegram?.users || []
    });
  }

  // 'deferred': a state-engine workflow captured this send (server/lib/
  // notificationCapture.js); whether it goes out is decided after the run.
  const failedChannels = Object.entries(deliveries)
    .filter(([, delivery]) => !delivery || (delivery.status !== 'sent' && delivery.status !== 'deferred'))
    .map(([channel, delivery]) => `${channel}: ${delivery?.error || 'delivery failed'}`);
  const scratch = context.scratch || {};
  const result = {
    status: failedChannels.length ? 'fail' : 'pass',
    delta: {
      scratch: {
        ...scratch,
        messagingDeliveries: {
          ...(scratch.messagingDeliveries || {}),
          [def.id]: deliveries
        }
      }
    },
    deliveries,
    next: def.next
  };
  if (failedChannels.length) result.reason = `MessagingNode: ${failedChannels.join('; ')}`;
  return result;
}

module.exports = MessagingNode;