// 错题自动生成服务
// 负责在答题批改后自动创建或更新错题记录
// 按 student_user_id + question_id 唯一键 upsert

const prisma = require('../config/prisma');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

// ========================
// 核心函数
// ========================

/**
 * 根据批改结果创建或更新错题记录
 *
 * @param {Object} params
 * @param {number} params.studentId - 学生用户 ID
 * @param {number} params.submissionId - 提交 ID
 * @param {Array} params.answerResults - 批改结果数组
 *   [{ question_id, is_correct, score, max_score, grading_status }]
 * @param {Object} params.questionMap - question_id → question 映射
 *   { question_id: { course_id, knowledge_point_id, question_type, content } }
 * @returns {Promise<{created: number, updated: number, resolved: number}>}
 */
async function createOrUpdateWrongQuestions({ studentId, submissionId, answerResults, questionMap }) {
  let created = 0;
  let updated = 0;
  let resolved = 0;

  if (!answerResults || answerResults.length === 0) {
    return { created, updated, resolved };
  }

  for (const result of answerResults) {
    const question = questionMap[result.question_id];
    if (!question) continue;

    const isWrong = result.is_correct === false || (result.score != null && result.max_score != null && result.score < result.max_score);
    const knowledgePointId = question.knowledge_point_id || null;
    const courseId = question.course_id || null;

    if (isWrong) {
      // 错题：创建或更新为 UNRESOLVED
      const existing = await prisma.wrongQuestion.findUnique({
        where: {
          student_user_id_question_id: {
            student_user_id: studentId,
            question_id: result.question_id,
          },
        },
      });

      if (existing) {
        // 已存在：更新状态为 unresolved，更新 last_wrong_at
        const updateData = {
          updated_at: new Date(),
        };
        if (existing.status === 'MASTERED' || existing.status === 'REMOVED') {
          updateData.status = 'UNRESOLVED';
          updateData.mastered_at = null;
        }
        await prisma.wrongQuestion.update({
          where: { wrong_question_id: existing.wrong_question_id },
          data: updateData,
        });
        updated++;
      } else {
        // 不存在：创建新记录
        await prisma.wrongQuestion.create({
          data: {
            student_user_id: studentId,
            question_id: result.question_id,
            course_id: courseId,
            knowledge_point_id: knowledgePointId,
            source_type: 'task_submission',
            status: 'UNRESOLVED',
          },
        });
        created++;
      }
    } else {
      // 答对了：如果之前有 UNRESOLVED 错题，标记为 MASTERED
      const existing = await prisma.wrongQuestion.findUnique({
        where: {
          student_user_id_question_id: {
            student_user_id: studentId,
            question_id: result.question_id,
          },
        },
      });

      if (existing && existing.status === 'UNRESOLVED') {
        await prisma.wrongQuestion.update({
          where: { wrong_question_id: existing.wrong_question_id },
          data: {
            status: 'MASTERED',
            mastered_at: new Date(),
            updated_at: new Date(),
          },
        });
        resolved++;
      }
    }
  }

  return { created, updated, resolved };
}

/**
 * 获取学生的错题统计（按知识点聚合）
 */
async function getWrongQuestionStats(studentId, courseId) {
  const wrongQuestions = await prisma.wrongQuestion.findMany({
    where: {
      student_user_id: studentId,
      status: 'UNRESOLVED',
      ...(courseId ? { course_id: courseId } : {}),
    },
    include: {
      knowledge_point: true,
    },
  });

  // 按知识点聚合统计
  const statsMap = {};
  for (const wq of wrongQuestions) {
    const kpId = wq.knowledge_point_id;
    if (!kpId) continue;
    if (!statsMap[kpId]) {
      statsMap[kpId] = {
        knowledge_point_id: kpId,
        knowledge_point_name: wq.knowledge_point?.knowledge_point_name || null,
        wrong_count: 0,
      };
    }
    statsMap[kpId].wrong_count++;
  }

  return Object.values(statsMap).sort((a, b) => b.wrong_count - a.wrong_count);
}

module.exports = {
  createOrUpdateWrongQuestions,
  getWrongQuestionStats,
};
