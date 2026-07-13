/**
 * Lesson Plan Collector Agent（信息采集智能体）
 *
 * 职责：根据 courseId + teachingClassId，从数据库采集学情基础数据。
 * 本 Agent 以确定性 Prisma 查询为主，输出结构化 JSON 供后续 Agent 使用。
 *
 * 严格遵循 Agent 模式：
 *   输入 → 查询 → Zod 校验 → 返回 { normalizedOutput, ... }
 */

const prisma = require('../../../config/prisma');
const {
  LessonPlanCollectorOutput,
  LessonPlanCollectorFallback,
} = require('../schemas/lesson-plan.schema');

// ---------------------------------------------------------------------------
// 采集核心逻辑
// ---------------------------------------------------------------------------

async function collectLearningData(courseId, teachingClassId) {
  // 学生人数
  const studentWhere = { course_id: courseId, enrollment_status: 'active' };
  if (teachingClassId) studentWhere.teaching_class_id = teachingClassId;
  const studentCount = await prisma.studentCourseEnrollment.count({ where: studentWhere });

  // 平均掌握度
  const masteryAgg = await prisma.studentMasteryRecord.aggregate({
    _avg: { mastery_score: true },
    where: { course_id: courseId },
  });
  const avgMastery = Math.round(masteryAgg._avg.mastery_score || 0);

  // 薄弱知识点（掌握等级为 WEAK 的）
  const weakKps = await prisma.studentMasteryRecord.findMany({
    where: { course_id: courseId, mastery_level: 'WEAK' },
    include: { knowledge_point: { select: { knowledge_point_name: true } } },
    take: 10,
    orderBy: { mastery_score: 'asc' },
  });

  // 提问数（限制在 COURSE_QA 类型的对话中）
  const questionWhere = { course_id: courseId };
  const questionCount = await prisma.studentQuestionRecord.count({ where: questionWhere });

  // 错题数
  const wrongCount = await prisma.wrongQuestion.count({
    where: { course_id: courseId, status: { not: 'REMOVED' } },
  });

  // 学生分段统计
  const allMastery = await prisma.studentMasteryRecord.findMany({
    where: { course_id: courseId },
    select: { mastery_score: true },
  });
  const segments = { excellent: 0, good: 0, general: 0, weak: 0 };
  for (const record of allMastery) {
    const score = record.mastery_score || 0;
    if (score >= 85) segments.excellent++;
    else if (score >= 70) segments.good++;
    else if (score >= 50) segments.general++;
    else segments.weak++;
  }

  // 近期主题（从知识点按更新时间获取）
  const recentKps = await prisma.knowledgePoint.findMany({
    where: { course_id: courseId },
    orderBy: { updated_at: 'desc' },
    take: 5,
    select: { knowledge_point_name: true },
  });

  return {
    student_count: studentCount,
    average_mastery: avgMastery,
    weak_knowledge_points: weakKps.map(w => w.knowledge_point?.knowledge_point_name).filter(Boolean),
    question_count: questionCount,
    wrong_question_count: wrongCount,
    recent_topics: recentKps.map(k => k.knowledge_point_name),
    student_segments: segments,
  };
}

// ---------------------------------------------------------------------------
// 主入口（对齐 Agent 模式）
// ---------------------------------------------------------------------------

/**
 * @param {Object} params
 * @param {number} params.courseId
 * @param {number} [params.teachingClassId]
 * @returns {Promise<{rawOutput: any, normalizedOutput: object, validationError: string|null}>}
 */
async function runCollector(params = {}) {
  const { courseId, teachingClassId } = params;

  const result = {
    rawOutput: null,
    normalizedOutput: null,
    validationError: null,
  };

  try {
    const raw = await collectLearningData(courseId, teachingClassId);
    result.rawOutput = raw;

    const validated = LessonPlanCollectorOutput.safeParse(raw);
    if (validated.success) {
      result.normalizedOutput = validated.data;
    } else {
      // 确定性收集出错时直接抛，不用 fallback
      throw new Error(`数据采集结构校验失败: ${validated.error.message}`);
    }
  } catch (err) {
    const message = err.message || '数据采集失败';
    result.validationError = message;
    result.normalizedOutput = LessonPlanCollectorFallback.parse({
      error: 'COLLECTOR_DATA_FAILED',
      is_fallback: true,
      message: `学情数据暂时无法获取: ${message}`,
    });
  }

  return result;
}

module.exports = { runCollector, collectLearningData };
