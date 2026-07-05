// 学生端服务层
// 负责学生首页仪表盘、课程、任务、错题本、推荐、学习记录、画像等业务逻辑
// 所有数据库操作统一使用 config/prisma 单例

const prisma = require('../config/prisma');

// ========================
// 工具函数
// ========================

/**
 * 将 Prisma 枚举值转为前端小写格式
 */
function toLower(value) {
  if (value == null) return null;
  const lower = String(value).toLowerCase();
  return lower === 'fill_blank' ? 'blank' : lower;
}

/**
 * 获取当前自然周周一 00:00:00（按中国习惯周一为一周起始）
 */
function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * 格式化用户基础信息（去除敏感字段）
 */
function formatUser(user) {
  if (!user) return null;
  return {
    user_id: user.user_id,
    username: user.username,
    real_name: user.profile?.real_name || null,
    role: toLower(user.role),
    avatar_url: user.profile?.avatar_url || null,
  };
}

/**
 * 校验当前用户是否为 student 角色
 */
function ensureStudentRole(user) {
  if (!user || toLower(user.role) !== 'student') {
    throw Object.assign(new Error('权限不足，仅学生角色可访问'), { code: 40301 });
  }
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

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function uniqueIds(ids) {
  return [...new Set((ids || []).filter((id) => Number.isInteger(id) && id > 0))];
}

function setSize(map, key) {
  return map[key] ? map[key].size : 0;
}

async function getActiveCourseEnrollments(userId, include = {}) {
  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: userId, enrollment_status: 'active' },
    include,
    orderBy: [
      { course_id: 'asc' },
      { created_at: 'desc' },
      { enrollment_id: 'desc' },
    ],
  });

  const seenCourseIds = new Set();
  return enrollments.filter((enrollment) => {
    if (seenCourseIds.has(enrollment.course_id)) return false;
    seenCourseIds.add(enrollment.course_id);
    return true;
  });
}

async function buildCourseLearningStats(userId, courseIdsInput) {
  const courseIds = uniqueIds(courseIdsInput);
  if (courseIds.length === 0) return {};

  const [
    chapterCounts,
    knowledgePoints,
    masteryRecords,
    studyRecords,
    portraits,
    videoCounts,
    questionCounts,
  ] = await Promise.all([
    prisma.chapter.groupBy({
      by: ['course_id'],
      where: { course_id: { in: courseIds } },
      _count: { _all: true },
    }),
    prisma.knowledgePoint.findMany({
      where: { course_id: { in: courseIds } },
      select: {
        knowledge_point_id: true,
        course_id: true,
        chapter_id: true,
        knowledge_point_name: true,
      },
    }),
    prisma.studentMasteryRecord.findMany({
      where: { student_user_id: userId, course_id: { in: courseIds } },
    }),
    prisma.studyRecord.findMany({
      where: { student_user_id: userId, course_id: { in: courseIds } },
      include: {
        knowledge_point: {
          select: {
            knowledge_point_id: true,
            knowledge_point_name: true,
            chapter_id: true,
          },
        },
      },
      orderBy: [{ created_at: 'desc' }, { study_record_id: 'desc' }],
    }),
    prisma.studentPortrait.findMany({
      where: { student_user_id: userId, course_id: { in: courseIds } },
    }),
    prisma.videoResource.groupBy({
      by: ['course_id'],
      where: { course_id: { in: courseIds } },
      _count: { _all: true },
    }),
    prisma.question.groupBy({
      by: ['course_id'],
      where: { course_id: { in: courseIds }, status: 'active' },
      _count: { _all: true },
    }),
  ]);

  const chapterCountMap = {};
  chapterCounts.forEach((item) => { chapterCountMap[item.course_id] = item._count._all; });

  const kpCountMap = {};
  const kpById = {};
  knowledgePoints.forEach((kp) => {
    kpById[kp.knowledge_point_id] = kp;
    kpCountMap[kp.course_id] = (kpCountMap[kp.course_id] || 0) + 1;
  });

  const masteryMap = {};
  masteryRecords.forEach((record) => {
    if (!masteryMap[record.course_id]) {
      masteryMap[record.course_id] = { mastered: 0, weak: 0, totalScore: 0, count: 0 };
    }
    const stats = masteryMap[record.course_id];
    stats.count += 1;
    stats.totalScore += record.mastery_score || 0;
    if (record.mastery_level === 'GOOD' || record.mastery_level === 'EXCELLENT') stats.mastered += 1;
    if (record.mastery_level === 'WEAK') stats.weak += 1;
  });

  const completedKps = {};
  const completedChapters = {};
  const latestStudyMap = {};
  studyRecords.forEach((record) => {
    if (!latestStudyMap[record.course_id]) latestStudyMap[record.course_id] = record;

    const progress = Number(record.progress_percent || 0);
    const completed = record.action_type === 'FINISH' || record.action_type === 'REVIEW' || progress >= 100;
    if (!completed || !record.knowledge_point_id) return;

    if (!completedKps[record.course_id]) completedKps[record.course_id] = new Set();
    completedKps[record.course_id].add(record.knowledge_point_id);

    const kp = record.knowledge_point || kpById[record.knowledge_point_id];
    if (kp?.chapter_id) {
      if (!completedChapters[record.course_id]) completedChapters[record.course_id] = new Set();
      completedChapters[record.course_id].add(kp.chapter_id);
    }
  });

  const portraitMap = {};
  portraits.forEach((portrait) => { portraitMap[portrait.course_id] = portrait; });

  const videoCountMap = {};
  videoCounts.forEach((item) => { videoCountMap[item.course_id] = item._count._all; });

  const questionCountMap = {};
  questionCounts.forEach((item) => { questionCountMap[item.course_id] = item._count._all; });

  const result = {};
  courseIds.forEach((courseId) => {
    const knowledgePointCount = kpCountMap[courseId] || 0;
    const mastery = masteryMap[courseId] || { mastered: 0, weak: 0, totalScore: 0, count: 0 };
    const completedKnowledgeCount = setSize(completedKps, courseId);
    const studyProgress = knowledgePointCount > 0
      ? (completedKnowledgeCount / knowledgePointCount) * 100
      : 0;
    const fallbackMasteryProgress = knowledgePointCount > 0
      ? (mastery.mastered / knowledgePointCount) * 100
      : 0;
    const portraitProgress = portraitMap[courseId]?.progress_score;
    const percentage = clampPercent(
      studyProgress > 0
        ? studyProgress
        : (portraitProgress != null ? portraitProgress : fallbackMasteryProgress),
    );
    const latestStudy = latestStudyMap[courseId] || null;
    const lastStudyAt = latestStudy
      ? (latestStudy.finished_at || latestStudy.started_at || latestStudy.created_at)
      : null;
    const lastPosition = latestStudy?.knowledge_point?.knowledge_point_name
      || (latestStudy?.resource_type ? `${latestStudy.resource_type}${latestStudy.resource_id ? ` #${latestStudy.resource_id}` : ''}` : null);

    result[courseId] = {
      course_id: courseId,
      completed: completedKnowledgeCount,
      total: knowledgePointCount,
      percentage,
      progress: percentage,
      last_study_at: lastStudyAt ? lastStudyAt.toISOString() : null,
      last_position: lastPosition,
      chapter_count: chapterCountMap[courseId] || 0,
      completed_chapter_count: setSize(completedChapters, courseId),
      knowledge_point_count: knowledgePointCount,
      completed_knowledge_count: completedKnowledgeCount,
      mastered_knowledge_count: mastery.mastered,
      weak_knowledge_count: mastery.weak,
      video_count: videoCountMap[courseId] || 0,
      question_count: questionCountMap[courseId] || 0,
      average_mastery_score: mastery.count > 0 ? Math.round(mastery.totalScore / mastery.count) : 0,
    };
  });

  return result;
}

// ========================
// 1. Dashboard（已有）
// ========================

async function getDashboard(userId) {
  const [user, enrollments] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: userId },
      include: { profile: true },
    }),
    getActiveCourseEnrollments(userId, { course: true, teachingClass: true }),
  ]);

  if (!user) {
    throw Object.assign(new Error('用户不存在'), { code: 40401 });
  }

  const courseIds = uniqueIds(enrollments.map((e) => e.course_id));
  const teachingClassIds = uniqueIds(enrollments.map((e) => e.teaching_class_id));

  if (courseIds.length === 0) {
    return {
      user: formatUser(user),
      overview: {
        course_count: 0,
        learning_progress: 0,
        mastered_knowledge_count: 0,
        weak_knowledge_count: 0,
        wrong_question_count: 0,
        weekly_study_hours: 0,
        ai_question_count: 0,
      },
      portrait: null,
      courses: [],
      weak_knowledge_points: [],
      recommendations: [],
      recent_tasks: [],
    };
  }

  const [
    masteryRecords,
    wrongQuestionCount,
    studyRecordsWeek,
    aiQuestionCount,
    portraits,
    latestRecRecord,
    recentTasks,
    allStudyRecords,
    courseProgressMap,
  ] = await Promise.all([
    prisma.studentMasteryRecord.findMany({
      where: { student_user_id: userId, course_id: { in: courseIds } },
      include: { knowledge_point: true },
    }),
    prisma.wrongQuestion.count({
      where: { student_user_id: userId, status: 'UNRESOLVED' },
    }),
    prisma.studyRecord.findMany({
      where: { student_user_id: userId, started_at: { gte: getWeekStart() } },
    }),
    prisma.studentQuestionRecord.count({
      where: { student_user_id: userId },
    }),
    prisma.studentPortrait.findMany({
      where: { student_user_id: userId, course_id: { in: courseIds } },
    }),
    prisma.recommendationRecord.findFirst({
      where: { student_user_id: userId, course_id: { in: courseIds } },
      orderBy: { created_at: 'desc' },
      include: { items: { orderBy: { rank: 'asc' } } },
    }),
    prisma.learningTask.findMany({
      where: {
        course_id: { in: courseIds },
        teaching_class_id: { in: teachingClassIds },
        status: 'PUBLISHED',
      },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),
    prisma.studyRecord.findMany({
      where: { student_user_id: userId },
    }),
    buildCourseLearningStats(userId, courseIds),
  ]);

  const masteredCount = masteryRecords.filter(
    (r) => r.mastery_level === 'GOOD' || r.mastery_level === 'EXCELLENT',
  ).length;
  const weakCount = masteryRecords.filter((r) => r.mastery_level === 'WEAK').length;

  let learningProgress = 0;
  const progressValues = Object.values(courseProgressMap).map((item) => item.percentage || 0);
  if (progressValues.length > 0) {
    learningProgress = Math.round(
      progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length,
    );
  }

  let weeklyStudyHours = 0;
  const weekSeconds = studyRecordsWeek.reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
  if (weekSeconds > 0) {
    weeklyStudyHours = Math.round((weekSeconds / 3600) * 10) / 10;
  } else {
    const allSeconds = allStudyRecords.reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
    weeklyStudyHours = Math.round((allSeconds / 3600) * 10) / 10;
  }

  const overview = {
    course_count: courseIds.length,
    learning_progress: learningProgress,
    mastered_knowledge_count: masteredCount,
    weak_knowledge_count: weakCount,
    wrong_question_count: wrongQuestionCount,
    weekly_study_hours: weeklyStudyHours,
    ai_question_count: aiQuestionCount,
  };

  let portrait = null;
  if (portraits.length > 0) {
    const avg = (key) => {
      const sum = portraits.reduce((s, p) => s + (p[key] || 0), 0);
      return Math.round((sum / portraits.length) * 10) / 10;
    };
    portrait = {
      learning_ability_score: avg('learning_total_score'),
      research_ability_score: avg('research_total_score'),
      competition_ability_score: avg('competition_total_score'),
    };
  }

  const courses = enrollments.map((e) => ({
    course_id: e.course.course_id,
    course_name: e.course.course_name,
    course_code: e.course.course_code,
    description: e.course.description || null,
    progress: courseProgressMap[e.course_id]?.percentage || 0,
    learning_progress: courseProgressMap[e.course_id]?.percentage || 0,
    last_study_at: courseProgressMap[e.course_id]?.last_study_at || null,
    last_position: courseProgressMap[e.course_id]?.last_position || null,
  }));

  const weakKnowledgePoints = masteryRecords
    .filter((r) => r.mastery_level === 'WEAK')
    .map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
      mastery_score: r.mastery_score,
      mastery_level: toLower(r.mastery_level),
    }))
    .sort((a, b) => a.mastery_score - b.mastery_score);

  let recommendations = [];
  if (latestRecRecord && latestRecRecord.items) {
    recommendations = latestRecRecord.items.map((item) => ({
      recommendation_item_id: item.recommendation_item_id,
      recommend_type: toLower(item.item_type),
      title: item.title,
      reason: item.reason || null,
      target_type: item.target_type ? toLower(item.target_type) : null,
      target_id: item.target_id,
    }));
  }

  const recentTasksList = recentTasks.map((t) => ({
    task_id: t.task_id,
    task_title: t.title,
    task_type: toLower(t.task_type),
    status: toLower(t.status),
    deadline: t.deadline ? t.deadline.toISOString() : null,
  }));

  return {
    user: formatUser(user),
    overview,
    portrait,
    courses,
    weak_knowledge_points: weakKnowledgePoints,
    recommendations,
    recent_tasks: recentTasksList,
  };
}

// ========================
// 2. 课程相关
// ========================

/**
 * 获取当前学生已加入的课程列表
 */
async function getStudentCourses(userId) {
  const enrollments = await getActiveCourseEnrollments(userId, {
    course: true,
    teachingClass: true,
  });

  if (enrollments.length === 0) {
    return { list: [] };
  }

  const courseIds = uniqueIds(enrollments.map((e) => e.course_id));

  // 并行查询：教师关系、课程学习统计
  const [teacherRelations, courseProgressMap] = await Promise.all([
    prisma.courseTeacherRelation.findMany({
      where: { course_id: { in: courseIds } },
      include: {
        teacher: { include: { profile: true } },
      },
    }),
    buildCourseLearningStats(userId, courseIds),
  ]);

  // 构建教师映射：course_id -> teacher_list
  const teacherMap = {};
  for (const rel of teacherRelations) {
    if (!teacherMap[rel.course_id]) teacherMap[rel.course_id] = [];
    teacherMap[rel.course_id].push({
      user_id: rel.teacher_user_id,
      real_name: rel.teacher.profile?.real_name || rel.teacher.username,
      role: toLower(rel.teacher_role),
    });
  }

  const list = enrollments.map((e) => {
    const progressStats = courseProgressMap[e.course_id] || {};

    return {
      course_id: e.course.course_id,
      course_name: e.course.course_name,
      course_code: e.course.course_code,
      description: e.course.description || null,
      cover_url: e.course.cover_url || null,
      teaching_class_id: e.teaching_class_id,
      teaching_class_name: e.teachingClass.teaching_class_name,
      teacher_list: teacherMap[e.course_id] || [],
      progress: progressStats.percentage || 0,
      learning_progress: progressStats.percentage || 0,
      progress_detail: {
        courseId: e.course_id,
        completed: progressStats.completed || 0,
        total: progressStats.total || 0,
        percentage: progressStats.percentage || 0,
        lastStudyAt: progressStats.last_study_at || null,
        lastPosition: progressStats.last_position || null,
      },
      chapter_count: progressStats.chapter_count || 0,
      completed_chapter_count: progressStats.completed_chapter_count || 0,
      knowledge_point_count: progressStats.knowledge_point_count || 0,
      completed_knowledge_count: progressStats.completed_knowledge_count || 0,
      mastered_knowledge_count: progressStats.mastered_knowledge_count || 0,
      weak_knowledge_count: progressStats.weak_knowledge_count || 0,
      video_count: progressStats.video_count || 0,
      question_count: progressStats.question_count || 0,
      last_study_at: progressStats.last_study_at || null,
      last_position: progressStats.last_position || null,
    };
  });

  return { list };
}

/**
 * 获取学生某一门课程详情
 */
async function getStudentCourseDetail(userId, courseId) {
  const enrollment = await ensureStudentInCourse(userId, courseId);

  const [course, teachingClass, teacherRelations, recentTasks, courseProgressMap] =
    await Promise.all([
      prisma.course.findUnique({ where: { course_id: courseId } }),
      prisma.teachingClass.findUnique({
        where: { teaching_class_id: enrollment.teaching_class_id },
      }),
      prisma.courseTeacherRelation.findMany({
        where: { course_id: courseId },
        include: { teacher: { include: { profile: true } } },
      }),
      prisma.learningTask.findMany({
        where: { course_id: courseId, status: 'PUBLISHED' },
        orderBy: { created_at: 'desc' },
        take: 5,
        include: {
          teaching_class: true,
        },
      }),
      buildCourseLearningStats(userId, [courseId]),
    ]);

  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  // 教师列表
  const teacherList = teacherRelations.map((rel) => ({
    user_id: rel.teacher_user_id,
    real_name: rel.teacher.profile?.real_name || rel.teacher.username,
    role: toLower(rel.teacher_role),
  }));

  const progressStats = courseProgressMap[courseId] || {};

  return {
    course_id: course.course_id,
    course_name: course.course_name,
    course_code: course.course_code,
    description: course.description || null,
    cover_url: course.cover_url || null,
    subject_category: course.subject_category || null,
    status: toLower(course.status),
    teaching_class: teachingClass
      ? {
          teaching_class_id: teachingClass.teaching_class_id,
          teaching_class_name: teachingClass.teaching_class_name,
          semester: teachingClass.semester || null,
        }
      : null,
    teacher_list: teacherList,
    chapter_count: progressStats.chapter_count || 0,
    completed_chapter_count: progressStats.completed_chapter_count || 0,
    knowledge_point_count: progressStats.knowledge_point_count || 0,
    completed_knowledge_count: progressStats.completed_knowledge_count || 0,
    mastered_knowledge_count: progressStats.mastered_knowledge_count || 0,
    weak_knowledge_count: progressStats.weak_knowledge_count || 0,
    video_count: progressStats.video_count || 0,
    question_count: progressStats.question_count || 0,
    learning_progress: progressStats.percentage || 0,
    progress: progressStats.percentage || 0,
    progress_detail: {
      courseId,
      completed: progressStats.completed || 0,
      total: progressStats.total || 0,
      percentage: progressStats.percentage || 0,
      lastStudyAt: progressStats.last_study_at || null,
      lastPosition: progressStats.last_position || null,
    },
    last_study_at: progressStats.last_study_at || null,
    last_position: progressStats.last_position || null,
    recent_tasks: recentTasks.map((t) => ({
      task_id: t.task_id,
      task_title: t.title,
      task_type: toLower(t.task_type),
      status: toLower(t.status),
      deadline: t.deadline ? t.deadline.toISOString() : null,
      teaching_class_name: t.teaching_class.teaching_class_name,
    })),
  };
}

/**
 * 获取课程章节列表
 */
async function getStudentCourseChapters(userId, courseId) {
  await ensureStudentInCourse(userId, courseId);

  const chapters = await prisma.chapter.findMany({
    where: { course_id: courseId },
    orderBy: { chapter_order: 'asc' },
    include: {
      _count: { select: { knowledge_points: true } },
    },
  });

  const list = chapters.map((ch) => ({
    chapter_id: ch.chapter_id,
    chapter_name: ch.chapter_name,
    chapter_code: ch.chapter_order != null ? `CH-${String(ch.chapter_order).padStart(2, '0')}` : null,
    description: ch.description || null,
    sort_order: ch.chapter_order,
    knowledge_point_count: ch._count.knowledge_points,
  }));

  return { list };
}

/**
 * 获取课程知识点列表（含学生掌握情况）
 */
async function getStudentCourseKnowledgePoints(userId, courseId) {
  await ensureStudentInCourse(userId, courseId);

  const [knowledgePoints, masteryRecords, studyRecords] = await Promise.all([
    prisma.knowledgePoint.findMany({
      where: { course_id: courseId },
      orderBy: [{ chapter_id: 'asc' }, { sort_order: 'asc' }],
      include: { chapter: true },
    }),
    prisma.studentMasteryRecord.findMany({
      where: { student_user_id: userId, course_id: courseId },
    }),
    prisma.studyRecord.findMany({
      where: {
        student_user_id: userId,
        course_id: courseId,
        knowledge_point_id: { not: null },
      },
      orderBy: [{ created_at: 'desc' }, { study_record_id: 'desc' }],
    }),
  ]);

  const masteryMap = {};
  for (const mr of masteryRecords) {
    masteryMap[mr.knowledge_point_id] = mr;
  }

  const latestStudyMap = {};
  for (const record of studyRecords) {
    if (!latestStudyMap[record.knowledge_point_id]) latestStudyMap[record.knowledge_point_id] = record;
  }

  const list = knowledgePoints.map((kp) => {
    const mastery = masteryMap[kp.knowledge_point_id];
    const latestStudy = latestStudyMap[kp.knowledge_point_id];
    const lastStudyAt = latestStudy
      ? (latestStudy.finished_at || latestStudy.started_at || latestStudy.created_at)
      : mastery?.updated_at;
    return {
      knowledge_point_id: kp.knowledge_point_id,
      knowledge_point_name: kp.knowledge_point_name,
      knowledge_point_code: kp.knowledge_point_code,
      chapter_id: kp.chapter_id,
      chapter_name: kp.chapter?.chapter_name || null,
      difficulty_level: toLower(kp.difficulty_level),
      description: kp.description || null,
      sort_order: kp.sort_order,
      mastery_score: mastery?.mastery_score ?? 0,
      mastery_level: mastery ? toLower(mastery.mastery_level) : 'weak',
      last_study_at: lastStudyAt ? lastStudyAt.toISOString() : null,
    };
  });

  return { list };
}

/**
 * 获取单个知识点详情
 */
async function getKnowledgePointDetail(userId, knowledgePointId) {
  const kp = await prisma.knowledgePoint.findUnique({
    where: { knowledge_point_id: knowledgePointId },
    include: {
      course: true,
      chapter: true,
    },
  });

  if (!kp) {
    throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  }

  // 校验学生是否加入该知识点所在课程
  await ensureStudentInCourse(userId, kp.course_id);

  const [mastery, questionCount, wrongQuestionCount, documentCount] = await Promise.all([
    prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: userId,
          course_id: kp.course_id,
          knowledge_point_id: knowledgePointId,
        },
      },
    }),
    prisma.question.count({
      where: { knowledge_point_id: knowledgePointId, status: 'active' },
    }),
    prisma.wrongQuestion.count({
      where: {
        student_user_id: userId,
        knowledge_point_id: knowledgePointId,
        status: { not: 'REMOVED' },
      },
    }),
    // 关联的文档数量（通过 knowledge_documents 中 scope_type=course 且 course_id 匹配）
    prisma.knowledgeDocument.count({
      where: { course_id: kp.course_id },
    }),
  ]);

  return {
    knowledge_point_id: kp.knowledge_point_id,
    knowledge_point_name: kp.knowledge_point_name,
    knowledge_point_code: kp.knowledge_point_code,
    description: kp.description || null,
    difficulty_level: toLower(kp.difficulty_level),
    course: {
      course_id: kp.course.course_id,
      course_name: kp.course.course_name,
      course_code: kp.course.course_code,
    },
    chapter: kp.chapter
      ? {
          chapter_id: kp.chapter.chapter_id,
          chapter_name: kp.chapter.chapter_name,
        }
      : null,
    mastery: mastery
      ? {
          mastery_score: mastery.mastery_score,
          mastery_level: toLower(mastery.mastery_level),
          last_study_at: mastery.updated_at ? mastery.updated_at.toISOString() : null,
        }
      : { mastery_score: 0, mastery_level: 'weak', last_study_at: null },
    question_count: questionCount,
    wrong_question_count: wrongQuestionCount,
    document_count: documentCount,
  };
}

// ========================
// 3. 学习任务相关
// ========================

/**
 * 获取学生学习任务列表
 */
async function getStudentTasks(userId, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const { task_type, status, course_id } = query;

  // 获取学生已加入的课程 ID
  const enrollments = await getActiveCourseEnrollments(userId);
  const enrolledCourseIds = uniqueIds(enrollments.map((e) => e.course_id));

  if (enrolledCourseIds.length === 0) {
    return { list: [], total: 0, page, page_size: pageSize };
  }

  // 如果指定了 course_id，校验是否已加入
  if (course_id) {
    const cid = parseInt(course_id, 10);
    if (!enrolledCourseIds.includes(cid)) {
      return { list: [], total: 0, page, page_size: pageSize };
    }
  }

  // 构建查询条件
  const where = {
    course_id: course_id ? parseInt(course_id, 10) : { in: enrolledCourseIds },
    teaching_class_id: { in: uniqueIds(enrollments.map((e) => e.teaching_class_id)) },
  };
  if (task_type) {
    const prismaTaskType = task_type.toUpperCase();
    where.task_type = prismaTaskType;
  }
  if (status) {
    const prismaStatus = status.toUpperCase();
    where.status = prismaStatus;
  }

  const [tasks, total] = await Promise.all([
    prisma.learningTask.findMany({
      where,
      orderBy: [{ deadline: 'desc' }, { created_at: 'desc' }],
      skip,
      take: pageSize,
      include: {
        course: true,
        _count: { select: { question_links: true } },
      },
    }),
    prisma.learningTask.count({ where }),
  ]);

  // 获取学生对这些任务的提交状态
  const taskIds = tasks.map((t) => t.task_id);
  const submissions = await prisma.taskSubmission.findMany({
    where: {
      task_id: { in: taskIds },
      student_user_id: userId,
    },
  });

  const submissionMap = {};
  for (const sub of submissions) {
    submissionMap[sub.task_id] = sub;
  }

  const list = tasks.map((t) => {
    const sub = submissionMap[t.task_id];
    return {
      task_id: t.task_id,
      task_title: t.title,
      task_type: toLower(t.task_type),
      course_id: t.course_id,
      course_name: t.course.course_name,
      status: toLower(t.status),
      deadline: t.deadline ? t.deadline.toISOString() : null,
      question_count: t._count.question_links,
      total_score: null, // 需要汇总题目分数，暂不计算
      submission_status: sub ? toLower(sub.submission_status) : null,
      submitted_at: sub?.submitted_at ? sub.submitted_at.toISOString() : null,
      score: sub?.total_score ?? null,
    };
  });

  return { list, total, page, page_size: pageSize };
}

/**
 * 获取学习任务详情
 */
async function getStudentTaskDetail(userId, taskId) {
  const task = await prisma.learningTask.findUnique({
    where: { task_id: taskId },
    include: {
      course: true,
      teaching_class: true,
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

  // 校验学生是否在该课程
  await ensureStudentInCourse(userId, task.course_id);

  // 获取学生提交状态
  const submission = await prisma.taskSubmission.findFirst({
    where: { task_id: taskId, student_user_id: userId },
  });

  // 题目列表：不返回 correct_answer，已提交则返回 analysis
  const isSubmitted = submission && submission.submission_status === 'SUBMITTED';
  const questions = task.question_links.map((link) => {
    const q = link.question;
    const result = {
      question_id: q.question_id,
      question_type: toLower(q.question_type),
      question_content: q.content,
      title: q.title,
      difficulty_level: toLower(q.difficulty_level),
      score: q.score,
      options: q.options.map((opt) => ({
        option_key: opt.option_key,
        option_content: opt.option_content,
      })),
    };
    // 已提交则返回解析，但不返回正确答案
    if (isSubmitted && q.analysis) {
      result.analysis = q.analysis;
    }
    return result;
  });

  return {
    task_id: task.task_id,
    task_title: task.title,
    task_type: toLower(task.task_type),
    description: task.description || null,
    course: {
      course_id: task.course.course_id,
      course_name: task.course.course_name,
    },
    teaching_class: {
      teaching_class_id: task.teaching_class.teaching_class_id,
      teaching_class_name: task.teaching_class.teaching_class_name,
    },
    deadline: task.deadline ? task.deadline.toISOString() : null,
    start_time: task.start_time ? task.start_time.toISOString() : null,
    status: toLower(task.status),
    allow_late_submit: task.allow_late_submit,
    knowledge_points: task.knowledge_point_links.map((link) => ({
      knowledge_point_id: link.knowledge_point_id,
      knowledge_point_name: link.knowledge_point.knowledge_point_name,
    })),
    questions,
    submission: submission
      ? {
          submission_id: submission.submission_id,
          status: toLower(submission.submission_status),
          submitted_at: submission.submitted_at ? submission.submitted_at.toISOString() : null,
          score: submission.total_score,
          total_score: task.question_links.reduce((sum, l) => sum + (l.question.score || 0), 0),
          grading_status: toLower(submission.grading_status),
        }
      : null,
  };
}

// ========================
// 4. 错题本相关
// ========================

/**
 * 获取学生错题本列表
 */
async function getWrongQuestions(userId, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const { course_id, knowledge_point_id, status } = query;

  const where = { student_user_id: userId };

  // 默认不返回 removed 状态
  if (status) {
    where.status = status.toUpperCase();
  } else {
    where.status = { not: 'REMOVED' };
  }

  if (course_id) {
    where.course_id = parseInt(course_id, 10);
  }
  if (knowledge_point_id) {
    where.knowledge_point_id = parseInt(knowledge_point_id, 10);
  }

  const [wrongQuestions, total] = await Promise.all([
    prisma.wrongQuestion.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        question: true,
        course: true,
        knowledge_point: true,
      },
    }),
    prisma.wrongQuestion.count({ where }),
  ]);

  const list = wrongQuestions.map((wq) => ({
    wrong_question_id: wq.wrong_question_id,
    question_id: wq.question_id,
    question_type: toLower(wq.question?.question_type),
    question_content: wq.question?.content || null,
    course_id: wq.course_id,
    course_name: wq.course?.course_name || null,
    knowledge_point_id: wq.knowledge_point_id,
    knowledge_point_name: wq.knowledge_point?.knowledge_point_name || null,
    wrong_count: 1, // 简单返回1，复杂统计后续再做
    last_wrong_at: wq.updated_at ? wq.updated_at.toISOString() : wq.created_at.toISOString(),
    status: toLower(wq.status),
  }));

  return { list, total, page, page_size: pageSize };
}

/**
 * 更新错题状态
 */
async function updateWrongQuestionStatus(userId, wrongQuestionId, newStatus) {
  const validStatuses = ['unresolved', 'mastered', 'removed'];
  if (!validStatuses.includes(newStatus)) {
    throw Object.assign(new Error('无效的状态值，可选：unresolved / mastered / removed'), { code: 40001 });
  }

  const wq = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
  });

  if (!wq) {
    throw Object.assign(new Error('错题记录不存在'), { code: 40002 });
  }

  if (wq.student_user_id !== userId) {
    throw Object.assign(new Error('无权操作该错题记录'), { code: 40301 });
  }

  const updateData = {
    status: newStatus.toUpperCase(),
  };
  if (newStatus === 'mastered') {
    updateData.mastered_at = new Date();
  }

  const updated = await prisma.wrongQuestion.update({
    where: { wrong_question_id: wrongQuestionId },
    data: updateData,
  });

  return {
    wrong_question_id: updated.wrong_question_id,
    status: toLower(updated.status),
    mastered_at: updated.mastered_at ? updated.mastered_at.toISOString() : null,
  };
}

// ========================
// 5. 推荐内容相关
// ========================

/**
 * 获取学生推荐内容列表
 */
async function getRecommendations(userId, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const { recommend_type } = query;

  // 获取最新推荐记录
  const latestRecord = await prisma.recommendationRecord.findFirst({
    where: { student_user_id: userId },
    orderBy: { created_at: 'desc' },
  });

  if (!latestRecord) {
    return { list: [], total: 0, page, page_size: pageSize };
  }

  // 构建推荐项查询条件
  const itemsWhere = {
    recommendation_record_id: latestRecord.recommendation_record_id,
  };
  if (recommend_type) {
    itemsWhere.item_type = recommend_type; // item_type 存储的就是小写，如 knowledge_point
  }

  const [items, total] = await Promise.all([
    prisma.recommendationItem.findMany({
      where: itemsWhere,
      orderBy: { rank: 'asc' },
      skip,
      take: pageSize,
    }),
    prisma.recommendationItem.count({ where: itemsWhere }),
  ]);

  const list = items.map((item) => ({
    recommendation_item_id: item.recommendation_item_id,
    recommend_type: item.item_type, // item_type 已是小写
    title: item.title,
    reason: item.reason || null,
    target_type: item.target_type || null,
    target_id: item.target_id,
    priority: item.rank,
    created_at: item.created_at ? item.created_at.toISOString() : null,
  }));

  return { list, total, page, page_size: pageSize };
}

// ========================
// 6. 学习记录相关
// ========================

/**
 * 获取学生学习记录列表
 */
async function getStudyRecords(userId, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const { course_id, knowledge_point_id, action_type } = query;

  const where = { student_user_id: userId };

  if (course_id) {
    where.course_id = parseInt(course_id, 10);
  }
  if (knowledge_point_id) {
    where.knowledge_point_id = parseInt(knowledge_point_id, 10);
  }
  if (action_type) {
    where.action_type = action_type.toUpperCase();
  }

  const [records, total] = await Promise.all([
    prisma.studyRecord.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: true,
        knowledge_point: true,
      },
    }),
    prisma.studyRecord.count({ where }),
  ]);

  const list = records.map((r) => ({
    study_record_id: r.study_record_id,
    course_id: r.course_id,
    course_name: r.course?.course_name || null,
    knowledge_point_id: r.knowledge_point_id,
    knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
    action_type: toLower(r.action_type),
    duration_seconds: r.duration_seconds,
    created_at: r.created_at ? r.created_at.toISOString() : null,
  }));

  return { list, total, page, page_size: pageSize };
}

/**
 * 新增学习记录
 */
async function createStudyRecord(userId, body) {
  const { course_id, knowledge_point_id, action_type, duration_seconds } = body;

  // 参数校验
  if (!course_id) {
    throw Object.assign(new Error('course_id 不能为空'), { code: 40001 });
  }
  if (!action_type) {
    throw Object.assign(new Error('action_type 不能为空'), { code: 40001 });
  }

  const validActions = ['start', 'view', 'pause', 'finish', 'review'];
  if (!validActions.includes(action_type)) {
    throw Object.assign(new Error('无效的 action_type，可选：start / view / pause / finish / review'), { code: 40001 });
  }

  const cid = parseInt(course_id, 10);
  const kpid = knowledge_point_id ? parseInt(knowledge_point_id, 10) : null;

  // 校验学生是否加入该课程
  await ensureStudentInCourse(userId, cid);

  // 校验知识点是否属于该课程
  if (kpid) {
    const kp = await prisma.knowledgePoint.findUnique({
      where: { knowledge_point_id: kpid },
    });
    if (!kp || kp.course_id !== cid) {
      throw Object.assign(new Error('知识点不属于该课程'), { code: 40001 });
    }
  }

  // 创建学习记录
  const record = await prisma.studyRecord.create({
    data: {
      student_user_id: userId,
      course_id: cid,
      knowledge_point_id: kpid,
      resource_type: 'knowledge_point',
      action_type: action_type.toUpperCase(),
      duration_seconds: duration_seconds || 0,
      started_at: new Date(),
    },
  });

  // 如果是 finish 或 review，更新掌握度记录的 updated_at
  if ((action_type === 'finish' || action_type === 'review') && kpid) {
    await prisma.studentMasteryRecord.upsert({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: userId,
          course_id: cid,
          knowledge_point_id: kpid,
        },
      },
      update: {
        updated_at: new Date(),
      },
      create: {
        student_user_id: userId,
        course_id: cid,
        knowledge_point_id: kpid,
        mastery_score: 0,
        mastery_level: 'WEAK',
      },
    });
  }

  return {
    study_record_id: record.study_record_id,
    course_id: record.course_id,
    knowledge_point_id: record.knowledge_point_id,
    action_type: toLower(record.action_type),
    duration_seconds: record.duration_seconds,
    created_at: record.created_at ? record.created_at.toISOString() : null,
  };
}

// ========================
// 7. 学生画像相关
// ========================

/**
 * 获取学生画像
 */
async function getStudentPortrait(userId) {
  // 获取学生已加入的课程 ID
  const enrollments = await getActiveCourseEnrollments(userId);
  const courseIds = uniqueIds(enrollments.map((e) => e.course_id));

  const [
    portraits,
    masteryRecords,
    researchProfiles,
    competitionProfiles,
  ] = await Promise.all([
    prisma.studentPortrait.findMany({
      where: { student_user_id: userId, course_id: { in: courseIds } },
    }),
    prisma.studentMasteryRecord.findMany({
      where: { student_user_id: userId, course_id: { in: courseIds } },
      include: { knowledge_point: true },
    }),
    prisma.studentResearchProfile.findMany({
      where: { student_user_id: userId },
    }),
    prisma.studentCompetitionProfile.findMany({
      where: { student_user_id: userId },
    }),
  ]);

  // 计算学习能力分数：跨课程平均值
  const avg = (key) => {
    if (portraits.length === 0) return 0;
    const sum = portraits.reduce((s, p) => s + (p[key] || 0), 0);
    return Math.round((sum / portraits.length) * 10) / 10;
  };

  // 掌握度汇总统计
  const weakCount = masteryRecords.filter((r) => r.mastery_level === 'WEAK').length;
  const generalCount = masteryRecords.filter((r) => r.mastery_level === 'GENERAL').length;
  const goodCount = masteryRecords.filter((r) => r.mastery_level === 'GOOD').length;
  const excellentCount = masteryRecords.filter((r) => r.mastery_level === 'EXCELLENT').length;

  // 薄弱知识点（前5个）
  const weakPoints = masteryRecords
    .filter((r) => r.mastery_level === 'WEAK')
    .sort((a, b) => a.mastery_score - b.mastery_score)
    .slice(0, 5)
    .map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
      mastery_score: r.mastery_score,
      mastery_level: toLower(r.mastery_level),
    }));

  // 掌握良好知识点（前5个）
  const goodPoints = masteryRecords
    .filter((r) => r.mastery_level === 'GOOD' || r.mastery_level === 'EXCELLENT')
    .sort((a, b) => b.mastery_score - a.mastery_score)
    .slice(0, 5)
    .map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
      mastery_score: r.mastery_score,
      mastery_level: toLower(r.mastery_level),
    }));

  // 科研画像
  let researchProfile = null;
  if (researchProfiles.length > 0) {
    const rp = researchProfiles[0];
    researchProfile = {
      total_score: rp.total_score,
      tags: rp.tags || [],
      teacher_comment: rp.teacher_comment || null,
    };
  }

  // 竞赛画像
  let competitionProfile = null;
  if (competitionProfiles.length > 0) {
    const cp = competitionProfiles[0];
    competitionProfile = {
      total_score: cp.total_score,
      tags: cp.tags || [],
      teacher_comment: cp.teacher_comment || null,
    };
  }

  return {
    learning_ability_score: avg('learning_total_score'),
    research_ability_score: avg('research_total_score'),
    competition_ability_score: avg('competition_total_score'),
    mastery_summary: {
      weak_count: weakCount,
      general_count: generalCount,
      good_count: goodCount,
      excellent_count: excellentCount,
    },
    weak_knowledge_points: weakPoints,
    good_knowledge_points: goodPoints,
    research_profile: researchProfile,
    competition_profile: competitionProfile,
  };
}

// ========================
// 导出
// ========================

module.exports = {
  getDashboard,
  getStudentCourses,
  getStudentCourseDetail,
  getStudentCourseChapters,
  getStudentCourseKnowledgePoints,
  getKnowledgePointDetail,
  getStudentTasks,
  getStudentTaskDetail,
  getWrongQuestions,
  updateWrongQuestionStatus,
  getRecommendations,
  getStudyRecords,
  createStudyRecord,
  getStudentPortrait,
};
