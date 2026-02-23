class BrokerClient {
  async connect() {
    throw new Error('connect() not implemented');
  }

  async subscribe() {
    throw new Error('subscribe() not implemented');
  }

  async ack() {
    throw new Error('ack() not implemented');
  }

  async nack() {
    throw new Error('nack() not implemented');
  }

  async close() {
    throw new Error('close() not implemented');
  }
}

module.exports = BrokerClient;
