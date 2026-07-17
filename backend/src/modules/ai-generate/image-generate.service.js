const prisma = require('../../config/prisma');
const providerFactory = require('../ai/provider.factory');

async function generate(input) {
  const modelId = Number(input?.modelId);
  if (!Number.isInteger(modelId) || modelId <= 0) throw Object.assign(new Error('请选择图片生成模型'), { code: 40001 });
  const model = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: modelId } });
  if (!model?.provider_id || !model.enabled || model.model_type !== 'image') {
    throw Object.assign(new Error('图片生成模型不存在、已停用或类型不匹配'), { code: 40401 });
  }
  const { adapter, provider } = await providerFactory.getProvider(model.provider_id);
  const result = await adapter.generateImage({
    model: model.model_code || model.model_name,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    n: input.n,
    size: input.size,
    responseFormat: input.responseFormat,
    signal: input.signal,
  });
  return { ...result, provider: provider.provider_code, model: model.model_code || model.model_name };
}

module.exports = { generate };
