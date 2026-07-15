const prisma = require('../../config/prisma');

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-—·（）()]+/g, '');
}

function requestedRange(query) {
  const text = String(query || '');
  if (/(?:近|最近)?(?:一|1)周|7\s*天|本周/iu.test(text)) return { key: '7d', days: 7, label: '最近 7 天' };
  if (/(?:近|最近)?(?:三|3)个?月|90\s*天|本季度/iu.test(text)) return { key: '90d', days: 90, label: '最近 90 天' };
  if (/(?:近|最近)?(?:一|1)个?月|30\s*天|本月/iu.test(text)) return { key: '30d', days: 30, label: '最近 30 天' };
  return { key: '30d', days: 30, label: '最近 30 天' };
}

function courseScore(course, query, subjectCode) {
  const queryText = normalize(query);
  const subject = normalize(subjectCode);
  const names = [course.course_name, course.course_code, course.subject_category].map(normalize).filter(Boolean);
  let score = 0;
  for (const name of names) {
    if (queryText && queryText.includes(name)) score = Math.max(score, 100 + name.length);
    if (subject && (name.includes(subject) || subject.includes(name))) score = Math.max(score, 80 + Math.min(name.length, subject.length));
  }
  return score;
}

async function buildUserContext(input = {}) {
  const authenticatedUserId = Number(input.user?.user_id);
  if (!Number.isInteger(authenticatedUserId) || authenticatedUserId < 1) {
    throw Object.assign(new Error('认证用户上下文缺失'), { code: 40101, status: 401, expose: true });
  }
  const role = String(input.user?.role || '').toLowerCase();
  const [profile, activeLearningContext, enrollments] = await Promise.all([
    prisma.userProfile.findUnique({ where: { user_id: authenticatedUserId }, select: { real_name: true, grade: true, major: true, default_course_id: true } }),
    role === 'student' ? prisma.studentLearningContext.findFirst({
      where: { userId: authenticatedUserId, isActive: true },
      include: { course: true, knowledgePoint: { include: { aliases: true } } },
    }) : Promise.resolve(null),
    role === 'student' ? prisma.studentCourseEnrollment.findMany({
      where: { student_user_id: authenticatedUserId, enrollment_status: 'active' },
      include: { course: true, teachingClass: { select: { teaching_class_id: true, teaching_class_name: true } } },
      orderBy: { joined_at: 'desc' },
    }) : Promise.resolve([]),
  ]);

  const explicitCourseId = Number(input.courseId);
  let enrollment = Number.isInteger(explicitCourseId)
    ? enrollments.find(item => item.course_id === explicitCourseId) || null
    : null;
  let courseSelectionReason = enrollment ? 'request_scope' : null;
  if (!enrollment) {
    const ranked = enrollments
      .map(item => ({ item, score: courseScore(item.course, input.query, input.subjectCode) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ranked[0] && (!ranked[1] || ranked[0].score > ranked[1].score)) {
      enrollment = ranked[0].item;
      courseSelectionReason = 'query_match';
    }
  }
  if (!enrollment && activeLearningContext) {
    enrollment = enrollments.find(item => item.course_id === activeLearningContext.courseId) || null;
    courseSelectionReason = enrollment ? 'active_learning_context' : null;
  }
  if (!enrollment && enrollments.length === 1) {
    enrollment = enrollments[0];
    courseSelectionReason = 'single_enrollment';
  }

  const selectedCourse = enrollment?.course || null;
  let knowledgePoint = null;
  const explicitKnowledgePointId = Number(input.knowledgePointId);
  if (selectedCourse && Number.isInteger(explicitKnowledgePointId)) {
    knowledgePoint = await prisma.knowledgePoint.findFirst({
      where: { knowledge_point_id: explicitKnowledgePointId, course_id: selectedCourse.course_id },
      include: { aliases: true },
    });
  }
  if (selectedCourse && !knowledgePoint) {
    const points = await prisma.knowledgePoint.findMany({
      where: { course_id: selectedCourse.course_id }, include: { aliases: true }, take: 300,
    });
    const queryText = normalize(input.query);
    knowledgePoint = points.map(point => {
      const names = [point.knowledge_point_name, ...point.aliases.map(alias => alias.alias_text)].map(normalize).filter(Boolean);
      const score = names.reduce((best, name) => queryText.includes(name) ? Math.max(best, name.length) : best, 0);
      return { point, score };
    }).sort((a, b) => b.score - a.score).find(item => item.score > 0)?.point || null;
  }
  // The active learning point is still exposed separately, but it must not
  // silently narrow broad questions such as “我的最近错题” or “成绩趋势”.
  // A point becomes the query scope only when the page supplied it or the
  // user's text named it.

  const range = requestedRange(input.query);
  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd.getTime() - range.days * 24 * 60 * 60 * 1000);
  return {
    userId: authenticatedUserId,
    role,
    // Safe summary only: student number, phone, email and authentication state never enter model/tool payloads.
    profile: profile ? { displayName: profile.real_name || null, grade: profile.grade || null, major: profile.major || null } : null,
    enrollments: enrollments.map(item => ({
      courseId: item.course_id, courseName: item.course.course_name, courseCode: item.course.course_code,
      teachingClassId: item.teaching_class_id, teachingClassName: item.teachingClass.teaching_class_name,
    })),
    selectedCourse: selectedCourse ? {
      id: selectedCourse.course_id, name: selectedCourse.course_name, code: selectedCourse.course_code,
      category: selectedCourse.subject_category, description: selectedCourse.description || null,
    } : null,
    selectedKnowledgePoint: knowledgePoint ? {
      id: knowledgePoint.knowledge_point_id, name: knowledgePoint.knowledge_point_name,
      description: knowledgePoint.description || null, difficulty: knowledgePoint.difficulty_level,
    } : null,
    teachingClass: enrollment ? { id: enrollment.teaching_class_id, name: enrollment.teachingClass.teaching_class_name } : null,
    activeLearningContext: activeLearningContext ? {
      courseId: activeLearningContext.courseId, knowledgePointId: activeLearningContext.knowledgePointId,
      learningGoalId: activeLearningContext.learningGoalId, workflowTemplateId: activeLearningContext.workflowTemplateId,
      targetMastery: activeLearningContext.targetMastery,
    } : null,
    courseSelectionReason,
    range: { ...range, start: rangeStart, end: rangeEnd },
  };
}

function publicUserContext(context) {
  return {
    role: context.role,
    profile: context.profile,
    selectedCourse: context.selectedCourse,
    selectedKnowledgePoint: context.selectedKnowledgePoint,
    teachingClass: context.teachingClass,
    activeLearningContext: context.activeLearningContext,
    courseSelectionReason: context.courseSelectionReason,
    range: { key: context.range.key, label: context.range.label, start: context.range.start.toISOString(), end: context.range.end.toISOString() },
  };
}

module.exports = { normalize, requestedRange, courseScore, buildUserContext, publicUserContext };
