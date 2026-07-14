const { randomUUID } = require('crypto');

function requestIdMiddleware(req, res, next) {
  const incoming = String(req.get('x-request-id') || '').trim();
  req.id = incoming && incoming.length <= 100 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestIdMiddleware;
