class TrainerWorkflowError extends Error {
  constructor(code, message, status = 500, data = null) {
    super(message);
    this.name = 'TrainerWorkflowError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

function createTrainerError(code, message, status = 400, data = null) {
  return new TrainerWorkflowError(code, message, status, data);
}

module.exports = {
  TrainerWorkflowError,
  createTrainerError,
};
