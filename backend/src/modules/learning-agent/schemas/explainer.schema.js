// Explainer Agent 结构化输出 Zod Schema
// 定义讲解者 Agent 的所有输出格式

const { z } = require('zod');

// ---------- 讲解策略枚举 ----------

const ExplainerStrategyEnum = z.enum([
  'direct',
  'analogy',
  'example_analysis',
  'socratic',
  'misconception_repair',
  'summary',
]);

// ---------- 直接讲解 ----------

const DirectExplanationOutput = z.object({
  strategy: z.literal('direct'),
  title: z.string().min(1).max(200),
  sections: z.array(z.object({
    heading: z.string().max(200),
    content: z.string().min(1),
    key_points: z.array(z.string()).optional(),
  })).min(1).max(10),
  summary: z.string().optional(),
  knowledge_sources: z.array(z.object({
    document_name: z.string().optional(),
    segment_id: z.string().optional(),
    relevance: z.string().optional(),
  })).optional(),
  estimated_reading_minutes: z.number().int().min(1).max(30).optional(),
});

// ---------- 类比讲解 ----------

const AnalogyExplanationOutput = z.object({
  strategy: z.literal('analogy'),
  concept: z.string().min(1).max(200),
  analogies: z.array(z.object({
    domain: z.string(),
    mapping: z.string(),
    limitation: z.string().optional(),
  })).min(1).max(5),
  bridge_back: z.string(),
  knowledge_sources: z.array(z.object({
    document_name: z.string().optional(),
    segment_id: z.string().optional(),
  })).optional(),
});

// ---------- 例题分析 ----------

const ExampleAnalysisOutput = z.object({
  strategy: z.literal('example_analysis'),
  problem_statement: z.string(),
  solution_steps: z.array(z.object({
    step_number: z.number().int(),
    description: z.string(),
    rationale: z.string().optional(),
  })).min(1).max(15),
  final_answer: z.string(),
  key_insights: z.array(z.string()).optional(),
  common_mistakes: z.array(z.string()).optional(),
  knowledge_sources: z.array(z.object({
    document_name: z.string().optional(),
    segment_id: z.string().optional(),
  })).optional(),
});

// ---------- 苏格拉底提问 ----------

const SocraticOutput = z.object({
  strategy: z.literal('socratic'),
  starting_question: z.string(),
  guidance_hints: z.array(z.string()).optional(),
  expected_insight: z.string().optional(),
  follow_up_questions: z.array(z.string()).optional(),
  knowledge_sources: z.array(z.object({
    document_name: z.string().optional(),
    segment_id: z.string().optional(),
  })).optional(),
});

// ---------- 误区修复 ----------

const MisconceptionRepairOutput = z.object({
  strategy: z.literal('misconception_repair'),
  identified_misconception: z.string(),
  why_it_is_wrong: z.string(),
  correct_understanding: z.string(),
  contrast_examples: z.array(z.object({
    wrong: z.string(),
    right: z.string(),
  })).optional(),
  practice_question: z.string().optional(),
  knowledge_sources: z.array(z.object({
    document_name: z.string().optional(),
    segment_id: z.string().optional(),
  })).optional(),
});

// ---------- 总结 ----------

const SummaryOutput = z.object({
  strategy: z.literal('summary'),
  topic: z.string(),
  key_concepts: z.array(z.object({
    name: z.string(),
    explanation: z.string(),
  })).min(1).max(10),
  concept_map: z.string().optional(),
  review_questions: z.array(z.string()).optional(),
  next_steps: z.array(z.string()).optional(),
  knowledge_sources: z.array(z.object({
    document_name: z.string().optional(),
    segment_id: z.string().optional(),
  })).optional(),
});

// ---------- 降级输出（结构校验失败时使用）----------

const ExplainerFallbackOutput = z.object({
  strategy: z.string(),
  content: z.string(),
  validation_error: z.string().optional(),
  is_fallback: z.literal(true),
});

// ---------- 联合输出类型 ----------

const ExplainerOutput = z.discriminatedUnion('strategy', [
  DirectExplanationOutput,
  AnalogyExplanationOutput,
  ExampleAnalysisOutput,
  SocraticOutput,
  MisconceptionRepairOutput,
  SummaryOutput,
]);

// ---------- 输出包装 ----------

const ExplainerResult = z.object({
  rawOutput: z.any().optional(),
  normalizedOutput: ExplainerOutput.or(ExplainerFallbackOutput).nullable(),
  validationError: z.string().nullable().optional(),
  knowledgeBased: z.boolean().default(true),
  retrievalRefs: z.array(z.object({
    datasetId: z.string().optional(),
    documentId: z.string().optional(),
    documentName: z.string().optional(),
    segmentId: z.string().optional(),
    score: z.number().optional(),
  })).optional(),
});

// ---------- 策略映射 ----------

const STRATEGY_TO_SCHEMA = {
  direct: DirectExplanationOutput,
  analogy: AnalogyExplanationOutput,
  example_analysis: ExampleAnalysisOutput,
  socratic: SocraticOutput,
  misconception_repair: MisconceptionRepairOutput,
  summary: SummaryOutput,
};

module.exports = {
  ExplainerStrategyEnum,
  DirectExplanationOutput,
  AnalogyExplanationOutput,
  ExampleAnalysisOutput,
  SocraticOutput,
  MisconceptionRepairOutput,
  SummaryOutput,
  ExplainerFallbackOutput,
  ExplainerOutput,
  ExplainerResult,
  STRATEGY_TO_SCHEMA,
};
