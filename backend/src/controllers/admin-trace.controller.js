const prisma = require('../config/prisma');
const { randomUUID } = require('crypto');
const { success, fail } = require('../utils/response');
const traceService = require('../services/ai-trace.service');
const { recordAdminOperation } = require('../services/admin-audit.service');

async function getTraces(req, res) {
  try { return success(res, await traceService.listTraces(req.query || {}), '获取 AI 轨迹成功'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

async function getTrace(req, res) {
  try { return success(res, await traceService.getTrace(req.params.id), '获取证据链成功'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

async function markTraceRisk(req, res) {
  try {
    const trace = await traceService.getTrace(req.params.id);
    const severity = ['low', 'medium', 'high', 'critical'].includes(req.body?.severity) ? req.body.severity : 'medium';
    const result = await prisma.$transaction(async (tx) => {
      await tx.aiRequestTrace.update({ where: { id: trace.id }, data: { risk_flag: true } });
      const event = await tx.aiRiskEvent.create({ data: {
        event_key: randomUUID(), risk_type: String(req.body?.risk_type || 'manual_review').slice(0, 80), severity,
        title: String(req.body?.title || '管理员标记的 AI 请求风险').slice(0, 240),
        description: String(req.body?.description || '').slice(0, 5000) || null,
        user_id: trace.user_id, request_trace_id: trace.id, agent_config_id: trace.agent_config_id,
        provider_id: trace.provider_id, model_config_id: trace.model_config_id, status: 'open',
      } });
      await tx.aiRiskEventEvidence.create({ data: {
        risk_event_id: event.id, evidence_type: 'trace', source_type: 'ai_request_trace',
        source_id: String(trace.id), evidence_redacted: `request_id=${trace.request_id}; status=${trace.status}`,
      } });
      return event;
    });
    await recordAdminOperation({ req, operationType: 'MARK_AI_TRACE_RISK', targetType: 'ai_request_trace', targetId: trace.id, after: { risk_event_id: result.id, severity } });
    return success(res, result, '已关联风险事件');
  } catch (error) { return fail(res, error.code || 50001, error.message); }
}

module.exports = { getTraces, getTrace, markTraceRisk };
