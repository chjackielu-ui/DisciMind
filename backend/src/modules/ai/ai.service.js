const prisma = require('../../config/prisma');
const providerFactory = require('./provider.factory');
const traceService = require('../../services/ai-trace.service');

async function chat({ modelId, userId, messages, scene = 'direct_model', options = {} }) {
  const model = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: Number(modelId) } });
  if (!model?.provider_id || !model.enabled) throw Object.assign(new Error('AI 模型不存在或已停用'), { code: 40401 });
  const { provider, adapter } = await providerFactory.getProvider(model.provider_id);
  const trace = await traceService.startTrace({ user_id: userId, entry_point: 'unified_ai_service', scene, provider_id: provider.id, model_config_id: model.ai_model_config_id, input: messages });
  const started = Date.now();
  try {
    const result = await adapter.chat({ model: model.model_code || model.model_name, messages, maxTokens: options.maxTokens || model.max_output_tokens || 2048, temperature: options.temperature ?? model.temperature ?? 0.7 });
    await traceService.addStep(trace.id, { step_type: 'model_generation', title: '模型生成', latency_ms: result.latency_ms, output_summary: { status: 'success' } });
    await traceService.completeTrace(trace.id, { status: 'success', output: result.content, latency_ms: Date.now() - started, prompt_tokens: result.usage?.prompt_tokens, completion_tokens: result.usage?.completion_tokens, total_tokens: result.usage?.total_tokens });
    return { ...result, request_id: trace.request_id, trace_id: trace.trace_id, provider: provider.provider_code, model: model.model_code || model.model_name };
  } catch (error) {
    await traceService.completeTrace(trace.id, { status: 'failed', latency_ms: Date.now() - started, error_type: error.code || 'AI_CALL_FAILED', error_message: error.message });
    throw error;
  }
}

module.exports = { chat };
