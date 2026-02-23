const RabbitBrokerClient = require('../broker/rabbit/RabbitBrokerClient');
const { processEnvelope } = require('../../app/eventSubscriberService');

const DEFAULT_BINDINGS = [
  'alerts.config.created',
  'alerts.config.updated',
  'alerts.config.deleted',
  'alerts.fired'
];

async function startAlertSubscriber({ stopSignal }) {
  const client = new RabbitBrokerClient();

  const bindings = (process.env.RABBITMQ_BINDINGS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const activeBindings = bindings.length ? bindings : DEFAULT_BINDINGS;

  const runner = client.subscribe({
    bindings: activeBindings,
    stopSignal,
    handler: async (message) => {
      const envelope = message.payload;
      const outcome = await processEnvelope(envelope);
      if (!outcome.duplicate) {
        console.log(`[alert-subscriber] processed ${envelope.eventType} tenant=${envelope.tenantId} alertId=${envelope.alertId} status=${outcome.status}`);
      }
    }
  });

  return {
    promise: runner,
    close: async () => client.close()
  };
}

module.exports = {
  startAlertSubscriber
};
