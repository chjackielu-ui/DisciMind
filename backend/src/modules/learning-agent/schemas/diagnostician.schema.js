// Diagnostician Agent 结构化输出 Zod Schema
// 定义诊断师 Agent 的所有输出格式

const { z } = require('zod');

// ---------- 错误类型 ----------

const ErrorTypeEnum = z.enum([
  'concept_misunderstanding',
  'memory_weak',
  'formula_error',
  'calculation_error',
  'question_reading_error',
  'method_selection_error',
  'careless',
  'time_insufficient',
  'unknown',
  'other',
]);

// ---------- 错误类型识别 ----------

const ErrorTypeIdentificationOutput = z.object({
  mode: z.literal('error_type_identification'),
  primary_error_type: ErrorTypeEnum,
  secondary_error_types: z.array(ErrorTypeEnum).optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  suggested_remediation: z.string().optional(),
});

// ---------- 误区总结 ----------

const MisconceptionSummaryOutput = z.object({
  mode: z.literal('misconception_summary'),
  identified_misconceptions: z.array(z.object({
    description: z.string(),
    frequency: z.number().int().min(1).optional(),
    severity: z.enum(['low', 'medium', 'high']).default('medium'),
    related_knowledge_points: z.array(z.string()).optional(),
  })).min(1).max(10),
  root_cause_analysis: z.string().optional(),
  overall_pattern: z.string().optional(),
});

// ---------- 连续错误分析 ----------

const ConsecutiveErrorAnalysisOutput = z.object({
  mode: z.literal('consecutive_error_analysis'),
  error_sequence: z.array(z.object({
    question_index: z.number().int(),
    error_type: ErrorTypeEnum,
    description: z.string(),
  })),
  pattern_detected: z.boolean(),
  pattern_description: z.string().optional(),
  is_escalating: z.boolean(),
  recommended_action: z.string(),
});

// ---------- 策略失败分析 ----------

const StrategyFailureAnalysisOutput = z.object({
  mode: z.literal('strategy_failure_analysis'),
  current_strategy: z.string(),
  failure_indicators: z.array(z.string()),
  suggested_strategy: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

// ---------- 诊断决策 ----------

const DiagnosticDecisionOutput = z.object({
  mode: z.literal('diagnostic_decision'),
  should_reduce_difficulty: z.boolean(),
  should_switch_explanation_strategy: z.boolean(),
  should_add_prerequisite_knowledge: z.boolean(),
  should_insert_remediation: z.boolean(),
  should_end_node: z.boolean(),
  should_flag_for_teacher_review: z.boolean(),
  decisions: z.array(z.object({
    action: z.string(),
    reason: z.string(),
    priority: z.number().int().min(1).max(100),
    target_agent: z.enum(['explainer', 'trainer', 'orchestrator']).optional(),
    params: z.record(z.any()).optional(),
  })).optional(),
  overall_assessment: z.string(),
  mastery_estimate: z.number().min(0).max(100).optional(),
});

const WrongQuestionDiagnosisOutput = z.object({
  mode: z.literal('wrong_question_diagnosis'),
  diagnosis_conclusion: z.string(),
  error_types: z.array(ErrorTypeEnum).default([]),
  misconception: z.string().optional(),
  reasonable_parts: z.array(z.string()).optional(),
  root_cause: z.string().optional(),
  repair_suggestions: z.array(z.string()).default([]),
  recommended_next_step: z.string().optional(),
  needs_remedial_explanation: z.boolean().default(false),
});

const LearningSummaryOutput = z.object({
  mode: z.literal('learning_summary'),
  completion_summary: z.string(),
  mastered_content: z.array(z.string()).default([]),
  weak_content: z.array(z.string()).default([]),
  wrong_answer_summary: z.string().optional(),
  mastery_change: z.object({
    before: z.number().nullable().optional(),
    after: z.number().nullable().optional(),
  }).optional(),
  next_steps: z.array(z.string()).default([]),
});

// ---------- 降级输出 ----------

const DiagnosticianFallbackOutput = z.object({
  mode: z.string(),
  error: z.string().optional(),
  is_fallback: z.literal(true),
  conservative_recommendation: z.string().optional(),
});

// ---------- 联合输出类型 ----------

const DiagnosticianOutput = z.discriminatedUnion('mode', [
  ErrorTypeIdentificationOutput,
  MisconceptionSummaryOutput,
  ConsecutiveErrorAnalysisOutput,
  StrategyFailureAnalysisOutput,
  DiagnosticDecisionOutput,
  WrongQuestionDiagnosisOutput,
  LearningSummaryOutput,
]);

// ---------- 输出包装 ----------

const DiagnosticianResult = z.object({
  rawOutput: z.any().optional(),
  normalizedOutput: DiagnosticianOutput.or(DiagnosticianFallbackOutput).nullable(),
  validationError: z.string().nullable().optional(),
  retrievalRefs: z.array(z.object({
    datasetId: z.string().optional(),
    documentId: z.string().optional(),
    documentName: z.string().optional(),
    segmentId: z.string().optional(),
    score: z.number().optional(),
  })).optional(),
});

module.exports = {
  ErrorTypeEnum,
  ErrorTypeIdentificationOutput,
  MisconceptionSummaryOutput,
  ConsecutiveErrorAnalysisOutput,
  StrategyFailureAnalysisOutput,
  DiagnosticDecisionOutput,
  WrongQuestionDiagnosisOutput,
  LearningSummaryOutput,
  DiagnosticianFallbackOutput,
  DiagnosticianOutput,
  DiagnosticianResult,
};
