const prisma = require('../../config/prisma');
const traceService = require('../../services/ai-trace.service');

function safeJson(value, max = 8000) {
  if (value == null) return null;
  try {
    const redacted = require('../../services/admin-secret.service').redact(value);
    const text = JSON.stringify(redacted);
    if (text.length <= max) return redacted;
    return { truncated: true, preview: text.slice(0, max) };
  } catch {
    return { unavailable: true };
  }
}

async function start(input = {}) {
  const trace = await traceService.startTrace(input);
  const metadata = {};
  if (input.conversation_id) metadata.conversation_id = Number(input.conversation_id);
  if (input.user_role) metadata.user_role = String(input.user_role).toLowerCase();
  if (input.search_mode) metadata.search_mode = String(input.search_mode);
  if (input.intent) metadata.intent_json = safeJson(input.intent);
  if (input.plan) metadata.plan_json = safeJson(input.plan);
  if (input.context) metadata.context_json = safeJson(input.context);
  if (!Object.keys(metadata).length) return trace;
  return prisma.aiRequestTrace.update({ where: { id: trace.id }, data: metadata });
}

async function addRetrieval(traceId, stepId, source = {}) {
  return prisma.aiTraceRetrieval.create({ data: {
    trace_id: Number(traceId),
    step_id: stepId ? Number(stepId) : null,
    knowledge_base_id: source.knowledgeBaseId ? Number(source.knowledgeBaseId) : null,
    document_id: Number.isInteger(Number(source.documentId)) ? Number(source.documentId) : null,
    document_title: String(source.title || '未命名来源').slice(0, 500),
    source_uri: source.url ? String(source.url).slice(0, 1000) : null,
    excerpt_redacted: source.snippet ? String(source.snippet).slice(0, 2000) : null,
    retrieval_score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
    cited: Boolean(source.cited), adopted: Boolean(source.adopted),
    source_type: String(source.sourceType || 'web').slice(0, 48),
    source_index: Number.isInteger(Number(source.index)) ? Number(source.index) : null,
    site_name: source.siteName ? String(source.siteName).slice(0, 160) : null,
    icon_url: source.icon ? String(source.icon).slice(0, 1000) : null,
    search_strategy: source.searchStrategy ? String(source.searchStrategy).slice(0, 32) : null,
    provider_request_id: source.requestId ? String(source.requestId).slice(0, 160) : null,
    retrieved_at: source.retrievedAt ? new Date(source.retrievedAt) : null,
  } });
}

async function addToolCall(traceId, stepId, input = {}) {
  return prisma.aiTraceToolCall.create({ data: {
    trace_id: Number(traceId), step_id: stepId ? Number(stepId) : null,
    tool_name: String(input.tool_name || input.name || 'unknown').slice(0, 160),
    status: String(input.status || 'success').slice(0, 24),
    input_summary: safeJson(input.input), output_summary: safeJson(input.output),
    latency_ms: Number.isFinite(Number(input.latency_ms)) ? Number(input.latency_ms) : null,
    error_message: input.error_message ? String(input.error_message).slice(0, 500) : null,
    retry_count: Math.max(0, Number(input.retry_count) || 0),
    permission_decision: input.permission_decision ? String(input.permission_decision).slice(0, 48) : null,
    started_at: input.started_at || new Date(), completed_at: input.completed_at || new Date(),
  } });
}

async function updatePlan(traceId, input = {}) {
  return prisma.aiRequestTrace.update({ where: { id: Number(traceId) }, data: {
    ...(input.intent ? { intent_json: safeJson(input.intent) } : {}),
    ...(input.plan ? { plan_json: safeJson(input.plan) } : {}),
    ...(input.context ? { context_json: safeJson(input.context) } : {}),
  } });
}

module.exports = { ...traceService, start, addRetrieval, addToolCall, updatePlan, safeJson };
