const path = require('path');
const dotenv = require('dotenv');

let loaded = false;

function loadEnv() {
  if (loaded) return;

  // Always try backend/.env first so the app works even when launched from repo root.
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  dotenv.config({ quiet: true });

  loaded = true;
}

function productionEnvErrors(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  const errors = [];
  const jwtSecret = String(env.JWT_SECRET || '').trim();
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32 || jwtSecret === 'discimind-dev-secret' || jwtSecret.startsWith('请')) {
    errors.push('JWT_SECRET 必须是至少 32 字节的生产随机密钥');
  }
  const origins = String(env.CORS_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => !origin.startsWith('https://') || /localhost|127\.0\.0\.1/i.test(origin))) {
    errors.push('CORS_ORIGIN 必须填写实际 HTTPS 域名');
  }
  if (String(env.REFRESH_TOKEN_COOKIE_SECURE || '').toLowerCase() !== 'true') {
    errors.push('REFRESH_TOKEN_COOKIE_SECURE 必须为 true');
  }
  if (String(env.AI_CONFIG_DB_ENABLED || 'true').toLowerCase() !== 'false') {
    const encryptionKey = String(env.AI_CONFIG_ENCRYPTION_KEY || '').trim();
    if (Buffer.byteLength(encryptionKey, 'utf8') < 32) errors.push('AI_CONFIG_ENCRYPTION_KEY 必须至少 32 字节');
  }
  return errors;
}

function validateProductionEnv(env = process.env) {
  const errors = productionEnvErrors(env);
  if (errors.length) {
    throw new Error(`生产环境配置校验失败：\n- ${errors.join('\n- ')}`);
  }
}

module.exports = { loadEnv, productionEnvErrors, validateProductionEnv };
