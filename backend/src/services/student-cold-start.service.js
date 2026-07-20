// Student cold-start: creates a small, syllabus-led starting experience for new learners.
const prisma = require('../config/prisma');

const STARTER_COURSE_CODES = ['ML001', 'PY001', 'DS001'];

function syllabusFrom(document) {
  const raw = document?.metadata_json;
  return raw && typeof raw === 'object' && raw.syllabus && typeof raw.syllabus === 'object' ? raw.syllabus : {};
}

async function buildSyllabusRecommendations(tx, studentUserId, courseId) {
  const existing = await tx.recommendationRecord.findFirst({
    where: { student_user_id: studentUserId, course_id: courseId },
    orderBy: { created_at: 'desc' },
  });
  if (existing) return existing;

  const [course, syllabusDocument, points] = await Promise.all([
    tx.course.findUnique({ where: { course_id: courseId } }),
    tx.knowledgeDocument.findFirst({
      where: { course_id: courseId, resource_kind: 'syllabus', deleted_at: null },
      orderBy: { updated_at: 'desc' },
    }),
    tx.knowledgePoint.findMany({
      where: { course_id: courseId }, orderBy: [{ chapter_id: 'asc' }, { sort_order: 'asc' }], take: 3,
    }),
  ]);
  if (!course) return null;
  const syllabus = syllabusFrom(syllabusDocument);
  const objective = Array.isArray(syllabus.objectives) ? syllabus.objectives[0] : null;
  return tx.recommendationRecord.create({
    data: {
      student_user_id: studentUserId,
      course_id: courseId,
      recommend_type: 'ALL',
      reason_summary: `依据《${course.course_name}》教学大纲生成的起步学习建议${objective ? `：${objective}` : ''}`,
      items: {
        create: points.map((point, index) => ({
          item_type: 'knowledge_point',
          target_type: 'knowledge_point',
          target_id: point.knowledge_point_id,
          title: `从“${point.knowledge_point_name}”开始`,
          reason: `教学大纲建议先建立该章节的基础概念，再进入后续应用学习。`,
          rank: index + 1,
          content: { source: 'syllabus', courseCode: course.course_code, syllabusDocumentId: syllabusDocument?.document_id || null },
        })),
      },
    },
  });
}

async function initializeNewStudent(tx, studentUserId) {
  const courses = await tx.course.findMany({
    where: { course_code: { in: STARTER_COURSE_CODES }, status: 'ACTIVE' },
    include: { teaching_classes: { where: { status: 'ACTIVE' }, orderBy: { teaching_class_id: 'asc' }, take: 1 } },
  });
  const ordered = STARTER_COURSE_CODES.map((code) => courses.find((course) => course.course_code === code)).filter(Boolean);
  const enrolled = [];
  for (const course of ordered) {
    const teachingClass = course.teaching_classes[0];
    if (!teachingClass) continue;
    const enrollment = await tx.studentCourseEnrollment.upsert({
      where: { student_user_id_course_id_teaching_class_id: { student_user_id: studentUserId, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id } },
      update: { enrollment_status: 'active' },
      create: { student_user_id: studentUserId, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, enrollment_status: 'active' },
    });
    enrolled.push(enrollment);
  }
  if (enrolled[0]) await buildSyllabusRecommendations(tx, studentUserId, enrolled[0].course_id);
  return enrolled;
}

async function ensureDiagnosticTask(studentUserId, courseId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: studentUserId, course_id: courseId, enrollment_status: 'active' },
    include: { course: true, teachingClass: true },
  });
  if (!enrollment) throw Object.assign(new Error('未加入该课程或课程不存在'), { code: 40301 });
  const title = `${enrollment.course.course_name} · 入门摸底测试`;
  const prior = await prisma.learningTask.findFirst({
    where: { course_id: courseId, title, recipients: { some: { student_user_id: studentUserId } } },
    include: { recipients: { where: { student_user_id: studentUserId }, take: 1 } },
  });
  if (prior) return { task: prior, created: false };

  const creatorId = enrollment.teachingClass?.teacher_user_id
    || (await prisma.courseTeacherRelation.findFirst({ where: { course_id: courseId }, select: { teacher_user_id: true } }))?.teacher_user_id
    || (await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { user_id: true } }))?.user_id;
  if (!creatorId) throw Object.assign(new Error('当前课程尚未配置可发布摸底测试的教师'), { code: 40002 });

  const points = await prisma.knowledgePoint.findMany({
    where: { course_id: courseId }, orderBy: [{ chapter_id: 'asc' }, { sort_order: 'asc' }], take: 5,
  });
  const task = await prisma.learningTask.create({
    data: {
      course_id: courseId,
      teaching_class_id: enrollment.teaching_class_id,
      created_by_user_id: creatorId,
      task_type: 'QUIZ',
      title,
      description: '开始学习前的轻量摸底测试，用于建立初始学习画像；结果仅用于个性化推荐。',
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      duration_minutes: 12,
      allowed_attempts: 1,
      randomize_questions: false,
      randomize_options: true,
      show_score_policy: 'after_submit',
      show_answer_policy: 'after_submit',
      show_analysis_policy: 'after_submit',
      auto_grade: true,
      source_mode: 'cold_start_diagnostic',
      total_score: Math.max(1, points.length) * 20,
      pass_score: 60,
      instructions: '请依据当前理解完成。不必查阅资料，系统会据此调整课程学习顺序。',
      configuration_json: { kind: 'cold_start_diagnostic', studentUserId, syllabusDriven: true },
      published_at: new Date(),
      status: 'PUBLISHED',
      recipients: { create: { student_user_id: studentUserId, teaching_class_id: enrollment.teaching_class_id, delivery_status: 'delivered' } },
    },
  });

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const question = await prisma.question.create({
      data: {
        course_id: courseId,
        knowledge_point_id: point.knowledge_point_id,
        question_type: 'SINGLE_CHOICE',
        title: `${point.knowledge_point_name} · 入门自评`,
        content: `关于“${point.knowledge_point_name}”，哪项学习策略最适合作为入门起点？`,
        correct_answer: ['A'],
        analysis: '先理解基本概念、适用条件和一个最小示例，再进入复杂推导或综合应用。',
        difficulty_level: 'BASIC',
        score: 20,
        source_type: 'ORIGINAL',
        generation_mode: 'ORIGINAL',
        created_by_user_id: creatorId,
        status: 'active',
        options: { create: [
          { option_key: 'A', option_content: '先理解核心概念、适用条件与一个最小示例', option_order: 1, is_correct: true },
          { option_key: 'B', option_content: '直接跳到综合项目，不再回顾基础定义', option_order: 2, is_correct: false },
          { option_key: 'C', option_content: '只背诵术语，不建立概念之间的联系', option_order: 3, is_correct: false },
          { option_key: 'D', option_content: '忽略课程大纲，随机挑选章节学习', option_order: 4, is_correct: false },
        ] },
      },
    });
    await prisma.taskQuestion.create({ data: { task_id: task.task_id, question_id: question.question_id, question_order: index + 1, score: 20 } });
    await prisma.taskKnowledgePoint.create({ data: { task_id: task.task_id, knowledge_point_id: point.knowledge_point_id } });
  }
  return { task, created: true };
}

module.exports = { initializeNewStudent, ensureDiagnosticTask, buildSyllabusRecommendations };
