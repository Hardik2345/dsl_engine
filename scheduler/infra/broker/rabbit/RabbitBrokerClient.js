const BrokerClient = require('../BrokerClient');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class RabbitBrokerClient extends BrokerClient {
  constructor(options = {}) {
    super();
    this.options = {
      url: options.url || process.env.RABBITMQ_URL,
      exchange: options.exchange || process.env.RABBITMQ_EXCHANGE || 'alerts.events',
      queue: options.queue || process.env.RABBITMQ_QUEUE || 'scheduler.alerts.v1',
      prefetch: Number(options.prefetch || process.env.RABBITMQ_PREFETCH || 10),
      enabled: options.enabled ?? (process.env.SCHEDULER_ALERT_SUBSCRIBER_ENABLED === 'true'),
      stubMode: options.stubMode ?? (process.env.RABBITMQ_STUB_MODE !== 'false')
    };

    this._amqplib = null;
    this._connection = null;
    this._channel = null;
    this._consumerTag = null;
  }

  async connect() {
    if (!this.options.enabled) return { connected: false, reason: 'subscriber_disabled' };

    if (this.options.stubMode) {
      return { connected: false, reason: 'rabbit_stub_mode' };
    }

    try {
      this._amqplib = require('amqplib');
    } catch (error) {
      const err = new Error('amqplib is not installed. Install it or run with RABBITMQ_STUB_MODE=true');
      err.code = 'AMQPLIB_MISSING';
      throw err;
    }

    this._connection = await this._amqplib.connect(this.options.url);
    this._channel = await this._connection.createChannel();
    await this._channel.assertExchange(this.options.exchange, 'topic', { durable: true });
    await this._channel.assertQueue(this.options.queue, { durable: true });
    await this._channel.prefetch(this.options.prefetch);

    return { connected: true };
  }

  async subscribe({ bindings = [], handler, stopSignal }) {
    if (!this.options.enabled) {
      while (!stopSignal.stopped) await sleep(1000);
      return;
    }

    const status = await this.connect();
    if (!status.connected) {
      console.log(`[rabbit-subscriber] ${status.reason}; running idle stub loop`);
      while (!stopSignal.stopped) await sleep(1000);
      return;
    }

    for (const binding of bindings) {
      await this._channel.bindQueue(this.options.queue, this.options.exchange, binding);
    }

    const consumeResult = await this._channel.consume(this.options.queue, async (msg) => {
      if (!msg) return;

      const bodyText = msg.content.toString('utf8');
      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch (error) {
        console.error('[rabbit-subscriber] invalid JSON message', error.message);
        this._channel.nack(msg, false, false);
        return;
      }

      const normalizedMessage = {
        messageId: msg.properties.messageId || null,
        routingKey: msg.fields.routingKey,
        headers: msg.properties.headers || {},
        payload,
        receivedAt: new Date().toISOString(),
        rawMeta: {
          redelivered: msg.fields.redelivered,
          deliveryTag: msg.fields.deliveryTag
        },
        _rawMessage: msg
      };

      try {
        await handler(normalizedMessage);
        await this.ack(normalizedMessage);
      } catch (error) {
        console.error('[rabbit-subscriber] handler failed', error.message);
        const terminalCodes = new Set(['INVALID_ENVELOPE', 'UNSUPPORTED_EVENT_TYPE']);
        await this.nack(normalizedMessage, { requeue: !terminalCodes.has(error.code) });
      }
    }, { noAck: false });

    this._consumerTag = consumeResult.consumerTag;

    while (!stopSignal.stopped) await sleep(500);
  }

  async ack(message) {
    if (!this._channel || !message?._rawMessage) return;
    this._channel.ack(message._rawMessage);
  }

  async nack(message, { requeue = false } = {}) {
    if (!this._channel || !message?._rawMessage) return;
    this._channel.nack(message._rawMessage, false, requeue);
  }

  async close() {
    if (this._channel && this._consumerTag) {
      try {
        await this._channel.cancel(this._consumerTag);
      } catch (error) {
        // no-op during shutdown
      }
    }
    if (this._channel) await this._channel.close();
    if (this._connection) await this._connection.close();
  }
}

module.exports = RabbitBrokerClient;
