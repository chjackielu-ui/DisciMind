const { createProviderAdapter } = require('./provider.adapter');

function createDeepSeekProvider(options = {}) {
  return createProviderAdapter({
    provider_code: options.providerCode || 'deepseek',
    provider_type: 'deepseek',
    base_url: options.baseUrl || process.env.DEEPSEEK_BASE_URL,
    auth_type: 'bearer',
    timeout_ms: options.timeoutMs || process.env.AI_PROVIDER_TIMEOUT_MS,
    max_retries: options.maxRetries ?? process.env.AI_PROVIDER_MAX_RETRIES,
    extra_config_json: options.extraConfig || {},
  }, { api_key: options.apiKey || process.env.DEEPSEEK_API_KEY }, options.runtime);
}

module.exports = { createDeepSeekProvider };
