const { createProviderAdapter } = require('./provider.adapter');

function createQwenProvider(options = {}) {
  return createProviderAdapter({
    provider_code: options.providerCode || 'qwen',
    provider_type: 'qwen',
    base_url: options.baseUrl || process.env.BAILIAN_BASE_URL || process.env.QWEN_BASE_URL,
    auth_type: 'bearer',
    timeout_ms: options.timeoutMs || process.env.BAILIAN_TIMEOUT_MS || process.env.AI_PROVIDER_TIMEOUT_MS,
    max_retries: options.maxRetries ?? process.env.BAILIAN_MAX_RETRIES ?? process.env.AI_PROVIDER_MAX_RETRIES,
    extra_config_json: options.extraConfig || {},
  }, { api_key: options.apiKey || process.env.QWEN_API_KEY || process.env.BAILIAN_API_KEY }, options.runtime);
}

module.exports = { createQwenProvider };
