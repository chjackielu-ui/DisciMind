// JWT 工具
// 统一管理 Token 的签发和验证，确保所有模块使用相同的 secret 和过期策略

const jwt = require('jsonwebtoken');

// 从环境变量读取 secret，开发环境使用默认值（仅用于本地调试）
const JWT_SECRET = process.env.JWT_SECRET || 'discimind-dev-secret';
const JWT_EXPIRES_IN = '7d';

/**
 * 签发 JWT
 * @param {Object} payload - 要写入 token 的数据，至少包含 user_id
 * @returns {string} JWT 字符串
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 验证 JWT 并返回解码后的 payload
 * @param {string} token - JWT 字符串
 * @returns {Object} 解码后的 payload
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken };
