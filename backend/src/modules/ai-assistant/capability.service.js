const prisma = require('../../config/prisma');
const { getBailianConfig } = require('../../services/bailian-openai.service');

const CONFIG_PREFIX = 'ai.search.capabilities.';

function feature(supported, reason = null, verifiedAt = null) {
  return { supported: Boolean(supported), reason, verifiedAt };
}

function staticCapabilities(model) {
  const normalized = String(model || '').toLowerCase();
  const qwen37Plus = /^qwen3\.7-plus(?:-|$)/.test(normalized);
  return {
    model,
    protocol: qwen37Plus ? 'dashscope-multimodal-generation' : 'dashscope-generation',
    features: {
      search: feature(qwen37Plus, qwen37Plus ? 'official-model-list' : 'model-not-in-verified-list'),
      forcedSearch: feature(qwen37Plus, qwen37Plus ? 'official-dashscope-feature' : 'unverified-model'),
      sources: feature(qwen37Plus, qwen37Plus ? 'official-dashscope-feature' : 'unverified-model'),
      citations: feature(qwen37Plus, qwen37Plus ? 'official-dashscope-feature' : 'unverified-model'),
      prependSources: feature(qwen37Plus, qwen37Plus ? 'official-dashscope-feature' : 'unverified-model'),
      strategyTurbo: feature(qwen37Plus, qwen37Plus ? 'official-dashscope-feature' : 'unverified-model'),
      strategyMax: feature(qwen37Plus, qwen37Plus ? 'official-dashscope-feature' : 'unverified-model'),
      strategyAgent: feature(false, 'qwen3.7-plus is not listed for agent strategy'),
      searchExtension: feature(qwen37Plus, qwen37Plus ? 'official-dashscope-feature' : 'unverified-model'),
      freshness: feature(false, 'qwen3.7-plus is not listed for freshness'),
      assignedSiteList: feature(false, 'qwen3.7-plus is not listed for assigned_site_list'),
      promptIntervene: feature(false, 'qwen3.7-plus is not listed for prompt_intervene'),
      textImageMixed: feature(false, 'qwen3.7-plus is not listed for enable_text_image_mixed'),
      reasoning: feature(false, 'requires live capability verification'),
      functionCalling: feature(qwen37Plus, qwen37Plus ? 'openai-compatible tool calling' : 'unverified-model'),
    },
    lastProbeAt: null,
    source: 'static',
  };
}

async function getCapabilities() {
  const { model } = getBailianConfig();
  const fallback = staticCapabilities(model);
  try {
    const record = await prisma.systemConfig.findUnique({ where: { config_key: `${CONFIG_PREFIX}${model}` } });
    const stored = record?.config_value;
    if (!stored || typeof stored !== 'object') return fallback;
    return {
      ...fallback,
      ...stored,
      model,
      features: { ...fallback.features, ...(stored.features || {}) },
      source: 'probe',
    };
  } catch {
    return fallback;
  }
}

async function recordCapabilityProbe(model, probe) {
  const value = {
    model,
    protocol: staticCapabilities(model).protocol,
    features: probe.features || {},
    lastProbeAt: probe.lastProbeAt || new Date().toISOString(),
    requestIds: Array.isArray(probe.requestIds) ? probe.requestIds.slice(0, 20) : [],
  };
  return prisma.systemConfig.upsert({
    where: { config_key: `${CONFIG_PREFIX}${model}` },
    create: { config_key: `${CONFIG_PREFIX}${model}`, config_value: value, description: 'DashScope 搜索能力真实探测结果（不含密钥）' },
    update: { config_value: value, description: 'DashScope 搜索能力真实探测结果（不含密钥）' },
  });
}

module.exports = { CONFIG_PREFIX, staticCapabilities, getCapabilities, recordCapabilityProbe };
