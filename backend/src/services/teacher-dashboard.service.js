// 教师端看板与学情分析服务

const prisma = require('../config/prisma');
const {
  getAccessibleCourseIds,
  getAccessibleTeachingClassIds,
  ensureCourseAccess,
  ensureStudentAccess,
} = require('./teacher-access.service');
const keywordCloudService = require('./teacher-keyword-cloud.service');
const { normalizeWeakKnowledgePoints } = require('./teacher-analytics-normalizer');

// ---------- 词云停用词表（过滤无意义词语）----------
const STOP_WORDS = new Set([
  '你好', '谢谢', '感谢', '请问', '好的', '嗯', '哦', '啊', '哎',
  '这个', '那个', '就是', '然后', '感觉', '可以', '怎么', '如何',
  '为什么', '什么', '一个', '一下', '还有', '以及', '你说的',
  '是不是', '能不能', '不会', '我想', '帮我', '老师', '助手',
  '题目', '这道', '那道', '那个', '这些', '那些', '一些',
  '因为', '所以', '如果', '虽然', '但是', '而且', '或者',
  '没有', '不是', '我们', '他们', '你们', '自己', '知道',
  '问题', '时候', '这样', '那样', '之后', '之前', '现在',
  '已经', '可以', '应该', '可能', '需要', '通过', '进行',
  '使用', '利用', '实现', '基于', '相关', '主要', '比较',
  '其中', '之一', '包括', '比如', '例如', '叫做', '称为',
  '所谓', '关于', '对于', '按照', '根据', '因为', '由于',
  '因此', '从而', '从而', '最终', '首先', '其次', '最后',
  '目前', '当前', '一般', '通常', '往往', '容易', '很难',
  '完全', '基本', '某种', '多种', '不同', '各种', '大量',
  '很多', '不少', '少数', '部分', '其他', '别的', '整个',
  '第一', '第二', '第三', '第几', '第一个', '第二个',
  '一会儿', '快速', '详细', '简单', '复杂', '直接', '间接',
  '往往', '不断', '持续', '已经', '正在', '一直', '一直',
  '还是', '或是', '或是', '只是', '但是', '可是', '然而',
  '那么', '那么', '既然', '假如', '即使', '虽然', '固然',
  'hello', 'hi', 'ok', 'okay', 'thanks', 'thank', 'please',
  '知道', '明白', '懂了', '理解', '不清楚', '不明白', '不懂',
]);

// 学科概念映射（将同义表达归一化）
const SYNONYM_MAP = {
  'loss函数': '损失函数',
  'loss function': '损失函数',
  '损失函数': '损失函数',
  'lr': '学习率',
  'learning rate': '学习率',
  '学习率': '学习率',
  'activation': '激活函数',
  '激活函数': '激活函数',
  '激活': '激活函数',
  'bp': '反向传播',
  'back propagation': '反向传播',
  '反向传播': '反向传播',
  'cnn': '卷积神经网络',
  '卷积': '卷积神经网络',
  'rnn': '循环神经网络',
  'lstm': '长短期记忆网络',
  'transformer': 'Transformer',
  '注意力': '注意力机制',
  'attention': '注意力机制',
  'dropout': 'Dropout',
  '正则化': '正则化',
  '归一化': '归一化',
  '标准化': '标准化',
  '归一': '归一化',
  '标化': '标准化',
  '过拟合': '过拟合',
  '欠拟合': '欠拟合',
  '拟合': '拟合',
  'train': '训练集',
  'test': '测试集',
  '验证': '验证集',
  '数据集': '数据集',
};

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

function getCourseFilter(courseIds) {
  if (!courseIds) return {};
  return { course_id: { in: courseIds } };
}

function dateKey(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function scheduleItems(schedule) {
  if (!schedule) return [];
  if (Array.isArray(schedule)) return schedule.flatMap(scheduleItems);
  if (typeof schedule === 'string') return [{ label: schedule }];
  if (typeof schedule !== 'object') return [];
  return Array.isArray(schedule.items) ? schedule.items.flatMap(scheduleItems) : [schedule];
}

function expandClassSchedules(classes, from, to) {
  const events = [];
  for (const teachingClass of classes) {
    const seenScheduleItems = new Set();
    scheduleItems(teachingClass.schedule).forEach((item, itemIndex) => {
      const weekday = Number(item.weekday ?? item.dayOfWeek ?? item.day_of_week);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return;
      const period = item.periods || item.period || item.time || item.label || '课表时间';
      const scheduleKey = `${weekday}|${String(period).trim()}|${teachingClass.location || ''}`;
      if (seenScheduleItems.has(scheduleKey)) return;
      seenScheduleItems.add(scheduleKey);
      for (let cursor = new Date(from); cursor <= to; cursor = new Date(cursor.getTime() + 86400000)) {
        const isoWeekday = cursor.getDay() === 0 ? 7 : cursor.getDay();
        if (isoWeekday !== weekday) continue;
        const date = dateKey(cursor);
        events.push({
          id: `class-${teachingClass.teaching_class_id}-${date}-${itemIndex}`,
          type: 'course',
          title: teachingClass.course.course_name,
          subtitle: `${teachingClass.teaching_class_name} · ${period}`,
          start_at: date,
          all_day: true,
          time_label: String(period),
          location: teachingClass.location,
          status: teachingClass.status,
          source: { type: 'TeachingClass.schedule', recordId: teachingClass.teaching_class_id },
          action_url: `#/teacher/courses/${teachingClass.course_id}`,
          course_id: teachingClass.course_id,
          teaching_class_id: teachingClass.teaching_class_id,
        });
      }
    });
  }
  return events;
}

function taskCalendarEvents(tasks) {
  return tasks.flatMap((task) => {
    if (['CANCELLED', 'ARCHIVED'].includes(String(task.status).toUpperCase())) return [];
    const shared = {
      type: 'task',
      title: task.title,
      status: toLower(task.status),
      action_url: `#/teacher/tasks/${task.task_id}`,
      course_id: task.course_id,
      teaching_class_id: task.teaching_class_id,
    };
    const startAt = task.start_time?.toISOString();
    const deadlineAt = task.deadline?.toISOString();
    if (startAt && deadlineAt && dateKey(startAt) === dateKey(deadlineAt)) {
      return [{
        ...shared,
        id: `task-${task.task_id}`,
        subtitle: `${task.teaching_class.teaching_class_name} · 当日开始并截止`,
        start_at: startAt,
        source: { type: 'LearningTask.schedule', recordId: task.task_id },
      }];
    }
    return [
      startAt ? { ...shared, id: `task-start-${task.task_id}`, subtitle: `${task.teaching_class.teaching_class_name} · 开始`, start_at: startAt, source: { type: 'LearningTask.start_time', recordId: task.task_id } } : null,
      deadlineAt ? { ...shared, id: `task-deadline-${task.task_id}`, type: 'deadline', subtitle: `${task.teaching_class.teaching_class_name} · 截止`, start_at: deadlineAt, source: { type: 'LearningTask.deadline', recordId: task.task_id } } : null,
    ].filter(Boolean);
  });
}

function lessonPlanCalendarEvents(lessonPlans) {
  const seen = new Set();
  return lessonPlans.flatMap((plan) => {
    if (!plan.teaching_date) return [];
    const key = `${plan.course_id || ''}|${plan.teaching_class_id || ''}|${dateKey(plan.teaching_date)}|${String(plan.topic || '').trim()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `plan-${plan.lesson_plan_id}`,
      type: 'preparation',
      title: plan.topic,
      subtitle: `备课 · ${toLower(plan.status)}`,
      start_at: plan.teaching_date.toISOString(),
      status: toLower(plan.status),
      source: { type: 'LessonPlan.teaching_date', recordId: plan.lesson_plan_id },
      action_url: `#/teacher/preparation?plan_id=${plan.lesson_plan_id}`,
      course_id: plan.course_id,
      teaching_class_id: plan.teaching_class_id,
    }];
  });
}

function reminderCalendarEvents(reminders) {
  return reminders.map(item => ({
    id: `reminder-${item.id}`, type: 'reminder', title: item.title,
    subtitle: item.description || `提醒 · ${item.status}`,
    start_at: item.startAt.toISOString(), status: item.status,
    source: { type: 'TeacherReminder', recordId: item.id },
    action_url: `#/teacher/dashboard?reminder_id=${item.id}`,
    course_id: item.courseId, teaching_class_id: item.teachingClassId,
    reminder: { id: item.id, remind_at: item.remindAt.toISOString(), priority: item.priority, recurrence_rule: item.recurrenceRule },
  }));
}

// ---------- 看板 ----------

async function getDashboard(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courses = courseIds
    ? await prisma.course.findMany({
        where: { course_id: { in: courseIds }, status: 'ACTIVE' },
        select: { course_id: true, course_name: true },
      })
    : await prisma.course.findMany({ where: { status: 'ACTIVE' }, select: { course_id: true, course_name: true } });

  const courseIdList = courses.map((c) => c.course_id);
  const classIds = await getAccessibleTeachingClassIds(user, { course_id: { in: courseIdList }, status: 'active' });
  const nowDate = new Date();
  const weekAgo = new Date(nowDate.getTime() - 7 * 86400000);
  const classes = classIds.length
    ? await prisma.teachingClass.findMany({
        where: { teaching_class_id: { in: classIds } },
        include: { course: true, _count: { select: { enrollments: true } } },
      })
    : [];
  const enrollments = classIds.length
    ? await prisma.studentCourseEnrollment.findMany({
        where: { teaching_class_id: { in: classIds }, enrollment_status: 'active' },
        select: { student_user_id: true },
      })
    : [];
  const studentIds = [...new Set(enrollments.map((item) => item.student_user_id))];
  const [masteryAgg, sessionAgg, aiQuestionCount, weakKpCount, pendingReviewCount, tasks, submissions, lessonPlans, documents, notifications, studyTrend] = await Promise.all([
    prisma.studentMasteryRecord.aggregate({
      _avg: { mastery_score: true },
      where: { course_id: { in: courseIdList }, student_user_id: { in: studentIds } },
    }),
    prisma.practiceSession.aggregate({
      _avg: { total_score: true, max_score: true },
      where: { teaching_class_id: { in: classIds }, status: { notIn: ['IN_PROGRESS', 'in_progress'] }, total_score: { not: null }, max_score: { not: null, gt: 0 } },
    }),
    prisma.studentQuestionRecord.count({ where: { course_id: { in: courseIdList }, student_user_id: { in: studentIds }, created_at: { gte: weekAgo } } }),
    prisma.studentMasteryRecord.count({ where: { course_id: { in: courseIdList }, student_user_id: { in: studentIds }, mastery_level: 'WEAK' } }),
    prisma.knowledgeBaseReviewRecord.count({
      where: { action: 'SUBMITTED', knowledgeBase: { marketplace_visibility: 'PUBLIC_PENDING', OR: [{ course_id: { in: courseIdList } }, { teaching_class_id: { in: classIds } }, { owner_user_id: { in: studentIds } }] } },
    }),
    prisma.learningTask.findMany({
      where: { teaching_class_id: { in: classIds } },
      include: { course: true, teaching_class: true, _count: { select: { recipients: true, submissions: true } } },
      orderBy: { created_at: 'desc' }, take: 100,
    }),
    prisma.taskSubmission.count({ where: { task: { teaching_class_id: { in: classIds } }, grading_status: 'PENDING' } }),
    prisma.lessonPlan.findMany({ where: { teacher_user_id: user.user_id, archived_at: null }, orderBy: { updated_at: 'desc' }, take: 100 }),
    prisma.knowledgeDocument.findMany({ where: { owner_user_id: user.user_id, deleted_at: null }, orderBy: { created_at: 'desc' }, take: 30 }),
    prisma.notification.findMany({ where: { receiver_user_id: user.user_id, deleted_at: null }, orderBy: { created_at: 'desc' }, take: 30 }),
    prisma.studyRecord.groupBy({
      by: ['created_at'],
      where: { course_id: { in: courseIdList }, student_user_id: { in: studentIds }, created_at: { gte: weekAgo } },
      _sum: { duration_seconds: true },
    }),
  ]);

  const averageTestScore = sessionAgg._avg.total_score != null && sessionAgg._avg.max_score > 0
    ? Math.round((sessionAgg._avg.total_score / sessionAgg._avg.max_score) * 100)
    : null;
  const publishedTasks = tasks.filter((task) => task.status === 'PUBLISHED');
  const expected = publishedTasks.reduce((sum, task) => sum + task._count.recipients, 0);
  const completed = publishedTasks.reduce((sum, task) => sum + task._count.submissions, 0);
  const completionRate = expected ? Math.round((completed / expected) * 100) : 0;
  const upcomingExam = tasks.find((task) => ['EXAM', 'QUIZ'].includes(task.task_type) && task.status === 'PUBLISHED' && (!task.start_time || task.start_time >= nowDate));
  const draftTask = tasks.find((task) => task.status === 'DRAFT');
  const generatingPlan = lessonPlans.find((plan) => plan.status === 'GENERATING');
  const priorities = [
    submissions > 0 ? { type: 'grading', title: `${submissions} 份提交待处理`, description: '优先完成主观题复核和成绩发布', action_label: '查看提交', action_url: '#/teacher/tasks' } : null,
    upcomingExam ? { type: 'exam', title: `即将开始：${upcomingExam.title}`, description: upcomingExam.teaching_class.teaching_class_name, action_label: '检查考试', action_url: `#/teacher/tasks/${upcomingExam.task_id}` } : null,
    pendingReviewCount > 0 ? { type: 'knowledge_review', title: `${pendingReviewCount} 个知识库公开申请待审核`, description: '审核学生申请与文档范围', action_label: '立即审核', action_url: '#/teacher/knowledge' } : null,
    generatingPlan ? { type: 'lesson_plan', title: `备课生成中：${generatingPlan.topic}`, description: `当前进度 ${generatingPlan.progress}%`, action_label: '进入备课', action_url: '#/teacher/preparation' } : null,
    weakKpCount > 0 ? { type: 'risk', title: `${weakKpCount} 条薄弱知识点记录需要关注`, description: '查看风险学生与建议教学重点', action_label: '查看学情', action_url: '#/teacher/analytics' } : null,
    draftTask ? { type: 'draft', title: `待发布：${draftTask.title}`, description: draftTask.teaching_class.teaching_class_name, action_label: '继续编辑', action_url: `#/teacher/tasks/${draftTask.task_id}/edit` } : null,
    { type: 'preparation', title: '开始下一课次智慧备课', description: '系统将自动读取班级学情与高频问题', action_label: '开始备课', action_url: '#/teacher/preparation' },
  ].filter(Boolean);

  const trendByDay = new Map();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(nowDate.getTime() - offset * 86400000).toISOString().slice(0, 10);
    trendByDay.set(date, { date, study_minutes: 0 });
  }
  studyTrend.forEach((item) => {
    const key = item.created_at.toISOString().slice(0, 10);
    if (trendByDay.has(key)) trendByDay.get(key).study_minutes += Math.round((item._sum.duration_seconds || 0) / 60);
  });
  const scheduleFrom = new Date(nowDate.getFullYear(), nowDate.getMonth() - 2, 1);
  const scheduleTo = new Date(nowDate.getFullYear(), nowDate.getMonth() + 4, 0);
  const reminders = await prisma.teacherReminder.findMany({ where: { teacherUserId: user.user_id, status: { notIn: ['cancelled', 'dismissed'] }, OR: [{ startAt: { gte: scheduleFrom, lte: scheduleTo } }, { remindAt: { gte: scheduleFrom, lte: scheduleTo } }] }, orderBy: { startAt: 'asc' }, take: 300 });
  const calendarEvents = [
    ...expandClassSchedules(classes, scheduleFrom, scheduleTo),
    ...taskCalendarEvents(tasks),
    ...lessonPlanCalendarEvents(lessonPlans),
    ...reminderCalendarEvents(reminders),
  ].sort((left, right) => new Date(left.start_at) - new Date(right.start_at));

  return {
    today_focus: priorities[0],
    course_count: courses.length,
    teaching_class_count: classes.length,
    student_count: studentIds.length,
    average_mastery_score: masteryAgg._avg.mastery_score == null ? 0 : Math.round(masteryAgg._avg.mastery_score),
    average_test_score: averageTestScore ?? 0,
    task_completion_rate: completionRate,
    pending_count: submissions + pendingReviewCount,
    ai_question_count: aiQuestionCount,
    weak_knowledge_point_count: weakKpCount,
    pending_review_document_count: pendingReviewCount,
    weekly_activity_trend: [...trendByDay.values()],
    calendar_events: calendarEvents,
    calendar_range: { start_at: scheduleFrom.toISOString(), end_at: scheduleTo.toISOString() },
    classes: classes.map((item) => ({
      teaching_class_id: item.teaching_class_id,
      course_id: item.course_id,
      name: item.teaching_class_name,
      course_name: item.course.course_name,
      schedule: item.schedule,
      location: item.location,
      student_count: item._count.enrollments,
    })),
    recent: {
      tasks: tasks.slice(0, 5).map((item) => ({ task_id: item.task_id, title: item.title, type: toLower(item.task_type), status: toLower(item.status), created_at: item.created_at.toISOString() })),
      lesson_plans: lessonPlans.map((item) => ({ lesson_plan_id: item.lesson_plan_id, topic: item.topic, status: toLower(item.status), progress: item.progress, updated_at: item.updated_at.toISOString() })),
      resources: documents.map((item) => ({ document_id: item.document_id, title: item.title, resource_kind: item.resource_kind, created_at: item.created_at.toISOString() })),
      notifications: notifications.map((item) => ({ notification_id: item.notification_id, title: item.title, type: toLower(item.notification_type), is_read: item.is_read, created_at: item.created_at.toISOString() })),
    },
  };
}

// ---------- 学习进度统计 ----------

async function getProgress(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const where = { status: { notIn: ['IN_PROGRESS', 'in_progress'] }, ...courseFilter };
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
  const submittedSessions = sessions.filter((s) => s.status !== 'IN_PROGRESS' && s.status !== 'in_progress').length;

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

  const sessionWhere = { status: { notIn: ['IN_PROGRESS', 'in_progress'] }, total_score: { not: null }, max_score: { not: null, gt: 0 }, ...courseFilter };
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

  // 调用统一关键词云服务
  const cloudResult = await keywordCloudService.computeKeywordCloud({
    courseIds: courseIds || [],
    limit: 50,
  });

  // 加载知识点维度统计（原有 list/top_tags 保留）
  const courseFilter = getCourseFilter(courseIds);
  const questions = await prisma.studentQuestionRecord.findMany({
    where: {
      ...courseFilter,
      OR: [
        { conversation_id: null },
        { conversation: { agent_type: 'COURSE_QA' } },
      ],
    },
    include: {
      analysis_records: {
        include: { knowledge_point: true, keywords: true, confusion_tags: true },
        take: 1,
      },
    },
    orderBy: { created_at: 'desc' },
  });

  const kpMap = {};
  const globalTagMap = {};
  for (const q of questions) {
    const analysis = q.analysis_records?.[0];
    const confusionTags = analysis?.confusion_tags || [];
    for (const tag of confusionTags) {
      const t = tag.tag?.trim();
      if (!t) continue;
      if (!globalTagMap[t]) globalTagMap[t] = { tag: t, count: 0 };
      globalTagMap[t].count += 1;
    }
    const kp = analysis?.knowledge_point;
    if (!kp) continue;
    if (!kpMap[kp.knowledge_point_id]) {
      kpMap[kp.knowledge_point_id] = {
        knowledge_point_id: kp.knowledge_point_id,
        knowledge_point_name: kp.knowledge_point_name,
        question_count: 0,
        student_ids: new Set(),
        top_keywords: [],
        top_confusion_tags: [],
      };
    }
    kpMap[kp.knowledge_point_id].question_count += 1;
    kpMap[kp.knowledge_point_id].student_ids.add(q.student_user_id);
  }

  const list = Object.values(kpMap)
    .map(item => ({
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point_name,
      question_count: item.question_count,
      student_count: item.student_ids.size,
      top_keywords: [],
      top_confusion_tags: [],
    }))
    .sort((a, b) => b.question_count - a.question_count);

  const topTags = Object.values(globalTagMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // word_cloud 使用统一服务结果，字段兼容前端渲染
  return {
    total_questions: cloudResult.total_questions,
    total_students: cloudResult.total_students,
    list,
    word_cloud: cloudResult.word_cloud.map(w => ({
      keyword: w.keyword,
      count: w.count,
      char_length: w.char_length,
      score: w.score,
      student_count: w.student_count,
      difficulty: w.difficulty,
      category: w.category,
      related_kp: w.related_kp,
    })),
    top_tags: topTags,
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

  const sourceRows = Object.values(kpMap).map((item) => ({
    knowledgePointId: item.knowledge_point_id,
    name: item.knowledge_point_name,
    studentCount: item.student_count,
    mastery: Math.round(item.score_sum / item.student_count),
    students: item.students.sort((a, b) => a.mastery_score - b.mastery_score).slice(0, 10),
  }));
  const studentsById = new Map(sourceRows.map((item) => [item.knowledgePointId, item.students]));
  const list = normalizeWeakKnowledgePoints(sourceRows, { type: 'StudentMasteryRecord', recordCount: records.length })
    .map((item) => ({ ...item, students: studentsById.get(item.knowledgePointId) || [] }));

  return { list };
}

// ---------- 学生能力雷达图 ----------

async function getStudentRadar(user, studentUserId, query) {
  const courseIds = await resolveCourseIds(user, query);
  await ensureStudentAccess(user, studentUserId, query.course_id ? { course_id: query.course_id } : {});

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
