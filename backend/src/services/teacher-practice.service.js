// 教师端练习统计服务

const prisma = require('../config/prisma');

const QUESTION_TYPE_TO_PRISMA = {
  single_choice: 'SINGLE_CHOICE',
  multiple_choice: 'MULTIPLE_CHOICE',
  fill_blank: 'FILL_BLANK',
  blank: 'BLANK',
  true_false: 'TRUE_FALSE',
  short_answer: 'SHORT_ANSWER',
  programming: 'PROGRAMMING',
};

const DIFFICULTY_TO_PRISMA = {
  basic: 'BASIC',
  medium: 'MEDIUM',
  hard: 'HARD',
};

const VALID_QUESTION_STATUSES = new Set(['active', 'inactive', 'pending', 'approved', 'rejected', 'archived']);

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function toPositiveInt(value, fieldName, required = true) {
  if (value == null || value === '') {
    if (required) {
      throw Object.assign(new Error(`${fieldName} 不能为空`), { code: 40001 });
    }
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw Object.assign(new Error(`${fieldName} 参数不合法`), { code: 40001 });
  }
  return parsed;
}

function parsePagination(query) {
  let page = Number.parseInt(query.page, 10);
  let pageSize = Number.parseInt(query.pageSize ?? query.page_size, 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 100) pageSize = 100;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function parseDate(value, fieldName) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`${fieldName} 日期格式不合法`), { code: 40001 });
  }
  return parsed;
}

function buildSubmittedAtFilter(query) {
  const start = parseDate(query.startDate ?? query.start_date, 'startDate');
  const end = parseDate(query.endDate ?? query.end_date, 'endDate');
  if (!start && !end) return null;
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}

function normalizeQuestionType(value, required = false) {
  if (value == null || value === '') {
    if (required) {
      throw Object.assign(new Error('questionType 不能为空'), { code: 40001 });
    }
    return null;
  }
  const normalized = toLower(value);
  const prismaType = QUESTION_TYPE_TO_PRISMA[normalized];
  if (!prismaType) {
    throw Object.assign(new Error(`不支持的题型: ${value}`), { code: 40001 });
  }
  return prismaType;
}

function normalizeDifficulty(value) {
  if (value == null || value === '') return null;
  const normalized = toLower(value);
  const prismaDifficulty = DIFFICULTY_TO_PRISMA[normalized];
  if (!prismaDifficulty) {
    throw Object.assign(new Error('difficulty 参数不合法，可选 basic / medium / hard'), { code: 40001 });
  }
  return prismaDifficulty;
}

async function getAccessibleCourseIds(user) {
  if (user.role === 'admin') return null;
  const relations = await prisma.courseTeacherRelation.findMany({
    where: { teacher_user_id: user.user_id },
    select: { course_id: true },
  });
  return relations.map((item) => item.course_id);
}

async function resolveCourseIds(user, query = {}) {
  const requestedCourseId = toPositiveInt(
    query.subjectId ?? query.subject_id ?? query.courseId ?? query.course_id,
    'subjectId',
    false,
  );
  const accessibleCourseIds = await getAccessibleCourseIds(user);

  if (requestedCourseId) {
    if (accessibleCourseIds && !accessibleCourseIds.includes(requestedCourseId)) {
      throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
    }
    return [requestedCourseId];
  }

  return accessibleCourseIds;
}

async function ensureClassAccess(user, classId) {
  const teachingClass = await prisma.teachingClass.findUnique({
    where: { teaching_class_id: classId },
    include: { course: true },
  });
  if (!teachingClass) {
    throw Object.assign(new Error('班级不存在'), { code: 40002 });
  }

  const accessibleCourseIds = await getAccessibleCourseIds(user);
  if (accessibleCourseIds && !accessibleCourseIds.includes(teachingClass.course_id)) {
    throw Object.assign(new Error('无权访问该班级数据'), { code: 40301 });
  }

  return teachingClass;
}

async function buildSessionWhere(user, query = {}) {
  const courseIds = await resolveCourseIds(user, query);
  const classId = toPositiveInt(query.classId ?? query.class_id, 'classId', false);
  const submittedAt = buildSubmittedAtFilter(query);
  const where = {
    status: { notIn: ['IN_PROGRESS', 'in_progress'] },
  };

  if (courseIds) where.course_id = { in: courseIds };

  if (classId) {
    const teachingClass = await ensureClassAccess(user, classId);
    where.teaching_class_id = classId;
    if (!where.course_id) where.course_id = teachingClass.course_id;
  }

  if (submittedAt) where.submitted_at = submittedAt;
  return where;
}

function summarizeSessions(sessions) {
  const totalSessions = sessions.length;
  const submittedSessions = sessions.filter((item) => item.status !== 'IN_PROGRESS' && item.status !== 'in_progress').length;
  const studentIds = new Set(sessions.map((item) => item.student_user_id));
  const questionCount = sessions.reduce((sum, item) => sum + (item.question_count || 0), 0);
  const correctCount = sessions.reduce((sum, item) => sum + (item.correct_count || 0), 0);
  const wrongCount = sessions.reduce((sum, item) => sum + (item.wrong_count || 0), 0);
  const scorePercents = sessions
    .filter((item) => item.max_score && item.max_score > 0 && item.total_score != null)
    .map((item) => (item.total_score / item.max_score) * 100);

  return {
    session_count: totalSessions,
    submitted_session_count: submittedSessions,
    student_count: studentIds.size,
    question_count: questionCount,
    correct_count: correctCount,
    wrong_count: wrongCount,
    average_score: scorePercents.length > 0
      ? Math.round(scorePercents.reduce((sum, item) => sum + item, 0) / scorePercents.length)
      : 0,
    average_accuracy: questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0,
  };
}

async function getOverview(user, query) {
  const sessionWhere = await buildSessionWhere(user, query);
  const sessions = await prisma.practiceSession.findMany({
    where: sessionWhere,
  });

  const courseFilter = sessionWhere.course_id
    ? (typeof sessionWhere.course_id === 'object' ? sessionWhere.course_id : { equals: sessionWhere.course_id })
    : undefined;

  const [answerCount, aiQuestionCount, wrongQuestionCount] = await Promise.all([
    prisma.answerRecord.count({
      where: {
        practice_session_id: { not: null },
        practice_session: { is: sessionWhere },
      },
    }),
    prisma.question.count({
      where: {
        is_ai_generated: true,
        ...(courseFilter ? { course_id: courseFilter } : {}),
      },
    }),
    prisma.wrongQuestion.count({
      where: {
        ...(courseFilter ? { course_id: courseFilter } : {}),
        status: { not: 'REMOVED' },
      },
    }),
  ]);

  return {
    overview: {
      ...summarizeSessions(sessions),
      answer_count: answerCount,
      ai_question_count: aiQuestionCount,
      wrong_question_count: wrongQuestionCount,
    },
  };
}

function getStudentName(user) {
  return user?.profile?.real_name || user?.username || null;
}

async function getClassAnalytics(user, classId, query) {
  const teachingClass = await ensureClassAccess(user, classId);
  const sessionWhere = await buildSessionWhere(user, {
    ...query,
    classId,
    subjectId: teachingClass.course_id,
  });

  const [sessions, enrollments, answers] = await Promise.all([
    prisma.practiceSession.findMany({
      where: sessionWhere,
      include: {
        student: { include: { profile: true } },
      },
      orderBy: { submitted_at: 'desc' },
    }),
    prisma.studentCourseEnrollment.findMany({
      where: {
        course_id: teachingClass.course_id,
        teaching_class_id: classId,
        enrollment_status: 'active',
      },
      include: {
        student: { include: { profile: true } },
      },
    }),
    prisma.answerRecord.findMany({
      where: {
        practice_session_id: { not: null },
        practice_session: { is: sessionWhere },
      },
      include: {
        question: {
          include: { knowledge_point: true },
        },
      },
    }),
  ]);

  const studentMap = {};
  for (const enrollment of enrollments) {
    studentMap[enrollment.student_user_id] = {
      student_user_id: enrollment.student_user_id,
      student_name: getStudentName(enrollment.student),
      session_count: 0,
      question_count: 0,
      correct_count: 0,
      score_sum: 0,
      score_count: 0,
    };
  }

  for (const session of sessions) {
    if (!studentMap[session.student_user_id]) {
      studentMap[session.student_user_id] = {
        student_user_id: session.student_user_id,
        student_name: getStudentName(session.student),
        session_count: 0,
        question_count: 0,
        correct_count: 0,
        score_sum: 0,
        score_count: 0,
      };
    }
    const item = studentMap[session.student_user_id];
    item.session_count += 1;
    item.question_count += session.question_count || 0;
    item.correct_count += session.correct_count || 0;
    if (session.max_score && session.max_score > 0 && session.total_score != null) {
      item.score_sum += (session.total_score / session.max_score) * 100;
      item.score_count += 1;
    }
  }

  const students = Object.values(studentMap).map((item) => ({
    student_user_id: item.student_user_id,
    student_name: item.student_name,
    session_count: item.session_count,
    question_count: item.question_count,
    accuracy: item.question_count > 0 ? Math.round((item.correct_count / item.question_count) * 100) : 0,
    average_score: item.score_count > 0 ? Math.round(item.score_sum / item.score_count) : 0,
  })).sort((a, b) => b.average_score - a.average_score);

  const questionTypeMap = {};
  const knowledgePointMap = {};
  for (const answer of answers) {
    const type = toLower(answer.question?.question_type) || 'unknown';
    if (!questionTypeMap[type]) {
      questionTypeMap[type] = { question_type: type, attempt_count: 0, correct_count: 0 };
    }
    questionTypeMap[type].attempt_count += 1;
    if (answer.is_correct) questionTypeMap[type].correct_count += 1;

    const kp = answer.question?.knowledge_point;
    if (kp) {
      if (!knowledgePointMap[kp.knowledge_point_id]) {
        knowledgePointMap[kp.knowledge_point_id] = {
          knowledge_point_id: kp.knowledge_point_id,
          knowledge_point_name: kp.knowledge_point_name,
          attempt_count: 0,
          correct_count: 0,
        };
      }
      knowledgePointMap[kp.knowledge_point_id].attempt_count += 1;
      if (answer.is_correct) knowledgePointMap[kp.knowledge_point_id].correct_count += 1;
    }
  }

  return {
    class: {
      class_id: teachingClass.teaching_class_id,
      class_name: teachingClass.teaching_class_name,
      course_id: teachingClass.course_id,
      course_name: teachingClass.course.course_name,
    },
    summary: {
      ...summarizeSessions(sessions),
      enrolled_student_count: enrollments.length,
    },
    students,
    question_type_stats: Object.values(questionTypeMap).map((item) => ({
      ...item,
      accuracy: item.attempt_count > 0 ? Math.round((item.correct_count / item.attempt_count) * 100) : 0,
    })),
    knowledge_point_stats: Object.values(knowledgePointMap).map((item) => ({
      ...item,
      accuracy: item.attempt_count > 0 ? Math.round((item.correct_count / item.attempt_count) * 100) : 0,
    })).sort((a, b) => a.accuracy - b.accuracy),
  };
}

async function ensureStudentAccess(user, studentId, query = {}) {
  const student = await prisma.user.findUnique({
    where: { user_id: studentId },
    include: { profile: true },
  });
  if (!student || student.role !== 'STUDENT') {
    throw Object.assign(new Error('学生不存在'), { code: 40002 });
  }

  if (user.role === 'admin') return student;

  const courseIds = await resolveCourseIds(user, query);
  if (!courseIds || courseIds.length === 0) {
    throw Object.assign(new Error('无权访问该学生数据'), { code: 40301 });
  }

  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: studentId,
      course_id: { in: courseIds },
      enrollment_status: 'active',
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('无权访问该学生数据'), { code: 40301 });
  }

  return student;
}

async function getStudentAnalytics(user, studentId, query) {
  const student = await ensureStudentAccess(user, studentId, query);
  const sessionWhere = await buildSessionWhere(user, query);
  sessionWhere.student_user_id = studentId;

  const [sessions, answers, wrongQuestions, masteryRecords] = await Promise.all([
    prisma.practiceSession.findMany({
      where: sessionWhere,
      include: {
        course: true,
        teaching_class: true,
      },
      orderBy: { submitted_at: 'desc' },
      take: 20,
    }),
    prisma.answerRecord.findMany({
      where: {
        student_user_id: studentId,
        practice_session_id: { not: null },
        practice_session: { is: sessionWhere },
      },
      include: {
        question: {
          include: { knowledge_point: true },
        },
      },
    }),
    prisma.wrongQuestion.findMany({
      where: {
        student_user_id: studentId,
        status: { not: 'REMOVED' },
        ...(sessionWhere.course_id ? { course_id: sessionWhere.course_id } : {}),
      },
      include: {
        question: true,
        knowledge_point: true,
      },
      orderBy: { updated_at: 'desc' },
      take: 20,
    }),
    prisma.studentMasteryRecord.findMany({
      where: {
        student_user_id: studentId,
        ...(sessionWhere.course_id ? { course_id: sessionWhere.course_id } : {}),
      },
      include: { knowledge_point: true },
      orderBy: { mastery_score: 'asc' },
    }),
  ]);

  const questionTypeMap = {};
  for (const answer of answers) {
    const type = toLower(answer.question?.question_type) || 'unknown';
    if (!questionTypeMap[type]) {
      questionTypeMap[type] = { question_type: type, attempt_count: 0, correct_count: 0 };
    }
    questionTypeMap[type].attempt_count += 1;
    if (answer.is_correct) questionTypeMap[type].correct_count += 1;
  }

  return {
    student: {
      student_user_id: student.user_id,
      student_name: getStudentName(student),
      student_no: student.profile?.student_no || null,
    },
    summary: summarizeSessions(sessions),
    recent_sessions: sessions.map((session) => ({
      practice_session_id: session.practice_session_id,
      course_id: session.course_id,
      course_name: session.course?.course_name || null,
      class_id: session.teaching_class_id,
      class_name: session.teaching_class?.teaching_class_name || null,
      mode: session.mode,
      status: session.status,
      score: session.total_score,
      total_score: session.max_score,
      accuracy: session.question_count > 0
        ? Math.round(((session.correct_count || 0) / session.question_count) * 100)
        : 0,
      submitted_at: session.submitted_at ? session.submitted_at.toISOString() : null,
    })),
    question_type_stats: Object.values(questionTypeMap).map((item) => ({
      ...item,
      accuracy: item.attempt_count > 0 ? Math.round((item.correct_count / item.attempt_count) * 100) : 0,
    })),
    wrong_questions: wrongQuestions.map((item) => ({
      wrong_question_id: item.wrong_question_id,
      question_id: item.question_id,
      question_title: item.question?.title || null,
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point?.knowledge_point_name || null,
      status: toLower(item.status),
      updated_at: item.updated_at.toISOString(),
    })),
    mastery_records: masteryRecords.map((item) => ({
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point?.knowledge_point_name || null,
      mastery_score: item.mastery_score,
      mastery_level: toLower(item.mastery_level),
      updated_at: item.updated_at.toISOString(),
    })),
  };
}

async function getQuestionAnalytics(user, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const sessionWhere = await buildSessionWhere(user, query);
  const questionType = normalizeQuestionType(query.questionType ?? query.question_type, false);
  const difficulty = normalizeDifficulty(query.difficulty);

  const questionWhere = {
    ...(questionType ? { question_type: questionType } : {}),
    ...(difficulty ? { difficulty_level: difficulty } : {}),
  };

  const answers = await prisma.answerRecord.findMany({
    where: {
      practice_session_id: { not: null },
      practice_session: { is: sessionWhere },
      ...(Object.keys(questionWhere).length > 0 ? { question: { is: questionWhere } } : {}),
    },
    include: {
      question: {
        include: {
          course: true,
          knowledge_point: true,
        },
      },
    },
  });

  const questionMap = {};
  for (const answer of answers) {
    const question = answer.question;
    if (!question) continue;
    if (!questionMap[question.question_id]) {
      questionMap[question.question_id] = {
        question_id: question.question_id,
        title: question.title,
        question_content: question.content,
        question_type: toLower(question.question_type),
        difficulty_level: toLower(question.difficulty_level),
        course_id: question.course_id,
        course_name: question.course?.course_name || null,
        knowledge_point_id: question.knowledge_point_id,
        knowledge_point_name: question.knowledge_point?.knowledge_point_name || null,
        is_ai_generated: question.is_ai_generated,
        status: question.status,
        attempt_count: 0,
        correct_count: 0,
        score_sum: 0,
        max_score_sum: 0,
      };
    }
    const item = questionMap[question.question_id];
    item.attempt_count += 1;
    if (answer.is_correct) item.correct_count += 1;
    item.score_sum += answer.score || 0;
    item.max_score_sum += answer.max_score || question.score || 0;
  }

  const list = Object.values(questionMap)
    .map((item) => ({
      ...item,
      wrong_count: item.attempt_count - item.correct_count,
      accuracy: item.attempt_count > 0 ? Math.round((item.correct_count / item.attempt_count) * 100) : 0,
      average_score_rate: item.max_score_sum > 0 ? Math.round((item.score_sum / item.max_score_sum) * 100) : 0,
    }))
    .sort((a, b) => b.attempt_count - a.attempt_count);

  return {
    list: list.slice(skip, skip + pageSize),
    total: list.length,
    page,
    page_size: pageSize,
  };
}

async function getAiQuestions(user, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const courseIds = await resolveCourseIds(user, query);
  const classId = toPositiveInt(query.classId ?? query.class_id, 'classId', false);
  const questionType = normalizeQuestionType(query.questionType ?? query.question_type, false);
  const difficulty = normalizeDifficulty(query.difficulty);
  const status = query.status ? toLower(query.status) : null;
  if (status && !VALID_QUESTION_STATUSES.has(status)) {
    throw Object.assign(new Error('status 参数不合法'), { code: 40001 });
  }

  const where = {
    is_ai_generated: true,
    ...(courseIds ? { course_id: { in: courseIds } } : {}),
    ...(questionType ? { question_type: questionType } : {}),
    ...(difficulty ? { difficulty_level: difficulty } : {}),
    ...(status ? { status } : {}),
  };

  if (classId) {
    const teachingClass = await ensureClassAccess(user, classId);
    where.course_id = teachingClass.course_id;
    where.bank_links = {
      some: {
        question_bank: {
          teaching_classes: { some: { teaching_class_id: classId } },
        },
      },
    };
  }

  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: true,
        knowledge_point: true,
        creator: { include: { profile: true } },
        generation_links: {
          include: { generation_log: true },
          take: 1,
        },
      },
    }),
    prisma.question.count({ where }),
  ]);

  const usageCounts = await Promise.all(
    questions.map((question) =>
      prisma.answerRecord.count({
        where: {
          question_id: question.question_id,
          practice_session_id: { not: null },
        },
      }),
    ),
  );

  return {
    list: questions.map((question, index) => {
      const generation = question.generation_links?.[0]?.generation_log || null;
      return {
        question_id: question.question_id,
        title: question.title,
        question_content: question.content,
        question_type: toLower(question.question_type),
        difficulty_level: toLower(question.difficulty_level),
        score: question.score,
        status: question.status,
        course_id: question.course_id,
        course_name: question.course?.course_name || null,
        knowledge_point_id: question.knowledge_point_id,
        knowledge_point_name: question.knowledge_point?.knowledge_point_name || null,
        correct_answer: question.correct_answer,
        answer_analysis: question.analysis,
        usage_count: usageCounts[index],
        created_by_user_id: question.created_by_user_id,
        created_by_name: getStudentName(question.creator),
        generation_log_id: generation?.ai_question_generation_log_id || null,
        ai_provider: generation?.ai_provider || null,
        model_name: generation?.model_name || null,
        created_at: question.created_at.toISOString(),
      };
    }),
    total,
    page,
    page_size: pageSize,
  };
}

async function updateQuestionStatus(user, questionId, status) {
  const normalizedStatus = toLower(status);
  if (!normalizedStatus || !VALID_QUESTION_STATUSES.has(normalizedStatus)) {
    throw Object.assign(new Error('status 参数不合法'), { code: 40001 });
  }

  const question = await prisma.question.findUnique({
    where: { question_id: questionId },
  });
  if (!question) {
    throw Object.assign(new Error('题目不存在'), { code: 40002 });
  }

  if (user.role !== 'admin') {
    const accessibleCourseIds = await getAccessibleCourseIds(user);
    if (!accessibleCourseIds || !accessibleCourseIds.includes(question.course_id)) {
      throw Object.assign(new Error('无权修改该题目'), { code: 40301 });
    }
  }

  const updated = await prisma.question.update({
    where: { question_id: questionId },
    data: { status: normalizedStatus },
  });

  return {
    question_id: updated.question_id,
    status: updated.status,
    updated_at: updated.updated_at.toISOString(),
  };
}

module.exports = {
  getOverview,
  getClassAnalytics,
  getStudentAnalytics,
  getQuestionAnalytics,
  getAiQuestions,
  updateQuestionStatus,
};
