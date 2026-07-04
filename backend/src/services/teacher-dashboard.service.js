// 教师端看板与学情分析服务

const prisma = require('../config/prisma');

// ---------- 辅助函数 ----------

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function toPositiveInt(value, fieldName, required = false) {
  if (value == null || value === '') {
    if (required) throw Object.assign(new Error(`${fieldName} 不能为空`), { code: 40001 });
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw Object.assign(new Error(`${fieldName} 参数不合法`), { code: 40001 });
  }
  return parsed;
}

function parseDate(value, fieldName) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`${fieldName} 日期格式不合法`), { code: 40001 });
  }
  return parsed;
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
    query.courseId ?? query.course_id,
    'course_id',
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

async function ensureCourseAccess(user, courseId) {
  if (user.role === 'admin') return;
  const accessibleIds = await getAccessibleCourseIds(user);
  if (accessibleIds && !accessibleIds.includes(courseId)) {
    throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
  }
}

function getCourseFilter(courseIds) {
  if (!courseIds) return {};
  return { course_id: { in: courseIds } };
}

// ---------- 看板 ----------

async function getDashboard(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  // 教师管理的课程数和班级数
  const courses = courseIds
    ? await prisma.course.findMany({
        where: { course_id: { in: courseIds } },
        select: { course_id: true, course_name: true },
      })
    : [];

  const courseIdList = courses.map((c) => c.course_id);

  // 教学班级数
  const teachingClassCount = courseIdList.length > 0
    ? await prisma.teachingClass.count({
        where: { course_id: { in: courseIdList } },
      })
    : 0;

  // 学生总数
  const studentCount = courseIdList.length > 0
    ? await prisma.studentCourseEnrollment.groupBy({
        by: ['student_user_id'],
        where: {
          course_id: { in: courseIdList },
          enrollment_status: 'active',
        },
      })
    : [];

  // 平均掌握度
  const masteryAgg = courseIdList.length > 0
    ? await prisma.studentMasteryRecord.aggregate({
        _avg: { mastery_score: true },
        where: { course_id: { in: courseIdList } },
      })
    : { _avg: { mastery_score: null } };

  // 平均测试成绩（最近提交的会话）
  const sessionAgg = courseIdList.length > 0
    ? await prisma.practiceSession.aggregate({
        _avg: { total_score: true, max_score: true },
        where: {
          course_id: { in: courseIdList },
          status: { not: 'in_progress' },
          total_score: { not: null },
          max_score: { not: null, gt: 0 },
        },
      })
    : { _avg: { total_score: null, max_score: null } };

  const averageTestScore = sessionAgg._avg.total_score != null && sessionAgg._avg.max_score > 0
    ? Math.round((sessionAgg._avg.total_score / sessionAgg._avg.max_score) * 100)
    : null;

  // AI 提问总数
  const aiQuestionCount = courseIdList.length > 0
    ? await prisma.studentQuestionRecord.count({
        where: { course_id: { in: courseIdList } },
      })
    : 0;

  // 薄弱知识点数量
  const weakKpCount = courseIdList.length > 0
    ? await prisma.studentMasteryRecord.count({
        where: {
          course_id: { in: courseIdList },
          mastery_level: 'WEAK',
        },
      })
    : 0;

  // 待审核文档数量
  const pendingReviewCount = courseIdList.length > 0
    ? await prisma.knowledgeDocument.count({
        where: {
          course_id: { in: courseIdList },
          review_status: 'PENDING',
        },
      })
    : 0;

  return {
    course_count: courses.length,
    teaching_class_count: teachingClassCount,
    student_count: studentCount.length,
    average_mastery_score: masteryAgg._avg.mastery_score
      ? Math.round(masteryAgg._avg.mastery_score)
      : 0,
    average_test_score: averageTestScore ?? 0,
    ai_question_count: aiQuestionCount,
    weak_knowledge_point_count: weakKpCount,
    pending_review_document_count: pendingReviewCount,
  };
}

// ---------- 学习进度统计 ----------

async function getProgress(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const where = { status: { not: 'in_progress' }, ...courseFilter };
  if (classId) where.teaching_class_id = classId;

  const sessions = await prisma.practiceSession.findMany({
    where,
    include: {
      student: { include: { profile: true } },
      course: true,
      teaching_class: true,
    },
    orderBy: { submitted_at: 'desc' },
    take: 100,
  });

  const studentProgressMap = {};
  for (const session of sessions) {
    const sid = session.student_user_id;
    if (!studentProgressMap[sid]) {
      studentProgressMap[sid] = {
        student_user_id: sid,
        student_name: session.student?.profile?.real_name || session.student?.username || null,
        course_id: session.course_id,
        course_name: session.course?.course_name || null,
        class_id: session.teaching_class_id,
        class_name: session.teaching_class?.teaching_class_name || null,
        session_count: 0,
        total_accuracy: 0,
        total_score_rate: 0,
        score_count: 0,
        last_active: null,
      };
    }
    const item = studentProgressMap[sid];
    item.session_count += 1;
    if (session.correct_count != null && session.question_count > 0) {
      item.total_accuracy = Math.round(
        ((item.total_accuracy * (item.session_count - 1)) + (session.correct_count / session.question_count) * 100) / item.session_count
      );
    }
    if (session.total_score != null && session.max_score > 0) {
      item.total_score_rate += (session.total_score / session.max_score) * 100;
      item.score_count += 1;
    }
    if (session.submitted_at && (!item.last_active || session.submitted_at > item.last_active)) {
      item.last_active = session.submitted_at;
    }
  }

  const students = Object.values(studentProgressMap).map((item) => ({
    ...item,
    average_score_rate: item.score_count > 0 ? Math.round(item.total_score_rate / item.score_count) : 0,
    total_score_rate: undefined,
    score_count: undefined,
    last_active: item.last_active ? item.last_active.toISOString() : null,
  }));

  const totalSessions = sessions.length;
  const submittedSessions = sessions.filter((s) => s.status !== 'in_progress').length;

  return {
    summary: {
      total_students: Object.keys(studentProgressMap).length,
      total_sessions: totalSessions,
      submitted_sessions: submittedSessions,
    },
    students,
  };
}

// ---------- 知识热力图 ----------

async function getKnowledgeHeatmap(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const masteryWhere = { ...courseFilter };
  if (classId) {
    const enrollments = await prisma.studentCourseEnrollment.findMany({
      where: { teaching_class_id: classId, enrollment_status: 'active' },
      select: { student_user_id: true },
    });
    masteryWhere.student_user_id = { in: enrollments.map((e) => e.student_user_id) };
  }

  const records = await prisma.studentMasteryRecord.findMany({
    where: masteryWhere,
    include: {
      student: { include: { profile: true } },
      knowledge_point: true,
    },
    orderBy: [{ student_user_id: 'asc' }, { knowledge_point_id: 'asc' }],
  });

  const heatmapData = records.map((r) => ({
    student_user_id: r.student_user_id,
    student_name: r.student?.profile?.real_name || r.student?.username || null,
    knowledge_point_id: r.knowledge_point_id,
    knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
    mastery_score: r.mastery_score,
    mastery_level: toLower(r.mastery_level),
  }));

  return { list: heatmapData };
}

// ---------- 成绩分布 ----------

async function getScoreDistribution(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const sessionWhere = { status: { not: 'in_progress' }, total_score: { not: null }, max_score: { not: null, gt: 0 }, ...courseFilter };
  if (classId) sessionWhere.teaching_class_id = classId;

  const sessions = await prisma.practiceSession.findMany({
    where: sessionWhere,
    select: { total_score: true, max_score: true },
  });

  const scoreRates = sessions
    .map((s) => (s.total_score / s.max_score) * 100)
    .filter((rate) => rate >= 0 && rate <= 100);

  const distribution = {
    excellent: 0, // 90-100
    good: 0,      // 75-89
    general: 0,   // 60-74
    weak: 0,      // 0-59
  };

  for (const rate of scoreRates) {
    if (rate >= 90) distribution.excellent += 1;
    else if (rate >= 75) distribution.good += 1;
    else if (rate >= 60) distribution.general += 1;
    else distribution.weak += 1;
  }

  return {
    total_sessions: sessions.length,
    distribution: {
      excellent: { count: distribution.excellent, percentage: sessions.length > 0 ? Math.round((distribution.excellent / sessions.length) * 100) : 0, label: '优秀 (90-100分)' },
      good: { count: distribution.good, percentage: sessions.length > 0 ? Math.round((distribution.good / sessions.length) * 100) : 0, label: '良好 (75-89分)' },
      general: { count: distribution.general, percentage: sessions.length > 0 ? Math.round((distribution.general / sessions.length) * 100) : 0, label: '一般 (60-74分)' },
      weak: { count: distribution.weak, percentage: sessions.length > 0 ? Math.round((distribution.weak / sessions.length) * 100) : 0, label: '薄弱 (0-59分)' },
    },
    average_score_rate: scoreRates.length > 0 ? Math.round(scoreRates.reduce((a, b) => a + b, 0) / scoreRates.length) : 0,
  };
}

// ---------- 高频提问统计 ----------

async function getQuestionFrequency(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const startDate = parseDate(query.startDate ?? query.start_date, 'startDate');
  const endDate = parseDate(query.endDate ?? query.end_date, 'endDate');

  const where = { ...courseFilter };
  if (startDate || endDate) {
    where.created_at = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    };
  }

  // 按知识点聚合学生提问
  const questions = await prisma.studentQuestionRecord.findMany({
    where,
    include: {
      analysis_records: {
        include: { knowledge_point: true },
        take: 1,
      },
    },
    orderBy: { created_at: 'desc' },
  });

  const kpMap = {};
  const studentSet = new Set();

  for (const q of questions) {
    studentSet.add(q.student_user_id);
    const analysis = q.analysis_records?.[0];
    const kp = analysis?.knowledge_point;
    if (!kp) continue;

    if (!kpMap[kp.knowledge_point_id]) {
      kpMap[kp.knowledge_point_id] = {
        knowledge_point_id: kp.knowledge_point_id,
        knowledge_point_name: kp.knowledge_point_name,
        question_count: 0,
        student_ids: new Set(),
      };
    }
    kpMap[kp.knowledge_point_id].question_count += 1;
    kpMap[kp.knowledge_point_id].student_ids.add(q.student_user_id);
  }

  const list = Object.values(kpMap)
    .map((item) => ({
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point_name,
      question_count: item.question_count,
      student_count: item.student_ids.size,
    }))
    .sort((a, b) => b.question_count - a.question_count);

  return {
    total_questions: questions.length,
    total_students: studentSet.size,
    list,
  };
}

// ---------- 薄弱知识点排行 ----------

async function getWeakKnowledgePoints(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const masteryWhere = { mastery_level: 'WEAK', ...courseFilter };
  if (classId) {
    const enrollments = await prisma.studentCourseEnrollment.findMany({
      where: { teaching_class_id: classId, enrollment_status: 'active' },
      select: { student_user_id: true },
    });
    masteryWhere.student_user_id = { in: enrollments.map((e) => e.student_user_id) };
  }

  const records = await prisma.studentMasteryRecord.findMany({
    where: masteryWhere,
    include: {
      knowledge_point: true,
      student: { include: { profile: true } },
    },
    orderBy: { mastery_score: 'asc' },
    take: 50,
  });

  const kpMap = {};
  for (const r of records) {
    const kpId = r.knowledge_point_id;
    if (!kpMap[kpId]) {
      kpMap[kpId] = {
        knowledge_point_id: kpId,
        knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
        student_count: 0,
        average_score: 0,
        score_sum: 0,
        students: [],
      };
    }
    kpMap[kpId].student_count += 1;
    kpMap[kpId].score_sum += r.mastery_score;
    kpMap[kpId].students.push({
      student_user_id: r.student_user_id,
      student_name: r.student?.profile?.real_name || r.student?.username || null,
      mastery_score: r.mastery_score,
    });
  }

  const list = Object.values(kpMap)
    .map((item) => ({
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point_name,
      student_count: item.student_count,
      average_score: Math.round(item.score_sum / item.student_count),
      students: item.students.sort((a, b) => a.mastery_score - b.mastery_score).slice(0, 10),
    }))
    .sort((a, b) => a.average_score - b.average_score);

  return { list };
}

// ---------- 学生能力雷达图 ----------

async function getStudentRadar(user, studentUserId, query) {
  const courseIds = await resolveCourseIds(user, query);

  if (user.role !== 'admin') {
    const enrollment = await prisma.studentCourseEnrollment.findFirst({
      where: {
        student_user_id: studentUserId,
        ...(courseIds ? { course_id: { in: courseIds } } : {}),
        enrollment_status: 'active',
      },
    });
    if (!enrollment) {
      throw Object.assign(new Error('无权访问该学生数据'), { code: 40301 });
    }
  }

  const courseId = toPositiveInt(query.courseId ?? query.course_id, 'course_id', false);

  const student = await prisma.user.findUnique({
    where: { user_id: studentUserId },
    include: { profile: true },
  });
  if (!student) {
    throw Object.assign(new Error('学生不存在'), { code: 40002 });
  }

  // 获取画像数据
  const portraitWhere = { student_user_id: studentUserId };
  if (courseId) portraitWhere.course_id = courseId;

  const portrait = await prisma.studentPortrait.findFirst({
    where: portraitWhere,
  });

  // 获取掌握度
  const masteryWhere = { student_user_id: studentUserId };
  if (courseId) masteryWhere.course_id = courseId;

  const masteryRecords = await prisma.studentMasteryRecord.findMany({
    where: masteryWhere,
    include: { knowledge_point: true },
    orderBy: { mastery_score: 'asc' },
  });

  return {
    student: {
      student_user_id: student.user_id,
      student_name: student.profile?.real_name || student.username,
      student_no: student.profile?.student_no || null,
    },
    radar: portrait ? {
      learning_ability_score: portrait.learning_total_score,
      progress_score: portrait.progress_score,
      mastery_score: portrait.mastery_score,
      test_score: portrait.test_score,
      wrong_question_score: portrait.wrong_question_score,
      activity_score: portrait.activity_score,
      qa_score: portrait.qa_score,
    } : null,
    mastery_records: masteryRecords.map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
      mastery_score: r.mastery_score,
      mastery_level: toLower(r.mastery_level),
    })),
  };
}

module.exports = {
  getDashboard,
  getProgress,
  getKnowledgeHeatmap,
  getScoreDistribution,
  getQuestionFrequency,
  getWeakKnowledgePoints,
  getStudentRadar,
};
