// 图编辑器使用小写业务类型；Prisma 写入必须使用 WorkflowNodeType 枚举键。
const { WorkflowNodeType } = require('@prisma/client');
const { createAgentError } = require('../agent/common/agent.errors');

const WORKFLOW_NODE_TYPE_MAP = Object.freeze({
  concept_explanation: WorkflowNodeType.CONCEPT_EXPLANATION,
  analogy_explanation: WorkflowNodeType.ANALOGY_EXPLANATION,
  worked_example_analysis: WorkflowNodeType.WORKED_EXAMPLE_ANALYSIS,
  socratic_questioning: WorkflowNodeType.SOCRATIC_QUESTIONING,
  basic_practice: WorkflowNodeType.BASIC_PRACTICE,
  adaptive_practice: WorkflowNodeType.ADAPTIVE_PRACTICE,
  wrong_question_repair: WorkflowNodeType.WRONG_QUESTION_REPAIR,
  mastery_gate: WorkflowNodeType.MASTERY_GATE,
  learning_summary: WorkflowNodeType.LEARNING_SUMMARY,
  multimodal_interaction: WorkflowNodeType.MULTIMODAL_INTERACTION,
  diagnostic_pre_test: WorkflowNodeType.DIAGNOSTIC_PRE_TEST,
  deep_evaluation: WorkflowNodeType.DEEP_EVALUATION,
  variant_question: WorkflowNodeType.VARIANT_QUESTION,
  misconception_repair: WorkflowNodeType.MISCONCEPTION_REPAIR,
  summary: WorkflowNodeType.SUMMARY,
});

const WORKFLOW_NODE_TYPE_ALIASES = Object.freeze({
  example_analysis: 'worked_example_analysis',
  worked_example: 'worked_example_analysis',
  error_repair: 'wrong_question_repair',
  wrong_answer_repair: 'wrong_question_repair',
  mastery_assessment: 'mastery_gate',
  mastery_check: 'mastery_gate',
});

function toSnakeCase(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

function normalizeWorkflowNodeType(rawType, context = {}) {
  const normalized = toSnakeCase(rawType);
  // 允许 Prisma 枚举键（BASIC_PRACTICE）和画布类型（basic-practice/basicPractice）。
  const canonical = WORKFLOW_NODE_TYPE_ALIASES[normalized] || normalized;
  const prismaType = WORKFLOW_NODE_TYPE_MAP[canonical];
  if (prismaType) return prismaType;

  throw createAgentError(
    'INVALID_WORKFLOW_NODE_TYPE',
    '当前学习节点配置异常，请重新尝试',
    400,
    {
      nodeId: context.nodeId || null,
      sessionId: context.sessionId || null,
      rawNodeType: rawType == null ? null : String(rawType),
      normalizedNodeType: normalized || null,
    },
  );
}

module.exports = {
  WORKFLOW_NODE_TYPE_MAP,
  WORKFLOW_NODE_TYPE_ALIASES,
  normalizeWorkflowNodeType,
  toSnakeCase,
};
