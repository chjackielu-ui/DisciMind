const { createProviderAdapter } = require('./provider.adapter');

function createSparkProvider(options = {}) {
  return createProviderAdapter({
    provider_code: options.providerCode || 'spark',
    provider_type: 'spark',
    base_url: options.baseUrl || process.env.SPARK_BASE_URL,
    auth_type: 'bearer',
    timeout_ms: options.timeoutMs || process.env.AI_PROVIDER_TIMEOUT_MS,
    max_retries: options.maxRetries ?? process.env.AI_PROVIDER_MAX_RETRIES,
    extra_config_json: options.extraConfig || {},
  }, { api_key: options.apiKey || process.env.SPARK_API_KEY }, options.runtime);
}

module.exports = { createSparkProvider };
