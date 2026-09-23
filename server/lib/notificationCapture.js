// Stands in for sendEmail while a state-engine workflow executes. Email and insight
// nodes render exactly as they normally would, but nothing leaves the process: each
// would-be send is recorded as an intent, and the state engine decides after the run
// whether any of it is delivered (see stateEngineService.deliver).
function createCapturingSender() {
  const intents = [];

  async function sender({ to, subject, html, text }) {
    intents.push({ to: Array.isArray(to) ? [...to] : [], subject, html, text });
    return {
      status: 'deferred',
      provider: 'state_engine',
      to: Array.isArray(to) ? to : [],
      subject
    };
  }

  return { sender, intents };
}

module.exports = { createCapturingSender };
