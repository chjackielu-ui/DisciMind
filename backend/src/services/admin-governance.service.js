const crypto = require('crypto');
const prisma = require('../config/prisma');
const { validateGraphJson } = require('../modules/learning-workflow/workflow-schema');
const { recordAdminOperation } = require('./admin-audit.service');
const aiConfigService = require('./admin-ai-config.service');
const providerFactory = require('../modules/ai/provider.factory');

const startOfToday = () => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; };
const ratio = (part, total) => total > 0 ? Number((part / total).toFixed(4)) : null;
const pagination = (query = {}) => ({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(100, Math.max(1, Number(query.page_size) || 20)) });

async function learningOverview() {
  const today = startOfToday();
  const [total, todayRuns, statusRows, completed, nodeCount, abnormal] = await Promise.all([
    prisma.learningWorkflowTemplate.count(),
    prisma.learningSession.count({ where: { created_at: { gte: today } } }),
    prisma.learningSession.groupBy({ by: ['status'], _count: { session_id: true } }),
    prisma.learningSession.findMany({ where: { status: 'COMPLETED', mastery_before: { not: null }, mastery_after: { not: null } }, select: { mastery_before: true, mastery_after: true, actual_duration_seconds: true }, take: 500, orderBy: { completed_at: 'desc' } }),
    prisma.learningSessionNodeRun.count(),
    prisma.learningFlowValidationResult.count({ where: { status: 'open' } }),
  ]);
  const status = Object.fromEntries(statusRows.map((item) => [String(item.status).toLowerCase(), item._count.session_id]));
  const allRuns = statusRows.reduce((sum, item) => sum + item._count.session_id, 0);
  const durationSamples = completed.filter((item) => item.actual_duration_seconds != null);
  return {
    total_flows: total, today_executions: todayRuns, total_executions: allRuns,
    completion_rate: ratio(status.completed || 0, allRuns), interruption_rate: ratio((status.abandoned || 0) + (status.failed || 0), allRuns),
    average_node_runs_per_session: allRuns ? Number((nodeCount / allRuns).toFixed(2)) : null,
    average_mastery_delta: completed.length ? Number((completed.reduce((sum, item) => sum + (item.mastery_after - item.mastery_before), 0) / completed.length).toFixed(2)) : null,
    average_duration_seconds: durationSamples.length ? Math.round(durationSamples.reduce((sum, item) => sum + item.actual_duration_seconds, 0) / durationSamples.length) : null,
    abnormal_flow_count: abnormal, sample_size: completed.length, data_status: allRuns ? 'sufficient' : 'insufficient_data',
  };
}

async function knowledgeOverview() {
  const today = startOfToday();
  const [knowledgeBases, documents, chunks, openIssues, retrievals, latestHealth, failures] = await Promise.all([
    prisma.knowledgeBase.count({ where: { deleted_at: null } }), prisma.knowledgeDocument.count({ where: { deleted_at: null } }),
    prisma.knowledgeDocumentChunk.count(), prisma.knowledgeQualityIssue.count({ where: { status: 'open' } }),
    prisma.aiTraceRetrieval.count({ where: { created_at: { gte: today } } }),
    prisma.knowledgeHealthSnapshot.aggregate({ _avg: { health_score: true, knowledge_coverage: true, retrieval_hit_rate: true }, _sum: { sample_size: true } }),
    prisma.knowledgeQueryFailure.count({ where: { status: 'open' } }),
  ]);
  return {
    knowledge_base_count: knowledgeBases, document_count: documents, chunk_count: chunks,
    health_score: latestHealth._avg.health_score, knowledge_coverage: latestHealth._avg.knowledge_coverage,
    retrieval_success_rate: latestHealth._avg.retrieval_hit_rate, today_retrieval_count: retrievals,
    open_issue_count: openIssues, blind_spot_count: failures, sample_size: latestHealth._sum.sample_size || 0,
    data_status: latestHealth._sum.sample_size ? 'sufficient' : 'insufficient_data',
  };
}

async function teachingOverview() {
  const [open, high, interventions, completed, affected] = await Promise.all([
    prisma.teachingIssue.count({ where: { status: 'open' } }),
    prisma.teachingIssue.count({ where: { status: 'open', severity: { in: ['high', 'critical'] } } }),
    prisma.teachingIntervention.count(), prisma.teachingIntervention.count({ where: { status: 'closed' } }),
    prisma.teachingIssue.aggregate({ where: { status: 'open' }, _sum: { affected_count: true } }),
  ]);
  return { open_issue_count: open, high_risk_issue_count: high, intervention_count: interventions, completed_intervention_count: completed, affected_count: affected._sum.affected_count || 0, closure_rate: ratio(completed, interventions) };
}

async function evaluationOverview() {
  const [sets, runs, running, result] = await Promise.all([
    prisma.agentEvaluationSet.count(), prisma.agentEvaluationRun.count(),
    prisma.agentEvaluationRun.count({ where: { status: { in: ['queued', 'running'] } } }),
    prisma.agentEvaluationResult.aggregate({ _avg: { score: true, latency_ms: true }, _count: { id: true } }),
  ]);
  return { evaluation_set_count: sets, run_count: runs, active_run_count: running, average_score: result._avg.score, average_latency_ms: result._avg.latency_ms, result_sample_size: result._count.id, data_status: result._count.id ? 'sufficient' : 'insufficient_data' };
}

async function experimentOverview() {
  const [total, active, assignments] = await Promise.all([
    prisma.aiExperiment.count(), prisma.aiExperiment.count({ where: { status: 'running', enabled: true } }), prisma.aiRolloutAssignment.count(),
  ]);
  return { experiment_count: total, active_experiment_count: active, assignment_count: assignments };
}

async function digitalTwinOverview() {
  const [classes, snapshots, latest] = await Promise.all([
    prisma.teachingClass.count({ where: { status: 'active' } }), prisma.digitalTwinSnapshot.count(),
    prisma.digitalTwinSnapshot.aggregate({ _avg: { confidence: true, sample_size: true } }),
  ]);
  return { teaching_class_count: classes, snapshot_count: snapshots, average_confidence: latest._avg.confidence, average_sample_size: latest._avg.sample_size, data_status: snapshots ? 'sufficient' : 'insufficient_data' };
}

async function assetsOverview() {
  const rows = await prisma.aiTeachingAsset.groupBy({ by: ['status'], _count: { id: true } });
  const status = Object.fromEntries(rows.map((item) => [item.status, item._count.id]));
  const total = rows.reduce((sum, item) => sum + item._count.id, 0);
  const usage = await prisma.aiTeachingAssetUsage.count();
  return { asset_count: total, draft_count: status.draft || 0, published_count: status.published || 0, pending_review_count: status.pending_review || 0, usage_count: usage };
}

async function strategyOverview() {
  const [profiles, students, groups] = await Promise.all([
    prisma.studentStrategyProfile.count(), prisma.studentStrategyProfile.groupBy({ by: ['student_user_id'], _count: { id: true } }),
    prisma.studentStrategyProfile.groupBy({ by: ['profile_type'], _count: { id: true } }),
  ]);
  return { profile_count: profiles, student_count: students.length, distribution: groups.map((item) => ({ type: item.profile_type, count: item._count.id })), data_status: profiles ? 'sufficient' : 'insufficient_data' };
}

async function riskOverview() {
  const today = startOfToday();
  const [open, todayCount, severity, rules] = await Promise.all([
    prisma.aiRiskEvent.count({ where: { status: 'open' } }), prisma.aiRiskEvent.count({ where: { detected_at: { gte: today } } }),
    prisma.aiRiskEvent.groupBy({ by: ['severity'], where: { status: 'open' }, _count: { id: true } }),
    prisma.aiRiskRule.count({ where: { enabled: true } }),
  ]);
  return { open_event_count: open, today_event_count: todayCount, active_rule_count: rules, severity_distribution: Object.fromEntries(severity.map((item) => [item.severity, item._count.id])), critical_count: severity.find((item) => item.severity === 'critical')?._count.id || 0 };
}

const OVERVIEWS = {
  'learning-flows': learningOverview, 'knowledge-health': knowledgeOverview, 'teaching-issues': teachingOverview,
  evaluations: evaluationOverview, experiments: experimentOverview, 'digital-twin': digitalTwinOverview,
  assets: assetsOverview, 'strategy-profiles': strategyOverview, risks: riskOverview,
};

async function getOverview(module) {
  const handler = OVERVIEWS[module];
  if (!handler) throw Object.assign(new Error('未知治理模块'), { code: 40401 });
  return handler();
}

async function listModule(module, query = {}) {
  const { page, pageSize } = pagination(query);
  const skip = (page - 1) * pageSize;
  let list; let total;
  switch (module) {
    case 'learning-flows':
      [list, total] = await Promise.all([
        prisma.learningWorkflowTemplate.findMany({ include: { _count: { select: { versions: true, sessions: true } } }, orderBy: { updated_at: 'desc' }, skip, take: pageSize }),
        prisma.learningWorkflowTemplate.count(),
      ]); break;
    case 'knowledge-health':
      [list, total] = await Promise.all([
        prisma.knowledgeQualityIssue.findMany({ where: query.status ? { status: String(query.status) } : {}, orderBy: [{ severity: 'desc' }, { created_at: 'desc' }], skip, take: pageSize }),
        prisma.knowledgeQualityIssue.count({ where: query.status ? { status: String(query.status) } : {} }),
      ]); break;
    case 'teaching-issues':
      [list, total] = await Promise.all([
        prisma.teachingIssue.findMany({ where: query.status ? { status: String(query.status) } : {}, include: { _count: { select: { evidence: true, interventions: true } } }, orderBy: [{ severity: 'desc' }, { detected_at: 'desc' }], skip, take: pageSize }),
        prisma.teachingIssue.count({ where: query.status ? { status: String(query.status) } : {} }),
      ]); break;
    case 'evaluations':
      [list, total] = await Promise.all([
        prisma.agentEvaluationSet.findMany({ include: { _count: { select: { cases: true, runs: true } } }, orderBy: { updated_at: 'desc' }, skip, take: pageSize }), prisma.agentEvaluationSet.count(),
      ]); break;
    case 'experiments':
      [list, total] = await Promise.all([
        prisma.aiExperiment.findMany({ include: { variants: true, _count: { select: { assignments: true } } }, orderBy: { updated_at: 'desc' }, skip, take: pageSize }), prisma.aiExperiment.count(),
      ]); break;
    case 'digital-twin':
      [list, total] = await Promise.all([
        prisma.digitalTwinSnapshot.findMany({ include: { _count: { select: { simulations: true } } }, orderBy: { created_at: 'desc' }, skip, take: pageSize }), prisma.digitalTwinSnapshot.count(),
      ]); break;
    case 'assets':
      [list, total] = await Promise.all([
        prisma.aiTeachingAsset.findMany({ where: query.status ? { status: String(query.status) } : {}, include: { _count: { select: { versions: true, reviews: true, usage: true } } }, orderBy: { updated_at: 'desc' }, skip, take: pageSize }), prisma.aiTeachingAsset.count({ where: query.status ? { status: String(query.status) } : {} }),
      ]); break;
    case 'strategy-profiles':
      [list, total] = await Promise.all([
        prisma.studentStrategyProfile.findMany({ include: { _count: { select: { evidence: true } } }, orderBy: { created_at: 'desc' }, skip, take: pageSize }), prisma.studentStrategyProfile.count(),
      ]); break;
    case 'risks':
      [list, total] = await Promise.all([
        prisma.aiRiskEvent.findMany({ where: query.status ? { status: String(query.status) } : {}, include: { _count: { select: { evidence: true, actions: true } } }, orderBy: [{ severity: 'desc' }, { detected_at: 'desc' }], skip, take: pageSize }), prisma.aiRiskEvent.count({ where: query.status ? { status: String(query.status) } : {} }),
      ]); break;
    default: throw Object.assign(new Error('未知治理模块'), { code: 40401 });
  }
  return { list, total, page, page_size: pageSize };
}

async function validateWorkflow(input, req) {
  const template = await prisma.learningWorkflowTemplate.findUnique({ where: { template_id: Number(input.template_id) }, include: { versions: { orderBy: { version_number: 'desc' }, take: 1 } } });
  if (!template?.versions[0]) throw Object.assign(new Error('学习流或版本不存在'), { code: 40401 });
  const version = template.versions[0];
  let valid = true; let message = '结构校验通过'; let severity = 'low'; let evidence = { node_count: Array.isArray(version.graph_json?.nodes) ? version.graph_json.nodes.length : 0 };
  try { validateGraphJson(version.graph_json); } catch (error) { valid = false; severity = 'high'; message = String(error.message).slice(0, 500); evidence = { code: error.code || 'WORKFLOW_STRUCTURE_INVALID' }; }
  const row = await prisma.learningFlowValidationResult.create({ data: {
    workflow_template_id: template.template_id, workflow_version_id: version.version_id,
    validation_type: valid ? 'structure_valid' : 'structure_invalid', severity, message,
    evidence_json: evidence, status: valid ? 'resolved' : 'open', checked_by: Number(req.user.user_id),
    resolved_by: valid ? Number(req.user.user_id) : null, resolved_at: valid ? new Date() : null,
  } });
  await recordAdminOperation({ req, operationType: 'VALIDATE_LEARNING_FLOW', targetType: 'learning_workflow', targetId: template.template_id, after: { valid, validation_id: row.id } });
  return { valid, result: row };
}

async function scanKnowledge(_input, req) {
  const documents = await prisma.knowledgeDocument.findMany({ where: { deleted_at: null }, select: { document_id: true, knowledge_base_id: true, title: true, parse_status: true, updated_at: true, _count: { select: { chunks: true } } } });
  let created = 0;
  for (const document of documents) {
    const issueType = document.parse_status === 'FAILED' ? 'parse_failed' : document._count.chunks === 0 ? 'empty_chunks' : null;
    if (!issueType || !document.knowledge_base_id) continue;
    const existing = await prisma.knowledgeQualityIssue.findFirst({ where: { document_id: document.document_id, issue_type: issueType, status: 'open' } });
    if (!existing) {
      await prisma.knowledgeQualityIssue.create({ data: {
        knowledge_base_id: document.knowledge_base_id, document_id: document.document_id, issue_type: issueType,
        severity: issueType === 'parse_failed' ? 'high' : 'medium', title: `${document.title}：${issueType === 'parse_failed' ? '解析失败' : '未产生有效切片'}`,
        suggested_action: issueType === 'parse_failed' ? '检查文件格式后重新解析' : '重新切片并检查文档正文', created_by: Number(req.user.user_id),
      } }); created += 1;
    }
  }
  const knowledgeBases = await prisma.knowledgeBase.findMany({ where: { deleted_at: null }, select: { knowledge_base_id: true, course_id: true } });
  let snapshotsCreated = 0;
  for (const knowledgeBase of knowledgeBases) {
    const scoped = documents.filter((item) => item.knowledge_base_id === knowledgeBase.knowledge_base_id);
    const valid = scoped.filter((item) => item.parse_status !== 'FAILED' && item._count.chunks > 0);
    const chunkCount = scoped.reduce((sum, item) => sum + item._count.chunks, 0);
    const openIssueCount = await prisma.knowledgeQualityIssue.count({ where: { knowledge_base_id: knowledgeBase.knowledge_base_id, status: 'open' } });
    const sampleSize = scoped.length;
    const healthScore = sampleSize ? Number((valid.length / sampleSize * 100).toFixed(2)) : null;
    await prisma.knowledgeHealthSnapshot.create({ data: {
      knowledge_base_id: knowledgeBase.knowledge_base_id, course_id: knowledgeBase.course_id,
      health_score: healthScore, document_count: sampleSize, chunk_count: chunkCount,
      open_issue_count: openIssueCount, sample_size: sampleSize,
      calculation_method: 'document_parse_and_chunk_integrity_ratio_v1',
      metrics_json: sampleSize ? { valid_document_count: valid.length, invalid_document_count: sampleSize - valid.length } : { data_status: 'insufficient_data' },
    } });
    snapshotsCreated += 1;
  }
  await recordAdminOperation({ req, operationType: 'SCAN_KNOWLEDGE_HEALTH', targetType: 'knowledge_base', after: { documents_scanned: documents.length, issues_created: created, snapshots_created: snapshotsCreated } });
  return { documents_scanned: documents.length, issues_created: created, snapshots_created: snapshotsCreated };
}

async function resolveKnowledgeIssue(input, req) {
  const issue = await prisma.knowledgeQualityIssue.findUnique({ where: { id: Number(input.issue_id) } });
  if (!issue) throw Object.assign(new Error('知识库质量问题不存在'), { code: 40401 });
  const status = input.status === 'ignored' ? 'ignored' : 'resolved';
  const updated = await prisma.knowledgeQualityIssue.update({ where: { id: issue.id }, data: {
    status, assigned_to: Number(req.user.user_id), resolved_by: Number(req.user.user_id), resolved_at: new Date(),
  } });
  await recordAdminOperation({ req, operationType: 'RESOLVE_KNOWLEDGE_ISSUE', targetType: 'knowledge_quality_issue', targetId: issue.id, before: { status: issue.status }, after: { status, resolution: String(input.resolution || '').slice(0, 500) } });
  return updated;
}

async function detectTeachingIssues(_input, req) {
  const groups = await prisma.studentMasteryRecord.groupBy({ by: ['course_id', 'knowledge_point_id'], _avg: { mastery_score: true }, _count: { mastery_record_id: true } });
  let created = 0;
  for (const group of groups.filter((item) => item._count.mastery_record_id >= 3 && item._avg.mastery_score < 60)) {
    const existing = await prisma.teachingIssue.findFirst({ where: { issue_type: 'low_mastery_knowledge_point', course_id: group.course_id, knowledge_point_id: group.knowledge_point_id, status: 'open' } });
    if (!existing) {
      const issue = await prisma.teachingIssue.create({ data: {
        issue_type: 'low_mastery_knowledge_point', severity: group._avg.mastery_score < 40 ? 'high' : 'medium',
        title: '知识点群体掌握度偏低', description: `真实掌握度样本均值为 ${group._avg.mastery_score.toFixed(1)} 分`,
        course_id: group.course_id, knowledge_point_id: group.knowledge_point_id,
        affected_count: group._count.mastery_record_id, confidence: Math.min(0.95, 0.5 + group._count.mastery_record_id / 100),
        detection_method: 'student_mastery_records_window_aggregate', created_by: Number(req.user.user_id), updated_by: Number(req.user.user_id),
      } });
      await prisma.teachingIssueEvidence.create({ data: { teaching_issue_id: issue.id, evidence_type: 'aggregate', source_type: 'student_mastery_records', metric_name: 'average_mastery_score', metric_value: group._avg.mastery_score, sample_size: group._count.mastery_record_id, observed_at: new Date() } });
      created += 1;
    }
  }
  await recordAdminOperation({ req, operationType: 'DETECT_TEACHING_ISSUES', targetType: 'teaching_issue', after: { groups_scanned: groups.length, issues_created: created } });
  return { groups_scanned: groups.length, issues_created: created };
}

async function createIntervention(input, req) {
  if (!input.title || !input.intervention_type) throw Object.assign(new Error('干预标题和类型不能为空'), { code: 40001 });
  const created = await prisma.teachingIntervention.create({ data: {
    teaching_issue_id: input.teaching_issue_id ? Number(input.teaching_issue_id) : null,
    intervention_type: String(input.intervention_type).slice(0, 80), title: String(input.title).slice(0, 240),
    content: input.content || null, status: input.status || 'draft', scheduled_at: input.scheduled_at ? new Date(input.scheduled_at) : null,
    created_by: Number(req.user.user_id), updated_by: Number(req.user.user_id),
    targets: Array.isArray(input.targets) ? { create: input.targets.map((target) => ({ target_type: String(target.target_type).slice(0, 50), target_id: Number(target.target_id) })) } : undefined,
  }, include: { targets: true } });
  await recordAdminOperation({ req, operationType: 'CREATE_TEACHING_INTERVENTION', targetType: 'teaching_intervention', targetId: created.id, after: created });
  return created;
}

async function createEvaluationSet(input, req) {
  if (!input.name) throw Object.assign(new Error('评测集名称不能为空'), { code: 40001 });
  const created = await prisma.agentEvaluationSet.create({ data: { name: String(input.name).slice(0, 200), description: input.description || null, domain: input.domain || null, passing_score: input.passing_score == null ? null : Number(input.passing_score), created_by: Number(req.user.user_id), updated_by: Number(req.user.user_id), cases: Array.isArray(input.cases) ? { create: input.cases.map((item, index) => ({ case_key: item.case_key || `case_${index + 1}`, title: item.title || `案例 ${index + 1}`, input_json: item.input_json || {}, expected_json: item.expected_json || null, rubric_json: item.rubric_json || null, created_by: Number(req.user.user_id) })) } : undefined }, include: { cases: true } });
  await recordAdminOperation({ req, operationType: 'CREATE_AGENT_EVALUATION_SET', targetType: 'agent_evaluation_set', targetId: created.id, after: { name: created.name, cases: created.cases.length } });
  return created;
}

async function runEvaluation(input, req) {
  const evaluationSet = await prisma.agentEvaluationSet.findUnique({ where: { id: Number(input.evaluation_set_id) }, include: { cases: { where: { enabled: true } } } });
  const agent = await prisma.aiAgentConfig.findUnique({ where: { agent_config_id: Number(input.agent_config_id) } });
  const modelId = Number(input.model_config_id || agent?.model_config_id);
  if (!Number.isInteger(modelId) || modelId <= 0) throw Object.assign(new Error('Agent 尚未绑定有效模型'), { code: 40001 });
  const model = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: modelId }, include: { provider_config: true } });
  if (!evaluationSet || !agent || !model?.provider_config) throw Object.assign(new Error('评测集、Agent 或模型配置不存在'), { code: 40401 });
  const run = await prisma.agentEvaluationRun.create({ data: { evaluation_set_id: evaluationSet.id, agent_config_id: agent.agent_config_id, agent_version_id: input.agent_version_id ? Number(input.agent_version_id) : null, model_config_id: model.ai_model_config_id, status: 'running', total_cases: evaluationSet.cases.length, created_by: Number(req.user.user_id), started_at: new Date() } });
  const { adapter } = await providerFactory.getProvider(model.provider_id);
  let completed = 0; let passed = 0;
  for (const testCase of evaluationSet.cases) {
    const prompt = String(testCase.input_json?.prompt || testCase.input_json?.question || JSON.stringify(testCase.input_json));
    try {
      const response = await adapter.chat({ model: model.model_code || model.model_name, messages: [{ role: 'user', content: prompt }], maxTokens: Number(input.max_output_tokens) || 800 });
      const expectedText = testCase.expected_json?.expected_text;
      const score = expectedText == null ? null : (response.content.includes(String(expectedText)) ? 100 : 0);
      const isPassed = score == null ? null : score >= (evaluationSet.passing_score ?? 60);
      if (isPassed) passed += 1;
      await prisma.agentEvaluationResult.create({ data: { evaluation_run_id: run.id, evaluation_case_id: testCase.id, status: 'completed', output_json: { content: response.content }, score, passed: isPassed, scoring_evidence: expectedText == null ? { method: 'not_scored', reason: 'expected_text_missing' } : { method: 'deterministic_substring_match', expected_text_present: Boolean(isPassed) }, latency_ms: response.latency_ms, total_tokens: response.usage?.total_tokens || null } });
    } catch (error) {
      await prisma.agentEvaluationResult.create({ data: { evaluation_run_id: run.id, evaluation_case_id: testCase.id, status: 'failed', output_json: { error: error.message }, passed: false, scoring_evidence: { method: 'execution_error' } } });
    }
    completed += 1;
    await prisma.agentEvaluationRun.update({ where: { id: run.id }, data: { completed_cases: completed, passed_cases: passed } });
  }
  const finished = await prisma.agentEvaluationRun.update({ where: { id: run.id }, data: { status: 'completed', completed_at: new Date(), aggregate_json: { scored_cases: evaluationSet.cases.filter((item) => item.expected_json?.expected_text != null).length, passed_cases: passed } } });
  await recordAdminOperation({ req, operationType: 'RUN_AGENT_EVALUATION', targetType: 'agent_evaluation_run', targetId: run.id, after: { completed, passed } });
  return finished;
}

async function publishEvaluationSet(input, req) {
  const current = await prisma.agentEvaluationSet.findUnique({ where: { id: Number(input.evaluation_set_id) }, include: { _count: { select: { cases: true } } } });
  if (!current) throw Object.assign(new Error('评测集不存在'), { code: 40401 });
  if (!current._count.cases) throw Object.assign(new Error('评测集至少需要一个案例后才能发布'), { code: 40001 });
  const updated = await prisma.agentEvaluationSet.update({ where: { id: current.id }, data: { status: 'published', published_at: new Date(), updated_by: Number(req.user.user_id) } });
  await recordAdminOperation({ req, operationType: 'PUBLISH_AGENT_EVALUATION_SET', targetType: 'agent_evaluation_set', targetId: current.id, before: { status: current.status }, after: { status: 'published' } });
  return updated;
}

async function createExperiment(input, req) {
  if (!input.name || !Array.isArray(input.variants) || input.variants.length < 2) throw Object.assign(new Error('实验名称和至少两个变体不能为空'), { code: 40001 });
  const allocation = input.variants.reduce((sum, item) => sum + Number(item.allocation_bp || 0), 0);
  if (allocation !== 10000) throw Object.assign(new Error('实验变体流量合计必须为 10000 基点'), { code: 40001 });
  const created = await prisma.aiExperiment.create({ data: {
    experiment_key: input.experiment_key || `exp_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    name: String(input.name).slice(0, 200), description: input.description || null, target_type: input.target_type || 'agent',
    target_id: input.target_id ? Number(input.target_id) : null, course_id: input.course_id ? Number(input.course_id) : null,
    teaching_class_id: input.teaching_class_id ? Number(input.teaching_class_id) : null,
    assignment_salt: crypto.randomBytes(24).toString('hex'), success_metric_json: input.success_metric_json || {}, stop_condition_json: input.stop_condition_json || null,
    created_by: Number(req.user.user_id), updated_by: Number(req.user.user_id),
    variants: { create: input.variants.map((item) => ({ variant_key: item.variant_key, name: item.name, is_control: Boolean(item.is_control), allocation_bp: Number(item.allocation_bp), configuration_json: item.configuration_json || {} })) },
  }, include: { variants: true } });
  await recordAdminOperation({ req, operationType: 'CREATE_AI_EXPERIMENT', targetType: 'ai_experiment', targetId: created.id, after: { name: created.name, variant_count: created.variants.length } });
  return created;
}

async function assignExperiment(input, req) {
  const experiment = await prisma.aiExperiment.findUnique({ where: { id: Number(input.experiment_id) }, include: { variants: true } });
  if (!experiment || !experiment.enabled || !['published', 'running'].includes(experiment.status)) throw Object.assign(new Error('实验未发布或不可用'), { code: 40001 });
  const userId = Number(input.user_id);
  const existing = await prisma.aiRolloutAssignment.findUnique({ where: { experiment_id_user_id: { experiment_id: experiment.id, user_id: userId } }, include: { variant: true } });
  if (existing) return existing;
  const assignment = aiConfigService.stableAssignment(experiment.experiment_key, experiment.assignment_salt, userId, experiment.variants);
  if (!assignment.variant) throw Object.assign(new Error('实验没有可用变体'), { code: 40001 });
  const created = await prisma.aiRolloutAssignment.create({ data: { experiment_id: experiment.id, variant_id: assignment.variant.id, user_id: userId, assignment_hash: assignment.hash }, include: { variant: true } });
  await recordAdminOperation({ req, operationType: 'ASSIGN_AI_EXPERIMENT', targetType: 'ai_experiment', targetId: experiment.id, after: { user_id: userId, variant_key: created.variant.variant_key } });
  return created;
}

async function updateExperimentStatus(input, req) {
  const experiment = await prisma.aiExperiment.findUnique({ where: { id: Number(input.experiment_id) } });
  if (!experiment) throw Object.assign(new Error('实验不存在'), { code: 40401 });
  const status = String(input.status || '');
  if (!['published', 'running', 'paused', 'terminated', 'rolled_back'].includes(status)) throw Object.assign(new Error('实验状态不合法'), { code: 40001 });
  const now = new Date();
  const data = { status, updated_by: Number(req.user.user_id), enabled: !['terminated', 'rolled_back'].includes(status) };
  if (status === 'published') data.published_at = experiment.published_at || now;
  if (status === 'running') { data.published_at = experiment.published_at || now; data.starts_at = experiment.starts_at || now; }
  if (['terminated', 'rolled_back'].includes(status)) data.ends_at = now;
  const updated = await prisma.aiExperiment.update({ where: { id: experiment.id }, data });
  await recordAdminOperation({ req, operationType: `AI_EXPERIMENT_${status.toUpperCase()}`, targetType: 'ai_experiment', targetId: experiment.id, before: { status: experiment.status, enabled: experiment.enabled }, after: { status, enabled: data.enabled }, failureReason: input.reason || null });
  return updated;
}

async function calculateDigitalTwin(input, req) {
  const classId = Number(input.teaching_class_id); const courseId = Number(input.course_id);
  const enrollments = await prisma.studentCourseEnrollment.findMany({ where: { teaching_class_id: classId, course_id: courseId, enrollment_status: 'active' }, select: { student_user_id: true } });
  const studentIds = enrollments.map((item) => item.student_user_id);
  const mastery = studentIds.length ? await prisma.studentMasteryRecord.groupBy({ by: ['knowledge_point_id'], where: { course_id: courseId, student_user_id: { in: studentIds } }, _avg: { mastery_score: true }, _count: { mastery_record_id: true } }) : [];
  const sampleSize = studentIds.length;
  const confidence = sampleSize < 5 ? null : Math.min(0.9, 0.5 + sampleSize / 100);
  const created = await prisma.digitalTwinSnapshot.create({ data: {
    teaching_class_id: classId, course_id: courseId, range_start: input.range_start ? new Date(input.range_start) : new Date(Date.now() - 30 * 86400000), range_end: input.range_end ? new Date(input.range_end) : new Date(),
    sample_size: sampleSize, calculation_method: 'student_mastery_records_arithmetic_mean', confidence,
    mastery_matrix_json: mastery.map((item) => ({ knowledge_point_id: item.knowledge_point_id, average_mastery: item._avg.mastery_score, sample_size: item._count.mastery_record_id })),
    risk_distribution_json: { low_mastery_knowledge_points: mastery.filter((item) => item._avg.mastery_score < 60).length },
    data_quality_json: sampleSize < 5 ? { status: 'insufficient_data', reason: '班级有效学生样本少于 5' } : { status: 'sufficient' },
  } });
  await recordAdminOperation({ req, operationType: 'CALCULATE_DIGITAL_TWIN', targetType: 'digital_twin_snapshot', targetId: created.id, after: { sample_size: sampleSize, confidence } });
  return created;
}

async function simulateDigitalTwin(input, req) {
  const snapshot = await prisma.digitalTwinSnapshot.findUnique({ where: { id: Number(input.snapshot_id) } });
  if (!snapshot) throw Object.assign(new Error('数字孪生快照不存在'), { code: 40401 });
  if (snapshot.sample_size < 5 || snapshot.confidence == null) throw Object.assign(new Error('样本少于 5，不能生成干预预测'), { code: 40001 });
  const matrix = Array.isArray(snapshot.mastery_matrix_json) ? snapshot.mastery_matrix_json : [];
  const lowMastery = matrix.filter((item) => Number(item.average_mastery) < 60).length;
  const coverage = matrix.length ? lowMastery / matrix.length : 0;
  const expectedMin = Number((Math.min(6, 1 + coverage * 2)).toFixed(2));
  const expectedMax = Number((Math.min(12, expectedMin + 3 + Math.log10(snapshot.sample_size + 1))).toFixed(2));
  const created = await prisma.digitalTwinSimulation.create({ data: {
    snapshot_id: snapshot.id, intervention_type: String(input.intervention_type || 'targeted_learning_flow').slice(0, 80),
    parameters_json: input.parameters_json || {}, affected_student_count: snapshot.sample_size,
    expected_delta_min: expectedMin, expected_delta_max: expectedMax, confidence: snapshot.confidence,
    method_explanation: '基于快照中的低掌握度知识点占比和有效学生样本量进行保守区间估计。',
    uncertainty_note: '该结果是统计情景模拟，不代表个体因果效果；上线前仍需灰度实验验证。', created_by: Number(req.user.user_id),
  } });
  await recordAdminOperation({ req, operationType: 'SIMULATE_DIGITAL_TWIN_INTERVENTION', targetType: 'digital_twin_simulation', targetId: created.id, after: { snapshot_id: snapshot.id, expected_delta_min: expectedMin, expected_delta_max: expectedMax, confidence: snapshot.confidence } });
  return created;
}

async function createAsset(input, req) {
  if (!input.title || !input.asset_type || !input.content_json) throw Object.assign(new Error('资产标题、类型和内容不能为空'), { code: 40001 });
  const checksum = crypto.createHash('sha256').update(JSON.stringify(input.content_json)).digest('hex');
  const created = await prisma.aiTeachingAsset.create({ data: {
    asset_key: input.asset_key || `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, asset_type: input.asset_type,
    title: String(input.title).slice(0, 240), summary: input.summary || null, course_id: input.course_id ? Number(input.course_id) : null,
    knowledge_point_id: input.knowledge_point_id ? Number(input.knowledge_point_id) : null, source_type: input.source_type || 'manual',
    source_id: input.source_id || null, source_trace_id: input.source_trace_id ? Number(input.source_trace_id) : null,
    created_by: Number(req.user.user_id), updated_by: Number(req.user.user_id),
    versions: { create: { version_number: 1, content_json: input.content_json, checksum, created_by: Number(req.user.user_id) } },
  }, include: { versions: true } });
  await recordAdminOperation({ req, operationType: 'CREATE_AI_TEACHING_ASSET', targetType: 'ai_teaching_asset', targetId: created.id, after: { title: created.title, source_type: created.source_type } });
  return created;
}

async function updateAssetStatus(input, req) {
  const asset = await prisma.aiTeachingAsset.findUnique({ where: { id: Number(input.asset_id) }, include: { _count: { select: { versions: true } } } });
  if (!asset) throw Object.assign(new Error('教学资产不存在'), { code: 40401 });
  if (!asset._count.versions) throw Object.assign(new Error('教学资产没有可发布版本'), { code: 40001 });
  const action = String(input.action || '');
  const statusMap = { submit_review: 'pending_review', approve: 'approved', reject: 'rejected', publish: 'published', offline: 'offline' };
  const status = statusMap[action];
  if (!status) throw Object.assign(new Error('资产审核动作不合法'), { code: 40001 });
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const value = await tx.aiTeachingAsset.update({ where: { id: asset.id }, data: {
      status, enabled: action !== 'offline', published_at: action === 'publish' ? now : asset.published_at,
      archived_at: action === 'offline' ? now : null, updated_by: Number(req.user.user_id),
    } });
    await tx.aiTeachingAssetReview.create({ data: { asset_id: asset.id, action, reason: String(input.reason || '').slice(0, 5000) || null, reviewer_id: Number(req.user.user_id) } });
    return value;
  });
  await recordAdminOperation({ req, operationType: `AI_ASSET_${action.toUpperCase()}`, targetType: 'ai_teaching_asset', targetId: asset.id, before: { status: asset.status }, after: { status } });
  return updated;
}

async function computeStrategyProfile(input, req) {
  const studentId = Number(input.student_user_id); const courseId = input.course_id ? Number(input.course_id) : null;
  const from = input.range_start ? new Date(input.range_start) : new Date(Date.now() - 30 * 86400000); const to = input.range_end ? new Date(input.range_end) : new Date();
  const [sessions, nodeRuns, aiCalls] = await Promise.all([
    prisma.learningSession.findMany({ where: { student_user_id: studentId, ...(courseId ? { course_id: courseId } : {}), created_at: { gte: from, lte: to } }, select: { status: true, total_correct: true, total_wrong: true } }),
    prisma.learningSessionNodeRun.count({ where: { session: { student_user_id: studentId, ...(courseId ? { course_id: courseId } : {}) }, created_at: { gte: from, lte: to } } }),
    prisma.aiCallLog.count({ where: { user_id: studentId, created_at: { gte: from, lte: to } } }),
  ]);
  const sample = sessions.length + nodeRuns;
  if (sample < 5) return { data_status: 'insufficient_data', sample_size: sample, required_sample_size: 5 };
  const interruptions = sessions.filter((item) => ['ABANDONED', 'FAILED'].includes(String(item.status))).length;
  const aiPerNode = nodeRuns ? aiCalls / nodeRuns : 0;
  const profileType = interruptions / Math.max(1, sessions.length) > 0.35 ? '容易中断型' : aiPerNode > 0.8 ? 'AI依赖偏高型' : '稳定推进型';
  const confidence = Math.min(0.9, 0.55 + sample / 200);
  const latest = await prisma.studentStrategyProfile.findFirst({ where: { student_user_id: studentId, course_id: courseId }, orderBy: { profile_version: 'desc' } });
  const created = await prisma.studentStrategyProfile.create({ data: {
    student_user_id: studentId, course_id: courseId, profile_type: profileType, profile_version: (latest?.profile_version || 0) + 1,
    confidence, range_start: from, range_end: to, sample_size: sample,
    metrics_json: { session_count: sessions.length, node_run_count: nodeRuns, ai_call_count: aiCalls, interruption_rate: ratio(interruptions, sessions.length), ai_calls_per_node: Number(aiPerNode.toFixed(3)) },
    calculation_method: '30_day_multi_signal_rule_v1',
    evidence: { create: [
      { evidence_type: 'aggregate', source_type: 'learning_sessions', metric_name: 'interruption_rate', metric_value: ratio(interruptions, sessions.length), weight: 0.5 },
      { evidence_type: 'aggregate', source_type: 'ai_call_logs', metric_name: 'ai_calls_per_node', metric_value: aiPerNode, weight: 0.5 },
    ] },
  }, include: { evidence: true } });
  await recordAdminOperation({ req, operationType: 'COMPUTE_STUDENT_STRATEGY_PROFILE', targetType: 'student_strategy_profile', targetId: created.id, after: { profile_type: profileType, confidence, sample_size: sample } });
  return { data_status: 'sufficient', profile: created };
}

async function resolveRisk(input, req) {
  const event = await prisma.aiRiskEvent.findUnique({ where: { id: Number(input.event_id) } });
  if (!event) throw Object.assign(new Error('风险事件不存在'), { code: 40401 });
  const status = ['confirmed', 'false_positive', 'resolved'].includes(input.status) ? input.status : 'resolved';
  const updated = await prisma.$transaction(async (tx) => {
    const value = await tx.aiRiskEvent.update({ where: { id: event.id }, data: { status, assignee_id: Number(req.user.user_id), resolution: String(input.resolution || '').slice(0, 5000) || null, confirmed: status === 'confirmed' ? true : status === 'false_positive' ? false : event.confirmed, resolved_at: ['resolved', 'false_positive'].includes(status) ? new Date() : null } });
    await tx.aiRiskAction.create({ data: { risk_event_id: event.id, action_type: status, status: 'success', action_summary: String(input.resolution || status).slice(0, 500), actor_user_id: Number(req.user.user_id), request_id: req.id || null } });
    return value;
  });
  await recordAdminOperation({ req, operationType: 'RESOLVE_AI_RISK', targetType: 'ai_risk_event', targetId: event.id, before: { status: event.status }, after: { status } });
  return updated;
}

const ACTIONS = {
  'learning-flows': { validate: validateWorkflow }, 'knowledge-health': { scan: scanKnowledge, resolve: resolveKnowledgeIssue },
  'teaching-issues': { detect: detectTeachingIssues, 'create-intervention': createIntervention },
  evaluations: { create: createEvaluationSet, run: runEvaluation, publish: publishEvaluationSet },
  experiments: { create: createExperiment, assign: assignExperiment, status: updateExperimentStatus },
  'digital-twin': { calculate: calculateDigitalTwin, simulate: simulateDigitalTwin }, assets: { create: createAsset, status: updateAssetStatus },
  'strategy-profiles': { compute: computeStrategyProfile }, risks: { resolve: resolveRisk },
};

async function runAction(module, action, input, req) {
  const handler = ACTIONS[module]?.[action];
  if (!handler) throw Object.assign(new Error('未知治理操作'), { code: 40401 });
  return handler(input || {}, req);
}

module.exports = { getOverview, listModule, runAction, learningOverview, knowledgeOverview, teachingOverview, evaluationOverview, riskOverview };
