// 学习流运行引擎 — 会话管理、节点执行、条件分支、动态调整
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

const COMPLETION_MODE_VALUES = Object.freeze({
  flow_complete: 'FLOW_COMPLETE',
  mastery_target: 'MASTERY_TARGET',
  FLOW_COMPLETE: 'FLOW_COMPLETE',
  MASTERY_TARGET: 'MASTERY_TARGET',
});
const ADJUSTMENT_MODE_VALUES = Object.freeze({
  auto_adjust: 'AUTO_ADJUST',
  ask_before_adjust: 'ASK_BEFORE_ADJUST',
  strict_original: 'STRICT_ORIGINAL',
  AUTO_ADJUST: 'AUTO_ADJUST',
  ASK_BEFORE_ADJUST: 'ASK_BEFORE_ADJUST',
  STRICT_ORIGINAL: 'STRICT_ORIGINAL',
});

// 所有练习节点共用这一份默认值。旧模板没有配置时也能稳定结束，且不会由前端自行放大题量。
const PRACTICE_DEFAULTS = Object.freeze({
  targetQuestionCount: 5,
  minQuestionCount: 3,
  maxQuestionCount: 8,
  targetMastery: 80,
  consecutiveCorrectToFinish: 3,
  allowSkip: true,
  difficultyMode: 'adaptive',
  exitMode: 'target_or_mastery_or_streak',
});

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getPracticeConfig(config = {}) {
  const targetQuestionCount = boundedInt(
    config.targetQuestionCount ?? config.questionCount,
    PRACTICE_DEFAULTS.targetQuestionCount,
    1,
    PRACTICE_DEFAULTS.maxQuestionCount,
  );
  const minQuestionCount = boundedInt(
    config.minQuestionCount,
    Math.min(PRACTICE_DEFAULTS.minQuestionCount, targetQuestionCount),
    1,
    targetQuestionCount,
  );
  const maxQuestionCount = boundedInt(
    config.maxQuestionCount,
    Math.max(PRACTICE_DEFAULTS.maxQuestionCount, targetQuestionCount),
    targetQuestionCount,
    20,
  );
  return {
    targetQuestionCount,
    minQuestionCount,
    maxQuestionCount,
    targetMastery: boundedInt(config.targetMastery, PRACTICE_DEFAULTS.targetMastery, 0, 100),
    consecutiveCorrectToFinish: boundedInt(
      config.consecutiveCorrectToFinish,
      PRACTICE_DEFAULTS.consecutiveCorrectToFinish,
      1,
      maxQuestionCount,
    ),
    allowSkip: config.allowSkip !== false,
    difficultyMode: String(config.difficultyMode || PRACTICE_DEFAULTS.difficultyMode),
    exitMode: String(config.exitMode || PRACTICE_DEFAULTS.exitMode),
  };
}

function isPracticeNode(node) {
  return ['basic_practice', 'adaptive_practice'].includes(node?.type);
}

function currentRunForSession(session) {
  const runs = session?.node_runs || [];
  if (session?.current_node_run_id) {
    const pointed = runs.find((run) => Number(run.node_run_id) === Number(session.current_node_run_id));
    if (pointed) return pointed;
  }
  return runs
    .filter((run) => String(run.node_id) === String(session?.current_node_id))
    .sort((a, b) => Number(b.node_run_id) - Number(a.node_run_id))[0] || null;
}

function isTerminalNodeRun(status) {
  return ['COMPLETED', 'SKIPPED', 'FAILED'].includes(status);
}

function toCompletionMode(value) {
  const result = COMPLETION_MODE_VALUES[value || 'flow_complete'];
  if (!result) throw createAgentError('INVALID_INPUT', '完成方式不合法', 400);
  return result;
}
function toAdjustmentMode(value) {
  const result = ADJUSTMENT_MODE_VALUES[value || 'auto_adjust'];
  if (!result) throw createAgentError('INVALID_INPUT', '诊断师调整方式不合法', 400);
  return result;
}

// ========================
// 会话管理
// ========================

async function createSession({ userId, courseId, knowledgePointId, templateId, versionId, completionMode, targetMastery, adjustmentMode, estimatedMinutes }) {
  const normalizedCourseId = Number(courseId);
  const normalizedKnowledgePointId = Number(knowledgePointId);
  if (!Number.isInteger(normalizedCourseId) || normalizedCourseId < 1
    || !Number.isInteger(normalizedKnowledgePointId) || normalizedKnowledgePointId < 1) {
    throw createAgentError('INVALID_INPUT', '开始学习前请选择课程和知识点', 400);
  }

  const [enrollment, knowledgePoint] = await Promise.all([
    prisma.studentCourseEnrollment.findFirst({
      where: { student_user_id: Number(userId), course_id: normalizedCourseId, enrollment_status: 'active' },
      select: { enrollment_id: true },
    }),
    prisma.knowledgePoint.findFirst({
      where: { knowledge_point_id: normalizedKnowledgePointId, course_id: normalizedCourseId },
      select: { knowledge_point_id: true },
    }),
  ]);
  if (!enrollment) throw createAgentError('COURSE_ACCESS_DENIED', '你尚未加入所选课程', 403);
  if (!knowledgePoint) throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '知识点不属于所选课程', 400);

  // 获取模板和版本
  const template = await prisma.learningWorkflowTemplate.findUnique({
    where: { template_id: Number(templateId) },
    include: {
      versions: {
        where: versionId ? { version_id: Number(versionId) } : {},
        orderBy: { version_number: 'desc' },
        take: 1,
      },
    },
  });

  if (!template) {
    throw createAgentError('TEMPLATE_NOT_FOUND', '学习流模板不存在', 404);
  }
  const canUseTemplate = template.source_type === 'SYSTEM'
    || (template.source_type === 'TEACHER' && template.is_published)
    || template.owner_user_id === Number(userId);
  if (!canUseTemplate || template.status !== 'active') {
    throw createAgentError('TEMPLATE_ACCESS_DENIED', '无权使用该学习流', 403);
  }
  if (template.course_id && template.course_id !== normalizedCourseId) {
    throw createAgentError('TEMPLATE_SCOPE_MISMATCH', '该学习流绑定了其他课程', 400);
  }
  if (template.knowledge_point_id && template.knowledge_point_id !== normalizedKnowledgePointId) {
    throw createAgentError('TEMPLATE_SCOPE_MISMATCH', '该学习流绑定了其他知识点', 400);
  }

  const version = template.versions[0];
  if (!version) {
    throw createAgentError('VERSION_NOT_FOUND', '模板没有可用版本', 404);
  }

  const graph = sanitizeGraphJson(version.graph_json || {});
  const settings = sanitizeSettingsJson(version.settings_json || {});

  // 同一流程、课程和知识点的未完成会话复用，刷新或重复点击不会制造新会话。
  const existingSession = await prisma.learningSession.findFirst({
    where: {
      student_user_id: Number(userId), workflow_template_id: template.template_id,
      course_id: normalizedCourseId, knowledge_point_id: normalizedKnowledgePointId,
      status: { in: ['CREATED', 'RUNNING', 'PAUSED'] },
    },
    orderBy: { updated_at: 'desc' },
  });
  if (existingSession) return getSession(existingSession.session_id, userId);

  // 获取当前掌握度
  let masteryBefore = null;
  if (knowledgePointId) {
    const mastery = await prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: Number(userId),
          course_id: normalizedCourseId,
          knowledge_point_id: normalizedKnowledgePointId,
        },
      },
    });
    masteryBefore = mastery?.mastery_score ?? null;
  }

  const session = await prisma.learningSession.create({
    data: {
      student_user_id: Number(userId),
      course_id: normalizedCourseId,
      knowledge_point_id: normalizedKnowledgePointId,
      workflow_template_id: template.template_id,
      workflow_version_id: version.version_id,
      workflow_snapshot_json: version.graph_json,
      runtime_graph_json: graph,
      status: 'CREATED',
      current_node_id: graph.entryNodeId || null,
      completion_mode: toCompletionMode(completionMode || settings.completion_mode),
      target_mastery: targetMastery || settings.target_mastery || 80,
      adjustment_mode: toAdjustmentMode(adjustmentMode || settings.adjustment_mode),
      mastery_before: masteryBefore,
      mastery_current: masteryBefore,
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

  if (!session) {
    throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
  }

  if (session.student_user_id !== Number(userId)) {
    throw createAgentError('SESSION_ACCESS_DENIED', '无权访问该学习会话', 403);
  }

  // 计算运行时状态
  const runtimeGraph = session.runtime_graph_json || {};
  const completedNodeIds = new Set(
    (session.node_runs || [])
      .filter((r) => r.status === 'COMPLETED' || r.status === 'SKIPPED')
      .map((r) => r.node_id)
  );

  const pendingNodes = (runtimeGraph.nodes || []).filter(
    (n) => !completedNodeIds.has(n.id)
  );

  const currentNodeRun = currentRunForSession(session);
  let trainerSession = null;
  if (currentNodeRun?.trainer_session_id) {
    trainerSession = await trainerService.getTrainerSession(Number(userId), currentNodeRun.trainer_session_id)
      .catch(() => null);
  }
  const completedTrainerHistory = await Promise.all(
    (session.node_runs || [])
      .filter((run) => run.trainer_session_id && Number(run.node_run_id) !== Number(currentNodeRun?.node_run_id))
      .map(async (run) => ({
        nodeRunId: run.node_run_id,
        nodeId: run.node_id,
        status: run.status,
        trainer: await trainerService.getTrainerSession(Number(userId), run.trainer_session_id).catch(() => null),
      }))
  );

  return {
    ...session,
    currentNodeRun,
    currentNodeExecutionId: currentNodeRun?.node_run_id || null,
    trainerSession,
    completedTrainerHistory,
    completedNodeCount: completedNodeIds.size,
    pendingNodeCount: pendingNodes.length,
    totalNodeCount: (runtimeGraph.nodes || []).length,
  };
}

async function startSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);

  if (session.status === 'RUNNING') {
    return session;
  }

  if (session.status !== 'CREATED' && session.status !== 'PAUSED') {
    throw createAgentError('INVALID_SESSION_STATUS', `无法从 ${session.status} 状态启动会话`, 400);
  }

  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: {
      status: 'RUNNING',
      started_at: session.started_at || new Date(),
      paused_at: null,
    },
  });

  // 预先创建 pending 记录，使刷新、跳过和异步请求都能绑定同一个 nodeExecution。
  await ensureCurrentNodeExecution(Number(sessionId), session.runtime_graph_json || {});

  await addSessionEvent(sessionId, 'SESSION_RESUMED', null, '学习会话已启动');

  return getSession(sessionId, userId);
}

async function pauseSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);

  if (session.status !== 'RUNNING') {
    throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以暂停', 400);
  }

  // 计算已用时间
  const startedAt = session.started_at ? new Date(session.started_at) : null;
  const durationSoFar = startedAt
    ? Math.round((Date.now() - startedAt.getTime()) / 1000)
    : session.actual_duration_seconds || 0;

  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: {
      status: 'PAUSED',
      paused_at: new Date(),
      actual_duration_seconds: durationSoFar,
    },
  });

  await addSessionEvent(sessionId, 'SESSION_PAUSED', null, '学习会话已暂停');

  return getSession(sessionId, userId);
}

// ========================
// 节点执行
// ========================

async function ensureCurrentNodeExecution(sessionId, graph) {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
    include: { node_runs: { orderBy: { node_run_id: 'desc' } } },
  });
  if (!session?.current_node_id) return null;

  const current = currentRunForSession(session);
  if (current && String(current.node_id) === String(session.current_node_id) && !isTerminalNodeRun(current.status)) {
    if (Number(session.current_node_run_id) !== Number(current.node_run_id)) {
      await prisma.learningSession.update({
        where: { session_id: Number(sessionId) },
        data: { current_node_run_id: current.node_run_id },
      });
    }
    return current;
  }

  const node = (graph.nodes || []).find((item) => String(item.id) === String(session.current_node_id));
  if (!node) return null;
  const sequenceIndex = (session.node_runs || []).reduce((max, run) => Math.max(max, run.sequence_index || 0), 0) + 1;
  const nodeRun = await prisma.learningSessionNodeRun.create({
    data: {
      session_id: Number(sessionId),
      node_id: String(node.id),
      node_type: normalizeWorkflowNodeType(node.type, { nodeId: node.id, sessionId }),
      status: 'PENDING',
      sequence_index: sequenceIndex,
      execution_version: 1,
    },
  });
  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: { current_node_run_id: nodeRun.node_run_id, execution_version: { increment: 1 } },
  });
  return nodeRun;
}

async function executeCurrentNode(sessionId, userId, req, res) {
  const session = await getSession(sessionId, userId);

  if (session.status !== 'RUNNING') {
    throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以执行节点', 400);
  }

  const graph = session.runtime_graph_json || {};
  const currentNodeId = session.current_node_id;
  if (!currentNodeId) {
    throw createAgentError('NO_CURRENT_NODE', '没有待执行的节点', 400);
  }

  const node = (graph.nodes || []).find((n) => n.id === currentNodeId);
  if (!node) {
    throw createAgentError('NODE_NOT_FOUND', `节点 ${currentNodeId} 不存在`, 404);
  }

  // 检查是否已完成
  const existingRun = currentRunForSession(session);
  if (existingRun && existingRun.status === 'COMPLETED') {
    throw createAgentError('NODE_ALREADY_COMPLETED', '该节点已执行完成', 400);
  }

  // 创建或更新 node_run
  let nodeRun;
  if (existingRun && existingRun.status === 'RUNNING') {
    nodeRun = existingRun;
  } else if (existingRun && existingRun.status === 'PENDING') {
    nodeRun = await prisma.learningSessionNodeRun.update({
      where: { node_run_id: existingRun.node_run_id },
      data: { status: 'RUNNING', started_at: existingRun.started_at || new Date() },
    });
  } else {
    const maxIndex = (session.node_runs || []).reduce(
      (max, r) => Math.max(max, r.sequence_index || 0), 0
    );
    nodeRun = await prisma.learningSessionNodeRun.create({
      data: {
        session_id: Number(sessionId),
        node_id: currentNodeId,
        node_type: normalizeWorkflowNodeType(node.type, { nodeId: currentNodeId, sessionId }),
        status: 'RUNNING',
        sequence_index: maxIndex + 1,
        started_at: new Date(),
      },
    });
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: { current_node_run_id: nodeRun.node_run_id, execution_version: { increment: 1 } },
    });
  }

  if (!existingRun || existingRun.status === 'PENDING') {
    await addSessionEvent(sessionId, 'NODE_STARTED', currentNodeId, `开始执行: ${node.title || node.type}`, {
      nodeExecutionId: nodeRun.node_run_id,
      executionVersion: nodeRun.execution_version || 1,
    });
  }

  // 根据节点类型分发执行
  const agentMapping = NODE_TO_AGENT[node.type];
  if (!agentMapping) {
    // mastery_gate 不需要 Agent
    if (node.type === 'mastery_gate') {
      return executeMasteryGate(session, node, nodeRun, userId);
    }
    throw createAgentError('UNKNOWN_NODE_TYPE', `未知节点类型: ${node.type}`, 400);
  }

  try {
    const result = await executeAgentNode(session, node, nodeRun, userId, agentMapping, req, res);
    return result;
  } catch (err) {
    await markNodeFailed(sessionId, nodeRun.node_run_id, err);
    throw err;
  }
}

async function executeAgentNode(session, node, nodeRun, userId, agentMapping, req, res) {
  const courseId = session.course_id;
  const kpId = session.knowledge_point_id;
  const practiceSessionId = session.practice_session_id;

  // 检查知识库
  if (courseId) {
    const kbEnabled = await checkKnowledgeBase(courseId);
    if (!kbEnabled && (node.type.includes('explanation') || node.type.includes('practice'))) {
      throw createAgentError('KNOWLEDGE_BASE_NOT_READY', '当前课程尚未接入专属知识库，暂不支持智能学习流执行', 400);
    }
  }

  const agentType = agentMapping.agent;

  switch (agentType) {
    case 'EXPLAINER': {
      if (res && req) {
        // SSE 流式执行
        const strategy = (node.config?.strategy) || agentMapping.defaultStrategy;
        return executeExplainerStream(session, node, nodeRun, userId, strategy, req, res);
      }
      // 非流式返回需要流式的提示
      throw createAgentError('STREAM_REQUIRED', '讲解类节点需要 SSE 流式连接', 400);
    }

    case 'TRAINER': {
      // 执行训练师节点
      return executeTrainerNode(session, node, nodeRun, userId);
    }

    case 'DIAGNOSTICIAN': {
      if (node.type === 'learning_summary') {
        return executeDiagnosticianSummary(session, node, nodeRun, userId);
      }
      if (node.type === 'wrong_question_repair') {
        return executeWrongQuestionRepair(session, node, nodeRun, userId);
      }
      throw createAgentError('UNSUPPORTED_DIAGNOSTICIAN_NODE', `诊断师不支持节点类型: ${node.type}`, 400);
    }

    default:
      throw createAgentError('UNSUPPORTED_AGENT', `不支持的 Agent 类型: ${agentType}`, 400);
  }
}

async function executeExplainerStream(session, node, nodeRun, userId, strategy, req, res) {
  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const knowledgePointId = session.knowledge_point_id;

  try {
    // 使用现有的 Explainer 流式服务
    await explainerService.streamExplainerChat({
      req,
      res,
      userId: Number(userId),
      body: {
        knowledgePointId: knowledgePointId ? Number(knowledgePointId) : null,
        message: node.config?.prompt || `请讲解: ${node.title || '知识点'}`,
        strategyHint: strategy,
        depth: node.config?.depth || 'moderate',
        newConversation: true,
        learningSessionId: String(session.session_id),
        practiceSessionId: session.practice_session_id || null,
      },
    });
  } catch (err) {
    await markNodeFailed(session.session_id, nodeRun.node_run_id, err);
    throw err;
  }
}

async function executeTrainerNode(session, node, nodeRun, userId) {
  const courseId = session.course_id;
  const kpId = session.knowledge_point_id;

  if (!courseId || !kpId) {
    throw createAgentError('MISSING_COURSE_OR_KP', '训练师节点需要课程和知识点', 400);
  }

  try {
    // 复用现有 Trainer 服务
    const practiceConfig = getPracticeConfig(node.config || {});
    const result = nodeRun.trainer_session_id
      ? await trainerService.getTrainerSession(Number(userId), nodeRun.trainer_session_id)
      : await trainerService.createTrainerSession(Number(userId), {
      courseId: Number(courseId),
      knowledgePointId: Number(kpId),
      questionCount: practiceConfig.targetQuestionCount,
      practiceConfig,
      learningSessionId: Number(session.session_id),
      nodeExecutionId: Number(nodeRun.node_run_id),
      executionVersion: Number(nodeRun.execution_version || 1),
      requestId: `lw_${session.session_id}_${nodeRun.node_run_id}_${nodeRun.execution_version || 1}`,
    });

    const trainerSessionId = result.session?.sessionId || result.sessionId;
    const activeRun = await prisma.learningSessionNodeRun.findFirst({
      where: { node_run_id: nodeRun.node_run_id, status: 'RUNNING' },
      select: { node_run_id: true },
    });
    if (!activeRun) {
      // 跳过后 Dify 迟到返回属于正常取消，不能把节点写回 completed/failed。
      return { nodeRun, trainerSession: result, cancelled: true, nodeCompleted: false };
    }

    // Trainer 会话只表示“题目已就绪”；节点保持 RUNNING，直到退出条件达成或学生跳过。
    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: nodeRun.node_run_id },
      data: {
        output_summary_json: {
          trainerSessionId,
          practiceConfig,
        },
        trainer_session_id: trainerSessionId || null,
        agent_type: 'TRAINER',
      },
    });

    return {
      nodeRun,
      trainerSession: result,
      nodeCompleted: false,
    };
  } catch (err) {
    await markNodeFailed(session.session_id, nodeRun.node_run_id, err);
    throw err;
  }
}

async function executeDiagnosticianSummary(session, node, nodeRun, userId) {
  if (!session.knowledge_point_id) {
    throw createAgentError('MISSING_KNOWLEDGE_POINT', '学习总结需要关联知识点', 400);
  }

  try {
    const context = await buildContextForDiagnostician(session, userId);

    const agentConfig = await prisma.aiAgentConfig.findFirst({
      where: { agent_type: 'DIAGNOSTICIAN', enabled: true },
    });

    if (!agentConfig) {
      throw createAgentError('AGENT_CONFIG_NOT_FOUND', '诊断师 Agent 未配置', 500);
    }

    const { runDiagnosticianWorkflow } = require('../../dify/agent-dify.service');
    const { buildDifyUser } = require('../../dify/agent-dify.service');

    const difyUser = buildDifyUser('diagnostician', Number(userId));
    const { businessResult, metadata } = await runDiagnosticianWorkflow({
      mode: 'growth_report',
      requestId: `lw_summary_${session.session_id}`,
      payload: {
        student_id: String(userId),
        knowledge_point_id: String(session.knowledge_point_id),
        course_id: session.course_id ? String(session.course_id) : null,
        session_context: context,
        node_runs: (session.node_runs || []).map((r) => ({
          node_type: r.node_type,
          status: r.status,
          error_code: r.error_code,
        })),
      },
      locale: 'zh-CN',
      difyUser,
    });

    const summaryData = businessResult?.result || businessResult?.data || businessResult || {};

    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: nodeRun.node_run_id },
      data: {
        status: 'COMPLETED',
        completed_at: new Date(),
        output_summary_json: summaryData,
        agent_type: 'DIAGNOSTICIAN',
      },
    });

    await addSessionEvent(session.session_id, 'NODE_COMPLETED', node.id,
      `学习总结已生成`);

    return {
      nodeRun,
      summary: summaryData,
      nodeCompleted: true,
    };
  } catch (err) {
    await markNodeFailed(session.session_id, nodeRun.node_run_id, err);
    throw err;
  }
}

async function executeWrongQuestionRepair(session, node, nodeRun, userId) {
  // 错题修复: 先调用 Diagnostician 分析，然后组合 Explainer 和 Trainer
  // 第一版简化实现：直接使用诊断师分析
  try {
    const context = await buildContextForDiagnostician(session, userId);

    const agentConfig = await prisma.aiAgentConfig.findFirst({
      where: { agent_type: 'DIAGNOSTICIAN', enabled: true },
    });

    if (!agentConfig) {
      throw createAgentError('AGENT_CONFIG_NOT_FOUND', '诊断师 Agent 未配置', 500);
    }

    const { runDiagnosticianWorkflow, buildDifyUser } = require('../../dify/agent-dify.service');
    const difyUser = buildDifyUser('diagnostician', Number(userId));

    const { businessResult } = await runDiagnosticianWorkflow({
      mode: 'mental_model',
      requestId: `lw_repair_${session.session_id}`,
      payload: {
        student_id: String(userId),
        knowledge_point_id: session.knowledge_point_id ? String(session.knowledge_point_id) : null,
        course_id: session.course_id ? String(session.course_id) : null,
        session_context: context,
        focus: 'wrong_question_analysis',
      },
      locale: 'zh-CN',
      difyUser,
    });

    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: nodeRun.node_run_id },
      data: {
        status: 'COMPLETED',
        completed_at: new Date(),
        output_summary_json: businessResult?.result || businessResult?.data || {},
        agent_type: 'DIAGNOSTICIAN',
      },
    });

    await addSessionEvent(session.session_id, 'NODE_COMPLETED', node.id,
      `错题修复分析完成`);

    return {
      nodeRun,
      repairResult: businessResult?.result || businessResult?.data || {},
      nodeCompleted: true,
    };
  } catch (err) {
    await markNodeFailed(session.session_id, nodeRun.node_run_id, err);
    throw err;
  }
}

async function executeMasteryGate(session, node, nodeRun, userId) {
  // 掌握度判断节点：计算当前掌握度并决定下一跳
  let masteryCurrent = session.mastery_current;
  if (session.knowledge_point_id) {
    const record = await prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: Number(userId),
          course_id: Number(session.course_id),
          knowledge_point_id: Number(session.knowledge_point_id),
        },
      },
    });
    masteryCurrent = record?.mastery_score ?? masteryCurrent;
  }

  const accuracy = session.total_correct + session.total_wrong > 0
    ? Math.round((session.total_correct / (session.total_correct + session.total_wrong)) * 100)
    : 0;

  // 更新会话掌握度
  await prisma.learningSession.update({
    where: { session_id: Number(session.session_id) },
    data: { mastery_current: masteryCurrent },
  });

  // 保存节点运行结果
  await prisma.learningSessionNodeRun.update({
    where: { node_run_id: nodeRun.node_run_id },
    data: {
      status: 'COMPLETED',
      completed_at: new Date(),
      output_summary_json: {
        mastery: masteryCurrent,
        accuracy,
        consecutive_wrong: session.consecutive_wrong,
        consecutive_correct: session.consecutive_correct,
      },
    },
  });

  await addSessionEvent(session.session_id, 'NODE_COMPLETED', node.id,
    `掌握度判断: ${masteryCurrent != null ? Math.round(masteryCurrent) : '--'}%`);

  return {
    nodeRun,
    gateResult: {
      mastery: masteryCurrent,
      accuracy,
      consecutiveWrong: session.consecutive_wrong,
    },
    nodeCompleted: true,
  };
}

// ========================
// 节点转换
// ========================

async function advanceToNextNode(sessionId, userId, context = {}) {
  const session = await getSession(sessionId, userId);
  const graph = session.runtime_graph_json || {};
  const currentNodeId = String(session.current_node_id || '');

  if (!currentNodeId) {
    return { sessionCompleted: true, message: '所有节点已完成' };
  }

  // Update session statistics
  if (context.lastAnswerCorrect === true) {
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: {
        consecutive_correct: { increment: 1 },
        consecutive_wrong: 0,
        total_correct: { increment: 1 },
      },
    });
  } else if (context.lastAnswerCorrect === false) {
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: {
        consecutive_wrong: { increment: 1 },
        consecutive_correct: 0,
        total_wrong: { increment: 1 },
      },
    });
  }

  // Evaluation context
  const refreshedSession = await getSession(sessionId, userId);
  const evalContext = {
    mastery: refreshedSession.mastery_current || 0,
    consecutiveWrong: refreshedSession.consecutive_wrong || 0,
    accuracy: refreshedSession.total_correct + refreshedSession.total_wrong > 0
      ? Math.round((refreshedSession.total_correct / (refreshedSession.total_correct + refreshedSession.total_wrong)) * 100)
      : 0,
    lastAnswerCorrect: context.lastAnswerCorrect,
  };

  // Calculate next node — use string comparison throughout
  const nextNodeIds = getNextNodeIds(graph, currentNodeId, evalContext);

  if (nextNodeIds.length === 0) {
    await completeSession(sessionId, userId);
    return { sessionCompleted: true, message: '学习流已完成' };
  }

  const nextNodeId = String(nextNodeIds[0]);

  // Early mastery check
  if (refreshedSession.completion_mode === 'MASTERY_TARGET') {
    const targetMastery = refreshedSession.target_mastery || 80;
    if (evalContext.mastery >= targetMastery) {
      const nextNode = (graph.nodes || []).find((n) => String(n.id) === nextNodeId);
      if (nextNode && nextNode.type === 'mastery_gate') {
        const afterGate = getNextNodeIds(graph, nextNodeId, evalContext);
        if (afterGate.length > 0) {
          await prisma.learningSession.update({
            where: { session_id: Number(sessionId) },
            data: { current_node_id: String(afterGate[0]) },
          });
          await ensureCurrentNodeExecution(sessionId, graph);
          return { nodeAdvanced: true, nextNodeId: String(afterGate[0]), earlyMastery: true };
        }
      }
    }
  }

  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: { current_node_id: nextNodeId },
  });

  await ensureCurrentNodeExecution(sessionId, graph);

  return { nodeAdvanced: true, nextNodeId };
}

/**
 * 所有用户驱动的节点结束都走这里。它以 nodeExecution 为比较对象，而不是数组下标，
 * 因此网络重放或旧响应最多返回当前快照，不会把会话再推进一次。
 */
async function advanceLearningSession({
  sessionId,
  userId,
  expectedNodeExecutionId,
  completionType = 'completed',
  operationId = null,
  reason = null,
  lastAnswerCorrect,
} = {}) {
  const normalizedSessionId = Number(sessionId);
  const expectedRunId = expectedNodeExecutionId == null ? null : Number(expectedNodeExecutionId);
  let transition = { idempotent: false, nodeAdvanced: false, sessionCompleted: false };

  await prisma.$transaction(async (tx) => {
    const session = await tx.learningSession.findUnique({
      where: { session_id: normalizedSessionId },
      include: { node_runs: { orderBy: { sequence_index: 'asc' } } },
    });
    if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
    if (session.student_user_id !== Number(userId)) throw createAgentError('SESSION_ACCESS_DENIED', '无权操作该学习会话', 403);

    const currentRun = currentRunForSession(session);
    if (!currentRun || (expectedRunId && Number(currentRun.node_run_id) !== expectedRunId)) {
      transition.idempotent = true;
      return;
    }
    if (isTerminalNodeRun(currentRun.status) || !session.current_node_id) {
      transition.idempotent = true;
      return;
    }

    const graph = session.runtime_graph_json || {};
    const currentNode = (graph.nodes || []).find((node) => String(node.id) === String(session.current_node_id));
    if (!currentNode) throw createAgentError('NODE_NOT_FOUND', '当前节点不存在', 404);
    const now = new Date();
    const skipped = completionType === 'skipped';
    const failed = completionType === 'failed';

    // 先使所有 Trainer 及其尚未落库的 Agent run 失效；迟到响应会在 Trainer service 再次校验此状态。
    if (skipped && currentRun.trainer_session_id) {
      const trainerSessionId = currentRun.trainer_session_id;
      await tx.agentRunRecord.updateMany({
        where: { practice_session_id: trainerSessionId, status: { in: ['PENDING', 'RUNNING'] } },
        data: {
          status: 'STOPPED',
          error_code: 'RUN_CANCELLED',
          error_message: '学习流节点已跳过，已忽略旧的训练请求。',
        },
      });
      await tx.trainerSessionQuestion.updateMany({
        where: { practice_session_id: trainerSessionId, status: 'active' },
        data: { status: 'cancelled' },
      });
      await tx.trainerSessionDetail.updateMany({
        where: { practice_session_id: trainerSessionId },
        data: { current_phase: 'cancelled', current_question_key: null },
      });
      await tx.practiceSession.updateMany({
        where: { practice_session_id: trainerSessionId, status: { in: ['CREATED', 'IN_PROGRESS', 'SUBMITTING', 'created', 'in_progress', 'submitting'] } },
        data: {
          status: 'ABANDONED',
          submitted_at: now,
          submit_reason: 'WORKFLOW_NODE_SKIPPED',
          last_active_at: now,
        },
      });
    }

    const runStatus = skipped ? 'SKIPPED' : failed ? 'FAILED' : 'COMPLETED';
    const endedRun = await tx.learningSessionNodeRun.updateMany({
      where: { node_run_id: currentRun.node_run_id, status: { in: ['PENDING', 'RUNNING'] } },
      data: {
        status: runStatus,
        completed_at: skipped ? currentRun.completed_at : now,
        ended_at: now,
        skipped_at: skipped ? now : null,
        skip_reason: skipped ? String(reason || 'user_skipped').slice(0, 500) : null,
        operation_id: operationId ? String(operationId).slice(0, 128) : currentRun.operation_id,
        error_code: failed ? 'NODE_FAILED' : null,
      },
    });
    if (!endedRun.count) {
      transition.idempotent = true;
      return;
    }

    const stats = {
      consecutive_correct: session.consecutive_correct,
      consecutive_wrong: session.consecutive_wrong,
      total_correct: session.total_correct,
      total_wrong: session.total_wrong,
    };
    if (lastAnswerCorrect === true) {
      stats.consecutive_correct += 1;
      stats.consecutive_wrong = 0;
      stats.total_correct += 1;
    } else if (lastAnswerCorrect === false) {
      stats.consecutive_wrong += 1;
      stats.consecutive_correct = 0;
      stats.total_wrong += 1;
    }

    // 失败默认停留在当前节点，不自动越过；跳过和正常完成才推进。
    if (failed) {
      await tx.learningSession.update({
        where: { session_id: normalizedSessionId },
        data: { ...stats, current_node_run_id: null, execution_version: { increment: 1 } },
      });
      await tx.learningSessionEvent.create({
        data: { session_id: normalizedSessionId, event_type: 'NODE_FAILED', node_id: currentNode.id, title: '节点执行失败' },
      });
      return;
    }

    const evaluation = {
      mastery: session.mastery_current || 0,
      consecutiveWrong: stats.consecutive_wrong,
      accuracy: stats.total_correct + stats.total_wrong > 0
        ? Math.round((stats.total_correct / (stats.total_correct + stats.total_wrong)) * 100)
        : 0,
      lastAnswerCorrect,
    };
    const nextNodeIds = getNextNodeIds(graph, String(currentNode.id), evaluation);
    if (!nextNodeIds.length) {
      await tx.learningSession.update({
        where: { session_id: normalizedSessionId },
        data: {
          ...stats,
          status: 'COMPLETED',
          completed_at: now,
          current_node_id: null,
          current_node_run_id: null,
          execution_version: { increment: 1 },
        },
      });
      await tx.learningSessionEvent.create({
        data: {
          session_id: normalizedSessionId,
          event_type: 'SESSION_COMPLETED',
          node_id: currentNode.id,
          title: '学习流已完成',
        },
      });
      transition.sessionCompleted = true;
      return;
    }

    const nextNodeId = String(nextNodeIds[0]);
    const nextNode = (graph.nodes || []).find((node) => String(node.id) === nextNodeId);
    if (!nextNode) throw createAgentError('NODE_NOT_FOUND', '下一节点不存在', 404);
    const nextRun = await tx.learningSessionNodeRun.create({
      data: {
        session_id: normalizedSessionId,
        node_id: nextNodeId,
        node_type: normalizeWorkflowNodeType(nextNode.type, { nodeId: nextNodeId, sessionId: normalizedSessionId }),
        status: 'PENDING',
        sequence_index: (session.node_runs || []).reduce((max, run) => Math.max(max, run.sequence_index || 0), 0) + 1,
        execution_version: 1,
      },
    });
    await tx.learningSession.update({
      where: { session_id: normalizedSessionId },
      data: {
        ...stats,
        current_node_id: nextNodeId,
        current_node_run_id: nextRun.node_run_id,
        execution_version: { increment: 1 },
      },
    });
    await tx.learningSessionEvent.create({
      data: {
        session_id: normalizedSessionId,
        event_type: skipped ? 'NODE_SKIPPED' : 'NODE_COMPLETED',
        node_id: currentNode.id,
        title: skipped ? `跳过节点: ${currentNode.title || currentNode.type}` : `完成节点: ${currentNode.title || currentNode.type}`,
        data_json: { operationId: operationId || null, nextNodeId, reason: skipped ? reason || 'user_skipped' : null },
      },
    });
    transition = { nodeAdvanced: true, nextNodeId, nextNodeExecutionId: nextRun.node_run_id, sessionCompleted: false, idempotent: false };
  });

  return { ...transition, session: await getSession(normalizedSessionId, userId) };
}

// ========================
// 节点操作
// ========================

async function skipNode(sessionId, userId, nodeId, reason, options = {}) {
  let session = await getSession(sessionId, userId);

  if (session.status !== 'RUNNING') {
    throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以跳过节点', 400);
  }

  const graph = session.runtime_graph_json || {};
  const node = (graph.nodes || []).find((n) => String(n.id) === String(nodeId));
  if (!node) {
    throw createAgentError('NODE_NOT_FOUND', '节点不存在', 404);
  }

  if (String(session.current_node_id) !== String(nodeId)) {
    // 迟到的重复请求只返回权威快照，绝不跳过新的当前节点。
    return { idempotent: true, session };
  }
  // 修复历史异常会话：此前 node run 因 Prisma 枚举报错未创建时，先补一条合法 PENDING 再原子跳过。
  if (!currentRunForSession(session)) {
    await ensureCurrentNodeExecution(sessionId, graph);
    session = await getSession(sessionId, userId);
  }
  if (isPracticeNode(node) && node.config?.allowSkip === false) {
    throw createAgentError('NODE_SKIP_DISABLED', '当前练习节点不允许跳过', 400);
  }
  return advanceLearningSession({
    sessionId,
    userId,
    expectedNodeExecutionId: options.expectedNodeExecutionId || session.currentNodeExecutionId,
    completionType: 'skipped',
    operationId: options.operationId,
    reason: reason || 'user_skipped',
  });
}

async function insertNode(sessionId, userId, nodeData, afterNodeId, reason) {
  const session = await getSession(sessionId, userId);

  if (session.status !== 'RUNNING' && session.status !== 'CREATED') {
    throw createAgentError('INVALID_SESSION_STATUS', '只有运行中或待开始的会话可以插入节点', 400);
  }

  const graph = session.runtime_graph_json || {};
  const nodes = [...(graph.nodes || [])];
  const edges = [...(graph.edges || [])];

  // 生成新节点 ID
  const newNodeId = `inserted_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // 创建新节点
  const newNode = {
    id: newNodeId,
    type: nodeData.type,
    title: String(nodeData.title || '').slice(0, 100),
    config: nodeData.config || {},
    position: nodeData.position || { x: 0, y: 0 },
  };
  nodes.push(newNode);

  // 找到 afterNodeId 的原始出边
  const afterEdges = edges.filter((e) => e.source === afterNodeId);
  const newEdgeId = `edge_inserted_${Date.now()}`;

  if (afterEdges.length > 0) {
    // 重新连接: afterNode -> newNode, newNode -> 原始target
    for (const edge of afterEdges) {
      edges.push({
        id: `${newEdgeId}_${edge.id}`,
        source: newNodeId,
        target: edge.target,
        condition: edge.condition || { type: 'always', params: {} },
        label: '',
      });
    }
    // 删除原始出边
    for (const edge of afterEdges) {
      const idx = edges.indexOf(edge);
      if (idx >= 0) edges.splice(idx, 1);
    }
  }

  // 添加连接边
  edges.push({
    id: newEdgeId,
    source: afterNodeId,
    target: newNodeId,
    condition: { type: 'always', params: {} },
    label: '',
  });

  const newGraph = { ...graph, nodes, edges, entryNodeId: graph.entryNodeId };

  // 校验新图
  const validation = validateGraphJson(newGraph);
  if (!validation.valid) {
    throw createAgentError('INVALID_GRAPH', `插入节点后流程图校验失败: ${validation.errors.join('; ')}`, 400);
  }

  // 更新运行时图
  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: { runtime_graph_json: newGraph },
  });

  // 如果当前节点就是 afterNodeId，更新为 newNodeId
  if (session.current_node_id === afterNodeId) {
    const completedRun = (session.node_runs || []).find(
      (r) => r.node_id === afterNodeId && r.status === 'COMPLETED'
    );
    if (completedRun) {
      await prisma.learningSession.update({
        where: { session_id: Number(sessionId) },
        data: { current_node_id: newNodeId },
      });
    }
  }

  // 创建 INSERTED node run
  const maxIndex = (session.node_runs || []).reduce(
    (max, r) => Math.max(max, r.sequence_index || 0), 0
  );

  await prisma.learningSessionNodeRun.create({
    data: {
      session_id: Number(sessionId),
      node_id: newNodeId,
      node_type: normalizeWorkflowNodeType(nodeData.type, { nodeId: newNodeId, sessionId }),
      status: 'INSERTED',
      sequence_index: maxIndex + 1,
      inserted_by: 'diagnostician',
      insert_reason: String(reason || '').slice(0, 500),
    },
  });

  await addSessionEvent(sessionId, 'NODE_INSERTED', newNodeId,
    `诊断师插入节点: ${newNode.title || nodeData.type}`);

  return getSession(sessionId, userId);
}

async function handleDiagnosticianAdjustment(sessionId, userId, action) {
  const session = await getSession(sessionId, userId);

  if (session.adjustment_mode === 'STRICT_ORIGINAL' && action !== 'reject') {
    return { applied: false, reason: '当前为严格模式，不接受诊断师调整' };
  }

  if (action === 'apply') {
    // 诊断师调整已应用（实际调整在 insertNode 时已生效）
    return { applied: true, message: '诊断师调整已应用' };
  }

  if (action === 'reject') {
    await addSessionEvent(sessionId, 'DIAG_ADJUSTMENT_REJECTED', null, '学生拒绝了诊断师调整建议');
    return { rejected: true, message: '已拒绝诊断师调整' };
  }

  return { applied: true };
}

// ========================
// 会话完成
// ========================

async function completeSession(sessionId, userId) {
  const session = await getSession(sessionId, userId);

  const startedAt = session.started_at ? new Date(session.started_at) : new Date();
  const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  // 获取最终掌握度
  let masteryAfter = session.mastery_current;
  if (session.knowledge_point_id) {
    const record = await prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: Number(userId),
          course_id: Number(session.course_id),
          knowledge_point_id: Number(session.knowledge_point_id),
        },
      },
    });
    masteryAfter = record?.mastery_score ?? masteryAfter;
  }

  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: {
      status: 'COMPLETED',
      completed_at: new Date(),
      mastery_after: masteryAfter,
      actual_duration_seconds: durationSeconds,
    },
  });

  await addSessionEvent(sessionId, 'SESSION_COMPLETED', null, '学习会话已完成');

  return getSession(sessionId, userId);
}

async function generateSummary(sessionId, userId) {
  const session = await getSession(sessionId, userId);

  const nodeRuns = session.node_runs || [];
  const completedNodes = nodeRuns.filter((r) => r.status === 'COMPLETED');
  const skippedNodes = nodeRuns.filter((r) => r.status === 'SKIPPED');
  const insertedNodes = nodeRuns.filter((r) => r.status === 'INSERTED');
  const failedNodes = nodeRuns.filter((r) => r.status === 'FAILED');

  const masteryChange = session.mastery_after != null && session.mastery_before != null
    ? Math.round((session.mastery_after - session.mastery_before) * 100) / 100
    : null;

  const targetReached = session.completion_mode === 'MASTERY_TARGET'
    ? (session.mastery_after || 0) >= (session.target_mastery || 80)
    : true;

  const statusLabel = targetReached
    ? '已达到学习目标'
    : (masteryChange != null && masteryChange > 0)
      ? '部分达到学习目标'
      : '尚未达到学习目标';

  return {
    sessionId: session.session_id,
    status: statusLabel,
    targetReached,
    masteryChange: {
      before: session.mastery_before,
      after: session.mastery_after,
      change: masteryChange,
    },
    targetMastery: session.target_mastery,
    completionMode: session.completion_mode,
    durationSeconds: session.actual_duration_seconds,
    estimatedMinutes: session.estimated_minutes,
    nodeStats: {
      total: nodeRuns.length,
      completed: completedNodes.length,
      skipped: skippedNodes.length,
      inserted: insertedNodes.length,
      failed: failedNodes.length,
    },
    completedNodes: completedNodes.map((r) => ({
      nodeId: r.node_id,
      type: r.node_type,
      agentType: r.agent_type,
    })),
    skippedNodes: skippedNodes.map((r) => ({
      nodeId: r.node_id,
      type: r.node_type,
      reason: r.skip_reason,
    })),
    insertedNodes: insertedNodes.map((r) => ({
      nodeId: r.node_id,
      type: r.node_type,
      reason: r.insert_reason,
    })),
    events: session.events || [],
    courseName: session.course?.course_name,
    knowledgePointName: session.knowledge_point?.knowledge_point_name,
  };
}

// ========================
// 辅助函数
// ========================

async function checkKnowledgeBase(courseId) {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { course_id: Number(courseId), status: 'active' },
  });
  return Boolean(kb);
}

async function buildContextForDiagnostician(session, userId) {
  const nodeRuns = (session.node_runs || []).map((r) => ({
    node_id: r.node_id,
    node_type: r.node_type,
    status: r.status,
    agent_type: r.agent_type,
    started_at: r.started_at,
    completed_at: r.completed_at,
  }));

  return {
    session_id: session.session_id,
    student_id: String(userId),
    course_id: session.course_id,
    knowledge_point_id: session.knowledge_point_id,
    status: session.status,
    mastery_before: session.mastery_before,
    mastery_current: session.mastery_current,
    consecutive_correct: session.consecutive_correct,
    consecutive_wrong: session.consecutive_wrong,
    total_correct: session.total_correct,
    total_wrong: session.total_wrong,
    node_runs: nodeRuns,
    current_node_id: session.current_node_id,
    completion_mode: session.completion_mode,
    target_mastery: session.target_mastery,
    adjustment_mode: session.adjustment_mode,
  };
}

async function markNodeFailed(sessionId, nodeRunId, err) {
  const updated = await prisma.learningSessionNodeRun.updateMany({
    where: { node_run_id: nodeRunId, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      ended_at: new Date(),
      error_code: String(err?.code || 'INTERNAL_ERROR').slice(0, 100),
      error_message: String(err?.message || '节点执行失败').slice(0, 500),
    },
  }).catch(() => ({ count: 0 }));

  if (updated.count) {
    await addSessionEvent(sessionId, 'NODE_FAILED', null,
      `节点执行失败: ${err?.message || '未知错误'}`);
  }
}

async function addSessionEvent(sessionId, eventType, nodeId, title, dataJson) {
  return prisma.learningSessionEvent.create({
    data: {
      session_id: Number(sessionId),
      event_type: eventType,
      node_id: nodeId || null,
      title: String(title || '').slice(0, 200),
      data_json: dataJson || null,
    },
  });
}

// ========================
// 提交答案（学习流中 Trainer 节点交互）
// ========================

async function submitNodeAnswer(sessionId, userId, data) {
  const session = await getSession(sessionId, userId);

  if (session.status !== 'RUNNING') {
    throw createAgentError('INVALID_SESSION_STATUS', '会话未在运行中', 400);
  }

  // 查找当前节点的 Trainer 会话
  const currentNodeRun = currentRunForSession(session);

  if (!currentNodeRun || currentNodeRun.status !== 'RUNNING') {
    throw createAgentError('NO_RUNNING_NODE', '没有正在执行的节点', 400);
  }
  if (data.expectedNodeExecutionId && Number(data.expectedNodeExecutionId) !== Number(currentNodeRun.node_run_id)) {
    throw createAgentError('STALE_NODE_EXECUTION', '当前练习已切换，请刷新后继续', 409);
  }

  // 如果是训练师节点，需要查找对应的 PracticeSession
  const practiceSessionId = currentNodeRun.trainer_session_id
    || currentNodeRun.output_summary_json?.trainerSessionId
    || currentNodeRun.output_summary_json?.sessionId;
  if (!practiceSessionId) {
    throw createAgentError('NO_PRACTICE_SESSION', '当前节点没有关联的训练会话', 400);
  }

  // 调用 Trainer 提交答案
  const result = await trainerService.submitTrainerAnswer(Number(userId), practiceSessionId, {
    questionKey: data.questionKey,
    selectedOption: data.selectedOption,
    confidenceLevel: data.confidenceLevel,
    timeSpentSeconds: data.timeSpentSeconds,
    requestId: String(data.requestId || `lw_submit_${sessionId}_${currentNodeRun.node_run_id}_${Date.now()}`).slice(0, 128),
  });

  // 如果有下一题，继续
  if (result.nextQuestion) {
    return {
      nodeContinued: true,
      nextQuestion: result.nextQuestion,
      answerResult: result.answerResult,
      evaluation: result.evaluation,
      sessionProgress: result.sessionProgress,
    };
  }

  // Trainer 已达到退出条件；先固化报告，再由统一推进服务结束 nodeExecution。
  const trainerCompletion = await trainerService.completeTrainerSession(Number(userId), practiceSessionId)
    .catch(() => null);
  const summary = trainerCompletion?.report?.sessionSummary || result.completion || {};
  await prisma.learningSessionNodeRun.update({
    where: { node_run_id: currentNodeRun.node_run_id },
    data: {
      output_summary_json: {
        ...currentNodeRun.output_summary_json,
        trainerSessionId: practiceSessionId,
        finalAnswer: result.answerResult,
        sessionProgress: result.sessionProgress,
        practiceSummary: {
          completedQuestionCount: summary.completedCount ?? result.completion?.answeredCount ?? 0,
          correctQuestionCount: summary.correctCount ?? result.completion?.correctCount ?? 0,
          accuracy: summary.accuracy ?? result.completion?.accuracy ?? 0,
          currentMastery: trainerCompletion?.report?.masteryChange?.masteryAfter ?? null,
          endedReason: result.completion?.reason || 'completed',
        },
      },
    },
  });

  const advanceResult = await advanceLearningSession({
    sessionId,
    userId,
    expectedNodeExecutionId: currentNodeRun.node_run_id,
    completionType: 'completed',
    operationId: data.operationId || data.requestId,
    lastAnswerCorrect: result.answerResult?.isCorrect,
  });

  return {
    nodeCompleted: true,
    answerResult: result.answerResult,
    evaluation: result.evaluation,
    completion: result.completion,
    sessionProgress: result.sessionProgress,
    ...advanceResult,
  };
}

module.exports = {
  toCompletionMode,
  toAdjustmentMode,
  // 会话管理
  createSession,
  getSession,
  startSession,
  pauseSession,

  // 节点执行
  executeCurrentNode,
  advanceToNextNode,
  advanceLearningSession,
  submitNodeAnswer,

  // 节点操作
  skipNode,
  insertNode,
  handleDiagnosticianAdjustment,

  // 会话完成
  completeSession,
  generateSummary,

  // 辅助
  addSessionEvent,
  checkKnowledgeBase,
  getPracticeConfig,
  currentRunForSession,
  ensureCurrentNodeExecution,
};
