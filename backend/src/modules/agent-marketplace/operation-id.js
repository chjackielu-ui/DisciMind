const crypto = require('crypto');

function scopedOperationId(userId, operationId, action) {
  return crypto.createHash('sha256').update(`${userId}:${action}:${operationId}`).digest('hex');
}

module.exports = { scopedOperationId };
