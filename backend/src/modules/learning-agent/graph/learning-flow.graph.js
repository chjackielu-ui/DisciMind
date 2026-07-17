/**
 * LangGraph learning-flow runtime.
 *
 * One checkpoint thread owns progression for one LearningSession. MySQL stores
 * durable business snapshots; callers never increment node indexes themselves.
 */
const fs = require('fs');
const path = require('path');
const { StateGraph, START, END, interrupt, Command } = require('@langchain/langgraph');
const prisma = require('../../../config/prisma');
const { LearningFlowState, getStateConstraints } = require('./learning-flow.state');
const {
  requiresStudentInteraction,
  getAgentForNode,
  getDefaultStrategy,
  getKnowledgeIntent,
  getInteractionType,
  agentOutputRequiresInteraction,
} = require('./node-dispatcher');
const { initCheckpointer } = require('./checkpointer.service');
const { buildRetrievalRequest } = require('../services/knowledge-router.service');
const { getNextNodeIds } = require('../../learning-workflow/workflow-schema');
const { normalizeWorkflowNodeType } = require('../../learning-workflow/workflow-node-type');
const {
  inferContentType,
  normalizeQuestions,
  questionId,
} = require('../../learning-workflow/execution-protocol');

const CHECKPOINT_PROTOCOL_VERSION = 2;
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const STRATEGY_MAP = Object.freeze({
  direct_instruction: 'direct',
  analogy_bridge: 'analogy',
  socratic_dialogue: 'socratic',
  misconception_confrontation: 'misconception_repair',
  auto: 'direct',
});
const TRAINER_MODE_MAP = Object.freeze({
  adaptive_training: 'adaptive_practice',
  basic_practice: 'basic_practice',
  adaptive_practice: 'adaptive_practice',
  diagnostic_pre_test: 'diagnostic_pre_test',
  deep_evaluation: 'deep_evaluation',
  variant_question: 'variant_question',
});

let compiledGraph = null;
let explainerAgent = null;
let trainerAgent = null;
let diagnosticianAgent = null;

function getExplainerAgent() {
  if (!explainerAgent) explainerAgent = require('../agents/explainer.agent');
  return explainerAgent;
}
function getTrainerAgent() {
  if (!trainerAgent) trainerAgent = require('../agents/trainer.agent');
  return trainerAgent;
}
function getDiagnosticianAgent() {
  if (!diagnosticianAgent) diagnosticianAgent = require('../agents/diagnostician.agent');
  return diagnosticianAgent;
}

function safeError(err, fallbackCode = 'AGENT_EXECUTION_FAILED') {
  const code = String(err?.code || fallbackCode).slice(0, 100);
  let message = String(err?.message || '学习内容生成失败');
  if (/Cannot find module|Require stack|MODULE_NOT_FOUND|[A-Z]:\\|\/Users\//i.test(message)) {
    message = '学习内容暂时生成失败，请重新尝试或跳过当前节点。';
  }
  return { code, message: message.slice(0, 500) };
}

// 上下文字符数上限（按 Agent 类型配置）
const CONTEXT_CHAR_LIMITS = Object.freeze({
  explainer: 10000,
  trainer: 8000,
  diagnostician: 10000,
  default: 8000,
});

function buildRetrievalContext(records, agentType = 'default') {
  if (!Array.isArray(records) || !records.length) return null;
  const maxChars = CONTEXT_CHAR_LIMITS[agentType] || CONTEXT_CHAR_LIMITS.default;
  const parts = [];
  let charCount = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const header = `[${i + 1}] (${record.documentName || '未知文档'}, ${Number(record.score || 0).toFixed(2)})\n`;
    const body = record.content || '';
    const full = header + body;
    if (charCount + full.length <= maxChars) {
      parts.push(full);
      charCount += full.length;
    } else if (charCount < maxChars) {
      const remaining = maxChars - charCount - header.length;
      if (remaining > 50) {
        parts.push(header + body.slice(0, remaining) + '...[截断]');
      }
      break;
    } else {
      break;
    }
  }
  return parts.join('\n\n') || null;
}

const performanceTraces = new Map();

function performanceTraceKey(state) {
  return `${state?.runId || 'unknown'}:${state?.currentNodeRunId || state?.currentNode?.id || 'unknown'}`;
}

function initPerformanceTrace(state) {
  const trace = {
    totalMs: 0,
    graphInitMs: 0,
    loadNodeMs: 0,
    knowledgeRouteMs: 0,
    knowledgeRetrieveMs: 0,
    knowledgeNormalizeMs: 0,
    multimodalPrepareMs: 0,
    modelQueueMs: 0,
    modelFirstTokenMs: 0,
    modelTotalMs: 0,
    structuredParseMs: 0,
    structuredRepairMs: 0,
    persistMs: 0,
    checkpointMs: 0,
    retrievalDatasetCount: 0,
    retrievedChunkCount: 0,
    retrievalContextChars: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    reasoningTokenCount: 0,
    modelAttemptCount: 0,
    repairAttemptCount: 0,
    startTime: process.hrtime.bigint(),
  };
  performanceTraces.set(performanceTraceKey(state), trace);
  return trace;
}

function getPerformanceTrace(state) {
  return performanceTraces.get(performanceTraceKey(state)) || initPerformanceTrace(state);
}

function markPhase(state, phase) {
  const performanceTrace = getPerformanceTrace(state);
  const now = process.hrtime.bigint();
  const elapsed = Number(now - performanceTrace.startTime) / 1e6;
  if (performanceTrace[phase] === 0) {
    performanceTrace[phase] = Math.round(elapsed * 100) / 100;
  }
}

function finalizePerformanceTrace(state, nodeRunId, sessionId, nodeType, agentType) {
  const key = performanceTraceKey(state);
  const performanceTrace = performanceTraces.get(key);
  if (!performanceTrace) return null;
  const now = process.hrtime.bigint();
  performanceTrace.totalMs = Math.round(Number(now - performanceTrace.startTime) / 1e6 * 100) / 100;
  const summary = {
    totalMs: performanceTrace.totalMs,
    knowledgeRetrieveMs: performanceTrace.knowledgeRetrieveMs,
    modelTotalMs: performanceTrace.modelTotalMs,
    modelFirstTokenMs: performanceTrace.modelFirstTokenMs,
    structuredParseMs: performanceTrace.structuredParseMs,
    structuredRepairMs: performanceTrace.structuredRepairMs,
    persistMs: performanceTrace.persistMs,
    retrievalDatasetCount: performanceTrace.retrievalDatasetCount,
    retrievedChunkCount: performanceTrace.retrievedChunkCount,
    retrievalContextChars: performanceTrace.retrievalContextChars,
    inputTokenCount: performanceTrace.inputTokenCount,
    outputTokenCount: performanceTrace.outputTokenCount,
    reasoningTokenCount: performanceTrace.reasoningTokenCount,
    modelAttemptCount: performanceTrace.modelAttemptCount,
    repairAttemptCount: performanceTrace.repairAttemptCount,
    nodeRunId,
    sessionId,
    nodeType,
    agentType,
  };
  console.log(JSON.stringify({
    event: 'learning_agent_performance',
    ...summary,
  }));
  performanceTraces.delete(key);
  return summary;
}

function findCurrentRun(session) {
  if (!session) return null;
  if (session.current_node_run_id) {
    const exact = (session.node_runs || []).find((run) => Number(run.node_run_id) === Number(session.current_node_run_id));
    if (exact) return exact;
  }
  return (session.node_runs || [])
    .filter((run) => String(run.node_id) === String(session.current_node_id))
    .sort((a, b) => Number(b.node_run_id) - Number(a.node_run_id))[0] || null;
}

function nodeAt(state) {
  return (state.nodeList || [])[Number(state.currentNodeIndex || 0)] || null;
}

function outputQuestions(state) {
  return normalizeQuestions(state.agentOutputRef?.normalizedOutput || state.agentOutputRef || {});
}

async function initSessionNode(state) {
  return {
    ...state,
    protocolVersion: CHECKPOINT_PROTOCOL_VERSION,
    threadId: state.threadId || String(state.runId),
    status: 'running',
    latestAction: null,
    errorCode: null,
    errorMessage: null,
  };
}

async function loadCurrentNode(state) {
  const currentNode = nodeAt(state);
  if (!currentNode) return { ...state, currentNode: null, status: 'completed' };
  return {
    ...state,
    currentNode,
    agentType: getAgentForNode(currentNode.type),
    latestAction: null,
    latestStudentInput: state.latestStudentInput || null,
    latestEvaluation: null,
    answerHistory: [],
    currentQuestionIndex: 0,
    currentQuestionId: null,
    currentQuestionRef: null,
    agentOutputRef: null,
    nodeResultSummary: null,
    retrievalRefs: [],
    imageAnalysisSummary: null,
    status: 'running',
  };
}

async function matchKnowledgeBase(state) {
  if (!state.currentNode) return state;
  const performanceTrace = getPerformanceTrace(state);
  const startTime = process.hrtime.bigint();
  try {
    const result = await buildRetrievalRequest({
      courseId: state.courseId,
      knowledgePointId: state.knowledgePointId,
      nodeType: state.currentNode.type,
      intent: getKnowledgeIntent(state.currentNode.type),
      query: state.latestStudentInput || state.currentNode.title || '',
      knowledgePointName: state.currentNode.config?.knowledgePointName || '',
      topK: 3,
    });
    const elapsedMs = Math.round(Number(process.hrtime.bigint() - startTime) / 1e6 * 100) / 100;
    performanceTrace.knowledgeRetrieveMs = elapsedMs;
    performanceTrace.retrievalDatasetCount = (result.datasetsUsed || []).length;
    performanceTrace.retrievedChunkCount = (result.records || []).length;
    // 记录每库耗时
    if (result.perDatasetTiming?.length) {
      console.log(JSON.stringify({
        event: 'learning_knowledge_per_dataset',
        sessionId: Number(state.runId),
        timing: result.perDatasetTiming,
      }));
    }
    return {
      ...state,
      retrievalRefs: result.records || [],
      knowledgeBaseAvailable: result.available !== false,
      isDegraded: result.degraded === true,
    };
  } catch (err) {
    const elapsedMs = Math.round(Number(process.hrtime.bigint() - startTime) / 1e6 * 100) / 100;
    performanceTrace.knowledgeRetrieveMs = elapsedMs;
    console.warn(`[LangGraph] knowledge retrieval degraded code=${err?.code || 'UNKNOWN'} elapsed=${elapsedMs}ms`);
    return { ...state, retrievalRefs: [], knowledgeBaseAvailable: false, isDegraded: true };
  }
}

function fileRefToDataUrl(fileRef) {
  const url = String(fileRef?.fileUrl || '');
  if (url.startsWith('data:image/')) return url;
  if (!url.startsWith('/uploads/')) return url;
  const relative = url.replace(/^\/uploads\//, '').replace(/\//g, path.sep);
  const absolute = path.resolve(PROJECT_ROOT, 'storage', 'uploads', relative);
  const uploadsRoot = path.resolve(PROJECT_ROOT, 'storage', 'uploads');
  if (!absolute.startsWith(uploadsRoot + path.sep) || !fs.existsSync(absolute)) return null;
  const mime = fileRef.mimeType || 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`;
}

async function analyzeUploadedImages(fileRefs) {
  const images = (fileRefs || []).filter((file) => String(file.mimeType || '').startsWith('image/'));
  if (!images.length) return null;
  const content = images.map(fileRefToDataUrl).filter(Boolean).map((url) => ({
    type: 'image_url', image_url: { url },
  }));
  if (!content.length) return null;
  const { bailianModelCall } = require('../adapters/bailian-model.adapter');
  const response = await bailianModelCall([{
    role: 'user',
    content: [
      { type: 'text', text: '识别图片中的题目、公式、解题步骤和知识点，只返回用于后续教学的简短分析。' },
      ...content,
    ],
  }], { enableThinking: false, maxTokens: 512, temperature: 0.2 });
  return response.content;
}

async function processMultimodalInput(state) {
  if (!state.uploadedFileRefs?.length) return state;
  try {
    const summary = await analyzeUploadedImages(state.uploadedFileRefs);
    return summary ? {
      ...state,
      imageAnalysisSummary: summary,
      multimodalTaskCount: (state.multimodalTaskCount || 0) + 1,
    } : state;
  } catch (err) {
    console.warn(`[LangGraph] multimodal analysis degraded code=${err?.code || 'UNKNOWN'}`);
    return { ...state, imageAnalysisSummary: null, isDegraded: true };
  }
}

async function loadPriorAnswers(runId) {
  const runs = await prisma.learningSessionNodeRun.findMany({
    where: { session_id: Number(runId) },
    orderBy: { sequence_index: 'asc' },
    select: { output_summary_json: true },
  });
  return runs.flatMap((run) => {
    const answers = run.output_summary_json?.answers;
    return Array.isArray(answers) ? answers : [];
  });
}

async function callAgent(state) {
  const node = state.currentNode;
  if (!node) return state;
  const agentType = getAgentForNode(node.type);
  if (!agentType || agentType === 'gate') {
    const session = await prisma.learningSession.findUnique({
      where: { session_id: Number(state.runId) },
      select: {
        mastery_current: true,
        target_mastery: true,
        total_correct: true,
        total_wrong: true,
        consecutive_correct: true,
        consecutive_wrong: true,
      },
    });
    const mastery = Math.round(Number(session?.mastery_current || 0));
    const targetMastery = Math.round(Number(session?.target_mastery || node.config?.targetMastery || 80));
    const correct = Number(session?.total_correct || 0);
    const wrong = Number(session?.total_wrong || 0);
    const answered = correct + wrong;
    const accuracy = answered ? Math.round((correct / answered) * 100) : null;
    const passed = mastery >= targetMastery;
    const decisions = passed
      ? [{ action: 'continue', reason: `当前掌握度 ${mastery}% 已达到目标 ${targetMastery}%`, priority: 80 }]
      : [{ action: 'remediate', reason: `当前掌握度 ${mastery}% 尚未达到目标 ${targetMastery}%`, priority: 80 }];
    return {
      ...state,
      agentType: 'diagnostician',
      agentOutputRef: {
        normalizedOutput: {
          mode: 'diagnostic_decision',
          overall_assessment: passed
            ? `当前掌握度为 ${mastery}%，已达到 ${targetMastery}% 的学习目标，可以进入总结。`
            : `当前掌握度为 ${mastery}%，距离 ${targetMastery}% 的学习目标还差 ${targetMastery - mastery} 个百分点，建议先完成针对性复盘。`,
          mastery_estimate: mastery,
          target_mastery: targetMastery,
          passed,
          accuracy,
          answered_count: answered,
          correct_count: correct,
          wrong_count: wrong,
          consecutive_correct: Number(session?.consecutive_correct || 0),
          consecutive_wrong: Number(session?.consecutive_wrong || 0),
          decisions,
          recommended_next_step: passed ? '进入学习总结' : '进入关键概念复盘',
        },
      },
    };
  }

  const performanceTrace = getPerformanceTrace(state);
  const retrievalContext = buildRetrievalContext(state.retrievalRefs, agentType);
  markPhase(state, 'knowledgeNormalizeMs');
  if (state.retrievalRefs?.length) {
    performanceTrace.retrievedChunkCount = (state.retrievalRefs || []).length;
    performanceTrace.retrievalContextChars = retrievalContext ? retrievalContext.length : 0;
  }

  const studentContext = {
    masteryScore: state.diagnosisSummary?.mastery_estimate,
    consecutiveCorrect: state.diagnosisSummary?.consecutiveCorrect || 0,
    consecutiveWrong: state.diagnosisSummary?.consecutiveWrong || 0,
    totalCorrect: state.diagnosisSummary?.totalCorrect || 0,
    totalWrong: state.diagnosisSummary?.totalWrong || 0,
  };

  try {
    let result;
    if (agentType === 'explainer') {
      const rawStrategy = node.config?.strategy || getDefaultStrategy(node.type) || 'direct';
      performanceTrace.modelAttemptCount = 1;
      markPhase(state, 'modelQueueMs');
      result = await getExplainerAgent().runExplainer({
        strategy: STRATEGY_MAP[rawStrategy] || rawStrategy,
        query: state.latestStudentInput || node.title || '请讲解当前知识点',
        knowledgePointName: node.config?.knowledgePointName || '',
        retrievalContext,
        imageAnalysisSummary: state.imageAnalysisSummary,
        studentContext,
        retrievalRefs: state.retrievalRefs,
      });
      markPhase(state, 'modelTotalMs');
      if (result?.modelTiming) {
        performanceTrace.modelTotalMs = result.modelTiming.totalMs || performanceTrace.modelTotalMs;
        performanceTrace.modelFirstTokenMs = result.modelTiming.firstTokenMs || 0;
        performanceTrace.inputTokenCount = result.modelTiming.inputTokens || 0;
        performanceTrace.outputTokenCount = result.modelTiming.outputTokens || 0;
        performanceTrace.reasoningTokenCount = result.modelTiming.reasoningTokens || 0;
      }
      if (result?.repairTiming) {
        performanceTrace.repairAttemptCount = 1;
        performanceTrace.structuredRepairMs = result.repairTiming.totalMs || 0;
      }
    } else if (agentType === 'trainer') {
      const isTimedTest = /限时|检测/.test(node.title || '');
      const rawMode = node.config?.mode || (isTimedTest ? 'deep_evaluation' : getDefaultStrategy(node.type)) || node.type;
      const requestedQuestionCount = Math.max(1, Math.min(6, Number(
        node.config?.questionCount
        || node.config?.targetQuestionCount
        || node.config?.maxQuestionCount
        || (['diagnostic_pre_test', 'deep_evaluation'].includes(TRAINER_MODE_MAP[rawMode] || rawMode) ? 1 : 3),
      )));
      performanceTrace.modelAttemptCount = 1;
      markPhase(state, 'modelQueueMs');
      result = await getTrainerAgent().runTrainer({
        mode: TRAINER_MODE_MAP[rawMode] || rawMode,
        query: node.title || '',
        knowledgePointName: node.config?.knowledgePointName || '',
        retrievalContext,
        studentContext,
        previousPerformance: { answers: await loadPriorAnswers(state.runId) },
        maxQuestions: requestedQuestionCount,
        retrievalRefs: state.retrievalRefs,
      });
      markPhase(state, 'modelTotalMs');
      if (result?.modelTiming) {
        performanceTrace.modelTotalMs = result.modelTiming.totalMs || performanceTrace.modelTotalMs;
        performanceTrace.modelFirstTokenMs = result.modelTiming.firstTokenMs || 0;
        performanceTrace.inputTokenCount = result.modelTiming.inputTokens || 0;
        performanceTrace.outputTokenCount = result.modelTiming.outputTokens || 0;
        performanceTrace.reasoningTokenCount = result.modelTiming.reasoningTokens || 0;
      }
      if (result?.repairTiming) {
        performanceTrace.repairAttemptCount = 1;
        performanceTrace.structuredRepairMs = result.repairTiming.totalMs || 0;
      }
    } else {
      const mode = getDefaultStrategy(node.type) || 'diagnostic_decision';
      const priorAnswers = await loadPriorAnswers(state.runId);
      performanceTrace.modelAttemptCount = 1;
      markPhase(state, 'modelQueueMs');
      result = await getDiagnosticianAgent().runDiagnostician({
        mode,
        studentContext,
        sessionContext: {
          currentNodeType: node.type,
          nodeIterationCount: state.nodeIterationCount,
          trainingQuestionCount: state.trainingQuestionCount,
          remediationRound: state.remediationRound,
        },
        recentAnswers: priorAnswers.map((answer) => ({
          questionSummary: answer.questionStem || answer.questionId,
          isCorrect: answer.isCorrect,
          errorType: answer.errorType,
          duration: answer.timeSpentSeconds || 0,
        })),
        knowledgeBaseContext: retrievalContext,
        retrievalRefs: state.retrievalRefs,
      });
      markPhase(state, 'modelTotalMs');
      if (result?.modelTiming) {
        performanceTrace.modelTotalMs = result.modelTiming.totalMs || performanceTrace.modelTotalMs;
        performanceTrace.modelFirstTokenMs = result.modelTiming.firstTokenMs || 0;
        performanceTrace.inputTokenCount = result.modelTiming.inputTokens || 0;
        performanceTrace.outputTokenCount = result.modelTiming.outputTokens || 0;
        performanceTrace.reasoningTokenCount = result.modelTiming.reasoningTokens || 0;
      }
    }

    const output = result?.normalizedOutput;
    const questions = normalizeQuestions(output);
    if (!output || output.is_fallback || (agentType === 'trainer' && !questions.length && !output.question)) {
      const error = new Error(result?.validationError || output?.error || 'Agent 返回内容格式无法用于当前节点');
      error.code = output?.error ? 'AGENT_MODEL_FAILED' : 'AGENT_OUTPUT_INVALID';
      throw error;
    }
    return {
      ...state,
      agentType,
      agentOutputRef: result,
      nodeIterationCount: (state.nodeIterationCount || 0) + 1,
      trainingQuestionCount: agentType === 'trainer'
        ? (questions.length || (output.question ? 1 : 0))
        : state.trainingQuestionCount,
      status: 'running',
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    const safe = safeError(err);
    console.error(`[LangGraph] agent failed session=${state.runId} node=${node.id} code=${safe.code}`);
    return {
      ...state,
      agentType,
      agentOutputRef: null,
      status: 'failed',
      errorCode: safe.code,
      errorMessage: safe.message,
    };
  }
}

async function persistGeneratedOutput(state) {
  const node = state.currentNode;
  if (!node || !state.currentNodeRunId) return state;
  const now = new Date();
  const runId = Number(state.currentNodeRunId);

  if (state.status === 'failed') {
    const failedPerformance = finalizePerformanceTrace(
      state,
      state.currentNodeRunId,
      state.runId,
      state.currentNode?.type,
      state.agentType,
    );
    await prisma.learningSessionNodeRun.updateMany({
      where: { node_run_id: runId, session_id: Number(state.runId), status: { in: ['PENDING', 'RUNNING'] } },
      data: {
        status: 'FAILED', ended_at: now,
        error_code: state.errorCode || 'AGENT_EXECUTION_FAILED',
        error_message: state.errorMessage || '学习内容暂时生成失败',
        output_summary_json: failedPerformance ? { performance: failedPerformance } : undefined,
      },
    });
    await prisma.learningSessionEvent.create({
      data: { session_id: Number(state.runId), event_type: 'NODE_FAILED', node_id: node.id, title: '节点执行失败', data_json: { code: state.errorCode || 'AGENT_EXECUTION_FAILED', nodeRunId: runId } },
    }).catch(() => null);
    return state;
  }

  const data = state.agentOutputRef.normalizedOutput;
  const contentType = inferContentType(state.agentType, node.type, data);
  const interactive = agentOutputRequiresInteraction(node.type, data);
  const existingRun = await prisma.learningSessionNodeRun.findUnique({
    where: { node_run_id: runId },
    select: { started_at: true },
  });
  const generationElapsedMs = existingRun?.started_at
    ? Math.max(0, now.getTime() - existingRun.started_at.getTime())
    : null;
  const stored = {
    protocolVersion: CHECKPOINT_PROTOCOL_VERSION,
    agentType: state.agentType,
    contentType,
    data,
    answers: [],
    sources: state.retrievalRefs || [],
    knowledgeBased: state.knowledgeBaseAvailable !== false,
    isDegraded: state.isDegraded === true,
    generatedAt: now.toISOString(),
    generationElapsedMs,
    performance: finalizePerformanceTrace(
      state,
      state.currentNodeRunId,
      state.runId,
      state.currentNode?.type,
      state.agentType,
    ),
  };
  const updated = await prisma.learningSessionNodeRun.updateMany({
    where: {
      node_run_id: runId,
      session_id: Number(state.runId),
      node_id: String(node.id),
      status: { in: ['PENDING', 'RUNNING'] },
    },
    data: {
      status: interactive ? 'RUNNING' : 'COMPLETED',
      agent_type: String(state.agentType || 'explainer').toUpperCase(),
      output_summary_json: stored,
      output_content: JSON.stringify(data),
      completed_at: interactive ? null : now,
      ended_at: interactive ? null : now,
      error_code: null,
      error_message: null,
    },
  });
  if (!updated.count) {
    return { ...state, status: 'failed', errorCode: 'STALE_GRAPH_EXECUTION', errorMessage: '节点已切换，旧执行结果已丢弃' };
  }
  if (!interactive) {
    await prisma.learningSessionEvent.create({
      data: { session_id: Number(state.runId), event_type: 'NODE_COMPLETED', node_id: node.id, title: `节点完成: ${node.title || node.type}`, data_json: { nodeRunId: runId } },
    }).catch(() => null);
  }
  const questions = normalizeQuestions(data);
  return {
    ...state,
    answerHistory: [],
    currentQuestionIndex: 0,
    currentQuestionId: questions[0] ? questionId(questions[0], 0) : null,
    currentQuestionRef: questions[0] || null,
    nodeResultSummary: { persisted: true, contentType },
    status: interactive ? 'waiting_student' : 'completed_node',
  };
}

function routeAfterPersist(state) {
  if (state.status === 'failed') return 'waitForFailure';
  // 优先检查 Agent 输出中是否标记了需要交互
  const output = state.agentOutputRef?.normalizedOutput || state.agentOutputRef;
  if (agentOutputRequiresInteraction(state.currentNode?.type, output)) return 'waitForStudent';
  if (requiresStudentInteraction(state.currentNode?.type)) return 'waitForStudent';
  return 'waitForContinue';
}

async function waitForStudent(state) {
  const questions = outputQuestions(state);
  const question = questions[state.currentQuestionIndex || 0] || null;
  const nodeType = state.currentNode?.type;
  const agentOutput = state.agentOutputRef?.normalizedOutput || state.agentOutputRef;
  const activeQuestionId = question ? questionId(question, state.currentQuestionIndex) : null;
  const interactionInfo = getInteractionType(nodeType, agentOutput, activeQuestionId);
  const action = interrupt({
    type: 'wait_student',
    nodeId: state.currentNode?.id,
    nodeRunId: state.currentNodeRunId,
    questionId: activeQuestionId,
    interactionType: interactionInfo.type,
    allowImages: true,
    allowText: interactionInfo.type === 'free_text'
      || interactionInfo.type === 'short_answer'
      || interactionInfo.type === 'fill_blank',
    placeholder: interactionInfo.type === 'free_text' ? '请输入你的思考或答案……'
      : interactionInfo.type === 'short_answer' ? '请输入你的答案……'
      : interactionInfo.type === 'fill_blank' ? '请填入缺失的内容……'
      : '请选择一个选项',
    options: interactionInfo.type === 'single_choice'
      || interactionInfo.type === 'multiple_choice'
      || interactionInfo.type === 'true_false'
      ? (() => {
          const q = questions[0] || question;
          const opts = q?.options || [];
          if (!opts.length && interactionInfo.type === 'true_false') {
            return [{ key: 'true', content: '正确' }, { key: 'false', content: '错误' }];
          }
          return opts.map((option) => ({
            key: String(option.key || option.option_key || ''),
            content: option.content || option.text || option.option_content || '',
          }));
        })()
      : undefined,
  });
  return { ...state, latestAction: action, status: 'evaluating' };
}

function normalizedComparable(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).sort().join('|');
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function evaluateQuestion(question, answer, imageAnalysisSummary) {
  const correctAnswer = question.correct_answer ?? question.correctAnswer ?? '';
  const type = question.question_type || question.questionType || question.type || 'short_answer';
  let evaluation;
  if (type !== 'short_answer' && correctAnswer !== '') {
    const isCorrect = normalizedComparable(answer) === normalizedComparable(correctAnswer);
    evaluation = {
      is_correct: isCorrect,
      score: isCorrect ? 100 : 0,
      feedback: isCorrect ? '回答正确' : '回答错误，请结合解析复盘。',
      error_type: isCorrect ? null : 'unknown',
    };
  } else {
    const evaluated = await getTrainerAgent().evaluateAnswer({
      question: question.stem || question.content || '',
      studentAnswer: imageAnalysisSummary ? `${answer}\n图片分析参考：${imageAnalysisSummary}` : answer,
      correctAnswer: correctAnswer || (question.expected_answer_elements || []).join('；'),
      analysis: question.analysis || '',
    });
    evaluation = evaluated.normalizedOutput;
  }
  return {
    isCorrect: typeof evaluation?.is_correct === 'boolean' ? evaluation.is_correct : null,
    score: evaluation?.score != null && Number.isFinite(Number(evaluation.score)) ? Number(evaluation.score) : null,
    feedback: evaluation?.feedback || '',
    errorType: evaluation?.error_type || null,
    errorAnalysis: evaluation?.error_analysis || '',
    remediationHint: evaluation?.remediation_hint || '',
    correctAnswer,
    analysis: question.analysis || evaluation?.feedback || '',
  };
}

async function persistAnswer(state, record, isLast) {
  await prisma.$transaction(async (tx) => {
    const run = await tx.learningSessionNodeRun.findUnique({ where: { node_run_id: Number(state.currentNodeRunId) } });
    if (!run || run.session_id !== Number(state.runId) || run.status !== 'RUNNING') {
      const error = new Error('当前题目已切换');
      error.code = 'STALE_NODE_EXECUTION';
      throw error;
    }
    const output = run.output_summary_json && typeof run.output_summary_json === 'object' ? run.output_summary_json : {};
    const answers = [...(Array.isArray(output.answers) ? output.answers : []), record];
    await tx.learningSessionNodeRun.update({
      where: { node_run_id: run.node_run_id },
      data: {
        output_summary_json: { ...output, answers },
        status: isLast ? 'COMPLETED' : 'RUNNING',
        completed_at: isLast ? new Date() : null,
        ended_at: isLast ? new Date() : null,
      },
    });
    if (typeof record.isCorrect === 'boolean') {
      await tx.learningSession.update({
        where: { session_id: Number(state.runId) },
        data: record.isCorrect ? {
          consecutive_correct: { increment: 1 }, consecutive_wrong: 0, total_correct: { increment: 1 },
        } : {
          consecutive_wrong: { increment: 1 }, consecutive_correct: 0, total_wrong: { increment: 1 },
        },
      });
    }
    if (isLast) {
      await tx.learningSessionEvent.create({
        data: { session_id: Number(state.runId), event_type: 'NODE_COMPLETED', node_id: state.currentNode.id, title: `练习完成: ${state.currentNode.title || state.currentNode.type}`, data_json: { nodeRunId: run.node_run_id } },
      });
    }
  });
}

async function processStudentAction(state) {
  const action = state.latestAction || {};
  if (action.action === 'skip_node') return advanceGraphNode(state, action, true);
  if (action.action !== 'submit_answer') {
    return { ...state, status: 'failed', errorCode: 'INVALID_GRAPH_ACTION', errorMessage: '当前节点需要提交答案或跳过' };
  }
  const questions = outputQuestions(state);
  const index = Number(state.currentQuestionIndex || 0);
  const question = questions[index];
  if (!question) {
    // 非练习节点的自由回答（Explainer 引导问题等）
    // 提取学生文字回答和文件引用
    const studentInput = action.studentInput || {};
    const answer = studentInput.text || studentInput.answer || action.answer || '';
    const fileRefs = Array.isArray(studentInput.fileRefs) ? studentInput.fileRefs : [];
    if (!answer && !fileRefs.length) {
      return { ...state, status: 'failed', errorCode: 'EMPTY_ANSWER', errorMessage: '请输入你的回答或上传图片' };
    }
    let imageSummary = state.imageAnalysisSummary;
    if (fileRefs.length) {
      imageSummary = await analyzeUploadedImages(fileRefs).catch(() => imageSummary);
    }
    // 自由回答也需要一次独立、短输出的模型评价。使用当前引导问题和
    // Explainer 给出的 expected_insight 作为评价依据，默认关闭深度思考。
    const output = state.agentOutputRef?.normalizedOutput || state.agentOutputRef || {};
    const questionStem = output.starting_question || state.currentNode?.title || '引导问题';
    const expectedInsight = output.expected_insight || (output.guidance_hints || []).join('；');
    const answerForEvaluation = answer || (imageSummary ? '学生使用图片作答，请结合图片分析评价。' : '');
    const evaluation = await evaluateQuestion({
      question_type: 'short_answer',
      stem: questionStem,
      correct_answer: expectedInsight,
      analysis: expectedInsight,
    }, answerForEvaluation, imageSummary);
    const record = {
      operationId: action.operationId || null,
      questionId: action.questionId || 'free_response',
      questionStem,
      questionType: 'free_text',
      studentAnswer: answer,
      fileRefs,
      imageSummary: imageSummary || null,
      correctAnswer: '',
      isCorrect: evaluation.isCorrect,
      score: evaluation.score,
      feedback: evaluation.feedback,
      analysis: evaluation.analysis,
      errorType: evaluation.errorType,
      errorAnalysis: evaluation.errorAnalysis,
      remediationHint: evaluation.remediationHint,
      submittedAt: new Date().toISOString(),
      timeSpentSeconds: Number(action.timeSpentSeconds || 0),
    };
    const history = [...(state.answerHistory || []), record];
    await persistAnswer(state, record, true);
    return {
      ...state,
      answerHistory: history,
      latestEvaluation: record,
      latestStudentInput: answer,
      uploadedFileRefs: fileRefs,
      latestAction: null,
      status: 'completed_node',
    };
  }
  const expectedId = questionId(question, index);
  if (action.questionId && String(action.questionId) !== expectedId) {
    return { ...state, status: 'failed', errorCode: 'STALE_QUESTION', errorMessage: '题目已切换，请刷新后继续' };
  }
  let imageSummary = state.imageAnalysisSummary;
  const studentInput = action.studentInput || {};
  const fileRefs = Array.isArray(studentInput.fileRefs) ? studentInput.fileRefs : [];
  if (fileRefs.length) {
    imageSummary = await analyzeUploadedImages(fileRefs).catch(() => imageSummary);
  }
  // 兼容旧格式 action.answer 和新格式 studentInput.text / studentInput.answer
  const answer = studentInput.text || studentInput.answer || studentInput.selectedOptions
    || action.answer || action.selectedOption || '';
  const evaluation = await evaluateQuestion(question, answer, imageSummary);
  const record = {
    operationId: action.operationId || null,
    questionId: expectedId,
    questionStem: String(question.stem || question.content || '').slice(0, 500),
    questionType: question.question_type || question.type || 'short_answer',
    studentAnswer: Array.isArray(answer) ? answer.join(', ') : String(answer),
    correctAnswer: evaluation.correctAnswer,
    isCorrect: evaluation.isCorrect,
    score: evaluation.score,
    feedback: evaluation.feedback,
    analysis: evaluation.analysis,
    errorType: evaluation.errorType,
    errorAnalysis: evaluation.errorAnalysis,
    remediationHint: evaluation.remediationHint,
    fileRefs,
    submittedAt: new Date().toISOString(),
    timeSpentSeconds: Number(action.timeSpentSeconds || 0),
  };
  const history = [...(state.answerHistory || []), record];
  const isLast = index + 1 >= questions.length;
  await persistAnswer(state, record, isLast);
  return {
    ...state,
    answerHistory: history,
    latestEvaluation: record,
    latestStudentInput: answer,
    uploadedFileRefs: fileRefs,
    currentQuestionIndex: isLast ? index : index + 1,
    currentQuestionId: isLast ? null : questionId(questions[index + 1], index + 1),
    currentQuestionRef: isLast ? null : questions[index + 1],
    latestAction: null,
    status: isLast ? 'completed_node' : 'waiting_student',
  };
}

function routeAfterStudentAction(state) {
  if (state.status === 'failed') return 'waitForFailure';
  if (state.status === 'waiting_student') return 'waitForStudent';
  if (state.status === 'ready') return 'waitForExecution';
  if (state.status === 'completed') return END;
  return 'waitForContinue';
}

async function waitForContinue(state) {
  const action = interrupt({
    type: 'wait_continue',
    nodeId: state.currentNode?.id,
    nodeRunId: state.currentNodeRunId,
  });
  return { ...state, latestAction: action };
}

async function processContinuation(state) {
  const action = state.latestAction || {};
  if (!['continue_node', 'skip_node'].includes(action.action)) {
    return { ...state, status: 'failed', errorCode: 'INVALID_GRAPH_ACTION', errorMessage: '当前节点只能继续或跳过' };
  }
  return advanceGraphNode(state, action, action.action === 'skip_node');
}

function resolveNextNodeIds(graph, currentNodeId, nodeList, currentNodeIndex, evaluation) {
  const nextIds = getNextNodeIds(graph, String(currentNodeId), evaluation);
  if (nextIds.length || (graph.edges || []).length) return nextIds;
  const sequential = nodeList[Number(currentNodeIndex || 0) + 1];
  return sequential ? [String(sequential.id)] : [];
}

async function advanceGraphNode(state, action, skipped) {
  const graph = state.workflowGraph || { nodes: state.nodeList, edges: [] };
  const current = state.currentNode;
  const session = await prisma.learningSession.findUnique({ where: { session_id: Number(state.runId) } });
  const total = Number(session?.total_correct || 0) + Number(session?.total_wrong || 0);
  const evaluation = {
    mastery: Number(session?.mastery_current || 0),
    consecutiveWrong: Number(session?.consecutive_wrong || 0),
    consecutiveCorrect: Number(session?.consecutive_correct || 0),
    accuracy: total ? Math.round((Number(session.total_correct || 0) / total) * 100) : 0,
    lastAnswerCorrect: state.answerHistory?.at(-1)?.isCorrect,
  };
  // 仅对完全没有 edges 的历史顺序流做兼容。DAG 中没有出边的节点就是
  // 真正的结束节点，不能再按 nodes 数组顺序回跳，否则会在总结/复盘间循环。
  const nextIds = resolveNextNodeIds(
    graph, current.id, state.nodeList, state.currentNodeIndex, evaluation,
  );
  const nextId = nextIds[0] ? String(nextIds[0]) : null;
  const now = new Date();
  let nextRun = null;

  await prisma.$transaction(async (tx) => {
    const latest = await tx.learningSession.findUnique({ where: { session_id: Number(state.runId) } });
    if (!latest || String(latest.current_node_id) !== String(current.id)) {
      const error = new Error('节点已切换');
      error.code = 'STALE_NODE_EXECUTION';
      throw error;
    }
    if (skipped) {
      const targetRunId = Number(action.nodeRunId || latest.current_node_run_id || state.currentNodeRunId);
      const target = await tx.learningSessionNodeRun.findUnique({ where: { node_run_id: targetRunId } });
      if (target?.status === 'FAILED') {
        const max = await tx.learningSessionNodeRun.aggregate({ where: { session_id: Number(state.runId) }, _max: { sequence_index: true } });
        nextRun = await tx.learningSessionNodeRun.create({
          data: {
            session_id: Number(state.runId), node_id: String(current.id),
            node_type: normalizeWorkflowNodeType(current.type, { nodeId: current.id, sessionId: state.runId }),
            status: 'SKIPPED', sequence_index: Number(max._max.sequence_index || 0) + 1,
            skipped_at: now, ended_at: now, skip_reason: String(action.reason || 'user_skipped').slice(0, 500),
            operation_id: action.operationId ? String(action.operationId).slice(0, 128) : null,
          },
        });
      } else {
        await tx.learningSessionNodeRun.updateMany({
          where: { node_run_id: targetRunId, status: { in: ['PENDING', 'RUNNING'] } },
          data: {
            status: 'SKIPPED', skipped_at: now, ended_at: now,
            skip_reason: String(action.reason || 'user_skipped').slice(0, 500),
            operation_id: action.operationId ? String(action.operationId).slice(0, 128) : undefined,
          },
        });
      }
      await tx.learningSessionEvent.create({
        data: { session_id: Number(state.runId), event_type: 'NODE_SKIPPED', node_id: current.id, title: `节点已跳过: ${current.title || current.type}`, data_json: { operationId: action.operationId || null } },
      });
    } else {
      const run = await tx.learningSessionNodeRun.findUnique({ where: { node_run_id: Number(latest.current_node_run_id) } });
      if (!run || !['COMPLETED', 'SKIPPED'].includes(run.status)) {
        const error = new Error('当前节点尚未完成');
        error.code = 'NODE_NOT_COMPLETED';
        throw error;
      }
    }

    if (!nextId) {
      await tx.learningSession.update({
        where: { session_id: Number(state.runId) },
        data: { status: 'COMPLETED', completed_at: now, current_node_id: null, current_node_run_id: null },
      });
      await tx.learningSessionEvent.create({
        data: { session_id: Number(state.runId), event_type: 'SESSION_COMPLETED', node_id: current.id, title: '学习流已完成' },
      });
      return;
    }
    const nextNode = state.nodeList.find((node) => String(node.id) === nextId);
    const existing = await tx.learningSessionNodeRun.findFirst({
      where: { session_id: Number(state.runId), node_id: nextId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { node_run_id: 'desc' },
    });
    if (existing) nextRun = existing;
    else {
      const max = await tx.learningSessionNodeRun.aggregate({ where: { session_id: Number(state.runId) }, _max: { sequence_index: true } });
      nextRun = await tx.learningSessionNodeRun.create({
        data: {
          session_id: Number(state.runId), node_id: nextId,
          node_type: normalizeWorkflowNodeType(nextNode.type, { nodeId: nextId, sessionId: state.runId }),
          status: 'PENDING', sequence_index: Number(max._max.sequence_index || 0) + 1,
        },
      });
    }
    await tx.learningSession.update({
      where: { session_id: Number(state.runId) },
      data: { current_node_id: nextId, current_node_run_id: nextRun.node_run_id, execution_version: { increment: 1 } },
    });
  });

  if (!nextId) {
    return {
      ...state, currentNode: null, currentNodeRunId: null, latestAction: null,
      agentOutputRef: null, answerHistory: [], status: 'completed',
    };
  }
  const nextIndex = state.nodeList.findIndex((node) => String(node.id) === nextId);
  return {
    ...state,
    currentNodeIndex: nextIndex,
    currentNode: state.nodeList[nextIndex],
    currentNodeRunId: nextRun.node_run_id,
    latestStudentInput: skipped
      ? null
      : (state.answerHistory?.at(-1)?.studentAnswer || state.latestStudentInput || null),
    uploadedFileRefs: [],
    retrievalRefs: [],
    imageAnalysisSummary: null,
    agentOutputRef: null,
    answerHistory: [],
    currentQuestionIndex: 0,
    latestEvaluation: null,
    latestAction: null,
    status: 'ready',
  };
}

function routeAfterContinuation(state) {
  if (state.status === 'failed') return 'waitForFailure';
  if (state.status === 'completed') return END;
  return 'waitForExecution';
}

async function waitForExecution(state) {
  const action = interrupt({
    type: 'ready_node',
    nodeId: state.currentNode?.id,
    nodeRunId: state.currentNodeRunId,
  });
  return { ...state, latestAction: action };
}

async function processExecutionAction(state) {
  const action = state.latestAction || {};
  if (action.action === 'skip_node') return advanceGraphNode(state, action, true);
  if (action.action !== 'execute_node' || (action.nodeId && String(action.nodeId) !== String(state.currentNode?.id))) {
    return { ...state, status: 'failed', errorCode: 'INVALID_GRAPH_ACTION', errorMessage: '当前节点无法执行' };
  }
  return {
    ...state,
    currentNodeRunId: Number(action.nodeRunId || state.currentNodeRunId),
    uploadedFileRefs: Array.isArray(action.uploadedFileRefs) ? action.uploadedFileRefs : [],
    latestAction: null,
    status: 'running',
  };
}

async function waitForFailure(state) {
  const action = interrupt({
    type: 'node_failed',
    nodeId: state.currentNode?.id,
    nodeRunId: state.currentNodeRunId,
    code: state.errorCode || 'AGENT_EXECUTION_FAILED',
  });
  return { ...state, latestAction: action };
}

async function processFailureAction(state) {
  const action = state.latestAction || {};
  if (action.action === 'skip_node') return advanceGraphNode(state, action, true);
  if (action.action !== 'retry_node') {
    return { ...state, status: 'failed', errorCode: 'INVALID_GRAPH_ACTION', errorMessage: '失败节点只能重试或跳过' };
  }
  return {
    ...state,
    currentNodeRunId: Number(action.nodeRunId),
    retryCount: (state.retryCount || 0) + 1,
    latestAction: null,
    agentOutputRef: null,
    nodeResultSummary: null,
    answerHistory: [],
    currentQuestionIndex: 0,
    latestEvaluation: null,
    errorCode: null,
    errorMessage: null,
    status: 'running',
  };
}

function routeAfterFailureAction(state) {
  if (state.status === 'ready') return 'waitForExecution';
  if (state.status === 'completed') return END;
  if (state.status === 'failed') return 'waitForFailure';
  return 'matchKnowledgeBase';
}

function buildGraph() {
  return new StateGraph(LearningFlowState)
    .addNode('initSession', initSessionNode)
    .addNode('loadCurrentNode', loadCurrentNode)
    .addNode('matchKnowledgeBase', matchKnowledgeBase)
    .addNode('processMultimodalInput', processMultimodalInput)
    .addNode('callAgent', callAgent)
    .addNode('persistGeneratedOutput', persistGeneratedOutput)
    .addNode('waitForStudent', waitForStudent)
    .addNode('processStudentAction', processStudentAction)
    .addNode('waitForContinue', waitForContinue)
    .addNode('processContinuation', processContinuation)
    .addNode('waitForExecution', waitForExecution)
    .addNode('processExecutionAction', processExecutionAction)
    .addNode('waitForFailure', waitForFailure)
    .addNode('processFailureAction', processFailureAction)
    .addEdge(START, 'initSession')
    .addEdge('initSession', 'loadCurrentNode')
    .addEdge('loadCurrentNode', 'matchKnowledgeBase')
    .addEdge('matchKnowledgeBase', 'processMultimodalInput')
    .addEdge('processMultimodalInput', 'callAgent')
    .addEdge('callAgent', 'persistGeneratedOutput')
    .addConditionalEdges('persistGeneratedOutput', routeAfterPersist, {
      waitForStudent: 'waitForStudent', waitForContinue: 'waitForContinue', waitForFailure: 'waitForFailure',
    })
    .addEdge('waitForStudent', 'processStudentAction')
    .addConditionalEdges('processStudentAction', routeAfterStudentAction, {
      waitForStudent: 'waitForStudent', waitForContinue: 'waitForContinue',
      waitForExecution: 'waitForExecution', waitForFailure: 'waitForFailure', [END]: END,
    })
    .addEdge('waitForContinue', 'processContinuation')
    .addConditionalEdges('processContinuation', routeAfterContinuation, {
      waitForExecution: 'waitForExecution', waitForFailure: 'waitForFailure', [END]: END,
    })
    .addEdge('waitForExecution', 'processExecutionAction')
    .addConditionalEdges('processExecutionAction', (state) => {
      if (state.status === 'failed') return 'waitForFailure';
      if (state.status === 'ready') return 'waitForExecution';
      if (state.status === 'completed') return END;
      return 'matchKnowledgeBase';
    }, {
      waitForFailure: 'waitForFailure', waitForExecution: 'waitForExecution',
      matchKnowledgeBase: 'matchKnowledgeBase', [END]: END,
    })
    .addEdge('waitForFailure', 'processFailureAction')
    .addConditionalEdges('processFailureAction', routeAfterFailureAction, {
      waitForExecution: 'waitForExecution', waitForFailure: 'waitForFailure', matchKnowledgeBase: 'matchKnowledgeBase', [END]: END,
    });
}

async function getCompiledGraph() {
  if (compiledGraph) return compiledGraph;
  const checkpointer = await initCheckpointer();
  compiledGraph = buildGraph().compile({ checkpointer });
  return compiledGraph;
}

function resetCompiledGraph() {
  compiledGraph = null;
}

function buildInitialState(session, userId) {
  const workflowGraph = session.runtime_graph_json || {};
  const knowledgePointName = session.knowledge_point?.knowledge_point_name || '';
  const nodeList = (workflowGraph.nodes || []).map((node) => ({
    id: String(node.id), type: node.type, title: node.title || '',
    config: { ...(node.config || {}), knowledgePointName },
  }));
  const currentIndex = Math.max(0, nodeList.findIndex((node) => String(node.id) === String(session.current_node_id)));
  const currentRun = findCurrentRun(session);
  return {
    protocolVersion: CHECKPOINT_PROTOCOL_VERSION,
    runId: String(session.session_id), threadId: String(session.session_id), studentId: Number(userId),
    workflowId: session.workflow_template_id, courseId: session.course_id, knowledgePointId: session.knowledge_point_id,
    currentNodeIndex: currentIndex, currentNode: null, nodeList, workflowGraph,
    currentNodeRunId: currentRun?.node_run_id || session.current_node_run_id || null,
    latestStudentInput: null, latestAction: null,
    uploadedFileRefs: currentRun?.input_summary_json?.uploadedFiles || [],
    answerHistory: currentRun?.output_summary_json?.answers || [], currentQuestionIndex: 0, latestEvaluation: null,
    retrievalRefs: [], currentQuestionId: null, currentQuestionRef: null,
    diagnosisSummary: {
      mastery_estimate: session.mastery_current,
      consecutiveCorrect: session.consecutive_correct, consecutiveWrong: session.consecutive_wrong,
      totalCorrect: session.total_correct, totalWrong: session.total_wrong,
    },
    pendingIntervention: null, retryCount: currentRun?.retry_count || 0,
    nodeIterationCount: 0, trainingQuestionCount: 0, remediationRound: 0,
    status: 'pending', errorMessage: null, errorCode: null,
    imageAnalysisSummary: null, multimodalTaskCount: 0,
    knowledgeBaseAvailable: true, isDegraded: false,
    agentOutputRef: null, agentType: null, nodeResultSummary: null,
  };
}

async function invokeGraph(initialState) {
  const graph = await getCompiledGraph();
  return graph.invoke(initialState, { configurable: { thread_id: String(initialState.threadId) } });
}

async function resumeGraph(threadId, resumeValue) {
  const graph = await getCompiledGraph();
  return graph.invoke(new Command({ resume: resumeValue }), { configurable: { thread_id: String(threadId) } });
}

async function inspectGraph(threadId) {
  const graph = await getCompiledGraph();
  const snapshot = await graph.getState({ configurable: { thread_id: String(threadId) } });
  return snapshot || null;
}

async function rebuildGraphThread(threadId) {
  const checkpointer = await initCheckpointer();
  await checkpointer.deleteThread(String(threadId));
}

async function streamGraph(initialState, callback) {
  const graph = await getCompiledGraph();
  const config = { configurable: { thread_id: String(initialState.threadId) }, streamMode: 'updates' };
  for await (const chunk of await graph.stream(initialState, config)) if (callback) callback(chunk);
}

module.exports = {
  CHECKPOINT_PROTOCOL_VERSION,
  buildGraph,
  getCompiledGraph,
  resetCompiledGraph,
  buildInitialState,
  invokeGraph,
  runLearningFlow: invokeGraph,
  resumeGraph,
  resumeLearningFlow: resumeGraph,
  compileGraph: getCompiledGraph,
  inspectGraph,
  rebuildGraphThread,
  streamGraph,
  buildRetrievalContext,
  initPerformanceTrace,
  finalizePerformanceTrace,
  __test: { safeError, normalizedComparable, evaluateQuestion, fileRefToDataUrl, resolveNextNodeIds },
};
