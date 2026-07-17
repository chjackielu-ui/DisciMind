const prisma = require('../../config/prisma');
const { buildChartSpec } = require('./chart-spec');

const TOOL_NAMES = Object.freeze([
  'get_current_student_context',
  'get_student_wrong_questions',
  'get_student_learning_records',
  'get_student_score_trend',
  'get_student_mastery',
  'get_student_recent_sessions',
  'get_student_learning_time',
  'get_student_task_completion',
]);

function assertOwnerContext(context) {
  const userId = Number(context?.userContext?.userId || context?.user?.user_id);
  if (!Number.isInteger(userId) || userId < 1) throw Object.assign(new Error('认证用户上下文缺失'), { code: 40101, status: 401, expose: true });
  if (String(context?.userContext?.role || context?.user?.role || '').toLowerCase() !== 'student') {
    throw Object.assign(new Error('本人学习数据工具仅面向登录学生'), { code: 40301, status: 403, expose: true });
  }
  return userId;
}

function scopeWhere(context, options = {}) {
  const courseId = Number(options.courseId || context.userContext?.selectedCourse?.id || context.courseId);
  const knowledgePointId = Number(options.knowledgePointId || context.userContext?.selectedKnowledgePoint?.id);
  return {
    ...(Number.isInteger(courseId) ? { courseId } : {}),
    ...(Number.isInteger(knowledgePointId) ? { knowledgePointId } : {}),
  };
}

function rangeOf(context, options = {}) {
  const fallback = context.userContext?.range;
  const days = Math.max(1, Math.min(366, Number(options.days || fallback?.days) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { days, start, end, label: days === 7 ? '最近 7 天' : days === 90 ? '最近 90 天' : days === 30 ? '最近 30 天' : `最近 ${days} 天` };
}

function source(label, models) {
  return { type: 'DATABASE', label, models };
}

function publicRange(range) {
  return { label: range.label, start: range.start.toISOString(), end: range.end.toISOString() };
}

function noData(message, extra = {}) {
  return { no_data: true, noData: true, message, ...extra };
}

async function getCurrentStudentContext(input, context) {
  assertOwnerContext(context);
  const data = context.userContext;
  return {
    no_data: !data.selectedCourse, noData: !data.selectedCourse,
    message: data.selectedCourse ? `当前课程为${data.selectedCourse.name}${data.selectedKnowledgePoint ? `，知识点为${data.selectedKnowledgePoint.name}` : ''}。` : '当前没有唯一可确定的课程，请先选择课程。',
    current: {
      course: data.selectedCourse, knowledgePoint: data.selectedKnowledgePoint, teachingClass: data.teachingClass,
      activeLearningContext: data.activeLearningContext, selectionReason: data.courseSelectionReason,
    },
    availableCourses: data.enrollments,
    source: source('当前登录学生的选课与学习上下文', ['StudentCourseEnrollment', 'StudentLearningContext']),
  };
}

async function getStudentWrongQuestions(input, context) {
  const userId = assertOwnerContext(context);
  const scope = scopeWhere(context, input);
  const rows = await prisma.wrongQuestion.findMany({
    where: {
      student_user_id: userId,
      ...(scope.courseId ? { course_id: scope.courseId } : {}),
      ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    include: {
      question: { select: { question_id: true, title: true, content: true, question_type: true, difficulty_level: true } },
      course: { select: { course_id: true, course_name: true } },
      knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } },
    },
    orderBy: [{ last_wrong_at: 'desc' }, { updated_at: 'desc' }], take: Math.max(1, Math.min(100, Number(input.limit) || 20)),
  });
  const statusCounts = rows.reduce((out, item) => ({ ...out, [item.status]: (out[item.status] || 0) + 1 }), {});
  const items = rows.map(item => ({
    id: item.wrong_question_id, questionId: item.question_id,
    title: item.question?.title || String(item.question?.content || '').slice(0, 80) || `题目 ${item.question_id}`,
    questionType: item.question?.question_type || null, difficulty: item.question?.difficulty_level || null,
    course: item.course ? { id: item.course.course_id, name: item.course.course_name } : null,
    knowledgePoint: item.knowledge_point ? { id: item.knowledge_point.knowledge_point_id, name: item.knowledge_point.knowledge_point_name } : null,
    status: item.status, reviewStatus: item.review_status, wrongReason: item.wrong_reason,
    reviewCount: item.review_count, lastWrongAt: (item.last_wrong_at || item.updated_at).toISOString(),
  }));
  return {
    ...(items.length ? { no_data: false, noData: false, message: `找到 ${items.length} 道符合范围的错题。` } : noData('当前范围没有错题记录。')),
    total: items.length, statusCounts, items,
    source: source('当前登录学生的错题本', ['WrongQuestion', 'Question', 'KnowledgePoint']),
  };
}

async function getStudentLearningRecords(input, context) {
  const userId = assertOwnerContext(context);
  const scope = scopeWhere(context, input); const range = rangeOf(context, input);
  const rows = await prisma.studyRecord.findMany({
    where: {
      student_user_id: userId, created_at: { gte: range.start, lte: range.end },
      ...(scope.courseId ? { course_id: scope.courseId } : {}),
      ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}),
    },
    include: { course: { select: { course_name: true } }, knowledge_point: { select: { knowledge_point_name: true } } },
    orderBy: { created_at: 'desc' }, take: Math.max(1, Math.min(200, Number(input.limit) || 50)),
  });
  const items = rows.map(item => ({
    id: item.study_record_id, courseName: item.course.course_name, knowledgePointName: item.knowledge_point?.knowledge_point_name || null,
    resourceType: item.resource_type, actionType: item.action_type, durationSeconds: item.duration_seconds || 0,
    progressPercent: item.progress_percent, occurredAt: item.created_at.toISOString(),
  }));
  return {
    ...(items.length ? { no_data: false, noData: false, message: `${range.label}有 ${items.length} 条学习记录。` } : noData(`${range.label}没有学习记录。`)),
    range: publicRange(range), total: items.length, items,
    source: source('当前登录学生的学习记录', ['StudyRecord']),
  };
}

async function getStudentScoreTrend(input, context) {
  const userId = assertOwnerContext(context);
  const scope = scopeWhere(context, input); const range = rangeOf(context, input);
  const [practices, submissions] = await Promise.all([
    prisma.practiceSession.findMany({
      where: {
        student_user_id: userId, started_at: { gte: range.start, lte: range.end },
        ...(scope.courseId ? { course_id: scope.courseId } : {}),
        ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}),
        total_score: { not: null }, max_score: { gt: 0 },
      },
      include: { knowledge_point: { select: { knowledge_point_name: true } } }, orderBy: { started_at: 'asc' }, take: 200,
    }),
    prisma.taskSubmission.findMany({
      where: {
        student_user_id: userId, submitted_at: { gte: range.start, lte: range.end }, total_score: { not: null },
        ...(scope.courseId ? { task: { course_id: scope.courseId } } : {}),
      },
      include: { task: { select: { title: true, total_score: true, course_id: true } } }, orderBy: { submitted_at: 'asc' }, take: 200,
    }),
  ]);
  const points = [
    ...practices.map(item => ({
      occurredAt: item.submitted_at || item.started_at, title: item.knowledge_point?.knowledge_point_name || '练习',
      scoreRate: Number(item.max_score) > 0 ? Number(item.total_score) / Number(item.max_score) * 100 : null, sourceType: '练习',
    })),
    ...submissions.map(item => ({
      occurredAt: item.submitted_at, title: item.task.title,
      scoreRate: Number(item.task.total_score) > 0 ? Number(item.total_score) / Number(item.task.total_score) * 100 : Number(item.total_score), sourceType: '课程任务',
    })),
  ].filter(item => Number.isFinite(item.scoreRate) && item.occurredAt).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)).map(item => ({
    ...item, scoreRate: Math.round(item.scoreRate * 100) / 100,
    occurredAt: new Date(item.occurredAt).toISOString(), label: new Date(item.occurredAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
  }));
  const result = {
    ...(points.length ? { no_data: false, noData: false, message: `${range.label}有 ${points.length} 个可比成绩点。` } : noData(`${range.label}没有已评分的练习或课程任务。`)),
    range: publicRange(range), points,
    metricDefinition: '得分率 = 实际得分 ÷ 可得总分 × 100%；课程任务缺少总分时使用记录中的百分制成绩。',
    source: source('当前登录学生已评分的练习和课程任务', ['PracticeSession', 'TaskSubmission', 'LearningTask']),
  };
  result.chartSpec = buildChartSpec('get_student_score_trend', result);
  return result;
}

async function getStudentMastery(input, context) {
  const userId = assertOwnerContext(context);
  const scope = scopeWhere(context, input);
  const rows = await prisma.studentMasteryRecord.findMany({
    where: { student_user_id: userId, ...(scope.courseId ? { course_id: scope.courseId } : {}), ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}) },
    include: { course: { select: { course_name: true } }, knowledge_point: { select: { knowledge_point_name: true } } },
    orderBy: [{ mastery_score: 'asc' }, { updated_at: 'desc' }], take: 100,
  });
  const items = rows.map(item => ({
    id: item.knowledge_point_id, name: item.knowledge_point.knowledge_point_name, courseName: item.course.course_name,
    score: Math.round(Number(item.mastery_score) * 100) / 100, level: item.mastery_level, updatedAt: item.updated_at.toISOString(),
  }));
  const result = {
    ...(items.length ? { no_data: false, noData: false, message: `找到 ${items.length} 个知识点掌握度记录。` } : noData('当前范围没有知识点掌握度记录。')),
    items, metricDefinition: '掌握度为 DisciMind 根据测验、答题、学习进度及教师标注形成的 0–100 综合分。',
    source: source('当前登录学生的知识点掌握度', ['StudentMasteryRecord', 'KnowledgePoint']),
  };
  result.chartSpec = buildChartSpec('get_student_mastery', result);
  return result;
}

async function getStudentRecentSessions(input, context) {
  const userId = assertOwnerContext(context);
  const scope = scopeWhere(context, input); const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  const [learning, practice] = await Promise.all([
    prisma.learningSession.findMany({
      where: { student_user_id: userId, ...(scope.courseId ? { course_id: scope.courseId } : {}), ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}) },
      include: { course: { select: { course_name: true } }, knowledge_point: { select: { knowledge_point_name: true } } }, orderBy: { updated_at: 'desc' }, take: limit,
    }),
    prisma.practiceSession.findMany({
      where: { student_user_id: userId, ...(scope.courseId ? { course_id: scope.courseId } : {}), ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}) },
      include: { course: { select: { course_name: true } }, knowledge_point: { select: { knowledge_point_name: true } } }, orderBy: { updated_at: 'desc' }, take: limit,
    }),
  ]);
  const items = [
    ...learning.map(item => ({ id: item.session_id, type: '学习流', status: item.status, courseName: item.course?.course_name, knowledgePointName: item.knowledge_point?.knowledge_point_name || null, mastery: item.mastery_current, durationSeconds: item.actual_duration_seconds, updatedAt: item.updated_at.toISOString() })),
    ...practice.map(item => ({ id: item.practice_session_id, type: '练习', status: item.status, courseName: item.course.course_name, knowledgePointName: item.knowledge_point?.knowledge_point_name || null, score: item.total_score, durationSeconds: item.duration_seconds, updatedAt: item.updated_at.toISOString() })),
  ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, limit);
  return {
    ...(items.length ? { no_data: false, noData: false, message: `找到 ${items.length} 次最近学习会话。` } : noData('当前范围没有学习会话。')),
    items, source: source('当前登录学生的学习流和练习会话', ['LearningSession', 'PracticeSession']),
  };
}

async function getStudentLearningTime(input, context) {
  const userId = assertOwnerContext(context);
  const scope = scopeWhere(context, input); const range = rangeOf(context, input);
  const [study, practices] = await Promise.all([
    prisma.studyRecord.findMany({
      where: { student_user_id: userId, created_at: { gte: range.start, lte: range.end }, ...(scope.courseId ? { course_id: scope.courseId } : {}), ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}) },
      select: { duration_seconds: true, created_at: true }, take: 2000,
    }),
    prisma.practiceSession.findMany({
      where: { student_user_id: userId, started_at: { gte: range.start, lte: range.end }, ...(scope.courseId ? { course_id: scope.courseId } : {}), ...(scope.knowledgePointId ? { knowledge_point_id: scope.knowledgePointId } : {}) },
      select: { duration_seconds: true, started_at: true }, take: 1000,
    }),
  ]);
  const dailyMap = new Map();
  const add = (date, seconds) => {
    if (!date || !Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return;
    const key = new Date(date).toISOString().slice(0, 10);
    dailyMap.set(key, (dailyMap.get(key) || 0) + Number(seconds));
  };
  study.forEach(item => add(item.created_at, item.duration_seconds));
  practices.forEach(item => add(item.started_at, item.duration_seconds));
  const daily = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, seconds]) => ({ date, label: date.slice(5), minutes: Math.round(seconds / 6) / 10 }));
  const totalMinutes = Math.round(daily.reduce((sum, item) => sum + item.minutes, 0) * 10) / 10;
  const result = {
    ...(daily.length ? { no_data: false, noData: false, message: `${range.label}累计记录学习 ${totalMinutes} 分钟。` } : noData(`${range.label}没有可计时的学习记录。`)),
    range: publicRange(range), totalMinutes, daily,
    metricDefinition: '学习时长为学习记录与练习会话中已保存的 duration_seconds 之和；未保存时长的活动不计入。',
    source: source('当前登录学生的学习与练习计时记录', ['StudyRecord', 'PracticeSession']),
  };
  result.chartSpec = buildChartSpec('get_student_learning_time', result);
  return result;
}

async function getStudentTaskCompletion(input, context) {
  const userId = assertOwnerContext(context);
  const scope = scopeWhere(context, input); const range = rangeOf(context, input);
  const recipients = await prisma.learningTaskRecipient.findMany({
    where: {
      student_user_id: userId, created_at: { lte: range.end },
      ...(scope.courseId ? { task: { course_id: scope.courseId } } : {}),
    },
    include: { task: { include: { submissions: { where: { student_user_id: userId }, orderBy: { updated_at: 'desc' }, take: 1 } } } },
    orderBy: { created_at: 'desc' }, take: 500,
  });
  const items = recipients.map(recipient => {
    const submission = recipient.task.submissions[0];
    const status = submission?.submission_status;
    const category = ['SUBMITTED', 'GRADED'].includes(String(status)) ? 'completed' : status === 'IN_PROGRESS' ? 'inProgress' : 'notStarted';
    return { id: recipient.task_id, title: recipient.task.title, category, status: status || 'NOT_STARTED', deadline: recipient.task.deadline?.toISOString() || null, score: submission?.total_score ?? null };
  });
  const completed = items.filter(item => item.category === 'completed').length;
  const inProgress = items.filter(item => item.category === 'inProgress').length;
  const notStarted = items.filter(item => item.category === 'notStarted').length;
  const result = {
    ...(items.length ? { no_data: false, noData: false, message: `当前范围共有 ${items.length} 个已下发任务，完成 ${completed} 个。` } : noData('当前范围没有已下发任务。')),
    range: publicRange(range), total: items.length, completed, inProgress, notStarted,
    completionRate: items.length ? Math.round(completed / items.length * 10000) / 100 : 0, items: items.slice(0, 50),
    metricDefinition: '完成率 = 已提交或已评分任务数 ÷ 当前范围内已下发任务数 × 100%。',
    source: source('当前登录学生收到的课程任务及提交记录', ['LearningTaskRecipient', 'LearningTask', 'TaskSubmission']),
  };
  result.chartSpec = buildChartSpec('get_student_task_completion', result);
  return result;
}

const handlers = Object.freeze({
  get_current_student_context: getCurrentStudentContext,
  get_student_wrong_questions: getStudentWrongQuestions,
  get_student_learning_records: getStudentLearningRecords,
  get_student_score_trend: getStudentScoreTrend,
  get_student_mastery: getStudentMastery,
  get_student_recent_sessions: getStudentRecentSessions,
  get_student_learning_time: getStudentLearningTime,
  get_student_task_completion: getStudentTaskCompletion,
});

async function execute(name, input, context) {
  const handler = handlers[name];
  if (!handler) throw Object.assign(new Error(`未注册本人学习数据工具：${name}`), { code: 'AI_TOOL_VALIDATION_FAILED', expose: true });
  return handler(input || {}, context);
}

module.exports = { TOOL_NAMES, handlers, assertOwnerContext, scopeWhere, rangeOf, execute };
