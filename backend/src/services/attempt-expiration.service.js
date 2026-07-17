// Attempt Expiration Service
// 定时扫描过期的答题会话并自动交卷
// 状态机：IN_PROGRESS → SUBMITTING → SUBMITTED

const prisma = require('../config/prisma');
const gradingService = require('./grading.service');
const wrongQuestionService = require('./wrong-question.service');
const masteryService = require('./mastery.service');

const SUBMIT_REASON = {
  USER_SUBMIT: 'USER_SUBMIT',
  TIMEOUT_AUTO_SUBMIT: 'TIMEOUT_AUTO_SUBMIT',
  TEACHER_FORCE_SUBMIT: 'TEACHER_FORCE_SUBMIT',
  SYSTEM_RECOVERY: 'SYSTEM_RECOVERY',
};

// 状态常量（与 practice.service.js 保持一致）
const SESSION_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTING: 'SUBMITTING',
  SUBMITTED: 'SUBMITTED',
};

// 限时类型（普通练习不参与自动交卷）
const TIMED_SOURCE_TYPES = ['MOCK_EXAM', 'TEACHER_TASK'];

// SUBMITTING 状态超时恢复：超过 5 分钟仍停留在 SUBMITTING 视为异常
const SUBMITTING_RECOVERY_MS = 5 * 60 * 1000;

/**
 * 扫描并提交所有过期 attempt
 */
async function scanAndSubmitExpiredAttempts() {
  const now = new Date();

  // 1. 查找所有过期的进行中会话
  const expiredSessions = await prisma.practiceSession.findMany({
    where: {
      status: SESSION_STATUS.IN_PROGRESS,
      expires_at: { lte: now },
      source_type: { in: TIMED_SOURCE_TYPES },
    },
  });

  let submitted = 0;
  let failed = 0;

  for (const session of expiredSessions) {
    try {
      await submitExpiredAttempt(session.practice_session_id);
      submitted++;
    } catch (err) {
      failed++;
      console.error(
        `[AttemptExpiration] 自动交卷失败 session=${session.practice_session_id}:`,
        err.message,
      );
    }
  }

  // 2. 恢复长时间停留在 SUBMITTING 的会话
  const stuckSessions = await prisma.practiceSession.findMany({
    where: {
      status: SESSION_STATUS.SUBMITTING,
      updated_at: { lte: new Date(now - SUBMITTING_RECOVERY_MS) },
    },
  });

  for (const session of stuckSessions) {
    try {
      // 原子恢复：SUBMITTING → IN_PROGRESS（带状态条件防止并发冲突）
      const recovered = await prisma.practiceSession.updateMany({
        where: { practice_session_id: session.practice_session_id, status: SESSION_STATUS.SUBMITTING },
        data: { status: SESSION_STATUS.IN_PROGRESS },
      });
      if (recovered.count === 0) continue; // 已被其他进程处理
      await submitExpiredAttempt(session.practice_session_id, SUBMIT_REASON.SYSTEM_RECOVERY);
      submitted++;
    } catch (err) {
      console.error(
        `[AttemptExpiration] 恢复提交失败 session=${session.practice_session_id}:`,
        err.message,
      );
    }
  }

  if (submitted > 0 || failed > 0 || stuckSessions.length > 0) {
    console.log(
      `[AttemptExpiration] 扫描完成: 提交=${submitted}, 失败=${failed}, 恢复=${stuckSessions.length}`,
    );
  }
}

/**
 * 提交单个过期 attempt（幂等）
 */
async function submitExpiredAttempt(sessionId, reason = SUBMIT_REASON.TIMEOUT_AUTO_SUBMIT) {
  // 1. 原子抢占：IN_PROGRESS → SUBMITTING
  const updated = await prisma.practiceSession.updateMany({
    where: { practice_session_id: sessionId, status: SESSION_STATUS.IN_PROGRESS },
    data: { status: SESSION_STATUS.SUBMITTING },
  });

  if (updated.count === 0) {
    // 已被其他进程处理或状态不是 IN_PROGRESS
    return;
  }

  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      // 2. 加载会话及题目关联
      const session = await tx.practiceSession.findUnique({
        where: { practice_session_id: sessionId },
        include: {
          questions: {
            include: {
              question: {
                include: {
                  options: { orderBy: { option_order: 'asc' } },
                  knowledge_point: true,
                },
              },
            },
            orderBy: { question_order: 'asc' },
          },
          answer_records: true,
        },
      });

      if (!session) return;

      // 3. 构建 question map 和 answer map
      const questionMap = {};
      const questions = [];
      for (const sq of session.questions) {
        const q = sq.question;
        questionMap[q.question_id] = q;
        questions.push(q);
      }

      const answerMap = {};
      for (const ar of session.answer_records) {
        answerMap[ar.question_id] = ar.answer_content;
      }

      // 4. 批改所有题目（未作答按空答案处理）
      const gradingResults = await gradingService.gradeAnswers(
        questions,
        answerMap,
        session.student_user_id,
      );

      // 5. 更新每条 AnswerRecord
      let totalScore = 0;
      let correctCount = 0;
      let wrongCount = 0;

      for (const result of gradingResults) {
        const existingRecord = session.answer_records.find(
          (ar) => ar.question_id === result.question_id,
        );

        const updateData = {
          is_correct: result.is_correct,
          score: result.score ?? 0,
          max_score: result.max_score,
          grading_status: result.grading_status?.toUpperCase?.() || result.grading_status || 'AUTO_GRADED',
          feedback: result.feedback || null,
          submitted_at: now,
        };

        if (existingRecord) {
          await tx.answerRecord.update({
            where: { answer_record_id: existingRecord.answer_record_id },
            data: updateData,
          });
        } else {
          // 未作答题目创建空答案记录
          await tx.answerRecord.create({
            data: {
              student_user_id: session.student_user_id,
              question_id: result.question_id,
              practice_session_id: sessionId,
              answer_content: '',
              started_at: session.started_at,
              submitted_at: now,
              attempt_no: 1,
              item_status: 'GRADED',
              ...updateData,
            },
          });
        }

        // AI 批改记录
        if (result.ai_grading) {
          const ar = existingRecord || (await tx.answerRecord.findFirst({
            where: { practice_session_id: sessionId, question_id: result.question_id },
          }));
          if (ar) {
            await tx.aiGradingRecord.create({
              data: {
                answer_record_id: ar.answer_record_id,
                score: result.ai_grading.score,
                total_score: result.ai_grading.total_score,
                comment: result.ai_grading.comment || '',
                rubric_matched: result.ai_grading.rubric_matched || [],
                rubric_missing: result.ai_grading.rubric_missing || [],
                is_ai_generated: result.ai_grading.is_ai_generated || false,
                ai_provider: result.ai_grading.ai_provider || null,
                model_name: result.ai_grading.model_name || null,
              },
            });
          }
        }

        totalScore += result.score || 0;
        if (result.is_correct) correctCount++;
        else wrongCount++;
      }

      // 6. 计算用时
      const durationSeconds = session.started_at
        ? Math.round((now - new Date(session.started_at)) / 1000)
        : 0;

      // 7. 更新 PracticeSession 为已提交
      await tx.practiceSession.update({
        where: { practice_session_id: sessionId },
        data: {
          status: SESSION_STATUS.SUBMITTED,
          submitted_at: now,
          duration_seconds: durationSeconds,
          total_score: totalScore,
          correct_count: correctCount,
          wrong_count: wrongCount,
          submit_reason: reason,
        },
      });
    });

    // 8. 异步处理错题和掌握度（事务外，避免长时间锁）
    try {
      const session = await prisma.practiceSession.findUnique({
        where: { practice_session_id: sessionId },
        include: {
          answer_records: true,
          questions: { include: { question: true } },
        },
      });

      if (session && session.answer_records.length > 0) {
        const questionMap = {};
        for (const sq of session.questions) {
          questionMap[sq.question_id] = sq.question;
        }

        const answerResults = session.answer_records.map((ar) => ({
          question_id: ar.question_id,
          is_correct: ar.is_correct,
          score: ar.score,
        }));

        await wrongQuestionService.createOrUpdateWrongQuestions({
          studentId: session.student_user_id,
          submissionId: sessionId,
          answerResults,
          questionMap,
          sourceType: 'practice',
        });

        await masteryService.updateMasteryAfterSubmission({
          studentId: session.student_user_id,
          courseId: session.course_id,
          answerResults,
          questionMap,
        });
      }
    } catch (err) {
      console.error(
        `[AttemptExpiration] 错题/掌握度处理失败 session=${sessionId}:`,
        err.message,
      );
    }

    console.log(`[AttemptExpiration] 自动交卷成功 session=${sessionId} reason=${reason}`);
  } catch (err) {
    // 事务失败，尝试回退状态
    try {
      await prisma.practiceSession.updateMany({
        where: { practice_session_id: sessionId, status: SESSION_STATUS.SUBMITTING },
        data: { status: SESSION_STATUS.IN_PROGRESS },
      });
    } catch {}
    throw err;
  }
}

/**
 * 请求时兜底检查：判断 attempt 是否已过期，过期则自动提交
 * @returns {boolean} 是否已经触发自动提交
 */
async function checkAndExpireIfNeeded(sessionId) {
  const session = await prisma.practiceSession.findUnique({
    where: { practice_session_id: sessionId },
  });

  if (!session) return false;
  if (session.status !== SESSION_STATUS.IN_PROGRESS) return false;
  if (!session.expires_at) return false;
  if (new Date(session.expires_at) > new Date()) return false;

  // 已过期，自动提交
  await submitExpiredAttempt(sessionId);
  return true;
}

module.exports = {
  SUBMIT_REASON,
  scanAndSubmitExpiredAttempts,
  submitExpiredAttempt,
  checkAndExpireIfNeeded,
};
