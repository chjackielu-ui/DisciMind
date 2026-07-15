const prisma = require('../../config/prisma');
const { createProviderAdapter } = require('./provider.adapter');
const { resolveProviderRuntime } = require('../../services/ai-provider-config.service');

async function getProvider(identifier) {
  const where = typeof identifier === 'number' || /^\d+$/.test(String(identifier || ''))
    ? { id: Number(identifier) }
    : { provider_code: String(identifier || '') };
  const provider = await prisma.aiProvider.findUnique({ where });
  if (!provider || !provider.enabled) throw Object.assign(new Error('AI 供应商不存在或已停用'), { code: 40401 });
  const runtime = await resolveProviderRuntime(provider);
  return { provider: runtime.provider, adapter: createProviderAdapter(runtime.provider, runtime.secret || {}), source: runtime.source };
}

module.exports = { getProvider };
