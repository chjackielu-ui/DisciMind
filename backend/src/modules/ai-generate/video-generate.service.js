const prisma = require('../../config/prisma');
const providerFactory = require('../ai/provider.factory');

async function generate(input) {
  const modelId = Number(input?.modelId);
  if (!Number.isInteger(modelId) || modelId <= 0) throw Object.assign(new Error('请选择视频生成模型'), { code: 40001 });
  const model = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: modelId } });
  const capabilities = model?.capabilities_json && typeof model.capabilities_json === 'object' ? model.capabilities_json : {};
  if (!model?.provider_id || !model.enabled || capabilities.video_generation !== true) {
    throw Object.assign(new Error('视频生成模型不存在、已停用或未声明视频能力'), { code: 40401 });
  }
  const { adapter, provider } = await providerFactory.getProvider(model.provider_id);
  const result = await adapter.generateVideo({
    model: model.model_code || model.model_name,
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    signal: input.signal,
  });
  return { ...result, provider: provider.provider_code, model: model.model_code || model.model_name };
}

module.exports = { generate };
