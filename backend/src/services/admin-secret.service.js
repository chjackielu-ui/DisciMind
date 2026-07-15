const crypto = require('crypto');
const { loadEnv } = require('../config/env');

const SENSITIVE_KEY = /authorization|api[_-]?key|api[_-]?secret|token|secret|password|cookie|ciphertext|auth[_-]?tag|\biv\b/i;

function getMasterKey() {
  loadEnv();
  const raw = String(process.env.AI_CONFIG_ENCRYPTION_KEY || '').trim();
  if (!raw) throw Object.assign(new Error('AI 配置加密主密钥未配置'), { code: 50002 });
  const candidates = [];
  try { candidates.push(Buffer.from(raw, 'base64')); } catch {}
  candidates.push(Buffer.from(raw, 'utf8'));
  const key = candidates.find((candidate) => candidate.length >= 32);
  if (!key) throw Object.assign(new Error('AI 配置加密主密钥长度不足 32 字节'), { code: 50002 });
  return key.length === 32 ? key : crypto.createHash('sha256').update(key).digest();
}

function encryptSecret(secret) {
  if (!secret || typeof secret !== 'object') throw Object.assign(new Error('密钥内容不能为空'), { code: 40001 });
  const serialized = JSON.stringify(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const primary = String(secret.api_key || secret.api_secret || secret.token || secret.app_id || '');
  return {
    secret_ciphertext: ciphertext.toString('base64'),
    secret_iv: iv.toString('base64'),
    secret_auth_tag: authTag.toString('base64'),
    secret_last_four: primary ? primary.slice(-4) : null,
    secret_updated_at: new Date(),
  };
}

function decryptSecret(record) {
  if (!record?.secret_ciphertext || !record?.secret_iv || !record?.secret_auth_tag) return null;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getMasterKey(),
    Buffer.from(record.secret_iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(record.secret_auth_tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.secret_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

function redact(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:api[_-]?key|token|secret)=)[^&\s]+/gi, '$1[REDACTED]');
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, seen);
  }
  return output;
}

function safeError(error) {
  const status = Number(error?.response?.status || error?.status || error?.provider_status || 0) || null;
  const code = String(error?.provider_code || error?.code || '').slice(0, 80) || null;
  const message = status === 401 || status === 403
    ? '供应商认证失败，请检查密钥'
    : status === 429
      ? '供应商请求频率受限'
      : code === 'ECONNREFUSED'
        ? '无法连接供应商服务'
        : code === 'ECONNABORTED' || code === 'ETIMEDOUT'
          ? '供应商连接超时'
          : Number(error?.code) === 40001 && /^供应商|^Dify/.test(String(error?.message || ''))
            ? String(error.message).slice(0, 200)
            : '供应商连接测试失败';
  return { message, status, code };
}

module.exports = { encryptSecret, decryptSecret, redact, safeError, getMasterKey };
