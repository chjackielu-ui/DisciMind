const aiService = require('../ai/ai.service');

async function generate(input) {
  const prompt = String(input?.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('文本生成提示词不能为空'), { code: 40001 });
  const messages = [];
  if (input.systemPrompt) messages.push({ role: 'system', content: String(input.systemPrompt).slice(0, 20000) });
  messages.push({ role: 'user', content: prompt.slice(0, 50000) });
  return aiService.chat({
    modelId: input.modelId,
    userId: input.userId,
    messages,
    scene: input.scene || 'text_generation',
    options: { maxTokens: input.maxTokens, temperature: input.temperature },
  });
}

module.exports = { generate };
