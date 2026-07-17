// 节点分发器 - 根据节点类型分发到对应的 Agent 和服务
// 不包含 LLM 逻辑，只做路由分发

const NODE_TYPE_TO_AGENT = {
  concept_explanation: { agent: 'explainer', strategy: 'direct' },
  analogy_explanation: { agent: 'explainer', strategy: 'analogy' },
  worked_example_analysis: { agent: 'explainer', strategy: 'example_analysis' },
  socratic_questioning: { agent: 'explainer', strategy: 'socratic' },
  misconception_repair: { agent: 'explainer', strategy: 'misconception_repair' },
  multimodal_interaction: { agent: 'explainer', strategy: 'direct', multimodal: true },
  diagnostic_pre_test: { agent: 'trainer', mode: 'diagnostic_pre_test' },
  basic_practice: { agent: 'trainer', mode: 'basic_practice' },
  adaptive_practice: { agent: 'trainer', mode: 'adaptive_practice' },
  deep_evaluation: { agent: 'trainer', mode: 'deep_evaluation' },
  wrong_question_repair: { agent: 'diagnostician', mode: 'wrong_question_diagnosis' },
  variant_question: { agent: 'trainer', mode: 'variant_question' },
  mastery_gate: { agent: 'gate', mode: null },
  learning_summary: { agent: 'diagnostician', mode: 'learning_summary' },
};

/**
 * 判断节点类型是否属于讲解类
 */
function isExplanationNode(nodeType) {
  return [
    'concept_explanation',
    'analogy_explanation',
    'worked_example_analysis',
    'socratic_questioning',
    'misconception_repair',
    'multimodal_interaction',
  ].includes(nodeType);
}

/**
 * 判断节点类型是否属于练习类
 */
function isPracticeNode(nodeType) {
  return [
    'diagnostic_pre_test',
    'basic_practice',
    'adaptive_practice',
    'deep_evaluation',
    'variant_question',
  ].includes(nodeType);
}

/**
 * 判断节点类型是否属于诊断类
 */
function isDiagnosisNode(nodeType) {
  return [
    'wrong_question_repair',
    'learning_summary',
  ].includes(nodeType);
}

/**
 * 判断节点是否需要学生交互（等待学生输入/回答）。
 *
 * 扩展范围：除了练习类节点和苏格拉底提问外，
 * Explainer 的误导修复、问题引入等场景也可能需要学生输入。
 * 最终判断由 routeAfterPersist 综合 agentOutput 决定；
 * 此函数作为快速预判用。
 */
function requiresStudentInteraction(nodeType) {
  return (
    isPracticeNode(nodeType) ||
    nodeType === 'socratic_questioning' ||
    nodeType === 'misconception_repair' ||
    nodeType === 'multimodal_interaction'
  );
}

/**
 * INTERACTION_TYPE_VALUES — 统一交互类型枚举。
 * 前端只根据这些类型渲染对应组件。
 */
const INTERACTION_TYPE_VALUES = Object.freeze({
  FREE_TEXT: 'free_text',
  SHORT_ANSWER: 'short_answer',
  FILL_BLANK: 'fill_blank',
  SINGLE_CHOICE: 'single_choice',
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  CONFIRM_CONTINUE: 'confirm_continue',
  NONE: 'none',
});

/**
 * 根据节点类型和 Agent 输出推断交互类型。
 *
 * 规则：
 * 1. Explainer 的 socratic → free_text（引导问题需要学生自由回答）
 * 2. Explainer 的 misconception_repair → free_text（学生需要解释自己的理解）
 * 3. Explainer 的 concept_explanation 含 starting_question → free_text
 * 4. Trainer 练习类 → 根据题目 question_type 映射
 * 5. Diagnostician → free_text（补充说明）
 * 6. 其它 → none
 *
 * @param {string} nodeType
 * @param {object|null} agentOutput - normalizedOutput
 * @returns {{ type: string, requiresInput: boolean }}
 */
function getInteractionType(nodeType, agentOutput = null, currentQuestionId = null) {
  const data = agentOutput || {};

  // Trainer 练习节点 — 根据题型返回
  if (isPracticeNode(nodeType)) {
    const questions = Array.isArray(data.questions) ? [...data.questions] : [];
    if (data.question && typeof data.question === 'object') questions.push(data.question);
    const q = (currentQuestionId
      ? questions.find((item, index) => String(
        item.question_id || item.questionId || item.question_key || item.questionKey || item.id || `question_${index + 1}`,
      ) === String(currentQuestionId))
      : null) || questions[0];
    if (!q) return { type: INTERACTION_TYPE_VALUES.NONE, requiresInput: false };
    const qType = q.question_type || q.questionType || q.type || 'short_answer';
    const typeMap = {
      single_choice: INTERACTION_TYPE_VALUES.SINGLE_CHOICE,
      multiple_choice: INTERACTION_TYPE_VALUES.MULTIPLE_CHOICE,
      true_false: INTERACTION_TYPE_VALUES.TRUE_FALSE,
      fill_blank: INTERACTION_TYPE_VALUES.FILL_BLANK,
      short_answer: INTERACTION_TYPE_VALUES.SHORT_ANSWER,
    };
    return { type: typeMap[qType] || INTERACTION_TYPE_VALUES.SINGLE_CHOICE, requiresInput: true };
  }

  // Explainer socratic → free_text
  if (nodeType === 'socratic_questioning') {
    return { type: INTERACTION_TYPE_VALUES.FREE_TEXT, requiresInput: true };
  }

  // Explainer misconception_repair → free_text
  if (nodeType === 'misconception_repair') {
    return { type: INTERACTION_TYPE_VALUES.FREE_TEXT, requiresInput: true };
  }

  if (nodeType === 'multimodal_interaction') {
    return { type: INTERACTION_TYPE_VALUES.FREE_TEXT, requiresInput: true };
  }

  // Explainer concept_explanation 包含引导问题
  if (nodeType === 'concept_explanation' && (data.starting_question || data.guidance_hints)) {
    return { type: INTERACTION_TYPE_VALUES.FREE_TEXT, requiresInput: true };
  }

  // Diagnostician 需要补充说明
  if (nodeType === 'wrong_question_repair' && data.needs_student_input) {
    return { type: INTERACTION_TYPE_VALUES.FREE_TEXT, requiresInput: true };
  }

  return { type: INTERACTION_TYPE_VALUES.NONE, requiresInput: false };
}

/**
 * 判断 agentOutput 是否包含需要学生交互的内容。
 * 用于 routeAfterPersist 做最终路由决策。
 */
function agentOutputRequiresInteraction(nodeType, agentOutput) {
  if (!agentOutput) return false;
  const data = agentOutput.normalizedOutput || agentOutput;

  // Trainer 始终需要交互
  if (isPracticeNode(nodeType)) return true;

  // Socratic / misconception_repair — 始终需要
  if (nodeType === 'socratic_questioning' || nodeType === 'misconception_repair' || nodeType === 'multimodal_interaction') return true;

  // concept_explanation 有引导问题时需要交互
  if (nodeType === 'concept_explanation' && (data.starting_question || data.guidance_hints)) return true;

  // Diagnostician 需要学生补充说明
  if (nodeType === 'wrong_question_repair' && data.needs_student_input) return true;

  return false;
}

/**
 * 获取节点对应的 Agent 类型
 */
function getAgentForNode(nodeType) {
  const mapping = NODE_TYPE_TO_AGENT[nodeType];
  return mapping?.agent || null;
}

/**
 * 获取节点默认策略/模式
 */
function getDefaultStrategy(nodeType) {
  const mapping = NODE_TYPE_TO_AGENT[nodeType];
  return mapping?.strategy || mapping?.mode || null;
}

/**
 * 判断节点是否支持多模态输入
 */
function supportsMultimodal(nodeType) {
  // 所有讲解类节点和练习类节点都可以接收图片
  return isExplanationNode(nodeType) || isPracticeNode(nodeType);
}

/**
 * 获取知识库检索意图
 */
function getKnowledgeIntent(nodeType) {
  if (isExplanationNode(nodeType)) {
    return 'explanation';
  }
  if (isPracticeNode(nodeType)) {
    return 'practice';
  }
  if (isDiagnosisNode(nodeType)) {
    return 'diagnosis';
  }
  if (nodeType === 'mastery_gate') {
    return 'evaluation';
  }
  return 'general';
}

module.exports = {
  NODE_TYPE_TO_AGENT,
  isExplanationNode,
  isPracticeNode,
  isDiagnosisNode,
  requiresStudentInteraction,
  getAgentForNode,
  getDefaultStrategy,
  supportsMultimodal,
  getKnowledgeIntent,
  INTERACTION_TYPE_VALUES,
  getInteractionType,
  agentOutputRequiresInteraction,
};
