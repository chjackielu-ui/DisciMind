// Trainer Agent 结构化输出 Zod Schema
// 定义训练师 Agent 的所有输出格式

const { z } = require('zod');

// ---------- 训练模式枚举 ----------

const TrainerModeEnum = z.enum([
  'diagnostic_pre_test',
  'basic_practice',
  'adaptive_practice',
  'deep_evaluation',
  'wrong_question_repair',
  'variant_question',
]);

// ---------- 题目选项 ----------

const QuestionOption = z.object({
  key: z.string(),
  content: z.string(),
});

// ---------- 题目结构 ----------

const TrainerQuestion = z.object({
  question_id: z.string().optional(),
  question_type: z.enum(['single_choice', 'multiple_choice', 'fill_blank', 'true_false', 'short_answer']),
  stem: z.string(),
  options: z.array(QuestionOption).optional(),
  correct_answer: z.union([z.string(), z.array(z.string())]).optional(),
  analysis: z.string().optional(),
  difficulty: z.enum(['basic', 'medium', 'hard']).default('basic'),
  knowledge_point: z.string().optional(),
  hints: z.array(z.string()).optional(),
  is_ai_generated: z.boolean().default(true),
});

// ---------- 诊断前测 ----------

const DiagnosticPreTestOutput = z.object({
  mode: z.literal('diagnostic_pre_test'),
  questions: z.array(TrainerQuestion).min(1).max(6),
  estimated_difficulty_range: z.string().optional(),
  diagnostic_focus: z.array(z.string()).optional(),
});

// ---------- 基础练习 ----------

const BasicPracticeOutput = z.object({
  mode: z.literal('basic_practice'),
  questions: z.array(TrainerQuestion).min(1).max(6),
  practice_topic: z.string(),
  difficulty_progression: z.string().optional(),
});

// ---------- 自适应练习 ----------

const AdaptivePracticeQuestion = TrainerQuestion.extend({
  adaptive_reason: z.string().optional(),
  target_pitfall: z.string().optional(),
});

const AdaptivePracticeOutput = z.object({
  mode: z.literal('adaptive_practice'),
  questions: z.array(AdaptivePracticeQuestion).min(1).max(6),
  student_level: z.enum(['weak', 'general', 'good', 'excellent']).optional(),
  adaptation_strategy: z.string().optional(),
});

// ---------- 深度评估 ----------

const DeepEvaluationOutput = z.object({
  mode: z.literal('deep_evaluation'),
  question: TrainerQuestion,
  evaluation_rubric: z.object({
    dimensions: z.array(z.object({
      name: z.string(),
      weight: z.number().min(0).max(1),
      scoring_guide: z.string().optional(),
    })),
    total_score: z.number(),
  }),
  expected_answer_elements: z.array(z.string()).optional(),
});

// ---------- 错题修复 ----------

const WrongQuestionRepairOutput = z.object({
  mode: z.literal('wrong_question_repair'),
  error_analysis: z.string(),
  remediation_content: z.string(),
  similar_practice: z.array(TrainerQuestion).min(1).max(4).optional(),
  prevention_tips: z.array(z.string()).optional(),
});

// ---------- 变式题 ----------

const VariantQuestionOutput = z.object({
  mode: z.literal('variant_question'),
  original_question_summary: z.string(),
  variants: z.array(z.object({
    question: TrainerQuestion,
    variation_type: z.string(),
    difficulty_shift: z.string(),
  })).min(1).max(5),
});

// ---------- 答题评估 ----------

const AnswerEvaluationOutput = z.object({
  is_correct: z.boolean(),
  score: z.number().min(0).max(100).optional(),
  feedback: z.string(),
  error_type: z.enum([
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
  ]).nullable().optional(),
  error_analysis: z.string().optional(),
  remediation_hint: z.string().optional(),
  confidence_level: z.enum(['high', 'medium', 'low']).optional(),
});

// ---------- 降级输出 ----------

const TrainerFallbackOutput = z.object({
  mode: z.string(),
  error: z.string().optional(),
  is_fallback: z.literal(true),
  questions: z.array(TrainerQuestion).optional(),
  message: z.string().optional(),
});

// ---------- 联合输出类型 ----------

const TrainerOutput = z.discriminatedUnion('mode', [
  DiagnosticPreTestOutput,
  BasicPracticeOutput,
  AdaptivePracticeOutput,
  DeepEvaluationOutput,
  WrongQuestionRepairOutput,
  VariantQuestionOutput,
]);

// ---------- 输出包装 ----------

const TrainerResult = z.object({
  rawOutput: z.any().optional(),
  normalizedOutput: TrainerOutput.or(TrainerFallbackOutput).nullable(),
  validationError: z.string().nullable().optional(),
  retrievalRefs: z.array(z.object({
    datasetId: z.string().optional(),
    documentId: z.string().optional(),
    documentName: z.string().optional(),
    segmentId: z.string().optional(),
    score: z.number().optional(),
  })).optional(),
});

const AnswerEvaluationResult = z.object({
  rawOutput: z.any().optional(),
  normalizedOutput: AnswerEvaluationOutput.nullable(),
  validationError: z.string().nullable().optional(),
});

module.exports = {
  TrainerModeEnum,
  TrainerQuestion,
  QuestionOption,
  DiagnosticPreTestOutput,
  BasicPracticeOutput,
  AdaptivePracticeOutput,
  DeepEvaluationOutput,
  WrongQuestionRepairOutput,
  VariantQuestionOutput,
  AnswerEvaluationOutput,
  TrainerFallbackOutput,
  TrainerOutput,
  TrainerResult,
  AnswerEvaluationResult,
};
