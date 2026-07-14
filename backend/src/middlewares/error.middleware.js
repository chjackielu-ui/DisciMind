// 统一错误处理中间件：日志保留完整异常，对外只暴露稳定、安全的错误契约。

const { toPublicError } = require('../utils/public-error');

function errorHandler(err, req, res, _next) {
  // 记录完整错误信息，方便后端排查
  const requestId = req.id || req.get?.('x-request-id') || `req_${Date.now().toString(36)}`;
  console.error(`[ErrorMiddleware][${requestId}]`, err.message || err);

  if (err instanceof SyntaxError && 'body' in err) {
    err.code = 40001;
    err.message = '请求 JSON 格式不正确';
    err.expose = true;
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    err.code = 40001;
    err.message = '上传文件超过大小限制';
    err.expose = true;
  }

  if (String(err.message || '').startsWith('Multipart:') || String(err.message || '').includes('头像仅支持')) {
    err.code = 40001;
    err.message = err.message || '上传参数不正确';
    err.expose = true;
  }

  const msg = String(err.message || '');
  const isPoolError = msg.includes('pool timeout') || msg.includes('connect ECONNREFUSED');
  if (isPoolError) {
    err.publicCode = 'DATABASE_UNAVAILABLE';
    err.retryable = true;
  }
  const publicError = toPublicError(err, null, req);
  return res.status(publicError.httpStatus).json({
    success: false,
    error: publicError.payload,
    code: publicError.legacyCode,
    message: publicError.payload.message,
    data: null,
  });
}

module.exports = errorHandler;
