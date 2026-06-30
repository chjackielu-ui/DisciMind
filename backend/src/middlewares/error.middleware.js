// 统一错误处理中间件
// 捕获所有未处理的错误，返回统一格式

function errorHandler(err, req, res, _next) {
  // 记录错误日志，方便排查
  console.error('[ErrorMiddleware]', err.message || err);

  // 返回统一错误格式
  return res.status(500).json({
    code: 50001,
    message: '服务器错误',
    data: null,
  });
}

module.exports = errorHandler;
