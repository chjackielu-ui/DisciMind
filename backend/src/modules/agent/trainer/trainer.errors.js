class TrainerAgentError extends Error {
  constructor(code, message, status = 400, data = null) {
    super(message);
    this.name = 'TrainerAgentError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

function createTrainerAgentError(code, message, status = 400, data = null) {
  return new TrainerAgentError(code, message, status, data);
}

module.exports = {
  TrainerAgentError,
  createTrainerAgentError,
};
