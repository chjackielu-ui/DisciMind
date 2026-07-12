// 统一错误处理中间件
// 捕获所有未处理的错误，返回统一格式

function errorHandler(err, req, res, _next) {
  // 记录完整错误信息，方便后端排查
  const requestId = req.get?.('x-request-id') || req.id || `req_${Date.now().toString(36)}`;
  console.error(`[ErrorMiddleware][${requestId}]`, err.message || err);

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      code: 40001,
      message: '请求 JSON 格式不正确',
      data: null,
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      code: 40001,
      message: '头像图片不能超过 2MB',
      data: null,
    });
  }

  if (String(err.message || '').startsWith('Multipart:') || String(err.message || '').includes('头像仅支持')) {
    return res.status(400).json({
      code: 40001,
      message: err.message || '头像上传参数不正确',
      data: null,
    });
  }

  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      code: Number.isInteger(err.code) ? err.code : err.status === 403 ? 40301 : err.status === 404 ? 40401 : err.status === 409 ? 40901 : 40001,
      message: err.message || '请求无法处理',
      data: null,
    });
  }

  // 数据库连接错误：给出明确提示
  const msg = String(err.message || '');
  const isPoolError = msg.includes('pool timeout') || msg.includes('connect ECONNREFUSED');

  return res.status(500).json({
    code: 50001,
    message: isPoolError
      ? '数据库连接超时，请检查 MySQL 服务是否正常运行'
      : '服务器内部错误，请稍后重试',
    data: null,
  });
}

module.exports = errorHandler;
