const { loadEnv } = require('../config/env');
const { decryptSecret } = require('./admin-secret.service');

loadEnv();

const ENV_PROVIDERS = Object.freeze([
  {
    provider_code: 'bailian', display_name: '阿里云百炼', provider_type: 'bailian',
    default_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    base_url: () => process.env.BAILIAN_BASE_URL,
    secret: () => ({ api_key: process.env.BAILIAN_API_KEY || '', workspace_id: process.env.BAILIAN_WORKSPACE_ID || '' }),
  },
  {
    provider_code: 'qwen', display_name: '通义千问', provider_type: 'qwen',
    default_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    base_url: () => process.env.QWEN_BASE_URL,
    secret: () => ({ api_key: process.env.QWEN_API_KEY || '' }),
  },
  {
    provider_code: 'deepseek', display_name: 'DeepSeek', provider_type: 'deepseek',
    default_base_url: 'https://api.deepseek.com/v1',
    base_url: () => process.env.DEEPSEEK_BASE_URL,
    secret: () => ({ api_key: process.env.DEEPSEEK_API_KEY || '' }),
  },
  {
    provider_code: 'spark', display_name: '讯飞星火', provider_type: 'spark',
    default_base_url: 'https://spark-api-open.xf-yun.com/v1',
    base_url: () => process.env.SPARK_BASE_URL,
    secret: () => ({ api_key: process.env.SPARK_API_KEY || '', api_secret: process.env.SPARK_API_SECRET || '', app_id: process.env.SPARK_APP_ID || '' }),
  },
  {
    provider_code: 'dify', display_name: 'Dify', provider_type: 'dify',
    default_base_url: 'http://localhost/v1',
    base_url: () => process.env.DIFY_API_BASE_URL || process.env.DIFY_CHATFLOW_BASE_URL,
    secret: () => ({ api_key: process.env.DIFY_API_KEY || process.env.DIFY_CHATFLOW_API_KEY || '', app_id: process.env.DIFY_APP_ID || '' }),
  },
]);

const secretCache = new Map();

function envEnabled(name, fallback = true) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function databaseConfigEnabled() {
  return envEnabled('AI_CONFIG_DB_ENABLED', true);
}

function environmentFallbackEnabled() {
  return envEnabled('AI_CONFIG_ENV_FALLBACK_ENABLED', true);
}

function cacheTtlMs() {
  return Math.min(3_600_000, Math.max(1_000, Number(process.env.AI_PROVIDER_CONFIG_CACHE_TTL_MS) || 60_000));
}

function envDefinition(code) {
  return ENV_PROVIDERS.find((item) => item.provider_code === String(code || '')) || null;
}

function compactSecret(value) {
  if (!value || typeof value !== 'object') return null;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = String(item || '').trim();
    if (normalized) output[key] = normalized;
  }
  return Object.keys(output).length ? output : null;
}

function configuredEnvSecret(code) {
  return compactSecret(envDefinition(code)?.secret?.());
}

function environmentBaseUrl(code) {
  const definition = envDefinition(code);
  return String(definition?.base_url?.() || definition?.default_base_url || '').trim() || null;
}

function invalidateProviderConfig(providerId) {
  if (providerId == null) return secretCache.clear();
  secretCache.delete(Number(providerId));
}

function databaseSecret(provider) {
  const id = Number(provider.id);
  const version = `${provider.secret_updated_at ? new Date(provider.secret_updated_at).getTime() : 0}:${provider.secret_auth_tag || ''}`;
  const cached = secretCache.get(id);
  if (cached && cached.version === version && cached.expires_at > Date.now()) return cached.value;
  const value = decryptSecret(provider);
  secretCache.set(id, { version, expires_at: Date.now() + cacheTtlMs(), value });
  return value;
}

async function resolveProviderSecret(provider) {
  if (!provider) return null;
  if (databaseConfigEnabled() && provider.enabled !== false && provider.secret_ciphertext) return databaseSecret(provider);
  if (environmentFallbackEnabled()) return configuredEnvSecret(provider.provider_code);
  return null;
}

async function resolveProviderRuntime(provider) {
  if (!provider) throw Object.assign(new Error('AI 供应商配置不存在'), { code: 40401 });
  const definition = envDefinition(provider.provider_code);
  const useDatabase = databaseConfigEnabled() && provider.enabled !== false;
  const useEnvironment = environmentFallbackEnabled();
  const baseUrl = (useDatabase && provider.base_url)
    || (useEnvironment && environmentBaseUrl(provider.provider_code))
    || definition?.default_base_url
    || null;
  return {
    provider: { ...provider, base_url: baseUrl },
    secret: await resolveProviderSecret(provider),
    source: useDatabase && provider.secret_ciphertext
      ? (configuredEnvSecret(provider.provider_code) ? 'mixed' : 'database')
      : configuredEnvSecret(provider.provider_code) ? 'environment' : 'default',
  };
}

function secretMetadata(provider) {
  const dbConfigured = Boolean(databaseConfigEnabled() && provider?.secret_ciphertext);
  const envSecret = environmentFallbackEnabled() ? configuredEnvSecret(provider?.provider_code) : null;
  const envPrimary = envSecret?.api_key || envSecret?.api_secret || envSecret?.token || envSecret?.app_id || '';
  return {
    configured: dbConfigured || Boolean(envSecret),
    source: dbConfigured ? (envSecret ? 'mixed' : 'database') : envSecret ? 'environment' : 'default',
    last_four: dbConfigured ? provider.secret_last_four : (envPrimary ? envPrimary.slice(-4) : null),
    updated_at: dbConfigured ? provider.secret_updated_at : null,
  };
}

module.exports = {
  ENV_PROVIDERS,
  envEnabled,
  databaseConfigEnabled,
  environmentFallbackEnabled,
  envDefinition,
  configuredEnvSecret,
  environmentBaseUrl,
  invalidateProviderConfig,
  resolveProviderSecret,
  resolveProviderRuntime,
  secretMetadata,
};
