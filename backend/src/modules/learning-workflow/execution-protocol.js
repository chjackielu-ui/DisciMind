const { normalizeStoredAgentOutput } = require('./agent-result-parser');
const {
  getAgentForNode,
  requiresStudentInteraction,
  getInteractionType,
  agentOutputRequiresInteraction,
  INTERACTION_TYPE_VALUES,
} = require('../learning-agent/graph/node-dispatcher');

const EXECUTION_STATUS = Object.freeze({
  GENERATING: 'GENERATING',
  WAITING_INPUT: 'WAITING_INPUT',
  EVALUATING: 'EVALUATING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

function flattenInterrupts(result, snapshot) {
  const values = [];
  const add = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item) continue;
      const value = item.value !== undefined ? item.value : item;
      values.push({ id: item.id || null, value });
    }
  };
  add(result?.__interrupt__);
  add(snapshot?.interrupts);
  for (const task of snapshot?.tasks || []) add(task?.interrupts);
  const deduped = [];
  const seen = new Set();
  for (const item of values) {
    const key = item.id || JSON.stringify(item.value);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function currentInterrupt(result, snapshot) {
  return flattenInterrupts(result, snapshot)[0]?.value || null;
}

function mapGraphExecution(graphState = {}, result = null, snapshot = null) {
  const interruptValue = currentInterrupt(result, snapshot);
  const interruptType = interruptValue?.type || null;
  let status = EXECUTION_STATUS.GENERATING;
  if (interruptType === 'wait_student') status = EXECUTION_STATUS.WAITING_INPUT;
  else if (interruptType === 'wait_continue') status = EXECUTION_STATUS.COMPLETED;
  else if (interruptType === 'node_failed' || graphState.status === 'failed') status = EXECUTION_STATUS.FAILED;
  else if (graphState.status === 'completed' || !(snapshot?.next || []).length && graphState.status === 'completed') status = EXECUTION_STATUS.COMPLETED;
  else if (graphState.status === 'evaluating') status = EXECUTION_STATUS.EVALUATING;

  const flowCompleted = graphState.status === 'completed' && !graphState.currentNode;
  const nodeCompleted = flowCompleted || graphState.status === 'completed_node' || interruptType === 'wait_continue';
  const requiresStudentInput = status === EXECUTION_STATUS.WAITING_INPUT;
  return {
    status,
    interrupt: interruptValue,
    requiresStudentInput,
    nodeCompleted,
    flowCompleted,
    canRetry: status === EXECUTION_STATUS.FAILED,
    canSkip: !flowCompleted && status !== EXECUTION_STATUS.EVALUATING,
    canContinue: !flowCompleted && nodeCompleted && status !== EXECUTION_STATUS.FAILED,
  };
}

/**
 * 构建标准化的 interaction 对象。
 *
 * 前端只根据 interaction 渲染输入组件，不允许通过 content.data.questions 猜测。
 *
 * @param {object|null} node       - 当前节点（graph node）
 * @param {object|null} agentOutput - normalizedOutput
 * @param {object|null} execution  - mapGraphExecution 返回值
 * @param {object|null} interruptValue - graph interrupt 值
 * @returns {object|null} interaction 对象，不需要时返回 null
 */
function buildInteraction(node, agentOutput, execution, interruptValue) {
  if (!node || !execution) return null;
  if (execution.status !== EXECUTION_STATUS.WAITING_INPUT) return null;

  const nodeType = node.type;
  const { type, requiresInput } = getInteractionType(nodeType, agentOutput, interruptValue?.questionId);
  if (!requiresInput || type === INTERACTION_TYPE_VALUES.NONE) return null;

  const nodeRunId = interruptValue?.nodeRunId || null;
  const questionId = interruptValue?.questionId || null;

  const base = {
    type,
    required: true,
    allowText: type === INTERACTION_TYPE_VALUES.FREE_TEXT
      || type === INTERACTION_TYPE_VALUES.SHORT_ANSWER
      || type === INTERACTION_TYPE_VALUES.FILL_BLANK,
    allowImages: true,
    maxImages: 3,
    placeholder: '',
    submitLabel: '提交回答',
    questionId: questionId || null,
    nodeRunId: nodeRunId || null,
  };

  // 根据交互类型设置占位符和选项
  switch (type) {
    case INTERACTION_TYPE_VALUES.FREE_TEXT:
      base.placeholder = '请输入你的思考或答案……';
      break;
    case INTERACTION_TYPE_VALUES.SHORT_ANSWER:
      base.placeholder = '请输入你的答案……';
      break;
    case INTERACTION_TYPE_VALUES.FILL_BLANK:
      base.placeholder = '请填入缺失的内容……';
      break;
    case INTERACTION_TYPE_VALUES.SINGLE_CHOICE:
    case INTERACTION_TYPE_VALUES.MULTIPLE_CHOICE:
    case INTERACTION_TYPE_VALUES.TRUE_FALSE:
      base.placeholder = '请选择一个选项';
      // 从 agentOutput 中提取选项
      if (agentOutput) {
        const questions = Array.isArray(agentOutput.questions) ? [...agentOutput.questions] : [];
        if (agentOutput.question) questions.push(agentOutput.question);
        const q = (questionId
          ? questions.find((item, index) => questionId === questionIdForInteraction(item, index))
          : null) || questions[0];
        if (q?.options) {
          base.options = q.options.map((option) => ({
            key: String(option.key || option.option_key || ''),
            content: option.content || option.text || option.option_content || '',
          }));
        }
        if (type === INTERACTION_TYPE_VALUES.TRUE_FALSE && !base.options?.length) {
          base.options = [
            { key: 'true', content: '正确' },
            { key: 'false', content: '错误' },
          ];
        }
      }
      break;
    default:
      base.placeholder = '请输入你的回答……';
  }

  return base;
}

function inferContentType(agentType, nodeType, data) {
  if (nodeType === 'learning_summary' || data?.mode === 'learning_summary') return 'summary';
  if (agentType === 'trainer' || Array.isArray(data?.questions) || data?.question) return 'practice';
  if (agentType === 'diagnostician') return 'diagnosis';
  return 'explanation';
}

function questionIdForInteraction(question, index = 0) {
  return String(question?.question_id || question?.questionId || question?.question_key || question?.questionKey || question?.id || `question_${index + 1}`);
}

function questionId(question, index = 0) {
  return String(question?.question_id || question?.questionId || question?.question_key || question?.questionKey || question?.id || `question_${index + 1}`);
}

function normalizeQuestions(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.questions)) return data.questions;
  if (data.question && typeof data.question === 'object') return [data.question];
  if (Array.isArray(data.similar_practice)) return data.similar_practice;
  if (Array.isArray(data.variants)) return data.variants.map((item) => item?.question || item).filter(Boolean);
  return [];
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) return value.map(String).sort();
  return String(value ?? '').trim();
}

function sanitizePracticeData(data, answerHistory = [], { revealAll = false } = {}) {
  const source = data && typeof data === 'object' ? data : {};
  const {
    question: _unsafeQuestion,
    similar_practice: _unsafeSimilarPractice,
    variants: _unsafeVariants,
    ...safeSource
  } = source;
  const answersByQuestion = new Map(
    (answerHistory || []).map((item) => [String(item.questionId), item]),
  );
  const questions = normalizeQuestions(source).map((question, index) => {
    const id = questionId(question, index);
    const answered = answersByQuestion.get(id);
    const safe = {
      id,
      questionId: id,
      questionType: question.question_type || question.questionType || question.type || 'short_answer',
      stem: question.stem || question.content || question.title || '',
      options: (question.options || []).map((option) => ({
        key: String(option.key || option.option_key || ''),
        content: option.content || option.text || option.option_content || '',
      })),
      difficulty: question.difficulty || 'medium',
      knowledgePoint: question.knowledge_point || question.knowledgePoint || '',
      hints: Array.isArray(question.hints) ? question.hints : [],
    };
    if (answered || revealAll) {
      safe.evaluation = answered || {
        questionId: id,
        studentAnswer: null,
        correctAnswer: normalizeAnswer(question.correct_answer ?? question.correctAnswer),
        isCorrect: null,
        analysis: question.analysis || '',
      };
    }
    return safe;
  });
  const currentIndex = Math.min(Number(source.currentQuestionIndex || answerHistory?.length || 0), Math.max(0, questions.length - 1));
  return {
    ...safeSource,
    questions,
    answers: answerHistory || [],
    currentQuestionIndex: currentIndex,
    currentQuestion: questions[currentIndex] || null,
  };
}

function contentFromState(node, graphState, nodeRun, execution) {
  const stored = normalizeStoredAgentOutput(nodeRun?.output_summary_json);
  const agentType = String(
    stored?.agentType || graphState?.agentType || getAgentForNode(node?.type) || nodeRun?.agent_type || 'explainer',
  ).toLowerCase();
  let data = stored?.protocolVersion ? stored.data : null;
  if (!data) data = graphState?.agentOutputRef?.normalizedOutput || graphState?.agentOutputRef || null;
  if (!data) data = normalizeStoredAgentOutput(nodeRun?.output_content || stored?.result || stored);
  const answers = graphState?.answerHistory || stored?.answers || [];
  const contentType = stored?.contentType || inferContentType(agentType, node?.type, data);
  if (contentType === 'practice') {
    data = sanitizePracticeData(data, answers, { revealAll: execution?.nodeCompleted === true });
  } else if (data && answers.length) {
    // 讲解/苏格拉底节点也要向前端恢复学生回答及其独立模型评价。
    data = { ...data, answerHistory: answers };
  }

  // 构建 interaction（仅 WAITING_INPUT 状态时需要）
  let interaction = null;
  if (execution?.status === EXECUTION_STATUS.WAITING_INPUT && node) {
    const agentOutput = graphState?.agentOutputRef?.normalizedOutput || graphState?.agentOutputRef || data || null;
    interaction = buildInteraction(node, agentOutput, execution, execution?.interrupt);
  }

  return data
    ? { agentType, contentType, data, interaction }
    : (contentType === 'practice' && answers.length
      ? { agentType, contentType: 'practice', data: { questions: [], answers, currentQuestionIndex: answers.length, currentQuestion: null }, interaction }
      : null);
}

function buildNodeDescriptor(node, nodeList = [], nodeRun = null, execution = null) {
  if (!node) return null;
  const index = Math.max(0, nodeList.findIndex((candidate) => String(candidate.id) === String(node.id)));
  return {
    id: String(node.id),
    index,
    displayIndex: index + 1,
    total: nodeList.length,
    type: node.type,
    title: node.title || '',
    status: execution?.status || nodeRun?.status || 'PENDING',
  };
}

function allowedActions(execution) {
  const actions = [];
  if (execution?.requiresStudentInput) actions.push('submit');
  if (execution?.canContinue) actions.push('continue');
  if (execution?.canRetry) actions.push('retry');
  if (execution?.canSkip) actions.push('skip');
  return actions;
}

module.exports = {
  EXECUTION_STATUS,
  flattenInterrupts,
  currentInterrupt,
  mapGraphExecution,
  buildInteraction,
  inferContentType,
  normalizeQuestions,
  questionId,
  sanitizePracticeData,
  contentFromState,
  buildNodeDescriptor,
  allowedActions,
  requiresStudentInteraction,
  INTERACTION_TYPE_VALUES,
  getInteractionType,
  agentOutputRequiresInteraction,
};
