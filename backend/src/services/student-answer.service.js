// 学生端在线答题服务
// 负责开始答题、保存答案、提交批改、查看提交详情、查看解析

const prisma = require('../config/prisma');
const gradingService = require('./grading.service');
const wrongQuestionService = require('./wrong-question.service');
const masteryService = require('./mastery.service');
const aiService = require('./ai.service');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  const lower = String(value).toLowerCase();
  return lower === 'fill_blank' ? 'blank' : lower;
}

/**
 * 校验学生是否已加入指定课程
 */
async function ensureStudentInCourse(userId, courseId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: userId,
      course_id: courseId,
      enrollment_status: 'active',
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('未加入该课程或课程不存在'), { code: 40301 });
  }
  return enrollment;
}

/**
 * 解析分页参数
 */
function parsePagination(query) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.page_size, 10);
  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 50) pageSize = 50;
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}

// ========================
// 1. 开始答题
// ========================

async function startQuiz(userId, taskId, mode = 'normal') {
  // 校验任务存在
  const task = await prisma.learningTask.findUnique({
    where: { task_id: taskId },
    include: {
      course: true,
      question_links: {
        orderBy: { question_order: 'asc' },
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
            },
          },
        },
      },
      knowledge_point_links: {
        include: { knowledge_point: true },
      },
    },
  });

  if (!task) {
    throw Object.assign(new Error('任务不存在'), { code: 40002 });
  }

  // 校验课程权限
  await ensureStudentInCourse(userId, task.course_id);

  // 校验任务状态
  if (task.status !== 'PUBLISHED') {
    throw Object.assign(new Error('任务未发布或已关闭'), { code: 40001 });
  }

  // 校验截止时间
  const now = new Date();
  if (task.deadline && new Date(task.deadline) < now && !task.allow_late_submit) {
    // 检查是否已有提交
    const existingSub = await prisma.taskSubmission.findFirst({
      where: { task_id: taskId, student_user_id: userId },
    });
    if (!existingSub || existingSub.submission_status === 'IN_PROGRESS') {
      throw Object.assign(new Error('任务已截止，不允许开始答题'), { code: 40001 });
    }
  }

  // 检查是否已有提交
  const existingSubmission = await prisma.taskSubmission.findFirst({
    where: { task_id: taskId, student_user_id: userId },
    include: {
      answer_records: {
        include: { question: { include: { options: { orderBy: { option_order: 'asc' } }, knowledge_point: true } } },
      },
    },
  });

  if (existingSubmission) {
    if (existingSubmission.submission_status === 'IN_PROGRESS') {
      // 返回进行中的提交
      const questions = task.question_links.map((link) => {
        const q = link.question;
        const existingAnswer = existingSubmission.answer_records.find(
          (ar) => ar.question_id === q.question_id,
        );
        return {
          question_id: q.question_id,
          question_type: toLower(q.question_type),
          question_content: q.content,
          title: q.title,
          difficulty_level: toLower(q.difficulty_level),
          score: q.score,
          question_order: link.question_order,
          is_ai_generated: q.is_ai_generated || false,
          knowledge_points: q.knowledge_point
            ? [{ knowledge_point_id: q.knowledge_point.knowledge_point_id, knowledge_point_name: q.knowledge_point.knowledge_point_name }]
            : [],
          options: q.options.map((opt) => ({
            option_id: opt.option_id,
            option_label: opt.option_key,
            option_content: opt.option_content,
          })),
          draft_answer: existingAnswer ? existingAnswer.answer_content : null,
        };
      });

      const totalScore = task.question_links.reduce((sum, l) => sum + (l.question.score || 0), 0);

      return {
        submission: {
          submission_id: existingSubmission.submission_id,
          task_id: existingSubmission.task_id,
          status: toLower(existingSubmission.submission_status),
          started_at: existingSubmission.started_at ? existingSubmission.started_at.toISOString() : null,
          submitted_at: existingSubmission.submitted_at ? existingSubmission.submitted_at.toISOString() : null,
          score: existingSubmission.total_score,
          total_score: totalScore,
        },
        task: {
          task_id: task.task_id,
          task_title: task.title,
          task_type: toLower(task.task_type),
          deadline: task.deadline ? task.deadline.toISOString() : null,
          allow_late_submit: task.allow_late_submit,
        },
        questions,
      };
    }

    // 已提交/已批改：返回已提交状态
    if (existingSubmission.submission_status === 'SUBMITTED' || existingSubmission.submission_status === 'GRADED') {
      return {
        submission: {
          submission_id: existingSubmission.submission_id,
          task_id: existingSubmission.task_id,
          status: toLower(existingSubmission.submission_status),
          started_at: existingSubmission.started_at ? existingSubmission.started_at.toISOString() : null,
          submitted_at: existingSubmission.submitted_at ? existingSubmission.submitted_at.toISOString() : null,
          score: existingSubmission.total_score,
          total_score: task.question_links.reduce((sum, l) => sum + (l.question.score || 0), 0),
          grading_status: toLower(existingSubmission.grading_status),
        },
        task: {
          task_id: task.task_id,
          task_title: task.title,
          task_type: toLower(task.task_type),
          deadline: task.deadline ? task.deadline.toISOString() : null,
        },
        message: '您已完成此任务，不可重复答题',
      };
    }
  }

  // 检查题目是否为空
  if (task.question_links.length === 0) {
    throw Object.assign(new Error('该任务暂无题目'), { code: 40002 });
  }

  // 创建新提交
  const newSubmission = await prisma.taskSubmission.create({
    data: {
      task_id: taskId,
      student_user_id: userId,
      started_at: new Date(),
      submission_status: 'IN_PROGRESS',
    },
  });

  // 构建题目列表（不含 correct_answer）
  const questions = task.question_links.map((link) => {
    const q = link.question;
    return {
      question_id: q.question_id,
      question_type: toLower(q.question_type),
      question_content: q.content,
      title: q.title,
      difficulty_level: toLower(q.difficulty_level),
      score: q.score,
      question_order: link.question_order,
      is_ai_generated: q.is_ai_generated || false,
      knowledge_points: q.knowledge_point
        ? [{ knowledge_point_id: q.knowledge_point.knowledge_point_id, knowledge_point_name: q.knowledge_point.knowledge_point_name }]
        : [],
      options: q.options.map((opt) => ({
        option_id: opt.option_id,
        option_label: opt.option_key,
        option_content: opt.option_content,
      })),
    };
  });

  const totalScore = task.question_links.reduce((sum, l) => sum + (l.question.score || 0), 0);

  return {
    submission: {
      submission_id: newSubmission.submission_id,
      task_id: newSubmission.task_id,
      status: toLower(newSubmission.submission_status),
      started_at: newSubmission.started_at ? newSubmission.started_at.toISOString() : null,
      submitted_at: null,
      score: null,
      total_score: totalScore,
    },
    task: {
      task_id: task.task_id,
      task_title: task.title,
      task_type: toLower(task.task_type),
      deadline: task.deadline ? task.deadline.toISOString() : null,
      allow_late_submit: task.allow_late_submit,
    },
    questions,
  };
}

// ========================
// 2. 保存答案草稿
// ========================

async function saveAnswers(userId, submissionId, answers) {
  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    throw Object.assign(new Error('答案列表不能为空'), { code: 40001 });
  }

  // 校验 submission
  const submission = await prisma.taskSubmission.findUnique({
    where: { submission_id: submissionId },
    include: { task: { include: { question_links: true } } },
  });

  if (!submission) {
    throw Object.assign(new Error('提交记录不存在'), { code: 40002 });
  }

  if (submission.student_user_id !== userId) {
    throw Object.assign(new Error('无权操作该提交记录'), { code: 40301 });
  }

  if (submission.submission_status !== 'IN_PROGRESS') {
    throw Object.assign(new Error('该提交已结束，无法保存答案'), { code: 40001 });
  }

  // 校验题目属于该任务
  const taskQuestionIds = new Set(submission.task.question_links.map((l) => l.question_id));

  let savedCount = 0;
  const now = new Date();

  for (const answer of answers) {
    if (!taskQuestionIds.has(answer.question_id)) {
      continue; // 跳过不属于该任务的题目
    }

    // 处理 answer_content：确保以 JSON 兼容格式存储
    let answerContent = answer.answer_content;
    if (typeof answerContent !== 'string') {
      answerContent = JSON.stringify(answerContent);
    }

    // 查找已有记录
    const existing = await prisma.answerRecord.findFirst({
      where: {
        student_user_id: userId,
        question_id: answer.question_id,
        task_id: submission.task_id,
        submission_id: submissionId,
      },
    });

    if (existing) {
      await prisma.answerRecord.update({
        where: { answer_record_id: existing.answer_record_id },
        data: {
          answer_content: answerContent,
          submitted_at: now,
        },
      });
    } else {
      await prisma.answerRecord.create({
        data: {
          student_user_id: userId,
          question_id: answer.question_id,
          task_id: submission.task_id,
          submission_id: submissionId,
          answer_content: answerContent,
          started_at: now,
          submitted_at: now,
          attempt_no: 1,
        },
      });
    }
    savedCount++;
  }

  return {
    submission_id: submissionId,
    saved_count: savedCount,
  };
}

// ========================
// 3. 提交答案并自动批改
// ========================

async function submitTask(userId, taskId, submissionId, answers) {
  // 校验任务存在
  const task = await prisma.learningTask.findUnique({
    where: { task_id: taskId },
    include: {
      question_links: {
        orderBy: { question_order: 'asc' },
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
            },
          },
        },
      },
      knowledge_point_links: true,
    },
  });

  if (!task) {
    throw Object.assign(new Error('任务不存在'), { code: 40002 });
  }

  await ensureStudentInCourse(userId, task.course_id);

  // 校验 submission
  const submission = await prisma.taskSubmission.findUnique({
    where: { submission_id: submissionId },
  });

  if (!submission) {
    throw Object.assign(new Error('提交记录不存在，请先开始答题'), { code: 40002 });
  }

  if (submission.student_user_id !== userId) {
    throw Object.assign(new Error('无权操作该提交记录'), { code: 40301 });
  }

  if (submission.task_id !== taskId) {
    throw Object.assign(new Error('提交记录与任务不匹配'), { code: 40001 });
  }

  if (submission.submission_status === 'SUBMITTED' || submission.submission_status === 'GRADED') {
    throw Object.assign(new Error('已提交，不可重复提交'), { code: 40001 });
  }

  // 处理截止时间
  const now = new Date();
  let isLate = false;
  if (task.deadline && new Date(task.deadline) < now) {
    if (!task.allow_late_submit) {
      throw Object.assign(new Error('任务已截止，不允许提交'), { code: 40001 });
    }
    isLate = true;
  }

  // 先保存最新答案
  if (answers && Array.isArray(answers) && answers.length > 0) {
    const taskQuestionIds = new Set(task.question_links.map((l) => l.question_id));
    for (const answer of answers) {
      if (!taskQuestionIds.has(answer.question_id)) continue;

      let answerContent = answer.answer_content;
      if (typeof answerContent !== 'string') {
        answerContent = JSON.stringify(answerContent);
      }

      const existing = await prisma.answerRecord.findFirst({
        where: {
          student_user_id: userId,
          question_id: answer.question_id,
          task_id: taskId,
          submission_id: submissionId,
        },
      });

      if (existing) {
        await prisma.answerRecord.update({
          where: { answer_record_id: existing.answer_record_id },
          data: { answer_content: answerContent, submitted_at: now },
        });
      } else {
        await prisma.answerRecord.create({
          data: {
            student_user_id: userId,
            question_id: answer.question_id,
            task_id: taskId,
            submission_id: submissionId,
            answer_content: answerContent,
            started_at: now,
            submitted_at: now,
            attempt_no: 1,
          },
        });
      }
    }
  }

  // 获取所有已保存的答题记录
  const answerRecords = await prisma.answerRecord.findMany({
    where: { submission_id: submissionId, student_user_id: userId },
  });

  if (answerRecords.length === 0) {
    throw Object.assign(new Error('未作答任何题目'), { code: 40001 });
  }

  // 构建 answerMap 和 questionMap
  const answerMap = {};
  for (const ar of answerRecords) {
    answerMap[ar.question_id] = ar.answer_content;
  }

  const questionMap = {};
  for (const link of task.question_links) {
    questionMap[link.question_id] = link.question;
  }

  // 批改所有题目
  const questions = task.question_links.map((l) => l.question);
  const gradingResults = await gradingService.gradeAnswers(questions, answerMap, userId);

  // 使用事务更新数据
  const transactionResult = await prisma.$transaction(async (tx) => {
    // 更新每条 answer_record
    const updatedAnswers = [];
    let totalScore = 0;
    let objectiveScore = 0;
    let aiScore = 0;
    let autoGradedCount = 0;
    let aiGradedCount = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let needsAiGrading = false;

    for (const result of gradingResults) {
      const updateData = {
        is_correct: result.is_correct,
        score: result.score ?? 0,
        max_score: result.max_score,
        grading_status: result.grading_status.toUpperCase(),
        feedback: result.feedback || null,
        submitted_at: now,
      };

      await tx.answerRecord.updateMany({
        where: {
          student_user_id: userId,
          question_id: result.question_id,
          submission_id: submissionId,
        },
        data: updateData,
      });

      // AI 批改记录
      if (result.ai_grading) {
        await tx.aiGradingRecord.create({
          data: {
            answer_record_id: answerRecords.find((ar) => ar.question_id === result.question_id)?.answer_record_id || 0,
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
        aiGradedCount++;
        aiScore += result.score || 0;
      } else if (result.grading_status === 'auto_graded') {
        autoGradedCount++;
        objectiveScore += result.score || 0;
      }

      if (result.grading_status === 'pending') {
        needsAiGrading = true;
      }

      totalScore += result.score || 0;

      if (result.is_correct === true) {
        correctCount++;
      } else {
        wrongCount++;
      }

      updatedAnswers.push({
        question_id: result.question_id,
        is_correct: result.is_correct,
        score: result.score,
        total_score: result.max_score,
        grading_status: result.grading_status,
        answer_analysis: result.feedback,
      });
    }

    // 更新 submission
    const gradingStatus = needsAiGrading ? 'PENDING' : (aiGradedCount > 0 ? 'AI_GRADED' : 'AUTO_GRADED');
    const submissionStatus = gradingStatus === 'PENDING' ? 'SUBMITTED' : 'GRADED';

    const totalPossibleScore = task.question_links.reduce((sum, l) => sum + (l.question.score || 0), 0);

    await tx.taskSubmission.update({
      where: { submission_id: submissionId },
      data: {
        submitted_at: now,
        duration_seconds: submission.started_at
          ? Math.round((now - new Date(submission.started_at)) / 1000)
          : 0,
        is_late: isLate,
        total_score: totalScore,
        objective_score: objectiveScore,
        ai_score: aiScore,
        submission_status: submissionStatus,
        grading_status: gradingStatus,
      },
    });

    return {
      updatedAnswers,
      totalScore,
      totalPossibleScore,
      correctCount,
      wrongCount,
      autoGradedCount,
      aiGradedCount,
      questionCount: gradingResults.length,
      submissionStatus,
      gradingStatus,
    };
  });

  // 错题处理
  const wrongQuestionResult = await wrongQuestionService.createOrUpdateWrongQuestions({
    studentId: userId,
    submissionId,
    answerResults: transactionResult.updatedAnswers,
    questionMap,
  });

  // 掌握度更新
  const masteryResults = await masteryService.updateMasteryAfterSubmission({
    studentId: userId,
    courseId: task.course_id,
    answerResults: transactionResult.updatedAnswers,
    questionMap,
  });

  // 生成推荐
  let recommendations = [];
  try {
    const weakKps = masteryResults.filter((r) => r.mastery_level === 'weak');
    if (weakKps.length > 0) {
      // 创建推荐记录
      const recRecord = await prisma.recommendationRecord.create({
        data: {
          student_user_id: userId,
          course_id: task.course_id,
          recommend_type: 'KNOWLEDGE_POINT',
          reason_summary: `测验"${task.title}"中以下知识点需要加强复习：${weakKps.map((kp) => kp.knowledge_point_id).join(',')}`,
        },
      });

      // 创建推荐项
      const recItems = [];
      for (const kp of weakKps) {
        const kpInfo = task.knowledge_point_links.find((l) => l.knowledge_point_id === kp.knowledge_point_id);
        const kpName = kpInfo?.knowledge_point?.knowledge_point_name || `知识点 ${kp.knowledge_point_id}`;

        const item = await prisma.recommendationItem.create({
          data: {
            recommendation_record_id: recRecord.recommendation_record_id,
            item_type: 'knowledge_point',
            target_type: 'knowledge_point',
            target_id: kp.knowledge_point_id,
            title: `复习 ${kpName}`,
            reason: `本次测验该知识点得分率 ${kp.avg_score_percent}%，需要加强学习。`,
            rank: recItems.length + 1,
            content: {
              knowledge_point_id: kp.knowledge_point_id,
              knowledge_point_name: kpName,
              mastery_score: kp.mastery_score,
              mastery_level: kp.mastery_level,
            },
          },
        });
        recItems.push(item);
      }

      recommendations = recItems.map((item) => ({
        recommend_type: item.item_type,
        title: item.title,
        reason: item.reason,
        target_type: item.target_type,
        target_id: item.target_id,
      }));
    }
  } catch (recErr) {
    console.error('[student-answer.service] 生成推荐失败:', recErr.message);
  }

  // 构建返回
  return {
    submission: {
      submission_id: submissionId,
      task_id: taskId,
      status: toLower(transactionResult.submissionStatus),
      score: transactionResult.totalScore,
      total_score: transactionResult.totalPossibleScore,
      submitted_at: now.toISOString(),
      grading_status: toLower(transactionResult.gradingStatus),
      is_late: isLate,
    },
    summary: {
      question_count: transactionResult.questionCount,
      correct_count: transactionResult.correctCount,
      wrong_count: transactionResult.wrongCount,
      auto_graded_count: transactionResult.autoGradedCount,
      ai_graded_count: transactionResult.aiGradedCount,
      new_wrong_question_count: wrongQuestionResult.created,
    },
    answers: transactionResult.updatedAnswers,
    recommendations,
    mastery_changes: masteryResults.map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      mastery_score: r.mastery_score,
      mastery_level: r.mastery_level,
      score_change: r.adjustment,
    })),
  };
}

// ========================
// 4. 查看提交详情
// ========================

async function getSubmission(userId, submissionId) {
  const submission = await prisma.taskSubmission.findUnique({
    where: { submission_id: submissionId },
    include: {
      task: {
        include: {
          course: true,
          question_links: {
            orderBy: { question_order: 'asc' },
            include: {
              question: {
                include: {
                  options: { orderBy: { option_order: 'asc' } },
                  knowledge_point: true,
                },
              },
            },
          },
        },
      },
      answer_records: {
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
            },
          },
          ai_grading_records: true,
        },
      },
    },
  });

  if (!submission) {
    throw Object.assign(new Error('提交记录不存在'), { code: 40002 });
  }

  if (submission.student_user_id !== userId) {
    throw Object.assign(new Error('无权查看该提交记录'), { code: 40301 });
  }

  // 获取错题状态
  const questionIds = submission.answer_records.map((ar) => ar.question_id);
  const wrongQuestions = await prisma.wrongQuestion.findMany({
    where: {
      student_user_id: userId,
      question_id: { in: questionIds },
    },
  });
  const wqMap = {};
  for (const wq of wrongQuestions) {
    wqMap[wq.question_id] = wq;
  }

  // 构建答案列表
  const answers = submission.answer_records.map((ar) => {
    const wq = wqMap[ar.question_id];
    const aiGrading = ar.ai_grading_records?.[0];
    return {
      question_id: ar.question_id,
      question_type: ar.question ? toLower(ar.question.question_type) : null,
      question_content: ar.question?.content || null,
      question_title: ar.question?.title || null,
      difficulty_level: ar.question ? toLower(ar.question.difficulty_level) : null,
      knowledge_point: ar.question?.knowledge_point
        ? {
            knowledge_point_id: ar.question.knowledge_point.knowledge_point_id,
            knowledge_point_name: ar.question.knowledge_point.knowledge_point_name,
          }
        : null,
      options: (ar.question?.options || []).map((opt) => ({
        option_label: opt.option_key,
        option_content: opt.option_content,
      })),
      student_answer: ar.answer_content,
      correct_answer: ar.question?.correct_answer || null,
      answer_analysis: ar.question?.analysis || ar.feedback || null,
      is_correct: ar.is_correct,
      score: ar.score,
      total_score: ar.max_score || ar.question?.score || 0,
      grading_status: toLower(ar.grading_status),
      feedback: ar.feedback,
      ai_grading: aiGrading
        ? {
            score: aiGrading.score,
            total_score: aiGrading.total_score,
            comment: aiGrading.comment,
            rubric_matched: aiGrading.rubric_matched,
            rubric_missing: aiGrading.rubric_missing,
            is_ai_generated: aiGrading.is_ai_generated,
            ai_provider: aiGrading.ai_provider,
            model_name: aiGrading.model_name,
          }
        : null,
      wrong_question_status: wq ? toLower(wq.status) : null,
    };
  });

  const totalPossibleScore = submission.task.question_links.reduce(
    (sum, l) => sum + (l.question.score || 0), 0,
  );

  return {
    submission: {
      submission_id: submission.submission_id,
      task_id: submission.task_id,
      status: toLower(submission.submission_status),
      grading_status: toLower(submission.grading_status),
      started_at: submission.started_at ? submission.started_at.toISOString() : null,
      submitted_at: submission.submitted_at ? submission.submitted_at.toISOString() : null,
      duration_seconds: submission.duration_seconds,
      is_late: submission.is_late,
      score: submission.total_score,
      total_score: totalPossibleScore,
      objective_score: submission.objective_score,
      ai_score: submission.ai_score,
    },
    task: {
      task_id: submission.task.task_id,
      task_title: submission.task.title,
      task_type: toLower(submission.task.task_type),
      course_id: submission.task.course_id,
      course_name: submission.task.course.course_name,
      deadline: submission.task.deadline ? submission.task.deadline.toISOString() : null,
    },
    answers,
  };
}

// ========================
// 5. 查看题目解析
// ========================

async function getQuestionAnalysis(userId, questionId, submissionId) {
  // 校验题目存在
  const question = await prisma.question.findUnique({
    where: { question_id: questionId },
    include: {
      options: { orderBy: { option_order: 'asc' } },
      knowledge_point: true,
      course: true,
    },
  });

  if (!question) {
    throw Object.assign(new Error('题目不存在'), { code: 40002 });
  }

  // 校验 submission
  let submission = null;
  if (submissionId) {
    submission = await prisma.taskSubmission.findUnique({
      where: { submission_id: submissionId },
    });

    if (!submission) {
      throw Object.assign(new Error('提交记录不存在'), { code: 40002 });
    }

    if (submission.student_user_id !== userId) {
      throw Object.assign(new Error('无权查看'), { code: 40301 });
    }

    // 检查是否已提交
    if (submission.submission_status === 'IN_PROGRESS') {
      throw Object.assign(new Error('请先提交后再查看解析'), { code: 40301 });
    }
  } else {
    // 如果没有传 submission_id，检查是否有任何已提交的 submission 包含此题
    submission = await prisma.taskSubmission.findFirst({
      where: {
        student_user_id: userId,
        submission_status: { in: ['SUBMITTED', 'GRADED'] },
        answer_records: { some: { question_id: questionId } },
      },
    });

    if (!submission) {
      throw Object.assign(new Error('请先提交包含此题的测验后再查看解析'), { code: 40301 });
    }
  }

  // 获取学生的答案
  const answerRecord = await prisma.answerRecord.findFirst({
    where: {
      student_user_id: userId,
      question_id: questionId,
      submission_id: submission.submission_id,
    },
    include: {
      ai_grading_records: true,
    },
  });

  // 获取错题状态
  const wrongQuestion = await prisma.wrongQuestion.findUnique({
    where: {
      student_user_id_question_id: {
        student_user_id: userId,
        question_id: questionId,
      },
    },
  });

  return {
    question: {
      question_id: question.question_id,
      question_type: toLower(question.question_type),
      question_content: question.content,
      title: question.title,
      difficulty_level: toLower(question.difficulty_level),
      score: question.score,
      course: {
        course_id: question.course.course_id,
        course_name: question.course.course_name,
      },
      knowledge_point: question.knowledge_point
        ? {
            knowledge_point_id: question.knowledge_point.knowledge_point_id,
            knowledge_point_name: question.knowledge_point.knowledge_point_name,
          }
        : null,
      options: question.options.map((opt) => ({
        option_label: opt.option_key,
        option_content: opt.option_content,
      })),
      correct_answer: question.correct_answer,
      answer_analysis: question.analysis,
      is_ai_generated: question.is_ai_generated,
    },
    student_answer: answerRecord
      ? {
          answer_content: answerRecord.answer_content,
          is_correct: answerRecord.is_correct,
          score: answerRecord.score,
          total_score: answerRecord.max_score || question.score,
          grading_status: toLower(answerRecord.grading_status),
          feedback: answerRecord.feedback,
          ai_grading: answerRecord.ai_grading_records?.[0]
            ? {
                score: answerRecord.ai_grading_records[0].score,
                comment: answerRecord.ai_grading_records[0].comment,
                rubric_matched: answerRecord.ai_grading_records[0].rubric_matched,
                rubric_missing: answerRecord.ai_grading_records[0].rubric_missing,
              }
            : null,
        }
      : null,
    wrong_question_status: wrongQuestion ? toLower(wrongQuestion.status) : null,
  };
}

module.exports = {
  startQuiz,
  saveAnswers,
  submitTask,
  getSubmission,
  getQuestionAnalysis,
};
