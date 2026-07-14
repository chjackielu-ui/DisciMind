const crypto = require('crypto');
const prisma = require('../config/prisma');
const {
  ensureCourseAccess,
  ensureTeachingClassAccess,
  getAccessibleTeachingClassIds,
} = require('./teacher-access.service');
const { normalizeWeakKnowledgePoints } = require('./teacher-analytics-normalizer');
const keywordCloudService = require('./teacher-keyword-cloud.service');

function round(value, digits = 1) {
  const base = 10 ** digits;
  return Math.round((Number(value) || 0) * base) / base;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function toDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${field} 时间格式不合法`), { code: 40001 });
  return date;
}

async function resolveRange(courseId, classId, query) {
  const now = new Date();
  const range = query.range || '30d';
  if (range === 'custom') {
    if (!query.start_at || !query.end_at) throw Object.assign(new Error('自定义时间需要 start_at 和 end_at'), { code: 40001 });
    const start = toDate(query.start_at, 'start_at');
    const end = toDate(query.end_at, 'end_at');
    if (start >= end) throw Object.assign(new Error('start_at 必须早于 end_at'), { code: 40001 });
    return { key: range, start, end };
  }
  if (range === 'semester') {
    const teachingClass = classId
      ? await prisma.teachingClass.findUnique({ where: { teaching_class_id: classId }, include: { course_offering: { include: { semester: true } } } })
      : null;
    const semester = teachingClass?.course_offering?.semester
      || await prisma.academicSemester.findFirst({ where: { status: 'active' }, orderBy: { start_date: 'desc' } });
    return { key: range, start: semester?.start_date || new Date(now.getTime() - 120 * 86400000), end: semester?.end_date || now };
  }
  const days = range === '7d' ? 7 : 30;
  return { key: range, start: new Date(now.getTime() - days * 86400000), end: now };
}

async function resolveScope(user, query) {
  const courseId = Number(query.course_id);
  if (!courseId) throw Object.assign(new Error('course_id 为必填项'), { code: 40001 });
  await ensureCourseAccess(user, courseId);
  const requestedClassId = query.teaching_class_id ? Number(query.teaching_class_id) : null;
  let classIds;
  if (requestedClassId) {
    const teachingClass = await ensureTeachingClassAccess(user, requestedClassId);
    if (teachingClass.course_id !== courseId) throw Object.assign(new Error('教学班不属于所选课程'), { code: 40001 });
    classIds = [requestedClassId];
  } else {
    classIds = await getAccessibleTeachingClassIds(user, { course_id: courseId, status: 'active' });
  }
  if (!classIds.length) throw Object.assign(new Error('没有可分析的教学班'), { code: 40002 });
  const range = await resolveRange(courseId, requestedClassId, query);
  return {
    courseId,
    requestedClassId,
    classIds,
    range,
    chapterId: query.chapter_id ? Number(query.chapter_id) : null,
    knowledgePointId: query.knowledge_point_id ? Number(query.knowledge_point_id) : null,
  };
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function tokenizeQuestion(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[\u4e00-\u9fff]{2,8}|[a-z][a-z0-9_-]{2,}/g) || [];
}

function buildLayer(masterScore, completionRate, activityCount) {
  if (masterScore < 55 || completionRate < 50 || activityCount === 0) return 'risk';
  if (masterScore >= 80 && completionRate >= 85) return 'advanced';
  if (masterScore >= 65) return 'steady';
  return 'support';
}

async function buildWorkbench(user, query = {}, options = {}) {
  const scope = await resolveScope(user, query);
  const { courseId, classIds, range, knowledgePointId, chapterId } = scope;
  const dateWhere = { gte: range.start, lte: range.end };
  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where: { teaching_class_id: { in: classIds }, enrollment_status: 'active' },
    include: { student: { include: { profile: { include: { admin_class: true } } } }, teachingClass: true },
  });
  const studentIds = [...new Set(enrollments.map((item) => item.student_user_id))];
  const tasks = await prisma.learningTask.findMany({
    where: { course_id: courseId, teaching_class_id: { in: classIds }, created_at: { lte: range.end }, status: { in: ['PUBLISHED', 'CLOSED'] } },
    include: { recipients: true, question_links: { include: { question: true } }, teaching_class: true },
    orderBy: { created_at: 'desc' },
  });
  const taskIds = tasks.map((item) => item.task_id);

  const [submissions, attempts, mastery, studyRecords, learningSessions, questionRecords, answerRecords, learningPlans, agentRuns, interventions] = await Promise.all([
    prisma.taskSubmission.findMany({
      where: { task_id: { in: taskIds }, student_user_id: { in: studentIds }, updated_at: dateWhere },
      include: { task: true },
    }),
    prisma.practiceSession.findMany({
      where: { source_type: 'TEACHER_TASK', source_id: { in: taskIds }, student_user_id: { in: studentIds }, created_at: dateWhere },
    }),
    prisma.studentMasteryRecord.findMany({
      where: {
        student_user_id: { in: studentIds },
        course_id: courseId,
        ...(knowledgePointId ? { knowledge_point_id: knowledgePointId } : {}),
        ...(chapterId ? { knowledge_point: { chapter_id: chapterId } } : {}),
      },
      include: { knowledge_point: true },
    }),
    prisma.studyRecord.findMany({
      where: { student_user_id: { in: studentIds }, course_id: courseId, created_at: dateWhere, ...(knowledgePointId ? { knowledge_point_id: knowledgePointId } : {}) },
      include: { knowledge_point: true },
    }),
    prisma.learningSession.findMany({
      where: { student_user_id: { in: studentIds }, course_id: courseId, created_at: dateWhere, ...(knowledgePointId ? { knowledge_point_id: knowledgePointId } : {}) },
    }),
    prisma.studentQuestionRecord.findMany({
      where: { student_user_id: { in: studentIds }, course_id: courseId, created_at: dateWhere },
      include: { analysis_records: { include: { keywords: true, confusion_tags: true, knowledge_point: true } } },
    }),
    prisma.answerRecord.findMany({
      where: {
        student_user_id: { in: studentIds },
        created_at: dateWhere,
        OR: [
          { task: { teaching_class_id: { in: classIds } } },
          { practice_session: { teaching_class_id: { in: classIds } } },
        ],
        ...(knowledgePointId ? { question: { knowledge_point_id: knowledgePointId } } : {}),
      },
      include: { question: { include: { knowledge_point: true } } },
    }),
    prisma.studentLearningPlan.findMany({ where: { studentUserId: { in: studentIds }, courseId, createdAt: dateWhere } }),
    prisma.agentRunRecord.findMany({ where: { student_user_id: { in: studentIds }, course_id: courseId, created_at: dateWhere } }),
    prisma.teacherStudentIntervention.findMany({ where: { student_user_id: { in: studentIds }, course_id: courseId, teaching_class_id: { in: classIds }, created_at: dateWhere } }),
  ]);

  const submittedKeys = new Set();
  submissions.filter((item) => ['SUBMITTED', 'GRADED'].includes(item.submission_status)).forEach((item) => submittedKeys.add(`${item.task_id}:${item.student_user_id}`));
  attempts.filter((item) => !['CREATED', 'IN_PROGRESS', 'ABANDONED'].includes(item.status)).forEach((item) => submittedKeys.add(`${item.source_id}:${item.student_user_id}`));
  const expectedCount = tasks.reduce((sum, task) => sum + (task.recipients.length || enrollments.filter((item) => item.teaching_class_id === task.teaching_class_id).length), 0);
  const completionRate = expectedCount ? (submittedKeys.size / expectedCount) * 100 : 0;

  const masteryByStudent = new Map();
  const masteryByKnowledge = new Map();
  mastery.forEach((item) => {
    if (!masteryByStudent.has(item.student_user_id)) masteryByStudent.set(item.student_user_id, []);
    masteryByStudent.get(item.student_user_id).push(item.mastery_score);
    if (!masteryByKnowledge.has(item.knowledge_point_id)) masteryByKnowledge.set(item.knowledge_point_id, { name: item.knowledge_point.knowledge_point_name, scores: [] });
    masteryByKnowledge.get(item.knowledge_point_id).scores.push(item.mastery_score);
  });
  const avgMastery = average(mastery.map((item) => item.mastery_score));

  const activityByStudent = new Map();
  const addActivity = (studentId, amount = 1) => activityByStudent.set(studentId, (activityByStudent.get(studentId) || 0) + amount);
  studyRecords.forEach((item) => addActivity(item.student_user_id));
  learningSessions.forEach((item) => addActivity(item.student_user_id));
  questionRecords.forEach((item) => addActivity(item.student_user_id));
  submissions.forEach((item) => addActivity(item.student_user_id));

  const tasksByStudent = new Map();
  tasks.forEach((task) => {
    const recipients = task.recipients.length ? task.recipients.map((item) => item.student_user_id) : enrollments.filter((item) => item.teaching_class_id === task.teaching_class_id).map((item) => item.student_user_id);
    recipients.forEach((studentId) => {
      const stats = tasksByStudent.get(studentId) || { expected: 0, submitted: 0 };
      stats.expected += 1;
      if (submittedKeys.has(`${task.task_id}:${studentId}`)) stats.submitted += 1;
      tasksByStudent.set(studentId, stats);
    });
  });

  const enrollmentByStudent = new Map();
  enrollments.forEach((item) => { if (!enrollmentByStudent.has(item.student_user_id)) enrollmentByStudent.set(item.student_user_id, item); });
  const studentLayers = studentIds.map((studentId) => {
    const enrollment = enrollmentByStudent.get(studentId);
    const masteryScore = average(masteryByStudent.get(studentId) || []);
    const taskStats = tasksByStudent.get(studentId) || { expected: 0, submitted: 0 };
    const studentCompletion = taskStats.expected ? (taskStats.submitted / taskStats.expected) * 100 : 0;
    const activityCount = activityByStudent.get(studentId) || 0;
    const layer = buildLayer(masteryScore, studentCompletion, activityCount);
    return {
      student_user_id: studentId,
      student_name: enrollment?.student?.profile?.real_name || enrollment?.student?.username || null,
      student_no: enrollment?.student?.profile?.student_no || null,
      teaching_class_id: enrollment?.teaching_class_id,
      teaching_class_name: enrollment?.teachingClass?.teaching_class_name,
      administrative_class_name: enrollment?.student?.profile?.admin_class?.class_name || null,
      mastery_score: round(masteryScore),
      completion_rate: round(studentCompletion),
      activity_count: activityCount,
      layer,
      needs_intervention: layer === 'risk' || layer === 'support',
      risk_reasons: [
        ...(masteryScore < 55 ? ['掌握度偏低'] : []),
        ...(studentCompletion < 50 ? ['任务完成率偏低'] : []),
        ...(activityCount === 0 ? ['时间范围内无学习活动'] : []),
      ],
    };
  }).sort((a, b) => a.mastery_score - b.mastery_score);

  const trendMap = new Map();
  const touchTrend = (date, key, amount = 1) => {
    const day = dayKey(date);
    const row = trendMap.get(day) || { date: day, study_minutes: 0, submissions: 0, questions: 0, sessions: 0 };
    row[key] += amount;
    trendMap.set(day, row);
  };
  studyRecords.forEach((item) => touchTrend(item.created_at, 'study_minutes', (item.duration_seconds || 0) / 60));
  learningSessions.forEach((item) => touchTrend(item.created_at, 'sessions'));
  questionRecords.forEach((item) => touchTrend(item.created_at, 'questions'));
  submissions.forEach((item) => touchTrend(item.updated_at, 'submissions'));
  const trend = [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, study_minutes: round(row.study_minutes) }));

  const knowledgeRows = normalizeWeakKnowledgePoints(
    [...masteryByKnowledge.entries()].map(([id, value]) => ({
      knowledgePointId: id,
      name: value.name,
      mastery: round(average(value.scores)),
      studentCount: value.scores.length,
    })),
    { type: 'StudentMasteryRecord', recordCount: mastery.length },
  );
  const masteryDistribution = [
    { label: '0-59', min: 0, max: 59.999 },
    { label: '60-69', min: 60, max: 69.999 },
    { label: '70-79', min: 70, max: 79.999 },
    { label: '80-89', min: 80, max: 89.999 },
    { label: '90-100', min: 90, max: 100 },
  ].map((bucket) => ({ label: bucket.label, count: studentLayers.filter((item) => item.mastery_score >= bucket.min && item.mastery_score <= bucket.max).length }));

  const wrongMap = new Map();
  answerRecords.filter((item) => item.is_correct === false).forEach((item) => {
    const current = wrongMap.get(item.question_id) || { question_id: item.question_id, title: item.question.title, content: item.question.content, knowledge_point_name: item.question.knowledge_point?.knowledge_point_name || null, count: 0, students: new Set() };
    current.count += 1;
    current.students.add(item.student_user_id);
    wrongMap.set(item.question_id, current);
  });
  const frequentErrors = [...wrongMap.values()].sort((a, b) => b.count - a.count).slice(0, 10).map((item) => ({ ...item, students: [...item.students], student_count: item.students.size }));

  const keywordMap = new Map();
  const misconceptionMap = new Map();
  questionRecords.forEach((record) => {
    const analyzedKeywords = record.analysis_records.flatMap((analysis) => analysis.keywords.map((item) => item.keyword));
    const keywords = analyzedKeywords.length ? analyzedKeywords : tokenizeQuestion(record.raw_question);
    keywords.forEach((keyword) => keywordMap.set(keyword, (keywordMap.get(keyword) || 0) + 1));
    record.analysis_records.flatMap((analysis) => analysis.confusion_tags.map((item) => item.tag)).forEach((tag) => misconceptionMap.set(tag, (misconceptionMap.get(tag) || 0) + 1));
  });
  let keywordCloud = null;
  try {
    keywordCloud = await keywordCloudService.computeKeywordCloud({
      courseId, teachingClassId: scope.requestedClassId || undefined, studentIds,
      rangeStart: range.start, rangeEnd: range.end, limit: 30,
    });
  } catch (error) {
    console.error('[teacher-analytics] keyword cloud degraded:', error);
  }
  const fallbackKeywords = [...keywordMap.entries()].map(([text, value]) => ({ text, value, knowledgePointId: null, studentCount: 0, questionCount: value, source: { type: 'StudentQuestionRecord' } })).sort((a, b) => b.value - a.value).slice(0, 30);
  const keywords = keywordCloud?.word_cloud?.map((item) => ({
    text: item.keyword,
    value: Number(item.score || item.count || 0),
    knowledgePointId: item.related_kp_ids?.[0] || null,
    studentCount: item.student_count || 0,
    questionCount: item.count || 0,
    category: item.category,
    difficulty: item.difficulty,
    relatedKnowledgePoints: item.related_kp || '',
    source: { type: 'TeacherKeywordCloud', records: item.sources || [] },
  })) || fallbackKeywords;
  const misconceptions = [...misconceptionMap.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 20);
  const questionSamples = questionRecords.slice(0, 20).map((item) => ({ student_user_id: item.student_user_id, question: item.raw_question, created_at: item.created_at.toISOString(), unresolved: item.analysis_records.some((analysis) => analysis.need_teacher_review) }));

  const examTasks = tasks.filter((item) => ['EXAM', 'QUIZ'].includes(item.task_type));
  const homeworkTasks = tasks.filter((item) => item.task_type === 'HOMEWORK');
  const scoreValues = [...submissions.map((item) => item.total_score), ...attempts.map((item) => item.total_score)].filter((value) => value != null);
  const result = {
    filters: {
      course_id: courseId,
      teaching_class_id: scope.requestedClassId,
      teaching_class_ids: classIds,
      range: range.key,
      start_at: range.start.toISOString(),
      end_at: range.end.toISOString(),
      chapter_id: chapterId,
      knowledge_point_id: knowledgePointId,
    },
    overview: {
      student_count: studentIds.length,
      active_student_count: studentLayers.filter((item) => item.activity_count > 0).length,
      average_mastery: round(avgMastery),
      task_completion_rate: round(completionRate),
      average_score: round(average(scoreValues)),
      study_minutes: round(studyRecords.reduce((sum, item) => sum + (item.duration_seconds || 0), 0) / 60),
      risk_student_count: studentLayers.filter((item) => item.layer === 'risk').length,
      pending_question_count: questionRecords.filter((item) => item.analysis_records.some((analysis) => analysis.need_teacher_review)).length,
    },
    learning_trend: trend,
    mastery_distribution: masteryDistribution,
    knowledge_heatmap: knowledgeRows,
    weak_knowledge_points: knowledgeRows.slice(0, 10),
    frequent_errors: frequentErrors,
    dialogue: {
      keywords,
      misconceptions,
      unresolved_count: questionSamples.filter((item) => item.unresolved).length,
      question_samples: questionSamples,
    },
    student_layers: studentLayers,
    risk_students: studentLayers.filter((item) => item.layer === 'risk').slice(0, 20),
    homework: { task_count: homeworkTasks.length, completion_rate: round(completionRate) },
    exams: { task_count: examTasks.length, average_score: round(average(scoreValues)), score_count: scoreValues.length },
    teaching_focus: knowledgeRows.slice(0, 5).map((item) => ({
      knowledge_point_id: item.knowledgePointId,
      title: item.name,
      reason: `班级平均掌握度 ${item.mastery}%，建议优先复习并配置分层练习。`,
      priority: item.mastery < 50 ? 'high' : 'medium',
    })),
    data_sources: {
      generated_at: new Date().toISOString(),
      definitions: {
        mastery: 'StudentMasteryRecord 当前快照',
        completion: 'LearningTaskRecipient、TaskSubmission 与教师任务 PracticeSession',
        activity: 'StudyRecord、LearningSession、StudentQuestionRecord 与提交记录',
        dialogue: 'StudentQuestionRecord 与 QuestionAnalysisRecord',
        keyword_cloud: 'TeacherKeywordCloud（停用词、同义词、学生覆盖率与真实对话/错题聚合）',
      },
      counts: {
        enrollments: enrollments.length,
        tasks: tasks.length,
        task_submissions: submissions.length,
        task_attempts: attempts.length,
        mastery_records: mastery.length,
        study_records: studyRecords.length,
        learning_sessions: learningSessions.length,
        dialogue_questions: questionRecords.length,
        keyword_cloud_questions: keywordCloud?.total_questions || questionRecords.length,
        answer_records: answerRecords.length,
        learning_plans: learningPlans.length,
        agent_runs: agentRuns.length,
        teacher_interventions: interventions.length,
      },
    },
  };

  if (options.persist !== false) {
    const cacheKey = crypto.createHash('sha256').update(JSON.stringify({ teacher: user.user_id, ...result.filters })).digest('hex');
    await prisma.teacherAnalyticsSnapshot.upsert({
      where: { cache_key: cacheKey },
      update: { result_json: result, data_sources_json: result.data_sources, generated_at: new Date(), expires_at: new Date(Date.now() + 10 * 60 * 1000) },
      create: {
        teacher_user_id: user.user_id,
        course_id: courseId,
        teaching_class_id: scope.requestedClassId,
        analysis_type: options.analysisType || 'learning_workbench',
        range_start: range.start,
        range_end: range.end,
        filter_json: result.filters,
        result_json: result,
        data_sources_json: result.data_sources,
        cache_key: cacheKey,
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  }
  return result;
}

async function getDialogueInsights(user, query = {}) {
  const result = await buildWorkbench(user, query, { persist: true, analysisType: 'dialogue_insights' });
  return {
    filters: result.filters,
    keywords: result.dialogue.keywords,
    frequent_questions: result.dialogue.question_samples,
    misconceptions: result.dialogue.misconceptions,
    unresolved_count: result.dialogue.unresolved_count,
    trend: result.learning_trend.map((item) => ({ date: item.date, question_count: item.questions })),
    student_distribution: result.student_layers.map((item) => ({ student_user_id: item.student_user_id, student_name: item.student_name, activity_count: item.activity_count })),
    knowledge_distribution: result.knowledge_heatmap,
    sources: result.data_sources,
  };
}

module.exports = { buildWorkbench, getDialogueInsights, resolveScope };
