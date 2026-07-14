// 统一响应格式工具
// 所有后端接口通过此工具返回统一结构，方便前端统一处理

/**
 * 成功响应
 * @param {import('express').Response} res
 * @param {*} data - 返回数据
 * @param {string} message - 提示信息
 */
function success(res, data = null, message = 'success') {
  return res.json({
    success: true,
    code: 0,
    message,
    data,
  });
}

/**
 * 失败响应
 * @param {import('express').Response} res
 * @param {number} code - 业务错误码
 * @param {string} message - 错误信息
 * @param {*} data - 额外数据（通常为 null）
 */
function fail(res, code = 40001, message = '请求失败', data = null, options = {}) {
  const { toPublicError } = require('./public-error');
  const publicError = toPublicError(code, message, res, options);
  return res.status(publicError.httpStatus).json({
    success: false,
    error: publicError.payload,
    // 保留旧字段，兼容当前前端和第三方调用方；新代码统一读取 error。
    code: publicError.legacyCode,
    message: publicError.payload.message,
    data,
  });
}

module.exports = { success, fail };
