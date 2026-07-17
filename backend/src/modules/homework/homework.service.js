// 作业模块核心业务服务
// 发布、关闭、导入试题、AI 批改、手动批改、成绩统计

const prisma = require('../../config/prisma');
const aiService = require('../../services/ai.service');
const tasks = require('../async-task/async-task.service');

// ---------- 辅助 ----------

function toInt(val, fallback = 0) {
  const n = Number.parseInt(val, 10);
  return Number.isNaN(n) ? fallback : n;
}

function now() { return new Date(); }

// ---------- 发布作业 ----------

async function createHomework(teacherId, body) {
  const { course_id, title, description, question_json, total_score, deadline } = body;

  const course = await prisma.course.findUnique({ where: { course_id } });
  if (!course) throw Object.assign(new Error('课程不存在'), { code: 40002 });

  const homework = await prisma.homework.create({
    data: {
      teacher_id: teacherId,
      course_id,
      title,
      description: description || null,
      question_json,
      total_score: total_score || 100,
      deadline: deadline ? new Date(deadline) : null,
      status: 'DRAFT',
    },
  });

  return { homework_id: homework.homework_id, title: homework.title };
}

// ---------- 更新作业草稿 ----------

async function updateHomework(homeworkId, teacherId, body) {
  const hw = await prisma.homework.findUnique({ where: { homework_id: homeworkId } });
  if (!hw) throw Object.assign(new Error('作业不存在'), { code: 40002 });
  if (hw.teacher_id !== teacherId) throw Object.assign(new Error('无权修改此作业'), { code: 40301 });

  const data = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.question_json !== undefined) data.question_json = body.question_json;
  if (body.deadline !== undefined) data.deadline = new Date(body.deadline);

  const updated = await prisma.homework.update({ where: { homework_id: homeworkId }, data });
  return { homework_id: updated.homework_id, title: updated.title };
}

// ---------- 发布 / 关闭作业 ----------

async function publishHomework(homeworkId, teacherId) {
  const hw = await prisma.homework.findUnique({ where: { homework_id: homeworkId } });
  if (!hw) throw Object.assign(new Error('作业不存在'), { code: 40002 });
  if (hw.teacher_id !== teacherId) throw Object.assign(new Error('无权操作'), { code: 40301 });
  if (hw.status !== 'DRAFT') throw Object.assign(new Error('仅草稿状态可发布'), { code: 40001 });

  const updated = await prisma.homework.update({
    where: { homework_id: homeworkId },
    data: { status: 'PUBLISHED' },
  });
  return { homework_id: updated.homework_id, status: 'PUBLISHED' };
}

async function closeHomework(homeworkId, teacherId) {
  const hw = await prisma.homework.findUnique({ where: { homework_id: homeworkId } });
  if (!hw) throw Object.assign(new Error('作业不存在'), { code: 40002 });
  if (hw.teacher_id !== teacherId) throw Object.assign(new Error('无权操作'), { code: 40301 });

  const updated = await prisma.homework.update({
    where: { homework_id: homeworkId },
    data: { status: 'CLOSED' },
  });
  return { homework_id: updated.homework_id, status: 'CLOSED' };
}

// ---------- 批量导入试题 ----------

async function importQuestions(homeworkId, teacherId, body) {
  const hw = await prisma.homework.findUnique({ where: { homework_id: homeworkId } });
  if (!hw) throw Object.assign(new Error('作业不存在'), { code: 40002 });
  if (hw.teacher_id !== teacherId) throw Object.assign(new Error('无权操作'), { code: 40301 });

  const existing = hw.question_json || [];
  const newQuestions = body.questions.map((q, i) => ({
    id: `Q_${Date.now()}_${i}`,
    ...q,
  }));
  const merged = [...existing, ...newQuestions];

  await prisma.homework.update({
    where: { homework_id: homeworkId },
    data: { question_json: merged },
  });

  return { total: merged.length, added: newQuestions.length };
}

// ---------- 作业列表 ----------

async function listHomework(teacherId, query = {}) {
  const where = { teacher_id: teacherId };
  if (query.course_id) where.course_id = toInt(query.course_id);
  if (query.status) where.status = query.status.toUpperCase();

  const page = Math.max(1, toInt(query.page, 1));
  const pageSize = Math.min(50, Math.max(1, toInt(query.page_size || query.pageSize, 10)));
  const skip = (page - 1) * pageSize;

  const [rows, total] = await Promise.all([
    prisma.homework.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.homework.count({ where }),
  ]);

  // 获取课程名和提交数（独立查询，避免跨表 relation）
  const courseIds = [...new Set(rows.map(r => r.course_id))];
  const courses = courseIds.length > 0
    ? await prisma.course.findMany({ where: { course_id: { in: courseIds } }, select: { course_id: true, course_name: true } })
    : [];
  const courseMap = {};
  courses.forEach(c => { courseMap[c.course_id] = c.course_name; });

  const hwIds = rows.map(r => r.homework_id);
  const submitCounts = hwIds.length > 0
    ? await prisma.homeworkSubmission.groupBy({ by: ['homework_id'], _count: { submission_id: true }, where: { homework_id: { in: hwIds } } })
    : [];
  const countMap = {};
  submitCounts.forEach(s => { countMap[s.homework_id] = s._count.submission_id; });

  return {
    list: rows.map(h => ({
      homework_id: h.homework_id,
      title: h.title,
      description: h.description,
      course_name: courseMap[h.course_id] || null,
      course_id: h.course_id,
      total_score: h.total_score,
      deadline: h.deadline?.toISOString() || null,
      status: h.status.toLowerCase(),
      submit_count: countMap[h.homework_id] || 0,
      created_at: h.created_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 作业详情 ----------

async function getHomeworkDetail(homeworkId, teacherId) {
  const hw = await prisma.homework.findUnique({
    where: { homework_id: homeworkId },
  });
  if (!hw) throw Object.assign(new Error('作业不存在'), { code: 40002 });

  let courseName = '';
  try {
    const course = await prisma.course.findUnique({ where: { course_id: hw.course_id }, select: { course_name: true } });
    courseName = course?.course_name || '';
  } catch (e) {}

  return {
    homework_id: hw.homework_id,
    title: hw.title,
    description: hw.description,
    course_name: courseName,
    course_id: hw.course_id,
    question_json: hw.question_json,
    total_score: hw.total_score,
    deadline: hw.deadline?.toISOString() || null,
    status: hw.status.toLowerCase(),
    created_at: hw.created_at.toISOString(),
  };
}

// ---------- 提交记录列表 ----------

async function listSubmissions(homeworkId, teacherId, query = {}) {
  const hw = await prisma.homework.findUnique({ where: { homework_id: homeworkId } });
  if (!hw) throw Object.assign(new Error('作业不存在'), { code: 40002 });

  const where = { homework_id: homeworkId };
  if (query.submit_status) where.submit_status = query.submit_status.toUpperCase();

  // 先查出所有提交（不含 mark_record 过滤，因无 Prisma 关联）
  const allRows = await prisma.homeworkSubmission.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });

  // 独立查询批改记录，用于标记过滤
  const subIds = allRows.map(r => r.submission_id);
  const markRecords = subIds.length > 0
    ? await prisma.homeworkMarkRecord.findMany({ where: { submission_id: { in: subIds } } })
    : [];
  const markedSubIds = new Set(markRecords.map(m => m.submission_id));

  // 按 mark_status 过滤
  let filtered = allRows;
  if (query.mark_status === 'marked') {
    filtered = allRows.filter(r => markedSubIds.has(r.submission_id));
  } else if (query.mark_status === 'unmarked') {
    filtered = allRows.filter(r => !markedSubIds.has(r.submission_id));
  }

  const total = filtered.length;
  const page = Math.max(1, toInt(query.page, 1));
  const pageSize = Math.min(50, Math.max(1, toInt(query.page_size || query.pageSize, 20)));
  const skip = (page - 1) * pageSize;
  const rows = filtered.slice(skip, skip + pageSize);

  // 独立查询学生姓名
  const studentIds = [...new Set(rows.map(r => r.student_id))];
  const students = studentIds.length > 0
    ? await prisma.userProfile.findMany({ where: { user_id: { in: studentIds } }, select: { user_id: true, real_name: true } })
    : [];
  const studentNameMap = {};
  students.forEach(s => { studentNameMap[s.user_id] = s.real_name; });

  // 查询当前页的批改记录
  const pageSubIds = rows.map(r => r.submission_id);
  const pageMarkRecords = pageSubIds.length > 0
    ? await prisma.homeworkMarkRecord.findMany({ where: { submission_id: { in: pageSubIds } } })
    : [];
  const markMap = {};
  pageMarkRecords.forEach(m => { markMap[m.submission_id] = m; });

  return {
    list: rows.map(s => ({
      submission_id: s.submission_id,
      student_id: s.student_id,
      student_name: studentNameMap[s.student_id] || '未知',
      submit_content: s.submit_content,
      submit_time: s.submit_time?.toISOString() || null,
      submit_status: s.submit_status.toLowerCase(),
      score: s.score,
      mark_record: markMap[s.submission_id] ? {
        mark_id: markMap[s.submission_id].mark_id,
        ai_score: markMap[s.submission_id].ai_score,
        manual_score: markMap[s.submission_id].manual_score,
        final_score: markMap[s.submission_id].final_score,
        comment: markMap[s.submission_id].comment,
        wrong_keywords: markMap[s.submission_id].wrong_keywords,
        mark_type: markMap[s.submission_id].mark_type.toLowerCase(),
        mark_time: markMap[s.submission_id].mark_time.toISOString(),
      } : null,
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- AI 自动批改单份提交 ----------

async function aiMarkSubmission(submissionId, teacherId) {
  const sub = await prisma.homeworkSubmission.findUnique({
    where: { submission_id: submissionId },
    include: { homework: true },
  });
  if (!sub) throw Object.assign(new Error('提交记录不存在'), { code: 40002 });
  if (!sub.submit_content) throw Object.assign(new Error('学生未提交内容'), { code: 40001 });

  const questions = sub.homework.question_json || [];
  const studentAnswers = sub.submit_content || {};
  let totalAiScore = 0;
  const wrongKeywords = [];

  for (const question of questions) {
    const studentAnswer = studentAnswers[question.id];
    if (!studentAnswer) continue;

    // 简答题使用 AI 评分
    if (question.type === 'SHORT_ANSWER') {
      try {
        const result = await aiService.gradeShortAnswer({
          questionContent: question.stem,
          correctAnswer: question.answer,
          answerKeywords: [],
          studentAnswer: String(studentAnswer),
          maxScore: question.score || 10,
          userId: sub.student_id,
        });
        const score = result?.score ?? 0;
        totalAiScore += score;
        if (score < (question.score || 10) * 0.6) {
          wrongKeywords.push(question.knowledgePoint || question.stem.slice(0, 20));
        }
      } catch (e) {
        totalAiScore += (question.score || 10) * 0.5;
      }
    } else {
      // 客观题：直接比较
      const isCorrect = Array.isArray(question.answer)
        ? JSON.stringify(studentAnswer.sort()) === JSON.stringify([...question.answer].sort())
        : String(studentAnswer).trim() === String(question.answer).trim();
      const score = isCorrect ? (question.score || 10) : 0;
      totalAiScore += score;
      if (!isCorrect) {
        wrongKeywords.push(question.knowledgePoint || question.stem.slice(0, 20));
      }
    }
  }

  // 创建或更新批改记录
  const existing = await prisma.homeworkMarkRecord.findUnique({
    where: { submission_id: submissionId },
  });

  const markData = {
    ai_score: totalAiScore,
    final_score: totalAiScore,
    mark_type: 'AI_AUTO',
    mark_time: new Date(),
    wrong_keywords: wrongKeywords,
    teacher_id: teacherId,
  };

  if (existing) {
    await prisma.homeworkMarkRecord.update({
      where: { mark_id: existing.mark_id },
      data: markData,
    });
  } else {
    await prisma.homeworkMarkRecord.create({
      data: { submission_id: submissionId, ...markData },
    });
  }

  // 更新 submission 分数
  await prisma.homeworkSubmission.update({
    where: { submission_id: submissionId },
    data: { score: totalAiScore },
  });

  return {
    submission_id: submissionId,
    ai_score: totalAiScore,
    wrong_keywords: wrongKeywords,
  };
}

// ---------- 批量 AI 批改（异步任务）----------

async function batchAiMarkHomework(homeworkId, teacherId, taskId) {
  const submissions = await prisma.homeworkSubmission.findMany({
    where: {
      homework_id: homeworkId,
      submit_status: { in: ['SUBMITTED', 'LATE'] },
      mark_record: null,
    },
  });

  if (taskId) {
    await tasks.updateTask(taskId, {
      status: 'RUNNING',
      progress: 0,
      stage: `开始批改 ${submissions.length} 份提交`,
    });
  }

  let completed = 0;
  const errors = [];
  for (const sub of submissions) {
    try {
      await aiMarkSubmission(sub.submission_id, teacherId);
      completed++;
    } catch (err) {
      errors.push({ submission_id: sub.submission_id, error: err.message });
    }
    if (taskId) {
      const pct = Math.round((completed / submissions.length) * 100);
      await tasks.updateTask(taskId, {
        progress: pct,
        stage: `已批改 ${completed}/${submissions.length}`,
      });
    }
  }

  if (taskId) {
    await tasks.updateTask(taskId, {
      status: errors.length === submissions.length ? 'FAILED' : 'SUCCEEDED',
      progress: 100,
      stage: `批改完成，成功 ${completed}，失败 ${errors.length}`,
    });
  }

  return { total: submissions.length, completed, errors };
}

// ---------- 手动批改 ----------

async function manualMarkSubmission(submissionId, teacherId, body) {
  const { score, comment, wrong_keywords } = body;

  const sub = await prisma.homeworkSubmission.findUnique({
    where: { submission_id: submissionId },
  });
  if (!sub) throw Object.assign(new Error('提交记录不存在'), { code: 40002 });

  // 获取 AI 分数
  const existing = await prisma.homeworkMarkRecord.findUnique({
    where: { submission_id: submissionId },
  });

  const markData = {
    manual_score: score,
    final_score: score,
    comment: comment || null,
    wrong_keywords: wrong_keywords || (existing?.wrong_keywords || null),
    mark_type: existing?.ai_score != null ? 'COMBINED' : 'TEACHER_MANUAL',
    mark_time: new Date(),
    teacher_id: teacherId,
  };

  if (existing) {
    await prisma.homeworkMarkRecord.update({
      where: { mark_id: existing.mark_id },
      data: markData,
    });
  } else {
    await prisma.homeworkMarkRecord.create({
      data: { submission_id: submissionId, ...markData },
    });
  }

  await prisma.homeworkSubmission.update({
    where: { submission_id: submissionId },
    data: { score },
  });

  return { submission_id: submissionId, final_score: score };
}

// ---------- 成绩统计 ----------

async function getScoreStats(homeworkId, teacherId) {
  const hw = await prisma.homework.findUnique({ where: { homework_id: homeworkId } });
  if (!hw) throw Object.assign(new Error('作业不存在'), { code: 40002 });

  const submissions = await prisma.homeworkSubmission.findMany({
    where: { homework_id: homeworkId, score: { not: null } },
  });

  // 独立查询批改记录
  const subIds = submissions.map(s => s.submission_id);
  const markRecords = subIds.length > 0
    ? await prisma.homeworkMarkRecord.findMany({ where: { submission_id: { in: subIds } } })
    : [];
  const markMap = {};
  markRecords.forEach(m => { markMap[m.submission_id] = m; });

  const scores = submissions.map(s => s.score);
  const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const max = scores.length > 0 ? Math.max(...scores) : 0;
  const min = scores.length > 0 ? Math.min(...scores) : 0;

  const distribution = { excellent: 0, good: 0, general: 0, weak: 0 };
  const totalScore = hw.total_score || 100;
  scores.forEach(s => {
    const rate = (s / totalScore) * 100;
    if (rate >= 90) distribution.excellent++;
    else if (rate >= 75) distribution.good++;
    else if (rate >= 60) distribution.general++;
    else distribution.weak++;
  });

  // 聚合错题关键词
  const wrongKwMap = {};
  submissions.forEach(s => {
    const mr = markMap[s.submission_id];
    if (mr?.wrong_keywords) {
      (mr.wrong_keywords || []).forEach(kw => {
        wrongKwMap[kw] = (wrongKwMap[kw] || 0) + 1;
      });
    }
  });
  const topWrongKeywords = Object.entries(wrongKwMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  return {
    total_submissions: submissions.length,
    average_score: avg,
    max_score: max,
    min_score: min,
    distribution: {
      excellent: { count: distribution.excellent, percentage: scores.length > 0 ? Math.round((distribution.excellent / scores.length) * 100) : 0, label: '优秀 (90-100分)' },
      good: { count: distribution.good, percentage: scores.length > 0 ? Math.round((distribution.good / scores.length) * 100) : 0, label: '良好 (75-89分)' },
      general: { count: distribution.general, percentage: scores.length > 0 ? Math.round((distribution.general / scores.length) * 100) : 0, label: '一般 (60-74分)' },
      weak: { count: distribution.weak, percentage: scores.length > 0 ? Math.round((distribution.weak / scores.length) * 100) : 0, label: '薄弱 (0-59分)' },
    },
    top_wrong_keywords: topWrongKeywords,
  };
}

module.exports = {
  createHomework,
  updateHomework,
  publishHomework,
  closeHomework,
  importQuestions,
  listHomework,
  getHomeworkDetail,
  listSubmissions,
  aiMarkSubmission,
  batchAiMarkHomework,
  manualMarkSubmission,
  getScoreStats,
};
