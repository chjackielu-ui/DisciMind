class AgentIntegrationError extends Error {
  constructor(code, message, status = 400, data = null) {
    super(message);
    this.name = 'AgentIntegrationError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

function createAgentError(code, message, status = 400, data = null) {
  return new AgentIntegrationError(code, message, status, data);
}

module.exports = {
  AgentIntegrationError,
  createAgentError,
};
