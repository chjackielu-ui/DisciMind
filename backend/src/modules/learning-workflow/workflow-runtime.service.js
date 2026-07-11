// 学习流运行引擎 — 会话管理、节点执行、条件分支、动态调整
//
// AGENT_MODE=langgraph 时：
//   所有 Agent 调用发生在 compiled LangGraph 节点内部。
//   runtime 只负责创建/启动会话、invoke Graph、resume Graph。
//   runtime 不再直接调用 runExplainer / runTrainer / runDiagnostician。
const prisma = require('../../config/prisma');
const { createAgentError } = require('../agent/common/agent.errors');
const {
  NODE_TO_AGENT,
  evaluateCondition,
  getNextNodeIds,
  sanitizeGraphJson,
  sanitizeSettingsJson,
  validateGraphJson,
} = require('./workflow-schema');
const explainerService = require('../agent/explainer/explainer.service');
const trainerService = require('../agent/trainer/trainer.service');
const diagnosticianService = require('../agent/diagnostician/diagnostician.service');
const { normalizeWorkflowNodeType } = require('./workflow-node-type');
const { normalizeStoredAgentOutput } = require('./agent-result-parser');
const {
  EXECUTION_STATUS,
  currentInterrupt,
  mapGraphExecution,
  contentFromState,
  buildNodeDescriptor,
  allowedActions,
  buildInteraction,
} = require('./execution-protocol');

// ---- LangGraph 模式支持 ----
const AGENT_MODE = process.env.AGENT_MODE || 'dify';

function isLangGraphMode() {
  return AGENT_MODE === 'langgraph' && process.env.LANGGRAPH_ENABLED === 'true';
}

function getGraphModule() {
  return require('../learning-agent');
}

const executionLocks = new Map();
const actionLocks = new Map();

function withLock(map, key, factory) {
  if (map.has(key)) return map.get(key);
  const promise = Promise.resolve().then(factory).finally(() => {
    if (map.get(key) === promise) map.delete(key);
  });
  map.set(key, promise);
  return promise;
}

const COMPLETION_MODE_VALUES = Object.freeze({
  flow_complete: 'FLOW_COMPLETE', mastery_target: 'MASTERY_TARGET',
  FLOW_COMPLETE: 'FLOW_COMPLETE', MASTERY_TARGET: 'MASTERY_TARGET',
});
const ADJUSTMENT_MODE_VALUES = Object.freeze({
  auto_adjust: 'AUTO_ADJUST', ask_before_adjust: 'ASK_BEFORE_ADJUST', strict_original: 'STRICT_ORIGINAL',
  AUTO_ADJUST: 'AUTO_ADJUST', ASK_BEFORE_ADJUST: 'ASK_BEFORE_ADJUST', STRICT_ORIGINAL: 'STRICT_ORIGINAL',
});

const PRACTICE_DEFAULTS = Object.freeze({
  targetQuestionCount: 5, minQuestionCount: 3, maxQuestionCount: 8,
  targetMastery: 80, consecutiveCorrectToFinish: 3, allowSkip: true,
  difficultyMode: 'adaptive', exitMode: 'target_or_mastery_or_streak',
});

function boundedInt(v, fallback, min, max) {
  const p = Number.parseInt(v, 10);
  return Number.isFinite(p) ? Math.min(max, Math.max(min, p)) : fallback;
}
function getPracticeConfig(cfg = {}) {
  const tc = boundedInt(cfg.targetQuestionCount ?? cfg.questionCount, PRACTICE_DEFAULTS.targetQuestionCount, 1, PRACTICE_DEFAULTS.maxQuestionCount);
  const minQ = boundedInt(cfg.minQuestionCount, Math.min(PRACTICE_DEFAULTS.minQuestionCount, tc), 1, tc);
  const maxQ = boundedInt(cfg.maxQuestionCount, Math.max(PRACTICE_DEFAULTS.maxQuestionCount, tc), tc, 20);
  return {
    targetQuestionCount: tc, minQuestionCount: minQ, maxQuestionCount: maxQ,
    targetMastery: boundedInt(cfg.targetMastery, PRACTICE_DEFAULTS.targetMastery, 0, 100),
    consecutiveCorrectToFinish: boundedInt(cfg.consecutiveCorrectToFinish, PRACTICE_DEFAULTS.consecutiveCorrectToFinish, 1, maxQ),
    allowSkip: cfg.allowSkip !== false,
    difficultyMode: String(cfg.difficultyMode || PRACTICE_DEFAULTS.difficultyMode),
    exitMode: String(cfg.exitMode || PRACTICE_DEFAULTS.exitMode),
  };
}
function isPracticeNode(n) { return ['basic_practice', 'adaptive_practice'].includes(n?.type); }

function currentRunForSession(session) {
  const runs = session?.node_runs || [];
  if (session?.current_node_run_id) {
    const found = runs.find((r) => Number(r.node_run_id) === Number(session.current_node_run_id));
    if (found && String(found.node_id) === String(session?.current_node_id)) return found;
  }
  return runs
    .filter((r) => String(r.node_id) === String(session?.current_node_id))
    .sort((a, b) => Number(b.node_run_id) - Number(a.node_run_id))[0] || null;
}
function isTerminalNodeRun(s) { return ['COMPLETED', 'SKIPPED', 'FAILED'].includes(s); }
function toCompletionMode(v) { const r = COMPLETION_MODE_VALUES[v || 'flow_complete']; if (!r) throw createAgentError('INVALID_INPUT', '完成方式不合法', 400); return r; }
function toAdjustmentMode(v) { const r = ADJUSTMENT_MODE_VALUES[v || 'auto_adjust']; if (!r) throw createAgentError('INVALID_INPUT', '诊断师调整方式不合法', 400); return r; }

// ========================
// 会话管理
// ========================

async function createSession({ userId, courseId, knowledgePointId, templateId, versionId, completionMode, targetMastery, adjustmentMode, estimatedMinutes }) {
  const nc = Number(courseId), nkp = Number(knowledgePointId);
  if (!Number.isInteger(nc) || nc < 1 || !Number.isInteger(nkp) || nkp < 1) {
    throw createAgentError('INVALID_INPUT', '开始学习前请选择课程和知识点', 400);
  }
  const [enrollment, kp] = await Promise.all([
    prisma.studentCourseEnrollment.findFirst({ where: { student_user_id: Number(userId), course_id: nc, enrollment_status: 'active' }, select: { enrollment_id: true } }),
    prisma.knowledgePoint.findFirst({ where: { knowledge_point_id: nkp, course_id: nc }, select: { knowledge_point_id: true } }),
  ]);
  if (!enrollment) throw createAgentError('COURSE_ACCESS_DENIED', '你尚未加入所选课程', 403);
  if (!kp) throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '知识点不属于所选课程', 400);

  const template = await prisma.learningWorkflowTemplate.findUnique({
    where: { template_id: Number(templateId) },
    include: { versions: { where: versionId ? { version_id: Number(versionId) } : {}, orderBy: { version_number: 'desc' }, take: 1 } },
  });
  if (!template) throw createAgentError('TEMPLATE_NOT_FOUND', '学习流模板不存在', 404);
  const canUse = template.source_type === 'SYSTEM' || (template.source_type === 'TEACHER' && template.is_published) || template.owner_user_id === Number(userId);
  if (!canUse || template.status !== 'active') throw createAgentError('TEMPLATE_ACCESS_DENIED', '无权使用该学习流', 403);
  if (template.course_id && template.course_id !== nc) throw createAgentError('TEMPLATE_SCOPE_MISMATCH', '该学习流绑定了其他课程', 400);
  if (template.knowledge_point_id && template.knowledge_point_id !== nkp) throw createAgentError('TEMPLATE_SCOPE_MISMATCH', '该学习流绑定了其他知识点', 400);
  const version = template.versions[0];
  if (!version) throw createAgentError('VERSION_NOT_FOUND', '模板没有可用版本', 404);

  const graph = sanitizeGraphJson(version.graph_json || {});
  const settings = sanitizeSettingsJson(version.settings_json || {});

  // 复用未完成会话
  const existing = await prisma.learningSession.findFirst({
    where: { student_user_id: Number(userId), workflow_template_id: template.template_id, course_id: nc, knowledge_point_id: nkp, status: { in: ['CREATED', 'RUNNING', 'PAUSED'] } },
    orderBy: { updated_at: 'desc' },
  });
  if (existing) return getSession(existing.session_id, userId);

  let masteryBefore = null;
  if (knowledgePointId) {
    const m = await prisma.studentMasteryRecord.findUnique({
      where: { student_user_id_course_id_knowledge_point_id: { student_user_id: Number(userId), course_id: nc, knowledge_point_id: nkp } },
    });
    masteryBefore = m?.mastery_score ?? null;
  }

  const session = await prisma.learningSession.create({
    data: {
      student_user_id: Number(userId), course_id: nc, knowledge_point_id: nkp,
      workflow_template_id: template.template_id, workflow_version_id: version.version_id,
      workflow_snapshot_json: version.graph_json, runtime_graph_json: graph,
      status: 'CREATED', current_node_id: graph.entryNodeId || null,
      completion_mode: toCompletionMode(completionMode || settings.completion_mode),
      target_mastery: targetMastery || settings.target_mastery || 80,
      adjustment_mode: toAdjustmentMode(adjustmentMode || settings.adjustment_mode),
      mastery_before: masteryBefore, mastery_current: masteryBefore,
      estimated_minutes: estimatedMinutes || settings.estimated_minutes || 25,
    },
  });
  await addSessionEvent(session.session_id, 'SESSION_PAUSED', null, '学习会话已创建');
  return getSession(session.session_id, userId);
}

async function getSession(sessionId, userId) {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
    include: {
      node_runs: { orderBy: { sequence_index: 'asc' } },
      course: { select: { course_id: true, course_name: true, course_code: true } },
      knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } },
      workflow_template: { select: { template_id: true, title: true } },
    },
  });
  if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
  if (session.student_user_id !== Number(userId)) throw createAgentError('SESSION_ACCESS_DENIED', '无权访问该学习会话', 403);

  const runtimeGraph = session.runtime_graph_json || {};
  const completedIds = new Set((session.node_runs || []).filter((r) => r.status === 'COMPLETED' || r.status === 'SKIPPED').map((r) => r.node_id));
  const pendingNodes = (runtimeGraph.nodes || []).filter((n) => !completedIds.has(n.id));
  const currentNodeRun = currentRunForSession(session);
  let trainerSession = null;
  if (currentNodeRun?.trainer_session_id) {
    trainerSession = await trainerService.getTrainerSession(Number(userId), currentNodeRun.trainer_session_id).catch(() => null);
  }
  const completedTrainerHistory = await Promise.all(
    (session.node_runs || []).filter((r) => r.trainer_session_id && Number(r.node_run_id) !== Number(currentNodeRun?.node_run_id))
      .map(async (r) => ({ nodeRunId: r.node_run_id, nodeId: r.node_id, status: r.status, trainer: await trainerService.getTrainerSession(Number(userId), r.trainer_session_id).catch(() => null) })),
  );

  return {
    ...session,
    currentNodeRun, currentNodeExecutionId: currentNodeRun?.node_run_id || null,
    trainerSession, completedTrainerHistory,
    completedNodeCount: completedIds.size, pendingNodeCount: pendingNodes.length,
    totalNodeCount: (runtimeGraph.nodes || []).length,
  };
}

function nodeForSession(session, graphState = null) {
  if (graphState?.currentNode) return graphState.currentNode;
  return (session.runtime_graph_json?.nodes || []).find((node) => String(node.id) === String(session.current_node_id)) || null;
}

function enrichMasteryGateContent(content, session) {
  if (!content?.data) return content;
  const mastery = Math.round(Number(content.data.mastery_estimate ?? session.mastery_current ?? 0));
  const target = Math.round(Number(content.data.target_mastery ?? session.target_mastery ?? 80));
  const correct = Number(content.data.correct_count ?? session.total_correct ?? 0);
  const wrong = Number(content.data.wrong_count ?? session.total_wrong ?? 0);
  const answered = Number(content.data.answered_count ?? (correct + wrong));
  const passed = content.data.passed ?? mastery >= target;
  return {
    ...content,
    data: {
      ...content.data,
      overall_assessment: content.data.overall_assessment === '掌握度检查完成'
        ? (passed ? `当前掌握度为 ${mastery}%，已达到 ${target}% 的学习目标。` : `当前掌握度为 ${mastery}%，距离 ${target}% 的目标还差 ${Math.max(0, target - mastery)} 个百分点。`)
        : content.data.overall_assessment,
      mastery_estimate: mastery,
      target_mastery: target,
      passed,
      answered_count: answered,
      correct_count: correct,
      wrong_count: wrong,
      accuracy: content.data.accuracy ?? (answered ? Math.round((correct / answered) * 100) : null),
      recommended_next_step: content.data.recommended_next_step || (passed ? '进入学习总结' : '进入关键概念复盘'),
    },
  };
}

async function serializeSession(session, snapshot = null) {
  let graphSnapshot = snapshot;
  if (isLangGraphMode() && !graphSnapshot) {
    graphSnapshot = await getGraphModule().inspectGraph(String(session.session_id)).catch(() => null);
  }
  const graphState = graphSnapshot?.values || {};
  const nodeRun = currentRunForSession(session);
  let execution = mapGraphExecution(graphState, null, graphSnapshot);
  if (nodeRun?.status === 'FAILED' && execution.status !== EXECUTION_STATUS.FAILED) {
    execution = {
      ...execution,
      status: EXECUTION_STATUS.FAILED,
      nodeCompleted: false,
      requiresStudentInput: false,
      canRetry: true,
      canSkip: true,
      canContinue: false,
    };
  } else if (!graphSnapshot && nodeRun?.status === 'COMPLETED') {
    execution = { ...execution, status: EXECUTION_STATUS.COMPLETED, nodeCompleted: true, canContinue: true };
  }
  const nodes = session.runtime_graph_json?.nodes || [];
  const node = nodeForSession(session, graphState);
  const content = node?.type === 'mastery_gate'
    ? enrichMasteryGateContent(contentFromState(node, graphState, nodeRun, execution), session)
    : contentFromState(node, graphState, nodeRun, execution);
  const publicRuns = (session.node_runs || []).map((run) => {
    const runNode = nodes.find((candidate) => String(candidate.id) === String(run.node_id));
    const runExecution = {
      nodeCompleted: ['COMPLETED', 'SKIPPED'].includes(run.status),
      status: run.status,
    };
    const runContent = runNode?.type === 'mastery_gate'
      ? enrichMasteryGateContent(contentFromState(runNode, {}, run, runExecution), session)
      : contentFromState(runNode, {}, run, runExecution);
    const summary = normalizeStoredAgentOutput(run.output_summary_json);
    return {
      ...run,
      output_content: undefined,
      output_summary_json: isLangGraphMode() ? {
        protocolVersion: summary?.protocolVersion || null,
        agentType: runContent?.agentType || summary?.agentType || null,
        contentType: runContent?.contentType || summary?.contentType || null,
        answers: runContent?.data?.answers || summary?.answers || [],
        guide: summary?.guide || null,
        generatedAt: summary?.generatedAt || null,
        generationElapsedMs: Number.isFinite(Number(summary?.generationElapsedMs))
          ? Number(summary.generationElapsedMs)
          : null,
        performance: summary?.performance || null,
      } : run.output_summary_json,
      content: runContent,
      error_message: run.status === 'FAILED' ? '学习内容暂时生成失败，请重新尝试或跳过当前节点。' : null,
    };
  });
  const nodeDescriptor = buildNodeDescriptor(node, nodes, nodeRun, execution);
  const index = nodeDescriptor?.index ?? Math.max(0, Number(session.completedNodeCount || 0));
  return {
    ...session,
    agentMode: isLangGraphMode() ? 'langgraph' : 'dify',
    node_runs: publicRuns,
    currentNodeRun: publicRuns.find((run) => Number(run.node_run_id) === Number(nodeRun?.node_run_id)) || null,
    currentNode: nodeDescriptor,
    currentContent: content,
    execution: {
      ...execution,
      executionId: nodeRun ? `${session.session_id}:${nodeRun.node_run_id}:${nodeRun.execution_version || 1}` : null,
      allowedActions: allowedActions(execution),
    },
    activeExecution: nodeRun ? {
      executionId: `${session.session_id}:${nodeRun.node_run_id}:${nodeRun.execution_version || 1}`,
      nodeRunId: nodeRun.node_run_id,
      nodeId: nodeRun.node_id,
    } : null,
    requiresStudentInput: execution.requiresStudentInput,
    allowedActions: allowedActions(execution),
    progress: {
      index,
      displayIndex: nodeDescriptor?.displayIndex || (session.status === 'COMPLETED' ? nodes.length : index + 1),
      total: nodes.length,
      completed: session.completedNodeCount || 0,
    },
  };
}

async function getPublicSession(sessionId, userId, snapshot = null) {
  return serializeSession(await getSession(sessionId, userId), snapshot);
}

async function startSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (session.status === 'RUNNING') return session;
  if (session.status !== 'CREATED' && session.status !== 'PAUSED') {
    throw createAgentError('INVALID_SESSION_STATUS', `无法从 ${session.status} 状态启动会话`, 400);
  }

  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: { status: 'RUNNING', started_at: session.started_at || new Date(), paused_at: null },
  });
  await ensureCurrentNodeExecution(Number(sessionId), session.runtime_graph_json || {});
  await addSessionEvent(sessionId, 'SESSION_RESUMED', null, '学习会话已启动');

  // ---- LangGraph 模式: Graph 由 executeCurrentNode 调用 ----
  return getSession(sessionId, userId);
}

async function pauseSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (session.status !== 'RUNNING') throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以暂停', 400);
  const startedAt = session.started_at ? new Date(session.started_at) : null;
  const dur = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : session.actual_duration_seconds || 0;
  await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { status: 'PAUSED', paused_at: new Date(), actual_duration_seconds: dur } });
  await addSessionEvent(sessionId, 'SESSION_PAUSED', null, '学习会话已暂停');
  return getSession(sessionId, userId);
}

// ========================
// 节点执行 — LangGraph 模式
// ========================

async function ensureCurrentNodeExecution(sessionId, graph) {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) }, include: { node_runs: { orderBy: { node_run_id: 'desc' } } },
  });
  if (!session?.current_node_id) return null;
  const current = currentRunForSession(session);
  if (current && String(current.node_id) === String(session.current_node_id) && !isTerminalNodeRun(current.status)) {
    if (Number(session.current_node_run_id) !== Number(current.node_run_id)) {
      await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { current_node_run_id: current.node_run_id } });
    }
    return current;
  }
  const node = (graph.nodes || []).find((i) => String(i.id) === String(session.current_node_id));
  if (!node) return null;
  const idx = (session.node_runs || []).reduce((m, r) => Math.max(m, r.sequence_index || 0), 0) + 1;
  const nr = await prisma.learningSessionNodeRun.create({
    data: { session_id: Number(sessionId), node_id: String(node.id), node_type: normalizeWorkflowNodeType(node.type, { nodeId: node.id, sessionId }), status: 'PENDING', sequence_index: idx, execution_version: 1 },
  });
  await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { current_node_run_id: nr.node_run_id, execution_version: { increment: 1 } } });
  return nr;
}

/**
 * executeCurrentNode — LangGraph 模式下 invoke compiled Graph。
 * Graph 执行到 waitForStudent 节点时 interrupt 暂停。
 */
async function executeCurrentNode(sessionId, userId, req, res) {
  const session = await getSession(sessionId, userId);
  if (session.status !== 'RUNNING') throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以执行节点', 400);

  const graph = session.runtime_graph_json || {};
  const currentNodeId = session.current_node_id;
  if (!currentNodeId) throw createAgentError('NO_CURRENT_NODE', '没有待执行的节点', 400);

  const node = (graph.nodes || []).find((n) => n.id === currentNodeId);
  if (!node) throw createAgentError('NODE_NOT_FOUND', `节点 ${currentNodeId} 不存在`, 404);

  const existingRun = currentRunForSession(session);
  if (existingRun && existingRun.status === 'COMPLETED' && !isLangGraphMode()) {
    throw createAgentError('NODE_ALREADY_COMPLETED', '该节点已执行完成', 400);
  }

  // 创建/更新 node_run
  let nodeRun;
  if (existingRun && ['RUNNING', 'COMPLETED', 'FAILED'].includes(existingRun.status) && isLangGraphMode()) {
    nodeRun = existingRun;
  } else if (existingRun && existingRun.status === 'RUNNING') {
    nodeRun = existingRun;
  } else if (existingRun && existingRun.status === 'PENDING') {
    nodeRun = await prisma.learningSessionNodeRun.update({
      where: { node_run_id: existingRun.node_run_id }, data: { status: 'RUNNING', started_at: existingRun.started_at || new Date() },
    });
  } else {
    const maxIdx = (session.node_runs || []).reduce((m, r) => Math.max(m, r.sequence_index || 0), 0);
    nodeRun = await prisma.learningSessionNodeRun.create({
      data: { session_id: Number(sessionId), node_id: currentNodeId, node_type: normalizeWorkflowNodeType(node.type, { nodeId: currentNodeId, sessionId }), status: 'RUNNING', sequence_index: maxIdx + 1, started_at: new Date() },
    });
    await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { current_node_run_id: nodeRun.node_run_id, execution_version: { increment: 1 } } });
  }

  if (!existingRun || existingRun.status === 'PENDING') {
    await addSessionEvent(sessionId, 'NODE_STARTED', currentNodeId, `开始执行: ${node.title || node.type}`, { nodeExecutionId: nodeRun.node_run_id });
  }

  // ---- LangGraph 模式: invoke compiled Graph ----
  if (isLangGraphMode()) {
    return executeViaLangGraph(session, node, nodeRun, userId, req, res);
  }

  // ---- Dify 模式 (legacy) ----
  return executeViaDify(session, node, nodeRun, userId, req, res);
}

/**
 * LangGraph 模式执行 — invoke compiled Graph
 */
async function executeViaLangGraph(session, node, nodeRun, userId, req, res) {
  const lockKey = `${session.session_id}:${nodeRun.node_run_id}`;
  return withLock(executionLocks, lockKey, async () => {
    const startedAt = Date.now();
    const graphModule = getGraphModule();
    try {
      const reconciliation = await reconcileSessionGraphState(session.session_id, String(session.session_id), userId);
      let latest = await getSession(session.session_id, userId);
      let latestRun = currentRunForSession(latest) || nodeRun;
      if (latestRun.status === 'PENDING') {
        latestRun = await prisma.learningSessionNodeRun.update({
          where: { node_run_id: latestRun.node_run_id },
          data: { status: 'RUNNING', started_at: latestRun.started_at || new Date() },
        });
      }

      let snapshot = await graphModule.inspectGraph(String(session.session_id)).catch(() => null);
      let result = null;
      const interruptValue = currentInterrupt(null, snapshot);
      if (!snapshot?.values?.protocolVersion) {
        if (snapshot?.values) await graphModule.rebuildGraphThread(String(session.session_id));
        latest = await getSession(session.session_id, userId);
        const initialState = graphModule.buildInitialState(latest, userId);
        initialState.currentNodeRunId = latestRun.node_run_id;
        result = await graphModule.invokeGraph(initialState);
      } else if (['wait_student', 'wait_continue', 'node_failed'].includes(interruptValue?.type)) {
        // Idempotent read: generated content or failure is already checkpointed.
      } else if (interruptValue?.type === 'ready_node') {
        const uploadedFileRefs = latestRun.input_summary_json?.uploadedFiles || [];
        result = await graphModule.resumeGraph(String(session.session_id), {
          action: 'execute_node', nodeId: latest.current_node_id,
          nodeRunId: latestRun.node_run_id, uploadedFileRefs,
        });
      } else if (snapshot?.values?.status !== 'completed') {
        await graphModule.rebuildGraphThread(String(session.session_id));
        latest = await getSession(session.session_id, userId);
        result = await graphModule.invokeGraph(graphModule.buildInitialState(latest, userId));
      }
      snapshot = await graphModule.inspectGraph(String(session.session_id)).catch(() => snapshot);
      const response = await buildLangGraphResponse(session.session_id, userId, result, snapshot, reconciliation);
      console.log(JSON.stringify({
        event: 'learning_graph_execute', sessionId: Number(session.session_id), threadId: String(session.session_id),
        nodeRunId: latestRun.node_run_id, nodeType: node.type,
        executionId: response.execution?.executionId, graphStatus: response.execution?.status,
        httpStatus: 200, elapsedMs: Date.now() - startedAt,
      }));
      return response;
    } catch (err) {
      const safe = sanitizeRuntimeError(err);
      await markNodeFailed(session.session_id, nodeRun.node_run_id, safe);
      console.error(JSON.stringify({
        event: 'learning_graph_execute', sessionId: Number(session.session_id), threadId: String(session.session_id),
        nodeRunId: nodeRun.node_run_id, nodeType: node.type, graphStatus: 'FAILED',
        httpStatus: safe.status || 500, elapsedMs: Date.now() - startedAt, errorCode: safe.code,
      }));
      throw safe;
    }
  });
}

function sanitizeRuntimeError(err) {
  const raw = String(err?.message || '学习内容暂时生成失败');
  const internal = /Cannot find module|Require stack|MODULE_NOT_FOUND|[A-Z]:\\|\/Users\//i.test(raw);
  const safe = createAgentError(
    String(err?.code || 'AGENT_EXECUTION_FAILED'),
    internal ? '学习内容暂时生成失败，请重新尝试或跳过当前节点。' : raw,
    Number(err?.status || 500),
  );
  return safe;
}

async function buildLangGraphResponse(sessionId, userId, result, snapshot, reconciliation = 'CONSISTENT') {
  const rawSession = await getSession(sessionId, userId);
  const graphState = snapshot?.values || result || {};
  const node = nodeForSession(rawSession, graphState);
  const nodeRun = currentRunForSession(rawSession);
  let execution = mapGraphExecution(graphState, result, snapshot);
  if (nodeRun?.status === 'FAILED' || graphState.status === 'failed') {
    execution = {
      ...execution, status: EXECUTION_STATUS.FAILED, requiresStudentInput: false,
      nodeCompleted: false, canRetry: true, canSkip: true, canContinue: false,
    };
  }
  const descriptor = buildNodeDescriptor(node, rawSession.runtime_graph_json?.nodes || [], nodeRun, execution);
  const content = contentFromState(node, graphState, nodeRun, execution);
  const publicSession = await serializeSession(rawSession, snapshot);
  const executionId = nodeRun ? `${rawSession.session_id}:${nodeRun.node_run_id}:${nodeRun.execution_version || 1}` : null;
  const error = execution.status === EXECUTION_STATUS.FAILED ? {
    code: graphState.errorCode || nodeRun?.error_code || 'AGENT_EXECUTION_FAILED',
    message: '学习内容暂时生成失败，请重新尝试或跳过当前节点。',
  } : null;
  return {
    success: execution.status !== EXECUTION_STATUS.FAILED,
    sessionId: Number(rawSession.session_id),
    runId: String(rawSession.session_id),
    threadId: String(rawSession.session_id),
    nodeRunId: nodeRun?.node_run_id || null,
    node: descriptor,
    execution: { ...execution, executionId, allowedActions: allowedActions(execution), reconciliation },
    content,
    evaluation: graphState.latestEvaluation || null,
    sources: graphState.retrievalRefs || [],
    error,
    session: publicSession,
  };
}

async function reconcileSessionGraphState(sessionId, threadId, userId) {
  const graphModule = getGraphModule();
  const session = await getSession(sessionId, userId);
  const snapshot = await graphModule.inspectGraph(threadId).catch(() => null);
  if (!snapshot?.values || Object.keys(snapshot.values).length === 0) return 'REBUILT_FROM_DATABASE';
  if (Number(snapshot.values.protocolVersion) !== 2) {
    await graphModule.rebuildGraphThread(threadId);
    console.warn(JSON.stringify({ event: 'learning_graph_reconcile', sessionId: Number(sessionId), result: 'REBUILT_FROM_DATABASE', reason: 'legacy_checkpoint' }));
    return 'REBUILT_FROM_DATABASE';
  }
  const graphNode = snapshot.values.currentNode;
  if (!graphNode && snapshot.values.status === 'completed') {
    if (session.status !== 'COMPLETED') {
      await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { status: 'COMPLETED', current_node_id: null, current_node_run_id: null, completed_at: new Date() } });
      return 'RECOVERED_FROM_CHECKPOINT';
    }
    return 'CONSISTENT';
  }
  if (!graphNode) return 'CONSISTENT';
  const graphRunId = Number(snapshot.values.currentNodeRunId || 0);
  const graphRun = graphRunId ? (session.node_runs || []).find((run) => Number(run.node_run_id) === graphRunId) : null;
  if (!graphRun || String(graphRun.node_id) !== String(graphNode.id)) {
    await graphModule.rebuildGraphThread(threadId);
    console.warn(JSON.stringify({ event: 'learning_graph_reconcile', sessionId: Number(sessionId), result: 'REBUILT_FROM_DATABASE', reason: 'missing_node_run' }));
    return 'REBUILT_FROM_DATABASE';
  }
  if (String(session.current_node_id) !== String(graphNode.id) || Number(session.current_node_run_id) !== graphRunId) {
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: { status: 'RUNNING', current_node_id: String(graphNode.id), current_node_run_id: graphRunId },
    });
    console.warn(JSON.stringify({ event: 'learning_graph_reconcile', sessionId: Number(sessionId), result: 'RECOVERED_FROM_CHECKPOINT', nodeId: graphNode.id, nodeRunId: graphRunId }));
    return 'RECOVERED_FROM_CHECKPOINT';
  }
  return 'CONSISTENT';
}

/**
 * Dify 模式执行 (legacy, unchanged)
 */
async function executeViaDify(session, node, nodeRun, userId, req, res) {
  const agentMapping = NODE_TO_AGENT[node.type];
  if (!agentMapping) {
    if (node.type === 'mastery_gate') return executeMasteryGate(session, node, nodeRun, userId);
    throw createAgentError('UNKNOWN_NODE_TYPE', `未知节点类型: ${node.type}`, 400);
  }
  return executeAgentNodeDify(session, node, nodeRun, userId, agentMapping, req, res);
}

async function executeAgentNodeDify(session, node, nodeRun, userId, agentMapping, req, res) {
  const courseId = session.course_id;
  if (courseId) {
    const kbEnabled = await checkKnowledgeBase(courseId);
    if (!kbEnabled && (node.type.includes('explanation') || node.type.includes('practice'))) {
      throw createAgentError('KNOWLEDGE_BASE_NOT_READY', '当前课程尚未接入专属知识库，暂不支持智能学习流执行', 400);
    }
  }
  const agentType = agentMapping.agent;
  switch (agentType) {
    case 'EXPLAINER': {
      if (res && req) return executeExplainerStream(session, node, nodeRun, userId, (node.config?.strategy) || agentMapping.defaultStrategy, req, res);
      throw createAgentError('STREAM_REQUIRED', '讲解类节点需要 SSE 流式连接', 400);
    }
    case 'TRAINER': return executeTrainerNode(session, node, nodeRun, userId);
    case 'DIAGNOSTICIAN': {
      if (node.type === 'learning_summary') return executeDiagnosticianSummary(session, node, nodeRun, userId);
      if (node.type === 'wrong_question_repair') return executeWrongQuestionRepair(session, node, nodeRun, userId);
      throw createAgentError('UNSUPPORTED_DIAGNOSTICIAN_NODE', `诊断师不支持节点类型: ${node.type}`, 400);
    }
    default: throw createAgentError('UNSUPPORTED_AGENT', `不支持的 Agent 类型: ${agentType}`, 400);
  }
}

// ---- Dify legacy agent functions (unchanged) ----
async function executeExplainerStream(session, node, nodeRun, userId, strategy, req, res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  try {
    await explainerService.streamExplainerChat({
      req, res, userId: Number(userId),
      body: { knowledgePointId: session.knowledge_point_id ? Number(session.knowledge_point_id) : null, message: node.config?.prompt || `请讲解: ${node.title || '知识点'}`, strategyHint: strategy, depth: node.config?.depth || 'moderate', newConversation: true, learningSessionId: String(session.session_id) },
    });
  } catch (err) { await markNodeFailed(session.session_id, nodeRun.node_run_id, err); throw err; }
}

async function executeTrainerNode(session, node, nodeRun, userId) {
  const { courseId, knowledgePointId: kpId } = session;
  if (!courseId || !kpId) throw createAgentError('MISSING_COURSE_OR_KP', '训练师节点需要课程和知识点', 400);
  try {
    const pc = getPracticeConfig(node.config || {});
    const result = nodeRun.trainer_session_id
      ? await trainerService.getTrainerSession(Number(userId), nodeRun.trainer_session_id)
      : await trainerService.createTrainerSession(Number(userId), { courseId: Number(courseId), knowledgePointId: Number(kpId), questionCount: pc.targetQuestionCount, practiceConfig: pc, learningSessionId: Number(session.session_id), nodeExecutionId: Number(nodeRun.node_run_id), executionVersion: Number(nodeRun.execution_version || 1), requestId: `lw_${session.session_id}_${nodeRun.node_run_id}` });
    const trainerSessionId = result.session?.sessionId || result.sessionId;
    const activeRun = await prisma.learningSessionNodeRun.findFirst({ where: { node_run_id: nodeRun.node_run_id, status: 'RUNNING' }, select: { node_run_id: true } });
    if (!activeRun) return { nodeRun, trainerSession: result, cancelled: true, nodeCompleted: false };
    await prisma.learningSessionNodeRun.update({ where: { node_run_id: nodeRun.node_run_id }, data: { output_summary_json: { trainerSessionId, practiceConfig: pc }, trainer_session_id: trainerSessionId || null, agent_type: 'TRAINER' } });
    return { nodeRun, trainerSession: result, nodeCompleted: false };
  } catch (err) { await markNodeFailed(session.session_id, nodeRun.node_run_id, err); throw err; }
}

async function executeDiagnosticianSummary(session, node, nodeRun, userId) {
  if (!session.knowledge_point_id) throw createAgentError('MISSING_KNOWLEDGE_POINT', '学习总结需要关联知识点', 400);
  try {
    const context = await buildContextForDiagnostician(session, userId);
    const agentConfig = await prisma.aiAgentConfig.findFirst({ where: { agent_type: 'DIAGNOSTICIAN', enabled: true } });
    if (!agentConfig) throw createAgentError('AGENT_CONFIG_NOT_FOUND', '诊断师 Agent 未配置', 500);
    const { runDiagnosticianWorkflow, buildDifyUser } = require('../dify/agent-dify.service');
    const { businessResult } = await runDiagnosticianWorkflow({ mode: 'growth_report', requestId: `lw_summary_${session.session_id}`, payload: { student_id: String(userId), knowledge_point_id: String(session.knowledge_point_id), course_id: session.course_id ? String(session.course_id) : null, session_context: context, node_runs: (session.node_runs || []).map((r) => ({ node_type: r.node_type, status: r.status, error_code: r.error_code })) }, locale: 'zh-CN', difyUser: buildDifyUser('diagnostician', Number(userId)) });
    const summaryData = businessResult?.result || businessResult?.data || businessResult || {};
    await prisma.learningSessionNodeRun.update({ where: { node_run_id: nodeRun.node_run_id }, data: { status: 'COMPLETED', completed_at: new Date(), output_summary_json: summaryData, agent_type: 'DIAGNOSTICIAN' } });
    await addSessionEvent(session.session_id, 'NODE_COMPLETED', node.id, '学习总结已生成');
    return { nodeRun, summary: summaryData, nodeCompleted: true };
  } catch (err) { await markNodeFailed(session.session_id, nodeRun.node_run_id, err); throw err; }
}

async function executeWrongQuestionRepair(session, node, nodeRun, userId) {
  try {
    const context = await buildContextForDiagnostician(session, userId);
    const agentConfig = await prisma.aiAgentConfig.findFirst({ where: { agent_type: 'DIAGNOSTICIAN', enabled: true } });
    if (!agentConfig) throw createAgentError('AGENT_CONFIG_NOT_FOUND', '诊断师 Agent 未配置', 500);
    const { runDiagnosticianWorkflow, buildDifyUser } = require('../dify/agent-dify.service');
    const { businessResult } = await runDiagnosticianWorkflow({ mode: 'mental_model', requestId: `lw_repair_${session.session_id}`, payload: { student_id: String(userId), knowledge_point_id: session.knowledge_point_id ? String(session.knowledge_point_id) : null, course_id: session.course_id ? String(session.course_id) : null, session_context: context, focus: 'wrong_question_analysis' }, locale: 'zh-CN', difyUser: buildDifyUser('diagnostician', Number(userId)) });
    await prisma.learningSessionNodeRun.update({ where: { node_run_id: nodeRun.node_run_id }, data: { status: 'COMPLETED', completed_at: new Date(), output_summary_json: businessResult?.result || businessResult?.data || {}, agent_type: 'DIAGNOSTICIAN' } });
    await addSessionEvent(session.session_id, 'NODE_COMPLETED', node.id, '错题修复分析完成');
    return { nodeRun, repairResult: businessResult?.result || businessResult?.data || {}, nodeCompleted: true };
  } catch (err) { await markNodeFailed(session.session_id, nodeRun.node_run_id, err); throw err; }
}

async function executeMasteryGate(session, node, nodeRun, userId) {
  let mc = session.mastery_current;
  if (session.knowledge_point_id) {
    const rec = await prisma.studentMasteryRecord.findUnique({ where: { student_user_id_course_id_knowledge_point_id: { student_user_id: Number(userId), course_id: Number(session.course_id), knowledge_point_id: Number(session.knowledge_point_id) } } });
    mc = rec?.mastery_score ?? mc;
  }
  const accuracy = session.total_correct + session.total_wrong > 0 ? Math.round((session.total_correct / (session.total_correct + session.total_wrong)) * 100) : 0;
  await prisma.learningSession.update({ where: { session_id: Number(session.session_id) }, data: { mastery_current: mc } });
  await prisma.learningSessionNodeRun.update({ where: { node_run_id: nodeRun.node_run_id }, data: { status: 'COMPLETED', completed_at: new Date(), output_summary_json: { mastery: mc, accuracy, consecutive_wrong: session.consecutive_wrong, consecutive_correct: session.consecutive_correct } } });
  await addSessionEvent(session.session_id, 'NODE_COMPLETED', node.id, `掌握度判断: ${mc != null ? Math.round(mc) : '--'}%`);
  return { nodeRun, gateResult: { mastery: mc, accuracy, consecutiveWrong: session.consecutive_wrong }, nodeCompleted: true };
}

// ========================
// 节点转换
// ========================

async function advanceLearningSession({ sessionId, userId, expectedNodeExecutionId, completionType = 'completed', operationId = null, reason = null, lastAnswerCorrect } = {}) {
  const nid = Number(sessionId);
  const expectedRunId = expectedNodeExecutionId == null ? null : Number(expectedNodeExecutionId);
  let transition = { idempotent: false, nodeAdvanced: false, sessionCompleted: false };

  await prisma.$transaction(async (tx) => {
    const session = await tx.learningSession.findUnique({ where: { session_id: nid }, include: { node_runs: { orderBy: { sequence_index: 'asc' } } } });
    if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
    if (session.student_user_id !== Number(userId)) throw createAgentError('SESSION_ACCESS_DENIED', '无权操作该学习会话', 403);

    const currentRun = currentRunForSession(session);
    if (!currentRun || (expectedRunId && Number(currentRun.node_run_id) !== expectedRunId)) { transition.idempotent = true; return; }
    if (isTerminalNodeRun(currentRun.status) || !session.current_node_id) { transition.idempotent = true; return; }

    const graph = session.runtime_graph_json || {};
    const currentNode = (graph.nodes || []).find((n) => String(n.id) === String(session.current_node_id));
    if (!currentNode) throw createAgentError('NODE_NOT_FOUND', '当前节点不存在', 404);
    const now = new Date();
    const skipped = completionType === 'skipped';
    const failed = completionType === 'failed';

    if (skipped && currentRun.trainer_session_id) {
      const tsid = currentRun.trainer_session_id;
      await tx.agentRunRecord.updateMany({ where: { practice_session_id: tsid, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'STOPPED', error_code: 'RUN_CANCELLED', error_message: '学习流节点已跳过' } });
      await tx.trainerSessionQuestion.updateMany({ where: { practice_session_id: tsid, status: 'active' }, data: { status: 'cancelled' } });
      await tx.trainerSessionDetail.updateMany({ where: { practice_session_id: tsid }, data: { current_phase: 'cancelled', current_question_key: null } });
      await tx.practiceSession.updateMany({ where: { practice_session_id: tsid, status: { in: ['CREATED', 'IN_PROGRESS', 'SUBMITTING', 'created', 'in_progress', 'submitting'] } }, data: { status: 'ABANDONED', submitted_at: now, submit_reason: 'WORKFLOW_NODE_SKIPPED', last_active_at: now } });
    }

    const runStatus = skipped ? 'SKIPPED' : failed ? 'FAILED' : 'COMPLETED';
    const endedRun = await tx.learningSessionNodeRun.updateMany({ where: { node_run_id: currentRun.node_run_id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: runStatus, completed_at: skipped ? currentRun.completed_at : now, ended_at: now, skipped_at: skipped ? now : null, skip_reason: skipped ? String(reason || 'user_skipped').slice(0, 500) : null, operation_id: operationId ? String(operationId).slice(0, 128) : currentRun.operation_id, error_code: failed ? 'NODE_FAILED' : null } });
    if (!endedRun.count) { transition.idempotent = true; return; }

    const stats = { consecutive_correct: session.consecutive_correct, consecutive_wrong: session.consecutive_wrong, total_correct: session.total_correct, total_wrong: session.total_wrong };
    if (lastAnswerCorrect === true) { stats.consecutive_correct += 1; stats.consecutive_wrong = 0; stats.total_correct += 1; }
    else if (lastAnswerCorrect === false) { stats.consecutive_wrong += 1; stats.consecutive_correct = 0; stats.total_wrong += 1; }

    if (failed) {
      await tx.learningSession.update({ where: { session_id: nid }, data: { ...stats, current_node_run_id: null, execution_version: { increment: 1 } } });
      await tx.learningSessionEvent.create({ data: { session_id: nid, event_type: 'NODE_FAILED', node_id: currentNode.id, title: '节点执行失败' } });
      return;
    }

    const evaluation = { mastery: session.mastery_current || 0, consecutiveWrong: stats.consecutive_wrong, accuracy: stats.total_correct + stats.total_wrong > 0 ? Math.round((stats.total_correct / (stats.total_correct + stats.total_wrong)) * 100) : 0, lastAnswerCorrect };
    const nextNodeIds = getNextNodeIds(graph, String(currentNode.id), evaluation);
    if (!nextNodeIds.length) {
      await tx.learningSession.update({ where: { session_id: nid }, data: { ...stats, status: 'COMPLETED', completed_at: now, current_node_id: null, current_node_run_id: null, execution_version: { increment: 1 } } });
      await tx.learningSessionEvent.create({ data: { session_id: nid, event_type: 'SESSION_COMPLETED', node_id: currentNode.id, title: '学习流已完成' } });
      transition.sessionCompleted = true;
      return;
    }

    const nextNodeId = String(nextNodeIds[0]);
    const nextNode = (graph.nodes || []).find((n) => String(n.id) === nextNodeId);
    if (!nextNode) throw createAgentError('NODE_NOT_FOUND', '下一节点不存在', 404);
    const nextRun = await tx.learningSessionNodeRun.create({ data: { session_id: nid, node_id: nextNodeId, node_type: normalizeWorkflowNodeType(nextNode.type, { nodeId: nextNodeId, sessionId: nid }), status: 'PENDING', sequence_index: (session.node_runs || []).reduce((m, r) => Math.max(m, r.sequence_index || 0), 0) + 1, execution_version: 1 } });
    await tx.learningSession.update({ where: { session_id: nid }, data: { ...stats, current_node_id: nextNodeId, current_node_run_id: nextRun.node_run_id, execution_version: { increment: 1 } } });
    await tx.learningSessionEvent.create({ data: { session_id: nid, event_type: skipped ? 'NODE_SKIPPED' : 'NODE_COMPLETED', node_id: currentNode.id, title: skipped ? `跳过节点: ${currentNode.title || currentNode.type}` : `完成节点: ${currentNode.title || currentNode.type}`, data_json: { operationId: operationId || null, nextNodeId, reason: skipped ? reason || 'user_skipped' : null } } });
    transition = { nodeAdvanced: true, nextNodeId, nextNodeExecutionId: nextRun.node_run_id, sessionCompleted: false, idempotent: false };
  });

  // ---- LangGraph 模式：主动推进 Graph 到下一节点 ----
  if (isLangGraphMode() && transition.nodeAdvanced && !transition.sessionCompleted) {
    try {
      const graphModule = getGraphModule();
      const cpSvc = require('../learning-agent/graph/checkpointer.service');
      const checkpointer = await cpSvc.initCheckpointer();
      const cp = await checkpointer.getTuple({ configurable: { thread_id: String(sessionId) } });
      if (cp) {
        // 恢复 Graph，告知进入下一节点
        await graphModule.resumeGraph(String(sessionId), { action: 'advance_node', nextNodeId: transition.nextNodeId });
      }
    } catch (err) {
      // GraphInterrupt 是预期行为 — 如果在 waitForStudent，还会再次 interrupt
      if (err?.name !== 'GraphInterrupt' && err?.constructor?.name !== 'GraphInterrupt') {
        console.warn(`[Runtime] Graph advance error: ${err.message}`);
      }
    }
  }

  return { ...transition, session: await getSession(nid, userId) };
}

// ========================
// 提交答案 — LangGraph resume
// ========================

async function submitNodeAnswer(sessionId, userId, data) {
  const session = await getSession(sessionId, userId);
  if (session.status !== 'RUNNING') throw createAgentError('INVALID_SESSION_STATUS', '会话未在运行中', 400);

  const currentNodeRun = currentRunForSession(session);
  if (!currentNodeRun || currentNodeRun.status !== 'RUNNING') throw createAgentError('NO_RUNNING_NODE', '没有正在执行的节点', 400);
  if (data.expectedNodeExecutionId && Number(data.expectedNodeExecutionId) !== Number(currentNodeRun.node_run_id)) throw createAgentError('STALE_NODE_EXECUTION', '当前练习已切换，请刷新后继续', 409);

  // ---- LangGraph 模式: 使用 Command({ resume }) 恢复 ----
  if (isLangGraphMode()) {
    const operationId = String(data.operationId || data.requestId || `submit_${sessionId}_${currentNodeRun.node_run_id}_${data.questionKey || 'question'}`);
    return withLock(actionLocks, `${sessionId}:submit:${operationId}`, async () => {
      await reconcileSessionGraphState(sessionId, String(sessionId), userId);
      const refreshed = await getSession(sessionId, userId);
      const run = currentRunForSession(refreshed);
      if (!run || Number(run.node_run_id) !== Number(currentNodeRun.node_run_id)) {
        throw createAgentError('STALE_NODE_EXECUTION', '当前练习已切换，请刷新后继续', 409);
      }
      const storedAnswers = run.output_summary_json?.answers || [];
      if (storedAnswers.some((answer) => answer.operationId === operationId)) {
        const snapshot = await getGraphModule().inspectGraph(String(sessionId));
        return buildLangGraphResponse(sessionId, userId, null, snapshot, 'CONSISTENT');
      }
      const snapshot = await getGraphModule().inspectGraph(String(sessionId));
      const waiting = currentInterrupt(null, snapshot);
      if (waiting?.type !== 'wait_student') {
        throw createAgentError('GRAPH_NOT_WAITING_INPUT', '当前节点不在等待答题状态，请刷新后继续', 409);
      }
      // 获取 studentInput（新协议）或兼容旧字段
      const studentInput = data.studentInput || {};
      const uploadedFileRefs = Array.isArray(studentInput.fileRefs)
        ? studentInput.fileRefs
        : (run.input_summary_json?.uploadedFiles || []);
      const graphResult = await getGraphModule().resumeGraph(String(sessionId), {
        action: 'submit_answer',
        questionId: data.questionKey || data.questionId || waiting.questionId || studentInput.questionId,
        answer: (studentInput.text || studentInput.answer || data.selectedOption) ?? data.answer,
        studentInput: {
          text: studentInput.text || data.answer || '',
          answer: studentInput.answer || studentInput.selectedOptions || data.selectedOption || data.answer || '',
          selectedOptions: studentInput.selectedOptions || (data.selectedOption ? [data.selectedOption] : []),
          fileRefs: uploadedFileRefs,
        },
        confidenceLevel: data.confidenceLevel,
        timeSpentSeconds: data.timeSpentSeconds,
        operationId,
      });
      const nextSnapshot = await getGraphModule().inspectGraph(String(sessionId));
      return buildLangGraphResponse(sessionId, userId, graphResult, nextSnapshot, 'CONSISTENT');
    });
  }

  // ---- Dify 模式 (legacy) ----
  const practiceSessionId = currentNodeRun.trainer_session_id || currentNodeRun.output_summary_json?.trainerSessionId || currentNodeRun.output_summary_json?.sessionId;
  if (!practiceSessionId) throw createAgentError('NO_PRACTICE_SESSION', '当前节点没有关联的训练会话', 400);
  const result = await trainerService.submitTrainerAnswer(Number(userId), practiceSessionId, { questionKey: data.questionKey, selectedOption: data.selectedOption, confidenceLevel: data.confidenceLevel, timeSpentSeconds: data.timeSpentSeconds, requestId: String(data.requestId || `lw_submit_${sessionId}_${currentNodeRun.node_run_id}_${Date.now()}`).slice(0, 128) });
  if (result.nextQuestion) return { nodeContinued: true, nextQuestion: result.nextQuestion, answerResult: result.answerResult, evaluation: result.evaluation, sessionProgress: result.sessionProgress };
  const trainerCompletion = await trainerService.completeTrainerSession(Number(userId), practiceSessionId).catch(() => null);
  const summary = trainerCompletion?.report?.sessionSummary || result.completion || {};
  await prisma.learningSessionNodeRun.update({ where: { node_run_id: currentNodeRun.node_run_id }, data: { output_summary_json: { ...currentNodeRun.output_summary_json, trainerSessionId: practiceSessionId, finalAnswer: result.answerResult, practiceSummary: { completedQuestionCount: summary.completedCount ?? result.completion?.answeredCount ?? 0, correctQuestionCount: summary.correctCount ?? result.completion?.correctCount ?? 0, accuracy: summary.accuracy ?? result.completion?.accuracy ?? 0, endedReason: result.completion?.reason || 'completed' } } } });
  const advanceResult = await advanceLearningSession({ sessionId, userId, expectedNodeExecutionId: currentNodeRun.node_run_id, completionType: 'completed', operationId: data.operationId || data.requestId, lastAnswerCorrect: result.answerResult?.isCorrect });
  return { nodeCompleted: true, answerResult: result.answerResult, evaluation: result.evaluation, completion: result.completion, sessionProgress: result.sessionProgress, ...advanceResult };
}

// ========================
// 节点操作
// ========================

async function skipNode(sessionId, userId, nodeId, reason, options = {}) {
  let session = await getSession(sessionId, userId);
  if (session.status !== 'RUNNING') throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以跳过节点', 400);
  const graph = session.runtime_graph_json || {};
  const node = (graph.nodes || []).find((n) => String(n.id) === String(nodeId));
  if (!node) throw createAgentError('NODE_NOT_FOUND', '节点不存在', 404);
  if (String(session.current_node_id) !== String(nodeId)) return { idempotent: true, session };
  if (!currentRunForSession(session)) { await ensureCurrentNodeExecution(sessionId, graph); session = await getSession(sessionId, userId); }
  if (isPracticeNode(node) && node.config?.allowSkip === false) throw createAgentError('NODE_SKIP_DISABLED', '当前练习节点不允许跳过', 400);
  if (isLangGraphMode()) {
    const operationId = String(options.operationId || `skip_${sessionId}_${session.currentNodeExecutionId || nodeId}`);
    return withLock(actionLocks, `${sessionId}:skip:${operationId}`, async () => {
      await reconcileSessionGraphState(sessionId, String(sessionId), userId);
      const latest = await getSession(sessionId, userId);
      if (String(latest.current_node_id) !== String(nodeId)) {
        const snapshot = await getGraphModule().inspectGraph(String(sessionId)).catch(() => null);
        return buildLangGraphResponse(sessionId, userId, null, snapshot, 'CONSISTENT');
      }
      const run = currentRunForSession(latest);
      if (options.expectedNodeExecutionId && Number(options.expectedNodeExecutionId) !== Number(run?.node_run_id)) {
        throw createAgentError('STALE_NODE_EXECUTION', '当前节点已切换，请刷新后继续', 409);
      }
      let snapshot = await getGraphModule().inspectGraph(String(sessionId)).catch(() => null);
      if (!snapshot?.values?.protocolVersion) {
        if (snapshot?.values) await getGraphModule().rebuildGraphThread(String(sessionId));
        const initialResult = await getGraphModule().invokeGraph(getGraphModule().buildInitialState(latest, userId));
        snapshot = await getGraphModule().inspectGraph(String(sessionId));
        if (!currentInterrupt(initialResult, snapshot)) throw createAgentError('GRAPH_RECOVERY_FAILED', '当前节点状态无法恢复，请重新尝试', 409);
      }
      const interruptValue = currentInterrupt(null, snapshot);
      if (!['wait_student', 'wait_continue', 'node_failed', 'ready_node'].includes(interruptValue?.type)) {
        throw createAgentError('GRAPH_NOT_SKIPPABLE', '当前节点暂时无法跳过，请稍后重试', 409);
      }
      const graphResult = await getGraphModule().resumeGraph(String(sessionId), {
        action: 'skip_node', nodeId: String(nodeId), nodeRunId: run?.node_run_id,
        operationId, reason: reason || 'user_skipped',
      });
      const nextSnapshot = await getGraphModule().inspectGraph(String(sessionId)).catch(() => null);
      return buildLangGraphResponse(sessionId, userId, graphResult, nextSnapshot, 'CONSISTENT');
    });
  }
  return advanceLearningSession({ sessionId, userId, expectedNodeExecutionId: options.expectedNodeExecutionId || session.currentNodeExecutionId, completionType: 'skipped', operationId: options.operationId, reason: reason || 'user_skipped' });
}

async function continueNode(sessionId, userId, data = {}) {
  if (!isLangGraphMode()) {
    return advanceLearningSession({
      sessionId, userId,
      expectedNodeExecutionId: data.expectedNodeExecutionId,
      completionType: 'completed', operationId: data.operationId,
    });
  }
  const operationId = String(data.operationId || `continue_${sessionId}_${data.expectedNodeExecutionId || data.nodeId || 'current'}`);
  return withLock(actionLocks, `${sessionId}:continue:${operationId}`, async () => {
    await reconcileSessionGraphState(sessionId, String(sessionId), userId);
    const session = await getSession(sessionId, userId);
    if (data.nodeId && String(session.current_node_id) !== String(data.nodeId)) {
      const currentSnapshot = await getGraphModule().inspectGraph(String(sessionId)).catch(() => null);
      return buildLangGraphResponse(sessionId, userId, null, currentSnapshot, 'CONSISTENT');
    }
    const run = currentRunForSession(session);
    if (data.expectedNodeExecutionId && Number(data.expectedNodeExecutionId) !== Number(run?.node_run_id)) {
      throw createAgentError('STALE_NODE_EXECUTION', '当前节点已切换，请刷新后继续', 409);
    }
    const snapshot = await getGraphModule().inspectGraph(String(sessionId));
    const waiting = currentInterrupt(null, snapshot);
    if (waiting?.type !== 'wait_continue') {
      throw createAgentError('NODE_NOT_COMPLETED', '当前节点尚未完成，不能继续下一步', 409);
    }
    const result = await getGraphModule().resumeGraph(String(sessionId), {
      action: 'continue_node', nodeId: session.current_node_id,
      nodeRunId: run?.node_run_id, operationId,
    });
    const nextSnapshot = await getGraphModule().inspectGraph(String(sessionId)).catch(() => null);
    return buildLangGraphResponse(sessionId, userId, result, nextSnapshot, 'CONSISTENT');
  });
}

async function retryNode(sessionId, userId, data = {}) {
  const operationId = String(data.operationId || `retry_${sessionId}_${data.nodeId || 'current'}_${Date.now()}`);
  return withLock(actionLocks, `${sessionId}:retry:${operationId}`, async () => {
    const session = await getSession(sessionId, userId);
    if (session.status !== 'RUNNING') throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以重试节点', 400);
    const node = (session.runtime_graph_json?.nodes || []).find((candidate) => String(candidate.id) === String(session.current_node_id));
    if (!node) throw createAgentError('NODE_NOT_FOUND', '当前节点不存在', 404);
    if (data.nodeId && String(data.nodeId) !== String(node.id)) throw createAgentError('STALE_NODE_EXECUTION', '当前节点已切换，请刷新后继续', 409);
    const failedRun = currentRunForSession(session);
    if (failedRun?.status !== 'FAILED') {
      const snapshot = isLangGraphMode() ? await getGraphModule().inspectGraph(String(sessionId)).catch(() => null) : null;
      return isLangGraphMode() ? buildLangGraphResponse(sessionId, userId, null, snapshot, 'CONSISTENT') : session;
    }
    const maxSequence = (session.node_runs || []).reduce((max, run) => Math.max(max, Number(run.sequence_index || 0)), 0);
    const newRun = await prisma.learningSessionNodeRun.create({
      data: {
        session_id: Number(sessionId), node_id: String(node.id),
        node_type: normalizeWorkflowNodeType(node.type, { nodeId: node.id, sessionId }),
        status: 'PENDING', sequence_index: maxSequence + 1,
        retry_count: Number(failedRun.retry_count || 0) + 1,
        execution_version: Number(failedRun.execution_version || 1) + 1,
        operation_id: operationId.slice(0, 128),
      },
    });
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: { current_node_run_id: newRun.node_run_id, execution_version: { increment: 1 } },
    });
    if (!isLangGraphMode()) return getSession(sessionId, userId);

    let snapshot = await getGraphModule().inspectGraph(String(sessionId)).catch(() => null);
    let result;
    if (currentInterrupt(null, snapshot)?.type === 'node_failed') {
      result = await getGraphModule().resumeGraph(String(sessionId), {
        action: 'retry_node', nodeId: node.id, nodeRunId: newRun.node_run_id, operationId,
      });
    } else {
      if (snapshot?.values) await getGraphModule().rebuildGraphThread(String(sessionId));
      const latest = await getSession(sessionId, userId);
      result = await getGraphModule().invokeGraph(getGraphModule().buildInitialState(latest, userId));
    }
    snapshot = await getGraphModule().inspectGraph(String(sessionId)).catch(() => null);
    return buildLangGraphResponse(sessionId, userId, result, snapshot, 'CONSISTENT');
  });
}

async function insertNode(sessionId, userId, nodeData, afterNodeId, reason) {
  let session = await getSession(sessionId, userId);
  if (session.status !== 'RUNNING' && session.status !== 'CREATED') throw createAgentError('INVALID_SESSION_STATUS', '只有运行中或待开始的会话可以插入节点', 400);
  const g = session.runtime_graph_json || {};
  const nodes = [...(g.nodes || [])]; const edges = [...(g.edges || [])];
  const newNodeId = `inserted_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const newNode = { id: newNodeId, type: nodeData.type, title: String(nodeData.title || '').slice(0, 100), config: nodeData.config || {}, position: nodeData.position || { x: 0, y: 0 } };
  nodes.push(newNode);
  const ae = edges.filter((e) => e.source === afterNodeId);
  for (const edge of ae) { edges.push({ id: `edge_${newNodeId}_${edge.id}`, source: newNodeId, target: edge.target, condition: edge.condition || { type: 'always', params: {} }, label: '' }); const idx = edges.indexOf(edge); if (idx >= 0) edges.splice(idx, 1); }
  edges.push({ id: `edge_${Date.now()}`, source: afterNodeId, target: newNodeId, condition: { type: 'always', params: {} }, label: '' });
  const ng = { ...g, nodes, edges, entryNodeId: g.entryNodeId };
  const validation = validateGraphJson(ng);
  if (!validation.valid) throw createAgentError('INVALID_GRAPH', `插入节点后流程图校验失败: ${validation.errors.join('; ')}`, 400);
  await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { runtime_graph_json: ng } });
  if (session.current_node_id === afterNodeId) {
    const cr = (session.node_runs || []).find((r) => r.node_id === afterNodeId && r.status === 'COMPLETED');
    if (cr) await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { current_node_id: newNodeId } });
  }
  const maxIdx = (session.node_runs || []).reduce((m, r) => Math.max(m, r.sequence_index || 0), 0);
  await prisma.learningSessionNodeRun.create({ data: { session_id: Number(sessionId), node_id: newNodeId, node_type: normalizeWorkflowNodeType(nodeData.type, { nodeId: newNodeId, sessionId }), status: 'INSERTED', sequence_index: maxIdx + 1, inserted_by: 'diagnostician', insert_reason: String(reason || '').slice(0, 500) } });
  await addSessionEvent(sessionId, 'NODE_INSERTED', newNodeId, `诊断师插入节点: ${newNode.title || nodeData.type}`);
  return getSession(sessionId, userId);
}

async function handleDiagnosticianAdjustment(sessionId, userId, action) {
  const session = await getSession(sessionId, userId);
  if (session.adjustment_mode === 'STRICT_ORIGINAL' && action !== 'reject') return { applied: false, reason: '当前为严格模式，不接受诊断师调整' };
  if (action === 'apply') return { applied: true, message: '诊断师调整已应用' };
  if (action === 'reject') { await addSessionEvent(sessionId, 'DIAG_ADJUSTMENT_REJECTED', null, '学生拒绝了诊断师调整建议'); return { rejected: true, message: '已拒绝诊断师调整' }; }
  return { applied: true };
}

// ========================
// 会话完成
// ========================

async function completeSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  const startedAt = session.started_at ? new Date(session.started_at) : new Date();
  const dur = Math.round((Date.now() - startedAt.getTime()) / 1000);
  let ma = session.mastery_current;
  if (session.knowledge_point_id) {
    const rec = await prisma.studentMasteryRecord.findUnique({ where: { student_user_id_course_id_knowledge_point_id: { student_user_id: Number(userId), course_id: Number(session.course_id), knowledge_point_id: Number(session.knowledge_point_id) } } });
    ma = rec?.mastery_score ?? ma;
  }
  await prisma.learningSession.update({ where: { session_id: Number(sessionId) }, data: { status: 'COMPLETED', completed_at: new Date(), mastery_after: ma, actual_duration_seconds: dur } });
  await addSessionEvent(sessionId, 'SESSION_COMPLETED', null, '学习会话已完成');
  if (session.learning_goal_id) {
    await require('../learning-goal/services/learning-goal-completion.service')
      .completeFromSession(session.learning_goal_id, userId).catch((error) => {
        console.warn(`[learning-goal] completion sync failed goal=${session.learning_goal_id} code=${error.code || 'UNKNOWN'}`);
      });
  }
  return getSession(sessionId, userId);
}

async function generateSummary(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  const nodeRuns = session.node_runs || [];
  const masteryChange = session.mastery_after != null && session.mastery_before != null ? Math.round((session.mastery_after - session.mastery_before) * 100) / 100 : null;
  const goalResult = session.learning_goal_id
    ? await require('../learning-goal/services/learning-goal-completion.service').completeFromSession(session.learning_goal_id, userId).catch(() => null)
    : null;
  return {
    sessionId: session.session_id,
    status: (session.completion_mode === 'MASTERY_TARGET' ? ((session.mastery_after || 0) >= (session.target_mastery || 80)) : true) ? '已达到学习目标' : '尚未达到学习目标',
    masteryChange: { before: session.mastery_before, after: session.mastery_after, change: masteryChange },
    targetMastery: session.target_mastery, completionMode: session.completion_mode,
    durationSeconds: session.actual_duration_seconds, estimatedMinutes: session.estimated_minutes,
    nodeStats: { total: nodeRuns.length, completed: nodeRuns.filter((r) => r.status === 'COMPLETED').length, skipped: nodeRuns.filter((r) => r.status === 'SKIPPED').length, inserted: nodeRuns.filter((r) => r.status === 'INSERTED').length, failed: nodeRuns.filter((r) => r.status === 'FAILED').length },
    courseName: session.course?.course_name, knowledgePointName: session.knowledge_point?.knowledge_point_name,
    ...(session.goal_snapshot ? { learningGoal: { snapshot: session.goal_snapshot, result: goalResult } } : {}),
  };
}

// ========================
// 辅助函数
// ========================

async function syncGraphStateToDb(sessionId, graphResult, nodeRun) {
  try {
    // 如果 Graph 已经持久化了 (persistToDb 节点会做), 只需同步 session-level 状态
    if (graphResult.status === 'completed') {
      await prisma.learningSession.update({
        where: { session_id: Number(sessionId) },
        data: { status: 'COMPLETED', completed_at: new Date() },
      });
      const completedSession = await prisma.learningSession.findUnique({ where: { session_id: Number(sessionId) }, select: { learning_goal_id: true, student_user_id: true } });
      if (completedSession?.learning_goal_id) {
        await require('../learning-goal/services/learning-goal-completion.service')
          .completeFromSession(completedSession.learning_goal_id, completedSession.student_user_id).catch(() => null);
      }
    }
  } catch (err) { console.warn(`[Runtime] syncGraphStateToDb error: ${err.message}`); }
}

async function checkKnowledgeBase(courseId) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { course_id: Number(courseId), status: 'active' } });
  return Boolean(kb);
}

async function buildContextForDiagnostician(session, userId) {
  return {
    session_id: session.session_id, student_id: String(userId),
    course_id: session.course_id, knowledge_point_id: session.knowledge_point_id,
    status: session.status, mastery_before: session.mastery_before, mastery_current: session.mastery_current,
    consecutive_correct: session.consecutive_correct, consecutive_wrong: session.consecutive_wrong,
    total_correct: session.total_correct, total_wrong: session.total_wrong,
    node_runs: (session.node_runs || []).map((r) => ({ node_id: r.node_id, node_type: r.node_type, status: r.status, agent_type: r.agent_type })),
    current_node_id: session.current_node_id, completion_mode: session.completion_mode, target_mastery: session.target_mastery, adjustment_mode: session.adjustment_mode,
  };
}

async function markNodeFailed(sessionId, nodeRunId, err) {
  const updated = await prisma.learningSessionNodeRun.updateMany({
    where: { node_run_id: nodeRunId, status: 'RUNNING' },
    data: { status: 'FAILED', ended_at: new Date(), error_code: String(err?.code || 'INTERNAL_ERROR').slice(0, 100), error_message: String(err?.message || '节点执行失败').slice(0, 500) },
  }).catch(() => ({ count: 0 }));
  if (updated.count) await addSessionEvent(sessionId, 'NODE_FAILED', null, `节点执行失败: ${err?.message || '未知错误'}`);
}

async function addSessionEvent(sessionId, eventType, nodeId, title, dataJson) {
  return prisma.learningSessionEvent.create({ data: { session_id: Number(sessionId), event_type: eventType, node_id: nodeId || null, title: String(title || '').slice(0, 200), data_json: dataJson || null } });
}

module.exports = {
  toCompletionMode, toAdjustmentMode,
  createSession, getSession, getPublicSession, startSession, pauseSession,
  executeCurrentNode, submitNodeAnswer, continueNode, advanceLearningSession,
  skipNode, retryNode, insertNode, handleDiagnosticianAdjustment,
  completeSession, generateSummary,
  addSessionEvent, checkKnowledgeBase, getPracticeConfig,
  currentRunForSession, ensureCurrentNodeExecution,
  reconcileSessionGraphState, buildLangGraphResponse, isLangGraphMode,
};
