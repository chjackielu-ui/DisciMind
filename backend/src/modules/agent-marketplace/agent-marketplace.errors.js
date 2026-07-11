class MarketplaceError extends Error {
  constructor(message, code = 40001, status = 400, details = null) {
    super(message);
    this.name = 'MarketplaceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assert(condition, message, code = 40001, status = 400, details = null) {
  if (!condition) throw new MarketplaceError(message, code, status, details);
}

module.exports = { MarketplaceError, assert };
