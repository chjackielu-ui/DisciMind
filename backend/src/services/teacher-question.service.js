// 教师端题库管理服务

const prisma = require('../config/prisma');
const { getAccessibleCourseIds, ensureCourseAccess } = require('./teacher-access.service');
const aiService = require('./ai.service');

const QUESTION_TYPE_MAP = {
  single_choice: 'SINGLE_CHOICE',
  multiple_choice: 'MULTIPLE_CHOICE',
  true_false: 'TRUE_FALSE',
  fill_blank: 'FILL_BLANK',
  blank: 'BLANK',
  short_answer: 'SHORT_ANSWER',
  programming: 'PROGRAMMING',
};

const DIFFICULTY_MAP = {
  basic: 'BASIC',
  medium: 'MEDIUM',
  hard: 'HARD',
};

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

// ---------- 题目列表 ----------

async function listQuestions(user, query) {
  const courseIds = await getAccessibleCourseIds(user);
  const where = {};
  if (courseIds) where.course_id = { in: courseIds };

  if (query.course_id) {
    const cid = Number.parseInt(query.course_id, 10);
    await ensureCourseAccess(user, cid);
    where.course_id = cid;
  }
  if (query.knowledge_point_id) {
    where.knowledge_point_id = Number.parseInt(query.knowledge_point_id, 10);
  }
  if (query.question_type) {
    const qt = QUESTION_TYPE_MAP[query.question_type];
    if (qt) where.question_type = qt;
  }
  if (query.difficulty_level) {
    const dl = DIFFICULTY_MAP[query.difficulty_level];
    if (dl) where.difficulty_level = dl;
  }
  if (query.source) where.is_ai_generated = query.source === 'ai';
  if (query.created_by_user_id) where.created_by_user_id = Number(query.created_by_user_id);
  if (query.status) where.status = query.status;
  else where.status = { not: 'deleted' };
  if (query.keyword) {
    where.OR = [
      { title: { contains: query.keyword } },
      { content: { contains: query.keyword } },
    ];
  }

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));
  const skip = (page - 1) * pageSize;

  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: { select: { course_name: true } },
        knowledge_point: { select: { knowledge_point_name: true } },
        creator: { include: { profile: true } },
        _count: { select: { answer_records: true, wrong_questions: true } },
      },
    }),
    prisma.question.count({ where }),
  ]);
  const questionIds = questions.map((item) => item.question_id);
  const answerStats = questionIds.length
    ? await prisma.answerRecord.groupBy({
        by: ['question_id', 'is_correct'],
        where: { question_id: { in: questionIds } },
        _count: { answer_record_id: true },
      })
    : [];
  const statMap = new Map();
  answerStats.forEach((item) => {
    const current = statMap.get(item.question_id) || { total: 0, correct: 0 };
    current.total += item._count.answer_record_id;
    if (item.is_correct === true) current.correct += item._count.answer_record_id;
    statMap.set(item.question_id, current);
  });

  return {
    list: questions.map((q) => ({
      question_id: q.question_id,
      title: q.title,
      question_type: toLower(q.question_type),
      difficulty_level: toLower(q.difficulty_level),
      course_id: q.course_id,
      course_name: q.course?.course_name || null,
      knowledge_point_id: q.knowledge_point_id,
      knowledge_point_name: q.knowledge_point?.knowledge_point_name || null,
      score: q.score,
      is_ai_generated: q.is_ai_generated,
      status: q.status,
      usage_count: q._count.answer_records,
      wrong_count: q._count.wrong_questions,
      correct_rate: statMap.get(q.question_id)?.total
        ? Math.round((statMap.get(q.question_id).correct / statMap.get(q.question_id).total) * 1000) / 10
        : null,
      created_by_name: q.creator?.profile?.real_name || q.creator?.username || null,
      created_at: q.created_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 创建题目 ----------

async function createQuestion(user, body) {
  const { course_id, knowledge_point_id, question_type, title, content, options, correct_answer, analysis, difficulty_level, score } = body;

  if (!course_id || !title || !question_type || correct_answer == null) {
    throw Object.assign(new Error('course_id、title、question_type、correct_answer 为必填项'), { code: 40001 });
  }

  await ensureCourseAccess(user, course_id);

  const qt = QUESTION_TYPE_MAP[question_type];
  if (!qt) throw Object.assign(new Error('不支持的题目类型'), { code: 40001 });

  const question = await prisma.question.create({
    data: {
      course_id,
      knowledge_point_id: knowledge_point_id || null,
      question_type: qt,
      title,
      content: content || title,
      correct_answer,
      analysis: analysis || null,
      difficulty_level: DIFFICULTY_MAP[difficulty_level || 'basic'] || 'BASIC',
      score: score ?? 5,
      is_ai_generated: false,
      created_by_user_id: user.user_id,
      status: 'active',
    },
  });

  // 创建选项（如果是选择题）
  if (options && Array.isArray(options) && options.length > 0) {
    await prisma.questionOption.createMany({
      data: options.map((opt, idx) => ({
        question_id: question.question_id,
        option_key: opt.option_key || String.fromCharCode(65 + idx),
        option_content: opt.option_content || '',
        option_order: idx,
        is_correct: Array.isArray(correct_answer)
          ? correct_answer.includes(opt.option_key)
          : opt.option_key === correct_answer,
      })),
    });
  }

  return { question_id: question.question_id, title: question.title, question_type: question.question_type };
}

// ---------- 题目详情 ----------

async function getQuestion(user, questionId) {
  const question = await prisma.question.findUnique({
    where: { question_id: questionId },
    include: {
      course: true,
      knowledge_point: true,
      creator: { include: { profile: true } },
      options: { orderBy: { option_order: 'asc' } },
    },
  });

  if (!question) throw Object.assign(new Error('题目不存在'), { code: 40002 });
  await ensureCourseAccess(user, question.course_id);

  return {
    question_id: question.question_id,
    title: question.title,
    content: question.content,
    question_type: toLower(question.question_type),
    difficulty_level: toLower(question.difficulty_level),
    course_id: question.course_id,
    course_name: question.course?.course_name || null,
    knowledge_point_id: question.knowledge_point_id,
    knowledge_point_name: question.knowledge_point?.knowledge_point_name || null,
    correct_answer: question.correct_answer,
    analysis: question.analysis,
    score: question.score,
    is_ai_generated: question.is_ai_generated,
    status: question.status,
    options: question.options.map((opt) => ({
      option_id: opt.option_id,
      option_key: opt.option_key,
      option_content: opt.option_content,
      is_correct: opt.is_correct,
    })),
    created_by_name: question.creator?.profile?.real_name || question.creator?.username || null,
    created_at: question.created_at.toISOString(),
  };
}

// ---------- 更新题目 ----------

async function updateQuestion(user, questionId, body) {
  const question = await prisma.question.findUnique({ where: { question_id: questionId } });
  if (!question) throw Object.assign(new Error('题目不存在'), { code: 40002 });
  await ensureCourseAccess(user, question.course_id);

  const { title, content, knowledge_point_id, difficulty_level, analysis, score, status, correct_answer, question_type, options } = body;

  const data = {};
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  if (knowledge_point_id !== undefined) data.knowledge_point_id = knowledge_point_id;
  if (difficulty_level !== undefined) {
    const dl = DIFFICULTY_MAP[difficulty_level];
    if (dl) data.difficulty_level = dl;
  }
  if (analysis !== undefined) data.analysis = analysis;
  if (score !== undefined) data.score = score;
  if (status !== undefined) data.status = status;
  if (correct_answer !== undefined) data.correct_answer = correct_answer;
  if (question_type !== undefined) {
    const qt = QUESTION_TYPE_MAP[question_type];
    if (qt) data.question_type = qt;
  }

  const updated = await prisma.question.update({
    where: { question_id: questionId },
    data,
  });

  // 更新选项
  if (options && Array.isArray(options)) {
    await prisma.questionOption.deleteMany({ where: { question_id: questionId } });
    await prisma.questionOption.createMany({
      data: options.map((opt, idx) => ({
        question_id: questionId,
        option_key: opt.option_key || String.fromCharCode(65 + idx),
        option_content: opt.option_content || '',
        option_order: idx,
        is_correct: opt.option_key === (correct_answer ?? question.correct_answer),
      })),
    });
  }

  return { question_id: updated.question_id, title: updated.title };
}

// ---------- 删除题目 ----------

async function deleteQuestion(user, questionId) {
  const question = await prisma.question.findUnique({ where: { question_id: questionId } });
  if (!question) throw Object.assign(new Error('题目不存在'), { code: 40002 });
  await ensureCourseAccess(user, question.course_id);
  await prisma.question.update({ where: { question_id: questionId }, data: { status: 'deleted' } });
}

async function batchImportQuestions(user, body) {
  const rows = Array.isArray(body.questions) ? body.questions : [];
  if (!rows.length) throw Object.assign(new Error('questions 为必填数组'), { code: 40001 });
  if (rows.length > 500) throw Object.assign(new Error('单次最多导入 500 道题'), { code: 40001 });
  const results = [];
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const result = await createQuestion(user, rows[index]);
      results.push({ row: index + 1, success: true, question_id: result.question_id });
    } catch (error) {
      results.push({ row: index + 1, success: false, reason: error.message });
    }
  }
  return { results, success_count: results.filter((item) => item.success).length, failed_count: results.filter((item) => !item.success).length };
}

async function ensureQuestionsAccess(user, ids) {
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!normalizedIds.length) throw Object.assign(new Error('question_ids 为必填项'), { code: 40001 });
  const rows = await prisma.question.findMany({ where: { question_id: { in: normalizedIds } }, select: { question_id: true, course_id: true } });
  if (rows.length !== normalizedIds.length) throw Object.assign(new Error('部分题目不存在'), { code: 40002 });
  for (const courseId of [...new Set(rows.map((item) => item.course_id))]) await ensureCourseAccess(user, courseId);
  return { ids: normalizedIds, rows };
}

async function batchUpdateQuestions(user, body) {
  const { ids, rows } = await ensureQuestionsAccess(user, body.question_ids);
  const data = {};
  if (body.course_id !== undefined) {
    await ensureCourseAccess(user, Number(body.course_id));
    data.course_id = Number(body.course_id);
  }
  if (body.knowledge_point_id !== undefined) {
    if (body.knowledge_point_id) {
      const targetCourseId = data.course_id || rows[0].course_id;
      if (!data.course_id && rows.some((item) => item.course_id !== targetCourseId)) {
        throw Object.assign(new Error('跨课程题目批量设置知识点前需先统一课程'), { code: 40001 });
      }
      const kp = await prisma.knowledgePoint.findFirst({ where: { knowledge_point_id: Number(body.knowledge_point_id), course_id: targetCourseId } });
      if (!kp) throw Object.assign(new Error('知识点不属于目标课程'), { code: 40001 });
    }
    data.knowledge_point_id = body.knowledge_point_id ? Number(body.knowledge_point_id) : null;
  }
  if (body.question_type !== undefined) {
    if (!QUESTION_TYPE_MAP[body.question_type]) throw Object.assign(new Error('不支持的题型'), { code: 40001 });
    data.question_type = QUESTION_TYPE_MAP[body.question_type];
  }
  if (body.difficulty_level !== undefined) data.difficulty_level = DIFFICULTY_MAP[body.difficulty_level] || 'MEDIUM';
  if (body.status !== undefined) data.status = body.status;
  if (!Object.keys(data).length) throw Object.assign(new Error('没有可批量更新的字段'), { code: 40001 });
  const result = await prisma.question.updateMany({ where: { question_id: { in: ids } }, data });
  return { updated_count: result.count };
}

async function batchDeleteQuestions(user, body) {
  const { ids } = await ensureQuestionsAccess(user, body.question_ids);
  const result = await prisma.question.updateMany({ where: { question_id: { in: ids } }, data: { status: 'deleted' } });
  return { deleted_count: result.count };
}

async function exportQuestions(user, query) {
  const result = await listQuestions(user, { ...query, page: 1, page_size: 100 });
  const details = await Promise.all(result.list.map((item) => getQuestion(user, item.question_id)));
  return { list: details, total: result.total };
}

async function previewAiQuestions(user, body = {}) {
  const courseId = Number(body.course_id);
  if (!Number.isInteger(courseId) || courseId < 1) throw Object.assign(new Error('course_id 为必填项'), { code: 40001 });
  await ensureCourseAccess(user, courseId);
  const course = await prisma.course.findUnique({ where: { course_id: courseId }, select: { course_name: true } });
  if (!course) throw Object.assign(new Error('课程不存在'), { code: 40002 });
  const knowledgePointIds = [...new Set((body.knowledge_point_ids || []).map(Number).filter(Number.isInteger))];
  const knowledgePoints = knowledgePointIds.length ? await prisma.knowledgePoint.findMany({
    where: { knowledge_point_id: { in: knowledgePointIds }, course_id: courseId },
    select: { knowledge_point_id: true, knowledge_point_name: true },
  }) : [];
  if (knowledgePoints.length !== knowledgePointIds.length) throw Object.assign(new Error('部分知识点不属于所选课程'), { code: 40001 });
  const questions = await aiService.generateQuestions({
    courseName: course.course_name,
    knowledgePoints,
    count: body.count,
    questionTypes: body.question_types,
    difficultyLevel: body.difficulty_level,
    userId: user.user_id,
  });
  return { course_id: courseId, status: 'preview', requires_review: true, questions };
}

module.exports = {
  listQuestions,
  createQuestion,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  batchImportQuestions,
  batchUpdateQuestions,
  batchDeleteQuestions,
  exportQuestions,
  previewAiQuestions,
};
