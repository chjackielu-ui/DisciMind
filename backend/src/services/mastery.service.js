// 知识点掌握度更新服务
// 在答题批改后根据答题结果调整知识点掌握度分数

const prisma = require('../config/prisma');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

/**
 * 根据 mastery_score 计算 mastery_level
 */
function calcMasteryLevel(score) {
  if (score == null) return 'weak';
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'general';
  return 'weak';
}

// ========================
// 核心函数
// ========================

/**
 * 答题提交后更新知识点掌握度
 *
 * @param {Object} params
 * @param {number} params.studentId - 学生用户 ID
 * @param {number} params.courseId - 课程 ID
 * @param {Array} params.answerResults - 批改结果数组
 *   [{ question_id, is_correct, score, max_score, grading_status }]
 * @param {Object} params.questionMap - question_id → question 映射
 *   { question_id: { knowledge_point_id } }
 * @returns {Promise<Array>} 更新后的掌握度记录列表
 */
async function updateMasteryAfterSubmission({ studentId, courseId, answerResults, questionMap }) {
  if (!answerResults || answerResults.length === 0) {
    return [];
  }

  // 按知识点聚合得分率
  const kpScores = {};
  const kpCounts = {};

  for (const result of answerResults) {
    const question = questionMap[result.question_id];
    if (!question || !question.knowledge_point_id) continue;

    const kpId = question.knowledge_point_id;
    if (!kpScores[kpId]) {
      kpScores[kpId] = 0;
      kpCounts[kpId] = 0;
    }

    const score = result.score ?? 0;
    const maxScore = result.max_score || 1;
    const scorePercent = maxScore > 0 ? score / maxScore : 0;

    kpScores[kpId] += scorePercent;
    kpCounts[kpId]++;
  }

  const updatedRecords = [];

  for (const kpId of Object.keys(kpScores)) {
    const kpIdNum = parseInt(kpId, 10);
    const totalPercent = kpScores[kpId];
    const questionCount = kpCounts[kpId];
    const avgScorePercent = questionCount > 0 ? totalPercent / questionCount : 0;

    // 获取现有掌握度记录
    const existing = await prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: studentId,
          course_id: courseId,
          knowledge_point_id: kpIdNum,
        },
      },
    });

    const currentScore = existing?.mastery_score ?? 60; // 默认初始掌握度 60

    // 根据本次得分率调整 mastery_score
    let adjustment = 0;
    if (avgScorePercent >= 0.9) {
      adjustment = 8;
    } else if (avgScorePercent >= 0.75) {
      adjustment = 5;
    } else if (avgScorePercent >= 0.6) {
      adjustment = 2;
    } else if (avgScorePercent >= 0.4) {
      adjustment = -5;
    } else {
      adjustment = -10;
    }

    const newScore = Math.max(0, Math.min(100, currentScore + adjustment));
    const newLevel = calcMasteryLevel(newScore).toUpperCase();

    // upsert
    const record = await prisma.studentMasteryRecord.upsert({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: studentId,
          course_id: courseId,
          knowledge_point_id: kpIdNum,
        },
      },
      update: {
        mastery_score: newScore,
        mastery_level: newLevel,
        question_score: Math.round(avgScorePercent * 100),
        updated_at: new Date(),
      },
      create: {
        student_user_id: studentId,
        course_id: courseId,
        knowledge_point_id: kpIdNum,
        mastery_score: newScore,
        mastery_level: newLevel,
        question_score: Math.round(avgScorePercent * 100),
        system_score: 0,
      },
    });

    updatedRecords.push({
      knowledge_point_id: kpIdNum,
      mastery_score: record.mastery_score,
      mastery_level: toLower(record.mastery_level),
      previous_score: currentScore,
      adjustment,
      avg_score_percent: Math.round(avgScorePercent * 100),
    });
  }

  // 同时更新学生画像中的 mastery_score
  try {
    const portrait = await prisma.studentPortrait.findUnique({
      where: {
        student_user_id_course_id: {
          student_user_id: studentId,
          course_id: courseId,
        },
      },
    });

    if (portrait) {
      // 重新计算所有知识点平均掌握度
      const allMastery = await prisma.studentMasteryRecord.findMany({
        where: { student_user_id: studentId, course_id: courseId },
      });
      const avgMastery = allMastery.length > 0
        ? Math.round(allMastery.reduce((sum, m) => sum + m.mastery_score, 0) / allMastery.length)
        : 0;

      await prisma.studentPortrait.update({
        where: { student_portrait_id: portrait.student_portrait_id },
        data: {
          mastery_score: avgMastery,
          updated_at: new Date(),
        },
      });
    }
  } catch (err) {
    console.error('[mastery.service] 更新学生画像掌握度失败:', err.message);
  }

  return updatedRecords;
}

/**
 * 获取学生在某课程下的全部知识点掌握度汇总
 */
async function getMasterySummary(studentId, courseId) {
  const records = await prisma.studentMasteryRecord.findMany({
    where: { student_user_id: studentId, course_id: courseId },
    include: { knowledge_point: true },
    orderBy: { mastery_score: 'asc' },
  });

  const summary = {
    weak_count: 0,
    general_count: 0,
    good_count: 0,
    excellent_count: 0,
    avg_score: 0,
    records: [],
  };

  if (records.length > 0) {
    for (const r of records) {
      const level = toLower(r.mastery_level);
      if (level === 'weak') summary.weak_count++;
      else if (level === 'general') summary.general_count++;
      else if (level === 'good') summary.good_count++;
      else if (level === 'excellent') summary.excellent_count++;
    }

    summary.avg_score = Math.round(
      records.reduce((sum, r) => sum + r.mastery_score, 0) / records.length,
    );
  }

  summary.records = records.map((r) => ({
    knowledge_point_id: r.knowledge_point_id,
    knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
    mastery_score: r.mastery_score,
    mastery_level: toLower(r.mastery_level),
    updated_at: r.updated_at ? r.updated_at.toISOString() : null,
  }));

  return summary;
}

module.exports = {
  updateMasteryAfterSubmission,
  getMasterySummary,
  calcMasteryLevel,
};
