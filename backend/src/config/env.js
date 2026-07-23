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

  const storageDriver = String(env.KNOWLEDGE_STORAGE_DRIVER || 'local').trim().toLowerCase();
  if (!['local', 'oss'].includes(storageDriver)) {
    errors.push('KNOWLEDGE_STORAGE_DRIVER 仅支持 local 或 oss');
  } else if (storageDriver === 'oss') {
    if (!String(env.KNOWLEDGE_OSS_BUCKET || '').trim()) errors.push('KNOWLEDGE_OSS_BUCKET 不能为空');
    if (!String(env.KNOWLEDGE_OSS_ACCESS_KEY_ID || '').trim()) errors.push('KNOWLEDGE_OSS_ACCESS_KEY_ID 不能为空');
    if (!String(env.KNOWLEDGE_OSS_ACCESS_KEY_SECRET || '').trim()) errors.push('KNOWLEDGE_OSS_ACCESS_KEY_SECRET 不能为空');
    if (!String(env.KNOWLEDGE_OSS_REGION || '').trim() && !String(env.KNOWLEDGE_OSS_ENDPOINT || '').trim()) {
      errors.push('KNOWLEDGE_OSS_REGION 与 KNOWLEDGE_OSS_ENDPOINT 至少填写一项');
    }
  }

  const vectorStore = String(env.KNOWLEDGE_VECTOR_STORE || 'database').trim().toLowerCase();
  if (!['database', 'qdrant'].includes(vectorStore)) {
    errors.push('KNOWLEDGE_VECTOR_STORE 仅支持 database 或 qdrant');
  } else if (vectorStore === 'qdrant') {
    if (!String(env.QDRANT_URL || '').trim()) errors.push('QDRANT_URL 不能为空');
    if (!String(env.QDRANT_COLLECTION || '').trim()) errors.push('QDRANT_COLLECTION 不能为空');
    if (!String(env.KNOWLEDGE_EMBEDDING_API_KEY || env.BAILIAN_API_KEY || '').trim()) {
      errors.push('Qdrant 知识库必须配置 KNOWLEDGE_EMBEDDING_API_KEY 或 BAILIAN_API_KEY');
    }
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
