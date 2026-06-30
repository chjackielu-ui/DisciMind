// 学生端服务层
// 负责学生首页仪表盘、学习数据查询等业务逻辑
// 所有数据库操作统一使用 config/prisma 单例

const prisma = require('../config/prisma');

/**
 * 将 Prisma 枚举值转为前端小写格式
 * Prisma 返回的枚举值是 enum 名称（如 'WEAK'、'QUIZ'），
 * 前端期望小写格式（如 'weak'、'quiz'）
 */
function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

/**
 * 获取当前自然周周一 00:00:00（按中国习惯周一为一周起始）
 */
function getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ...
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
 * 获取学生首页仪表盘综合数据
 * @param {number} userId - 当前登录学生用户 ID
 * @returns {Object} 仪表盘数据
 */
async function getDashboard(userId) {
  // ========== 并行查询所有基础数据 ==========

  // 1. 用户基本信息（含 profile）
  const userPromise = prisma.user.findUnique({
    where: { user_id: userId },
    include: { profile: true },
  });

  // 2. 学生选课记录（仅激活的）
  const enrollmentsPromise = prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: userId, enrollment_status: 'active' },
    include: {
      course: true,
      teachingClass: true,
    },
  });

  // 3. 知识点掌握度记录（跨所有已选课程）
  // 4. 错题数量
  // 5. 本周学习记录
  // 6. AI 提问次数
  // 7. 学生画像
  // 8. 推荐记录
  // 9. 学习任务

  // 先获取用户和选课记录（需要 courseIds 才能继续）
  const [user, enrollments] = await Promise.all([
    userPromise,
    enrollmentsPromise,
  ]);

  if (!user) {
    throw Object.assign(new Error('用户不存在'), { code: 40401 });
  }

  const courseIds = enrollments.map((e) => e.course_id);
  const teachingClassIds = enrollments.map((e) => e.teaching_class_id);

  // ========== 如果学生没有选课，返回空数据 ==========

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

  // ========== 并行查询所有业务数据 ==========

  const [
    masteryRecords,
    wrongQuestionCount,
    studyRecordsWeek,
    aiQuestionCount,
    portraits,
    latestRecRecord,
    recentTasks,
    allStudyRecords,
  ] = await Promise.all([
    // 知识点掌握度（含知识点基础信息）
    prisma.studentMasteryRecord.findMany({
      where: {
        student_user_id: userId,
        course_id: { in: courseIds },
      },
      include: {
        knowledge_point: true,
      },
    }),

    // 错题数量（未解决的）
    prisma.wrongQuestion.count({
      where: {
        student_user_id: userId,
        status: 'UNRESOLVED',
      },
    }),

    // 本周学习记录
    prisma.studyRecord.findMany({
      where: {
        student_user_id: userId,
        started_at: { gte: getWeekStart() },
      },
    }),

    // AI 提问次数（来自 student_question_records）
    prisma.studentQuestionRecord.count({
      where: { student_user_id: userId },
    }),

    // 学生画像
    prisma.studentPortrait.findMany({
      where: {
        student_user_id: userId,
        course_id: { in: courseIds },
      },
    }),

    // 最新推荐记录（含推荐项）
    prisma.recommendationRecord.findFirst({
      where: {
        student_user_id: userId,
        course_id: { in: courseIds },
      },
      orderBy: { created_at: 'desc' },
      include: {
        items: {
          orderBy: { rank: 'asc' },
        },
      },
    }),

    // 最近学习任务
    prisma.learningTask.findMany({
      where: {
        course_id: { in: courseIds },
        teaching_class_id: { in: teachingClassIds },
        status: 'PUBLISHED',
      },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),

    // 全部学习记录（用于 weekly_study_hours 回退计算）
    prisma.studyRecord.findMany({
      where: { student_user_id: userId },
    }),
  ]);

  // ========== 组装 overview 概览数据 ==========

  // course_count
  const courseCount = enrollments.length;

  // mastered_knowledge_count: mastery_level 为 GOOD 或 EXCELLENT
  const masteredCount = masteryRecords.filter(
    (r) => r.mastery_level === 'GOOD' || r.mastery_level === 'EXCELLENT',
  ).length;

  // weak_knowledge_count: mastery_level 为 WEAK
  const weakCount = masteryRecords.filter(
    (r) => r.mastery_level === 'WEAK',
  ).length;

  // learning_progress: 优先从画像 progress_score 计算（取平均值）
  let learningProgress = 0;
  if (portraits.length > 0) {
    const avgProgress =
      portraits.reduce((sum, p) => sum + (p.progress_score || 0), 0) /
      portraits.length;
    learningProgress = Math.round(avgProgress * 10) / 10;
  }

  // weekly_study_hours: 优先本周学习记录，回退到全部学习记录
  let weeklyStudyHours = 0;
  const weekSeconds = studyRecordsWeek.reduce(
    (sum, r) => sum + (r.duration_seconds || 0),
    0,
  );
  if (weekSeconds > 0) {
    weeklyStudyHours = Math.round((weekSeconds / 3600) * 10) / 10;
  } else {
    // 回退：取全部学习记录总时长
    const allSeconds = allStudyRecords.reduce(
      (sum, r) => sum + (r.duration_seconds || 0),
      0,
    );
    weeklyStudyHours = Math.round((allSeconds / 3600) * 10) / 10;
  }

  const overview = {
    course_count: courseCount,
    learning_progress: learningProgress,
    mastered_knowledge_count: masteredCount,
    weak_knowledge_count: weakCount,
    wrong_question_count: wrongQuestionCount,
    weekly_study_hours: weeklyStudyHours,
    ai_question_count: aiQuestionCount,
  };

  // ========== 组装 portrait 学生能力画像 ==========

  let portrait = null;
  if (portraits.length > 0) {
    // 跨课程取平均值
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

  // ========== 组装 courses 课程列表 ==========

  const courses = enrollments.map((e) => ({
    course_id: e.course.course_id,
    course_name: e.course.course_name,
    course_code: e.course.course_code,
    description: e.course.description || null,
  }));

  // ========== 组装 weak_knowledge_points 薄弱知识点 ==========

  const weakKnowledgePoints = masteryRecords
    .filter((r) => r.mastery_level === 'WEAK')
    .map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
      mastery_score: r.mastery_score,
      mastery_level: toLower(r.mastery_level),
    }))
    .sort((a, b) => a.mastery_score - b.mastery_score);

  // ========== 组装 recommendations 推荐内容 ==========

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

  // ========== 组装 recent_tasks 最近学习任务 ==========

  const recentTasksList = recentTasks.map((t) => ({
    task_id: t.task_id,
    task_title: t.title,
    task_type: toLower(t.task_type),
    status: toLower(t.status),
    deadline: t.deadline ? t.deadline.toISOString() : null,
  }));

  // ========== 组装并返回最终结果 ==========

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

module.exports = { getDashboard };
