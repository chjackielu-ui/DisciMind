// 教师端题库管理服务

const prisma = require('../config/prisma');

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

async function getAccessibleCourseIds(user) {
  if (user.role === 'admin') return null;
  const relations = await prisma.courseTeacherRelation.findMany({
    where: { teacher_user_id: user.user_id },
    select: { course_id: true },
  });
  return relations.map((item) => item.course_id);
}

async function ensureCourseAccess(user, courseId) {
  if (user.role === 'admin') return;
  const ids = await getAccessibleCourseIds(user);
  if (!ids || !ids.includes(courseId)) {
    throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
  }
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
      correct_answer: typeof correct_answer === 'string' ? correct_answer : JSON.stringify(correct_answer),
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
        is_correct: opt.option_key === correct_answer,
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
  await prisma.question.delete({ where: { question_id: questionId } });
}

module.exports = {
  listQuestions,
  createQuestion,
  getQuestion,
  updateQuestion,
  deleteQuestion,
};
