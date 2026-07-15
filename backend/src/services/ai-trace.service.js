const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { redact } = require('./admin-secret.service');

function summary(value, max = 2000) {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(redact(value));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function startTrace(input = {}) {
  const requestId = String(input.request_id || randomUUID());
  const traceId = String(input.trace_id || randomUUID());
  return prisma.aiRequestTrace.create({ data: {
    request_id: requestId, trace_id: traceId, user_id: input.user_id || null,
    course_id: input.course_id || null, teaching_class_id: input.teaching_class_id || null,
    entry_point: String(input.entry_point || 'unknown').slice(0, 100), scene: input.scene || null,
    agent_config_id: input.agent_config_id || null, agent_version_id: input.agent_version_id || null,
    provider_id: input.provider_id || null, model_config_id: input.model_config_id || null,
    prompt_version_id: input.prompt_version_id || null, workflow_version_id: input.workflow_version_id || null,
    input_summary: summary(input.input), status: 'running', started_at: new Date(),
  } });
}

async function addStep(traceDatabaseId, input = {}) {
  const sequence = input.sequence_number || await prisma.aiTraceStep.count({ where: { trace_id: Number(traceDatabaseId) } }) + 1;
  return prisma.aiTraceStep.create({ data: {
    trace_id: Number(traceDatabaseId), parent_step_id: input.parent_step_id || null,
    sequence_number: sequence, step_type: input.step_type || 'operation', title: input.title || input.step_type || '执行步骤',
    status: input.status || 'success', input_summary: redact(input.input_summary || null),
    output_summary: redact(input.output_summary || null), latency_ms: input.latency_ms || null,
    error_type: input.error_type || null, error_message: input.error_message ? summary(input.error_message, 500) : null,
    started_at: input.started_at || new Date(), completed_at: input.completed_at || new Date(),
  } });
}

async function completeTrace(traceDatabaseId, result = {}) {
  return prisma.aiRequestTrace.update({ where: { id: Number(traceDatabaseId) }, data: {
    status: result.status || 'success', output_summary: summary(result.output), retrieval_hit: Boolean(result.retrieval_hit),
    retry_count: Number(result.retry_count) || 0, risk_flag: Boolean(result.risk_flag),
    prompt_tokens: result.prompt_tokens ?? null, completion_tokens: result.completion_tokens ?? null,
    total_tokens: result.total_tokens ?? null, latency_ms: result.latency_ms ?? null,
    error_type: result.error_type || null, error_message: result.error_message ? summary(result.error_message, 500) : null,
    completed_at: new Date(),
  } });
}

async function listTraces(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 20));
  const where = {};
  if (query.status) where.status = String(query.status);
  if (query.user_id) where.user_id = Number(query.user_id);
  if (query.course_id) where.course_id = Number(query.course_id);
  if (query.agent_id) where.agent_config_id = Number(query.agent_id);
  if (query.provider_id) where.provider_id = Number(query.provider_id);
  if (query.model_id) where.model_config_id = Number(query.model_id);
  if (query.risk === 'true') where.risk_flag = true;
  if (query.retrieval_hit === 'true') where.retrieval_hit = true;
  if (query.retry === 'true') where.retry_count = { gt: 0 };
  if (query.request_id) where.OR = [{ request_id: { contains: String(query.request_id) } }, { trace_id: { contains: String(query.request_id) } }];
  if (query.start_date || query.end_date) {
    where.created_at = {};
    if (query.start_date) where.created_at.gte = new Date(query.start_date);
    if (query.end_date) where.created_at.lte = new Date(query.end_date);
  }
  const [list, total] = await Promise.all([
    prisma.aiRequestTrace.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.aiRequestTrace.count({ where }),
  ]);
  const userIds = [...new Set(list.map((item) => item.user_id).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({ where: { user_id: { in: userIds } }, select: { user_id: true, username: true, profile: { select: { real_name: true } } } }) : [];
  const userMap = new Map(users.map((item) => [item.user_id, item.profile?.real_name || item.username]));
  return { list: list.map((item) => ({ ...item, user_name: userMap.get(item.user_id) || null })), total, page, page_size: pageSize };
}

async function getTrace(id) {
  const numeric = Number(id);
  const trace = await prisma.aiRequestTrace.findFirst({
    where: Number.isFinite(numeric) ? { id: numeric } : { OR: [{ request_id: String(id) }, { trace_id: String(id) }] },
    include: { steps: { orderBy: { sequence_number: 'asc' } }, retrievals: { orderBy: { created_at: 'asc' } }, tool_calls: { orderBy: { created_at: 'asc' } }, feedback: { orderBy: { created_at: 'asc' } } },
  });
  if (!trace) throw Object.assign(new Error('AI 请求轨迹不存在'), { code: 40401 });
  return redact(trace);
}

module.exports = { startTrace, addStep, completeTrace, listTraces, getTrace, summary };
