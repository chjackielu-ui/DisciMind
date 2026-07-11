const GOAL_TYPES = Object.freeze([
  'DIRECT_MATCH', 'SUBTOPIC', 'MULTI_TOPIC', 'TOO_BROAD', 'AMBIGUOUS', 'OUT_OF_SCOPE', 'INSUFFICIENT_COVERAGE',
]);

const GOAL_STATUSES = Object.freeze([
  'DRAFT', 'RESOLVING', 'NEEDS_CLARIFICATION', 'OUT_OF_SCOPE', 'INSUFFICIENT_COVERAGE',
  'RESOLVED', 'CONFIRMED', 'GENERATING_WORKFLOW', 'WORKFLOW_READY', 'STARTED', 'COMPLETED', 'FAILED', 'CANCELLED',
]);

const TARGET_DEPTHS = Object.freeze(['introductory', 'basic', 'intermediate', 'advanced', 'review']);
const COVERAGE_STATUSES = Object.freeze(['sufficient', 'partial', 'insufficient', 'unavailable']);
const EDITABLE_FIELDS = Object.freeze(['normalizedTitle', 'focusQuestion', 'targetDepth', 'targetMastery', 'estimatedMinutes']);
const TERMINAL_OR_BLOCKED_TYPES = new Set(['TOO_BROAD', 'AMBIGUOUS', 'OUT_OF_SCOPE', 'INSUFFICIENT_COVERAGE']);
const RESOLVABLE_STATUSES = new Set(['DRAFT', 'RESOLVING', 'FAILED']);
const MUTABLE_STATUSES = new Set(['RESOLVED', 'NEEDS_CLARIFICATION', 'INSUFFICIENT_COVERAGE']);
const WORKFLOW_TEMPLATE_KEYS = Object.freeze(['standard', 'practice_driven', 'weakness_repair', 'socratic_inquiry', 'exam_sprint']);

function numberEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getLearningGoalConfig() {
  return {
    enabled: process.env.LEARNING_GOAL_ENABLED === 'true',
    maxInputChars: numberEnv('LEARNING_GOAL_MAX_INPUT_CHARS', 300, 20, 2000),
    maxSubGoals: numberEnv('LEARNING_GOAL_MAX_SUB_GOALS', 6, 2, 10),
    maxRelatedKnowledgePoints: numberEnv('LEARNING_GOAL_MAX_RELATED_KPS', 5, 0, 10),
    defaultTargetMastery: numberEnv('LEARNING_GOAL_DEFAULT_TARGET_MASTERY', 80, 60, 95),
    defaultEstimatedMinutes: numberEnv('LEARNING_GOAL_DEFAULT_ESTIMATED_MINUTES', 25, 10, 120),
    resolveTimeoutMs: numberEnv('LEARNING_GOAL_RESOLVE_TIMEOUT_MS', 30000, 3000, 120000),
    workflowTimeoutMs: numberEnv('LEARNING_GOAL_WORKFLOW_TIMEOUT_MS', 60000, 5000, 180000),
    coverageSufficientThreshold: numberEnv('LEARNING_GOAL_COVERAGE_SUFFICIENT_THRESHOLD', 0.65, 0, 1),
    coveragePartialThreshold: numberEnv('LEARNING_GOAL_COVERAGE_PARTIAL_THRESHOLD', 0.40, 0, 1),
    debug: process.env.LEARNING_GOAL_DEBUG === 'true',
  };
}

const BROAD_OPTIONS = Object.freeze([
  { title: '监督学习基础', goalText: '我想理解监督学习的基本概念和适用场景' },
  { title: '分类与回归', goalText: '我想掌握分类任务和回归任务的区别' },
  { title: '常用模型', goalText: '我想了解常见机器学习模型的基本原理' },
  { title: '模型评估', goalText: '我想学习准确率、精确率、召回率和AUC' },
  { title: '完整入门路线', goalText: '我想从机器学习定义、任务类型和基本流程开始入门' },
]);

module.exports = {
  GOAL_TYPES, GOAL_STATUSES, TARGET_DEPTHS, COVERAGE_STATUSES, EDITABLE_FIELDS,
  TERMINAL_OR_BLOCKED_TYPES, RESOLVABLE_STATUSES, MUTABLE_STATUSES,
  WORKFLOW_TEMPLATE_KEYS, BROAD_OPTIONS, getLearningGoalConfig,
};
