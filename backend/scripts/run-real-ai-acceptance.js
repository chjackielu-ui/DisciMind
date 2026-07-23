const crypto = require('crypto');
const { loadEnv } = require('../src/config/env');

loadEnv();

const prisma = require('../src/config/prisma');
const { createDeepSeekProvider } = require('../src/modules/ai/deepseek.provider');
const { createQwenProvider } = require('../src/modules/ai/qwen.provider');
const knowledgeProvider = require('../src/modules/knowledge-base/knowledge-provider.service');

function digest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 16);
}

function safeFailure(error) {
  return {
    ok: false,
    code: String(error?.publicCode || error?.code || 'UNKNOWN').slice(0, 80),
    status: Number(error?.status || error?.statusCode || error?.response?.status || 0) || null,
    retryable: Boolean(error?.retryable),
  };
}

function success(content, startedAt, extra = {}) {
  const text = String(content || '').trim();
  return {
    ok: Boolean(text),
    latency_ms: Date.now() - startedAt,
    content_chars: text.length,
    content_sha256_16: digest(text),
    ...extra,
  };
}

async function runCall(name, callback) {
  try {
    return [name, await callback()];
  } catch (error) {
    return [name, safeFailure(error)];
  }
}

async function main() {
  const knowledgeOnly = process.argv.includes('--knowledge-only');
  const checks = knowledgeOnly ? {} : Object.fromEntries(await Promise.all([
    runCall('deepseek_chat', async () => {
      const startedAt = Date.now();
      const result = await createDeepSeekProvider({ maxRetries: 1 }).chat({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [{ role: 'user', content: '只回复：DisciMind DeepSeek 实链路正常' }],
        maxTokens: 64,
        temperature: 0,
      });
      return success(result.content, startedAt, { provider_latency_ms: result.latency_ms });
    }),
    runCall('qwen_stream', async () => {
      const startedAt = Date.now();
      let content = '';
      let chunks = 0;
      for await (const chunk of createQwenProvider({ maxRetries: 1 }).streamChat({
        model: process.env.BAILIAN_MODEL || process.env.QWEN_MODEL || 'qwen3.7-plus',
        messages: [{ role: 'user', content: '只回复：DisciMind Qwen 流式实链路正常' }],
        maxTokens: 64,
        temperature: 0,
      })) {
        chunks += 1;
        content += chunk.content || '';
      }
      return success(content, startedAt, { chunks });
    }),
  ]));

  const knowledgeStartedAt = Date.now();
  try {
    const bindings = await prisma.knowledgeBase.findMany({
      where: {
        deleted_at: null,
        status: 'active',
        documents: { some: { deleted_at: null, parse_status: 'EMBEDDED', marketplace_status: 'READY' } },
      },
      select: { knowledge_base_id: true },
      orderBy: { updated_at: 'desc' },
      take: 10,
    });
    let matched = null;
    let attempts = 0;
    const failureCodes = {};
    const tryDataset = async (datasetId) => {
      attempts += 1;
      const originalLog = console.log;
      const originalError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        const result = await knowledgeProvider.retrieveFromDataset(
          datasetId,
          '机器学习的基本概念、监督学习与模型训练',
          { topK: 3, scoreThreshold: 0 },
        );
        if (result.records.length) {
          matched = result.records;
          return true;
        }
      } catch (error) {
        const code = String(error?.code || error?.publicCode || 'UNKNOWN').slice(0, 80);
        failureCodes[code] = (failureCodes[code] || 0) + 1;
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
      return false;
    };
    for (const binding of bindings) {
      if (await tryDataset(binding.knowledge_base_id)) break;
    }
    const content = matched?.map((record) => record.content).join('\n') || '';
    checks.knowledge_retrieval = {
      ok: Boolean(matched?.length),
      latency_ms: Date.now() - knowledgeStartedAt,
      configured_bindings: bindings.length,
      datasets_attempted: attempts,
      records: matched?.length || 0,
      top_score: matched?.length ? Math.max(...matched.map((record) => Number(record.score || 0))) : null,
      content_chars: content.length,
      content_sha256_16: digest(content),
      failure_codes: failureCodes,
    };
  } catch (error) {
    checks.knowledge_retrieval = safeFailure(error);
  } finally {
    await prisma.$disconnect();
  }

  const configured = {
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_BASE_URL),
    qwen: Boolean((process.env.QWEN_API_KEY || process.env.BAILIAN_API_KEY)
      && (process.env.QWEN_BASE_URL || process.env.BAILIAN_BASE_URL)),
    agent_runtime: String(process.env.AGENT_MODE || 'langgraph').toLowerCase() === 'langgraph',
    knowledge_embedding: Boolean(process.env.KNOWLEDGE_EMBEDDING_API_KEY || process.env.BAILIAN_API_KEY),
    knowledge_vector_store: process.env.KNOWLEDGE_VECTOR_STORE || 'database',
  };
  const passed = Object.values(checks).filter((item) => item.ok).length;
  process.stdout.write(`${JSON.stringify({ configured, checks, summary: { passed, total: Object.keys(checks).length } }, null, 2)}\n`);
  if (passed !== Object.keys(checks).length) process.exitCode = 2;
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => {});
  process.stderr.write(`${JSON.stringify({ fatal: safeFailure(error) })}\n`);
  process.exitCode = 1;
});
