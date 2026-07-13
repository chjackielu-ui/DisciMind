/**
 * 教师端智能教案生成 — LangGraph State 定义
 *
 * 采用与 file-generator.state.js 同款的 Annotation.Root 模式。
 */

const { Annotation } = require('@langchain/langgraph');

const replace = (current, next) => next === undefined ? current : next;

const LessonPlanState = Annotation.Root({
  // ---- 任务标识 ----
  taskId: Annotation({ reducer: replace, default: () => null }),
  userId: Annotation({ reducer: replace, default: () => null }),
  courseId: Annotation({ reducer: replace, default: () => null }),
  teachingClassId: Annotation({ reducer: replace, default: () => null }),

  // ---- 教师输入参数 ----
  params: Annotation({ reducer: replace, default: () => ({
    courseName: '',
    courseCode: '',
    subjectCategory: '',
    teacherName: '',
    className: '',
    teachingDate: '',
    period: '1课时（45分钟）',
    lessonType: '新授课',
    venue: '',
    teachingMaterial: '',
    topic: '',
  }) }),

  // ---- 学情数据（Collector Agent 输出）----
  learningData: Annotation({ reducer: replace, default: () => null }),

  // ---- 词云关键词（keyword-cloud.service 原始输出）----
  keywordCloud: Annotation({ reducer: replace, default: () => null }),

  // ---- 关键词分析（Analyzer Agent 输出）----
  keywordAnalysis: Annotation({ reducer: replace, default: () => null }),

  // ---- 教案内容（Generator Agent 输出 / 13模块 JSON）----
  lessonPlan: Annotation({ reducer: replace, default: () => null }),

  // ---- DOCX 输出 ----
  docxPath: Annotation({ reducer: replace, default: () => null }),
  docxFileName: Annotation({ reducer: replace, default: () => null }),
  docxSize: Annotation({ reducer: replace, default: () => null }),

  // ---- 学生提问数据标记（无数据时跳过复盘模块）----
  hasStudentQuestions: Annotation({ reducer: replace, default: () => true }),

  // ---- 错误 & 阶段 ----
  error: Annotation({ reducer: replace, default: () => null }),
  stage: Annotation({ reducer: replace, default: () => 'resolve_params' }),
});

module.exports = { LessonPlanState };
