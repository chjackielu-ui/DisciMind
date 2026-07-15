const prisma = require('../../config/prisma');

const SUBJECT_ALIASES = {
  machine_learning: ['机器学习', 'machine learning'],
  operating_system: ['操作系统', 'operating system'],
  web_frontend: ['web前端', 'web 前端', '前端开发', 'frontend'],
  probability: ['概率论', '概率与统计', 'probability'],
  database: ['数据库', 'database'],
  computer_network: ['计算机网络', 'computer network'],
  software_engineering: ['软件工程', 'software engineering'],
};

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function matchesSubject(course, subject) {
  if (!normalize(subject)) return false;
  const haystack = normalize(`${course?.course_name || ''} ${course?.subject_category || ''} ${course?.course_code || ''}`);
  return (SUBJECT_ALIASES[subject] || [subject]).some((alias) => haystack.includes(normalize(alias)));
}

async function resolveScope(userId, conversation, question) {
  const [activeContext, enrollments] = await Promise.all([
    prisma.studentLearningContext.findFirst({
      where: { userId, isActive: true },
      include: { course: true, knowledgePoint: true },
    }),
    prisma.studentCourseEnrollment.findMany({
      where: { student_user_id: userId, enrollment_status: 'active' },
      include: { course: true, teachingClass: true },
    }),
  ]);

  const subject = String(conversation.subject || '');
  let enrollment = enrollments.find((item) => matchesSubject(item.course, subject)) || null;
  if (!enrollment) {
    const normalizedQuestion = normalize(question);
    const matched = enrollments.map(item => {
      const names = [item.course.course_name, item.course.course_code, item.course.subject_category].map(normalize).filter(Boolean);
      return { item, score: names.reduce((best, name) => normalizedQuestion.includes(name) ? Math.max(best, name.length) : best, 0) };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    if (matched[0] && (!matched[1] || matched[0].score > matched[1].score)) enrollment = matched[0].item;
  }
  if (!enrollment && activeContext && matchesSubject(activeContext.course, subject)) {
    enrollment = enrollments.find((item) => item.course_id === activeContext.courseId) || null;
  }
  if (!enrollment && activeContext && !subject) enrollment = enrollments.find((item) => item.course_id === activeContext.courseId) || null;
  if (!enrollment && enrollments.length === 1) enrollment = enrollments[0];
  const course = enrollment?.course || null;

  let knowledgePoint = null;
  if (course && activeContext?.courseId === course.course_id) {
    const activeName = normalize(activeContext.knowledgePoint?.knowledge_point_name);
    if (activeName && normalize(question).includes(activeName)) knowledgePoint = activeContext.knowledgePoint;
  }
  if (course && !knowledgePoint) {
    const points = await prisma.knowledgePoint.findMany({
      where: { course_id: course.course_id },
      include: { aliases: true },
      take: 300,
    });
    const normalizedQuestion = normalize(question);
    knowledgePoint = points
      .map((point) => {
        const names = [point.knowledge_point_name, ...point.aliases.map((alias) => alias.alias_text)]
          .map(normalize)
          .filter(Boolean);
        const matched = names.filter((name) => normalizedQuestion.includes(name));
        return { point, score: matched.reduce((max, name) => Math.max(max, name.length), 0) };
      })
      .sort((a, b) => b.score - a.score)
      .find((item) => item.score > 0)?.point || null;
  }

  return {
    subject,
    course,
    knowledgePoint,
    enrollment,
    activeContext,
    summary: course
      ? `已识别课程：${course.course_name}；${knowledgePoint ? `已识别知识点：${knowledgePoint.knowledge_point_name}` : '未匹配到明确知识点'}`
      : subject ? `当前“${(SUBJECT_ALIASES[subject] || [subject])[0]}”未匹配到有效选课记录` : '当前未选择课程，且问题中没有唯一可匹配的选课课程',
  };
}

async function loadLearningContext(userId, scope) {
  if (!scope.course) {
    return {
      available: false,
      summary: '暂无可用课程学习上下文',
      recentStudy: [],
      recentTasks: [],
      learningFlow: null,
    };
  }
  const pointFilter = scope.knowledgePoint ? { knowledge_point_id: scope.knowledgePoint.knowledge_point_id } : {};
  const [recentStudy, recentTasks, recentSession] = await Promise.all([
    prisma.studyRecord.findMany({
      where: { student_user_id: userId, course_id: scope.course.course_id, ...pointFilter },
      orderBy: { created_at: 'desc' },
      take: 8,
      select: { action_type: true, duration_seconds: true, progress_percent: true, created_at: true },
    }),
    prisma.learningTask.findMany({
      where: { course_id: scope.course.course_id, status: { not: 'DRAFT' } },
      orderBy: { updated_at: 'desc' },
      take: 5,
      select: { task_id: true, title: true, task_type: true, status: true, deadline: true },
    }),
    prisma.learningSession.findFirst({
      where: { student_user_id: userId, course_id: scope.course.course_id },
      orderBy: { updated_at: 'desc' },
      select: { session_id: true, status: true, current_node_id: true, mastery_current: true, started_at: true, completed_at: true, updated_at: true },
    }),
  ]);
  const pieces = [`课程：${scope.course.course_name}`];
  if (scope.knowledgePoint) pieces.push(`知识点：${scope.knowledgePoint.knowledge_point_name}`);
  pieces.push(recentStudy.length ? `最近学习记录 ${recentStudy.length} 条` : '暂无最近学习记录');
  pieces.push(recentTasks.length ? `近期课程任务 ${recentTasks.length} 个` : '暂无近期课程任务');
  if (recentSession) pieces.push(`最近学习流状态：${String(recentSession.status).toLowerCase()}`);
  return {
    available: true,
    summary: pieces.join('；'),
    recentStudy,
    recentTasks,
    learningFlow: recentSession,
    activeSnapshot: scope.activeContext?.contextSnapshotJson || null,
  };
}

async function loadStudentProfile(userId, scope) {
  const courseId = scope.course?.course_id;
  if (!courseId) {
    return { available: false, summary: '暂无相关画像数据', mastery: null, weakPoints: [], wrongQuestionCount: 0, portrait: null };
  }
  const [portrait, selectedMastery, weakPoints, wrongQuestionCount, recentWrongQuestions] = await Promise.all([
    prisma.studentPortrait.findUnique({
      where: { student_user_id_course_id: { student_user_id: userId, course_id: courseId } },
    }),
    scope.knowledgePoint ? prisma.studentMasteryRecord.findUnique({
      where: { student_user_id_course_id_knowledge_point_id: { student_user_id: userId, course_id: courseId, knowledge_point_id: scope.knowledgePoint.knowledge_point_id } },
    }) : Promise.resolve(null),
    prisma.studentMasteryRecord.findMany({
      where: { student_user_id: userId, course_id: courseId, mastery_score: { lt: 60 } },
      include: { knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } } },
      orderBy: { mastery_score: 'asc' },
      take: 5,
    }),
    prisma.wrongQuestion.count({
      where: { student_user_id: userId, course_id: courseId, status: 'UNRESOLVED', ...(scope.knowledgePoint ? { knowledge_point_id: scope.knowledgePoint.knowledge_point_id } : {}) },
    }),
    prisma.wrongQuestion.findMany({
      where: { student_user_id: userId, course_id: courseId, ...(scope.knowledgePoint ? { knowledge_point_id: scope.knowledgePoint.knowledge_point_id } : {}) },
      orderBy: { updated_at: 'desc' },
      take: 3,
      select: { wrong_question_id: true, wrong_reason: true, status: true, last_wrong_at: true },
    }),
  ]);
  const available = Boolean(portrait || selectedMastery || weakPoints.length || wrongQuestionCount);
  const summary = available
    ? [
      selectedMastery ? `当前知识点掌握度 ${Math.round(selectedMastery.mastery_score)}%` : '当前知识点暂无掌握度记录',
      weakPoints.length ? `课程薄弱知识点 ${weakPoints.length} 个` : '未发现低于 60% 的薄弱知识点',
      wrongQuestionCount ? `未解决错题 ${wrongQuestionCount} 道` : '当前未找到相关错题记录',
    ].join('；')
    : '暂无相关画像数据';
  return {
    available,
    summary,
    mastery: selectedMastery ? { score: selectedMastery.mastery_score, level: selectedMastery.mastery_level, updatedAt: selectedMastery.updated_at } : null,
    weakPoints: weakPoints.map((item) => ({ id: item.knowledge_point_id, name: item.knowledge_point.knowledge_point_name, score: item.mastery_score })),
    wrongQuestionCount,
    recentWrongQuestions,
    portrait: portrait ? {
      learningTotalScore: portrait.learning_total_score,
      progressScore: portrait.progress_score,
      masteryScore: portrait.mastery_score,
      wrongQuestionScore: portrait.wrong_question_score,
      updatedAt: portrait.updated_at,
    } : null,
  };
}

module.exports = { SUBJECT_ALIASES, resolveScope, loadLearningContext, loadStudentProfile };
