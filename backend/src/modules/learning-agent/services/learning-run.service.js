/**
 * Learning Run Service
 *
 * 学习运行管理：创建运行、恢复运行、跳过节点、查询运行状态。
 * 桥接 LangGraph 运行和现有 LearningSession / LearningSessionNodeRun 数据库表。
 */

const prisma = require('../../../config/prisma');
const { createAgentError } = require('../../agent/common/agent.errors');
const { runLearningFlow, resumeLearningFlow } = require('../graph/learning-flow.graph');
const { getCheckpointer } = require('../graph/checkpointer.service');

// ---------------------------------------------------------------------------
// 从现有 LearningSession 构建 LangGraph 初始状态
// ---------------------------------------------------------------------------

async function buildInitialState(sessionId, userId) {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
    include: {
      node_runs: { orderBy: { sequence_index: 'asc' } },
      course: { select: { course_id: true, course_name: true } },
      knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } },
    },
  });

  if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
  if (session.student_user_id !== Number(userId)) {
    throw createAgentError('SESSION_ACCESS_DENIED', '无权访问该学习会话', 403);
  }

  // 从 runtime_graph_json 解析节点列表
  const graph = session.runtime_graph_json || {};
  const nodeList = (graph.nodes || []).map((node) => ({
    id: node.id,
    type: node.type,
    title: node.title || '',
    config: node.config || {},
    position: node.position || {},
  }));

  // 查找当前节点索引
  const currentNodeId = session.current_node_id;
  const currentNodeIndex = nodeList.findIndex((n) => String(n.id) === String(currentNodeId));

  // 获取完成节点的进度
  const completedNodeIds = new Set(
    (session.node_runs || [])
      .filter((r) => r.status === 'COMPLETED' || r.status === 'SKIPPED')
      .map((r) => r.node_id),
  );

  const masteryRecord = await prisma.studentMasteryRecord.findUnique({
    where: {
      student_user_id_course_id_knowledge_point_id: {
        student_user_id: Number(userId),
        course_id: session.course_id,
        knowledge_point_id: session.knowledge_point_id,
      },
    },
  }).catch(() => null);

  return {
    runId: String(session.session_id),
    threadId: String(session.session_id),
    studentId: Number(userId),
    workflowId: session.workflow_template_id,
    courseId: session.course_id,
    knowledgePointId: session.knowledge_point_id,
    currentNodeIndex: currentNodeIndex >= 0 ? currentNodeIndex : 0,
    currentNode: null,
    nodeList,
    latestStudentInput: null,
    uploadedFileRefs: [],
    retrievalRefs: [],
    currentQuestionId: null,
    currentQuestionRef: null,
    diagnosisSummary: masteryRecord
      ? { mastery_estimate: masteryRecord.mastery_score }
      : null,
    pendingIntervention: null,
    retryCount: 0,
    nodeIterationCount: 0,
    trainingQuestionCount: 0,
    remediationRound: 0,
    status: 'pending',
    errorMessage: null,
    errorCode: null,
    imageAnalysisSummary: null,
    multimodalTaskCount: 0,
    knowledgeBaseAvailable: true,
    isDegraded: false,
    agentOutputRef: null,
    nodeResultSummary: null,
  };
}

// ---------------------------------------------------------------------------
// 创建运行
// ---------------------------------------------------------------------------

/**
 * 为现有 LearningSession 创建 LangGraph 运行并执行
 */
async function createRun(sessionId, userId) {
  // 1. 确保会话是 RUNNING 状态
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
  });

  if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
  if (session.student_user_id !== Number(userId)) {
    throw createAgentError('SESSION_ACCESS_DENIED', '无权访问', 403);
  }

  // 更新状态
  if (session.status !== 'RUNNING') {
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: {
        status: 'RUNNING',
        started_at: session.started_at || new Date(),
      },
    });
  }

  // 2. 构建初始状态
  const initialState = await buildInitialState(sessionId, userId);

  // 3. 运行 LangGraph
  let graphResult;
  try {
    graphResult = await runLearningFlow(initialState);
  } catch (err) {
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: { status: 'FAILED', error_message: err.message },
    });
    throw err;
  }

  // 4. 持久化结果到 node_run
  await persistNodeResult(sessionId, userId, graphResult);

  // 5. 返回运行状态
  return buildRunResponse(sessionId, userId, graphResult);
}

// ---------------------------------------------------------------------------
// 恢复运行（学生交互后）
// ---------------------------------------------------------------------------

/**
 * 学生提交交互（答题、提问等）后恢复 LangGraph 运行
 */
async function resumeRun(sessionId, userId, studentInput) {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
  });

  if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
  if (session.student_user_id !== Number(userId)) {
    throw createAgentError('SESSION_ACCESS_DENIED', '无权访问', 403);
  }
  if (session.status !== 'RUNNING') {
    throw createAgentError('INVALID_SESSION_STATUS', '会话未在运行中', 400);
  }

  // 检查 checkpoint 是否存在
  const checkpointer = getCheckpointer();
  const existingCheckpoint = await checkpointer.getTuple({
    configurable: { thread_id: String(sessionId) },
  });

  let graphResult;
  if (existingCheckpoint) {
    // 从 checkpoint 恢复
    graphResult = await resumeLearningFlow(String(sessionId), studentInput);
  } else {
    // checkpoint 不存在（如后端重启），重新创建
    const initialState = await buildInitialState(sessionId, userId);
    initialState.latestStudentInput = studentInput;
    graphResult = await runLearningFlow(initialState);
  }

  // 持久化
  await persistNodeResult(sessionId, userId, graphResult);

  return buildRunResponse(sessionId, userId, graphResult);
}

// ---------------------------------------------------------------------------
// 跳过节点
// ---------------------------------------------------------------------------

async function skipCurrentNode(sessionId, userId, reason = 'user_skipped') {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
    include: { node_runs: { orderBy: { sequence_index: 'asc' } } },
  });

  if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);

  const currentNodeRun = (session.node_runs || []).find(
    (r) => r.status === 'RUNNING' || r.status === 'PENDING',
  );

  if (currentNodeRun) {
    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: currentNodeRun.node_run_id },
      data: {
        status: 'SKIPPED',
        skipped_at: new Date(),
        skip_reason: String(reason).slice(0, 500),
      },
    });
  }

  // 推进到下一节点
  const graph = session.runtime_graph_json || {};
  const nodeList = (graph.nodes || []).map((n) => n.id);
  const currentIndex = nodeList.indexOf(String(session.current_node_id));
  const nextNodeId = currentIndex >= 0 && currentIndex + 1 < nodeList.length
    ? nodeList[currentIndex + 1]
    : null;

  await prisma.learningSession.update({
    where: { session_id: Number(sessionId) },
    data: {
      current_node_id: nextNodeId,
      current_node_run_id: null,
    },
  });

  // 清除 checkpoint
  const checkpointer = getCheckpointer();
  await checkpointer.deleteThread(String(sessionId)).catch(() => {});

  if (!nextNodeId) {
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: { status: 'COMPLETED', completed_at: new Date() },
    });
    return { sessionCompleted: true, message: '学习流已完成' };
  }

  return { nodeAdvanced: true, nextNodeId };
}

// ---------------------------------------------------------------------------
// 获取运行状态
// ---------------------------------------------------------------------------

async function getRun(sessionId, userId) {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
    include: {
      node_runs: { orderBy: { sequence_index: 'asc' } },
      course: { select: { course_id: true, course_name: true } },
      knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } },
      workflow_template: { select: { template_id: true, title: true } },
    },
  });

  if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
  if (session.student_user_id !== Number(userId)) {
    throw createAgentError('SESSION_ACCESS_DENIED', '无权访问', 403);
  }

  // 尝试从 checkpointer 获取最新状态
  let graphState = null;
  try {
    const checkpointer = getCheckpointer();
    const checkpoint = await checkpointer.getTuple({
      configurable: { thread_id: String(sessionId) },
    });
    if (checkpoint) {
      graphState = checkpoint.checkpoint;
    }
  } catch {
    // checkpoint 不存在，使用数据库状态
  }

  const graph = session.runtime_graph_json || {};
  const nodeList = (graph.nodes || []).map((n) => ({ id: n.id, type: n.type, title: n.title }));

  return {
    sessionId: session.session_id,
    status: session.status,
    courseId: session.course_id,
    courseName: session.course?.course_name,
    knowledgePointId: session.knowledge_point_id,
    knowledgePointName: session.knowledge_point?.knowledge_point_name,
    workflowTitle: session.workflow_template?.title,
    currentNodeId: session.current_node_id,
    nodeList,
    nodeRuns: (session.node_runs || []).map((r) => ({
      nodeRunId: r.node_run_id,
      nodeId: r.node_id,
      nodeType: r.node_type,
      status: r.status,
      outputContent: r.output_content,
      outputSummary: r.output_summary_json,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    })),
    graphState: graphState ? sanitizeGraphState(graphState) : null,
    masteryBefore: session.mastery_before,
    masteryCurrent: session.mastery_current,
    consecutiveCorrect: session.consecutive_correct,
    consecutiveWrong: session.consecutive_wrong,
    totalCorrect: session.total_correct,
    totalWrong: session.total_wrong,
  };
}

// ---------------------------------------------------------------------------
// 上传文件到学习运行
// ---------------------------------------------------------------------------

async function uploadRunFiles(sessionId, userId, files) {
  const session = await prisma.learningSession.findUnique({
    where: { session_id: Number(sessionId) },
  });

  if (!session) throw createAgentError('SESSION_NOT_FOUND', '学习会话不存在', 404);
  if (session.student_user_id !== Number(userId)) {
    throw createAgentError('SESSION_ACCESS_DENIED', '无权访问', 403);
  }

  // 文件引用持久化到 node_run 的 input_summary_json
  const currentNodeRun = await prisma.learningSessionNodeRun.findFirst({
    where: { session_id: Number(sessionId), status: { in: ['RUNNING', 'PENDING'] } },
    orderBy: { sequence_index: 'desc' },
  });

  const fileRefs = files.map((f) => ({
    fileUrl: `/uploads/learning/${f.filename}`,
    mimeType: f.mimetype,
    fileName: f.originalname,
    fileSize: f.size,
    uploadedAt: new Date().toISOString(),
  }));

  if (currentNodeRun) {
    const existingInput = currentNodeRun.input_summary_json || {};
    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: currentNodeRun.node_run_id },
      data: {
        input_summary_json: {
          ...existingInput,
          uploadedFiles: [...(existingInput.uploadedFiles || []), ...fileRefs],
        },
      },
    });
  }

  return fileRefs;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function sanitizeGraphState(state) {
  if (!state) return null;
  // 移除大型数据和隐私信息
  const safe = { ...state };
  delete safe.latestStudentInput;
  delete safe.uploadedFileRefs;
  delete safe.agentOutputRef;
  delete safe.imageAnalysisSummary;
  return safe;
}

async function persistNodeResult(sessionId, userId, graphResult) {
  if (!graphResult?.currentNode) return;

  const nodeRun = await prisma.learningSessionNodeRun.findFirst({
    where: {
      session_id: Number(sessionId),
      node_id: String(graphResult.currentNode.id),
      status: { in: ['RUNNING', 'PENDING', 'COMPLETED'] },
    },
    orderBy: { sequence_index: 'desc' },
  });

  const agentOutput = graphResult.agentOutputRef?.normalizedOutput;
  const outputContent = agentOutput
    ? JSON.stringify(agentOutput).slice(0, 65535)
    : null;

  if (nodeRun && outputContent) {
    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: nodeRun.node_run_id },
      data: {
        output_content: outputContent,
        output_summary_json: {
          agentType: graphResult.currentNode.type,
          knowledgeBased: graphResult.knowledgeBaseAvailable !== false,
          isDegraded: graphResult.isDegraded,
          retrievalCount: (graphResult.retrievalRefs || []).length,
          multimodalTasks: graphResult.multimodalTaskCount || 0,
        },
        status: graphResult.status === 'waiting_student' ? 'RUNNING' : 'COMPLETED',
        completed_at: graphResult.status === 'completed' ? new Date() : null,
      },
    });
  }
}

function buildRunResponse(sessionId, userId, graphResult) {
  const { currentNode, status, nodeIterationCount, trainingQuestionCount,
    remediationRound, diagnosisSummary, isDegraded, agentOutputRef } = graphResult;

  return {
    sessionId,
    status: status === 'waiting_student' ? 'RUNNING' : status,
    currentNode: currentNode ? {
      id: currentNode.id,
      type: currentNode.type,
      title: currentNode.title,
    } : null,
    requiresStudentInput: status === 'waiting_student',
    agentOutput: agentOutputRef?.normalizedOutput || null,
    progress: {
      nodeIterationCount,
      trainingQuestionCount,
      remediationRound,
    },
    diagnosis: diagnosisSummary || null,
    isDegraded: isDegraded || false,
  };
}

module.exports = {
  createRun,
  resumeRun,
  skipCurrentNode,
  getRun,
  uploadRunFiles,
  buildInitialState,
};
