/**
 * 教师端智能教案生成 — 三个 Agent 的 Zod 结构化输出 Schema
 *
 * Collector  → LessonPlanCollectorOutput
 * Analyzer   → LessonPlanAnalyzerOutput
 * Generator  → LessonPlanGeneratorOutput
 */

const { z } = require('zod');

// ---------------------------------------------------------------------------
// Collector Agent Schema（信息采集）
// ---------------------------------------------------------------------------

const studentSegmentSchema = z.object({
  excellent: z.number().int().nonnegative(),
  good: z.number().int().nonnegative(),
  general: z.number().int().nonnegative(),
  weak: z.number().int().nonnegative(),
}).strict();

const LessonPlanCollectorOutput = z.object({
  student_count: z.number().int().nonnegative(),
  average_mastery: z.number().min(0).max(100),
  weak_knowledge_points: z.array(z.string().min(1)).max(20),
  question_count: z.number().int().nonnegative(),
  wrong_question_count: z.number().int().nonnegative(),
  recent_topics: z.array(z.string().min(1)).max(5),
  student_segments: studentSegmentSchema,
}).strict();

// ---------------------------------------------------------------------------
// Analyzer Agent Schema（关键词分析）
// ---------------------------------------------------------------------------

const keywordItemSchema = z.object({
  keyword: z.string().min(1).max(50),
  weight: z.number().min(0).max(100),
  difficulty_level: z.enum(['high', 'medium', 'low']),
  type: z.enum(['核心概念类', '方法步骤类', '易错理解类', '情绪反馈类']),
  student_count: z.number().int().nonnegative().optional(),
  related_knowledge_point: z.string().max(200).optional(),
  sources: z.array(z.string()).optional(),
  source_count: z.number().int().nonnegative().optional(),
  teacher_note: z.string().max(500).optional(),
}).strict();

const categoryBreakdownSchema = z.object({
  '核心概念类': z.array(keywordItemSchema).optional(),
  '方法步骤类': z.array(keywordItemSchema).optional(),
  '易错理解类': z.array(keywordItemSchema).optional(),
  '情绪反馈类': z.array(keywordItemSchema).optional(),
  // 兼容 LLM 可能输出的英文 key
  'core_concepts': z.array(keywordItemSchema).optional(),
  'method_steps': z.array(keywordItemSchema).optional(),
  'common_misunderstandings': z.array(keywordItemSchema).optional(),
  'emotional_feedback': z.array(keywordItemSchema).optional(),
}).strict();

const LessonPlanAnalyzerOutput = z.object({
  // 数据来源说明
  keyword_sources: z.array(z.string().min(1)).min(1).max(10),
  // 精选关键词 TOP10（每词含完整维度）
  top_keywords: z.array(keywordItemSchema).min(0).max(20),
  // 四类关键词归类
  category_breakdown: categoryBreakdownSchema,
  // 学生最关注的知识点（可选，LLM 可能不输出）
  student_focus_points: z.array(z.object({
    knowledge_point: z.string().min(1).max(100),
    question_frequency: z.number().int().nonnegative(),
    student_count: z.number().int().nonnegative(),
    analysis: z.string().min(1).max(300),
  }).strict()).max(10).optional().default([]),
  // 学生最集中的困惑点（可选）
  student_confusion_points: z.array(z.object({
    topic: z.string().min(1).max(100),
    confusion_description: z.string().min(1).max(300),
    affected_student_count: z.number().int().nonnegative(),
  }).strict()).max(10).optional().default([]),
  // 学生最容易出错的环节（可选）
  student_error_prone_steps: z.array(z.object({
    step: z.string().min(1).max(200),
    error_pattern: z.string().min(1).max(300),
    severity: z.enum(['高', '中', '低']),
  }).strict()).max(10).optional().default([]),
  // 兼容旧字段（method_barriers 兼容 LLM 可能输出的对象格式）
  high_frequency_concepts: z.array(z.string().min(1)).max(10),
  common_misunderstandings: z.array(z.string().min(1)).max(10),
  method_barriers: z.array(z.union([
    z.string().min(1),
    z.object({ barrier: z.string().min(1).optional(), description: z.string().min(1).optional(), step: z.string().min(1).optional() }).passthrough(),
  ])).max(10),
  emotional_feedback_summary: z.string().max(500),
  // 复盘结论（适合直接写入教案，150-300字）
  review_conclusion: z.string().min(1).max(2000),
  // 教学调整策略（每条可操作，关联具体关键词）
  teaching_adjustments: z.array(z.string().min(1)).min(1).max(10),
}).strict();

// ---------------------------------------------------------------------------
// Generator Agent Schema（教案生成）
// ---------------------------------------------------------------------------

const basicInfoSchema = z.object({
  course_name: z.string().min(1).max(100),
  course_code: z.string().max(50).optional(),
  subject_category: z.string().max(100).optional(),
  teacher_name: z.string().min(1).max(50),
  class_name: z.string().min(1).max(100),
  teaching_date: z.string().max(20),
  period: z.string().max(50),
  lesson_type: z.string().max(20),
  venue: z.string().max(100).optional(),
  teaching_material: z.string().max(200).optional(),
  topic: z.string().min(1).max(100),
}).strict();

const teachingProcessStepSchema = z.object({
  stage: z.string().min(1).max(100),
  time_suggestion: z.string().max(50).optional(),
  teaching_content: z.string().min(1).max(1000).optional(),
  teacher_activity: z.string().min(1).max(1000),
  student_activity: z.string().min(1).max(1000),
  design_intent: z.string().min(1).max(500),
}).strict();

const LessonPlanGeneratorOutput = z.object({
  basic_info: basicInfoSchema,
  // 二、学情分析（结构化）
  student_analysis: z.object({
    knowledge_foundation: z.string().min(1).max(1000),
    cognitive_characteristics: z.string().min(1).max(1000),
    common_problems: z.string().min(1).max(1000),
    class_participation: z.string().min(1).max(1000),
    teaching_entry_point: z.string().min(1).max(1000),
  }).strict(),
  // 三、上一节课复盘模块（可选：无学生提问数据时允许省略）
  review_module: z.object({
    keyword_sources: z.string().min(1).max(1000),
    keyword_summary: z.string().min(1).max(2000),
    concept_keywords: z.array(z.string().min(1)).max(10),
    method_keywords: z.array(z.string().min(1)).max(10),
    mistake_keywords: z.array(z.string().min(1)).max(10),
    emotion_keywords: z.array(z.string().min(1)).max(10),
    student_focus_points: z.array(z.object({
      knowledge_point: z.string().min(1).max(100),
      question_frequency: z.number().int().nonnegative(),
      student_count: z.number().int().nonnegative(),
      analysis: z.string().min(1).max(300),
    }).strict()).max(10),
    student_confusion_points: z.array(z.object({
      topic: z.string().min(1).max(100),
      confusion_description: z.string().min(1).max(300),
      affected_student_count: z.number().int().nonnegative(),
    }).strict()).max(10),
    student_error_prone_steps: z.array(z.object({
      step: z.string().min(1).max(200),
      error_pattern: z.string().min(1).max(300),
      severity: z.enum(['高', '中', '低']),
    }).strict()).max(10),
    review_conclusion: z.string().min(1).max(2000),
    teaching_adjustments: z.array(z.string().min(1)).min(1).max(10),
  }).strict().optional(),  // 无学生提问数据时可省略复盘模块
  // 四、教学目标
  teaching_goals: z.object({
    knowledge: z.string().min(1).max(1000),
    ability: z.string().min(1).max(1000),
    emotion: z.string().min(1).max(1000),
  }).strict(),
  // 五、教学重点
  key_points: z.array(z.string().min(1)).min(1).max(10),
  // 六、教学难点
  difficulties: z.array(z.string().min(1)).min(1).max(10),
  // 七、教学方法与教学策略（含说明）
  teaching_methods: z.array(z.object({
    name: z.string().min(1).max(50),
    description: z.string().min(1).max(300),
  }).strict()).min(3).max(10),
  // 八、教学准备
  teaching_preparation: z.object({
    teacher: z.string().min(1).max(1000),
    student: z.string().min(1).max(1000),
  }).strict(),
  // 九、教学过程设计（7个标准环节）
  teaching_process: z.array(teachingProcessStepSchema).min(5).max(10),
  // 十、课堂评价设计
  evaluation_design: z.object({
    process: z.string().min(1).max(1000),
    result: z.string().min(1).max(1000),
    data_assisted: z.string().min(1).max(1000),
  }).strict(),
  // 十一、板书设计（兼容 LLM 输出的字符串和数组两种格式）
  board_design: z.object({
    theme: z.string().min(1).max(200),
    core_concepts: z.union([
      z.string().min(1).max(500),
      z.array(z.string().min(1)).transform(arr => arr.join('\n')),
    ]),
    key_steps: z.union([
      z.string().min(1).max(500),
      z.array(z.string().min(1)).transform(arr => arr.join('\n')),
    ]),
    common_mistakes: z.union([
      z.string().min(1).max(500),
      z.array(z.string().min(1)).transform(arr => arr.join('\n')),
    ]),
    summary: z.string().min(1).max(500),
  }).strict(),
  // 十二、作业设计
  homework_design: z.object({
    basic: z.string().min(1).max(1000),
    advanced: z.string().min(1).max(1000),
    tiered: z.string().min(1).max(1000),
    preview: z.string().min(1).max(1000),
  }).strict(),
  // 十三、课后反思（结构化模板，留空供教师填写）
  reflection: z.object({
    goal_achievement: z.string().min(1).max(500),
    key_points_implementation: z.string().min(1).max(500),
    difficulty_breakthrough: z.string().min(1).max(500),
    student_participation: z.string().min(1).max(500),
    review_teaching_connection: z.string().min(1).max(500),
    improvement_suggestions: z.string().min(1).max(500),
  }).strict(),
}).strict();

// ---------------------------------------------------------------------------
// Fallback Schemas（降级输出）
// ---------------------------------------------------------------------------

const LessonPlanCollectorFallback = z.object({
  error: z.string(),
  is_fallback: z.literal(true),
  message: z.string(),
}).strict();

const LessonPlanAnalyzerFallback = z.object({
  error: z.string(),
  is_fallback: z.literal(true),
  message: z.string(),
}).strict();

const LessonPlanGeneratorFallback = z.object({
  error: z.string(),
  is_fallback: z.literal(true),
  message: z.string(),
}).strict();

module.exports = {
  LessonPlanCollectorOutput,
  LessonPlanAnalyzerOutput,
  LessonPlanGeneratorOutput,
  LessonPlanCollectorFallback,
  LessonPlanAnalyzerFallback,
  LessonPlanGeneratorFallback,
};
