// 教师端学生管理服务

const prisma = require('../config/prisma');
const {
  getAccessibleCourseIds,
  getAccessibleTeachingClassIds,
  ensureTeachingClassAccess,
  ensureStudentAccess,
  isAdmin,
} = require('./teacher-access.service');

// ---------- 辅助函数 ----------

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

// ---------- 学生列表 ----------

async function listStudents(user, query) {
  const courseIds = await getAccessibleCourseIds(user);
  const accessibleClassIds = await getAccessibleTeachingClassIds(user);

  const where = { role: 'STUDENT', status: 'ACTIVE' };

  // 先以教师可访问的教学班收敛学生集合，避免同课程其他教师班级的数据泄漏。
  const classId = query.class_id ? Number.parseInt(query.class_id, 10) : null;
  if (classId) {
    await ensureTeachingClassAccess(user, classId);
  }

  const courseId = query.course_id ? Number.parseInt(query.course_id, 10) : null;
  if (courseId && !courseIds?.includes(courseId) && !isAdmin(user)) {
    throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
  }
  const enrollmentWhere = {
    enrollment_status: 'active',
    ...(classId ? { teaching_class_id: classId } : { teaching_class_id: { in: accessibleClassIds } }),
    ...(courseId ? { course_id: courseId } : {}),
  };
  const authorizedEnrollments = await prisma.studentCourseEnrollment.findMany({
    where: enrollmentWhere,
    select: { student_user_id: true },
  });
  const finalIds = [...new Set(authorizedEnrollments.map((item) => item.student_user_id))];
  if (!finalIds.length) return { list: [], total: 0, page: 1, page_size: 20 };
  where.user_id = { in: finalIds };

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));

  // 多字段搜索：学号 / 姓名 / 用户名 / 班级
  const orConditions = [];
  if (query.keyword) {
    orConditions.push(
      { username: { contains: query.keyword } },
      { profile: { real_name: { contains: query.keyword } } },
    );
  }
  if (query.student_no) {
    orConditions.push({ profile: { student_no: { contains: query.student_no } } });
  }
  if (query.student_name) {
    orConditions.push({ profile: { real_name: { contains: query.student_name } } });
  }
  if (query.class_name) {
    // 按班级名称搜索：先查找匹配的班级 enrollment
    const matchedClasses = await prisma.teachingClass.findMany({
      where: { teaching_class_id: { in: accessibleClassIds }, teaching_class_name: { contains: query.class_name } },
      select: { teaching_class_id: true },
    });
    if (matchedClasses.length > 0) {
      const matchedIds = matchedClasses.map((c) => c.teaching_class_id);
      const enrollmentsInClass = await prisma.studentCourseEnrollment.findMany({
        where: { teaching_class_id: { in: matchedIds }, enrollment_status: 'active' },
        select: { student_user_id: true },
      });
      const userIds = [...new Set(enrollmentsInClass.map((e) => e.student_user_id))];
      if (userIds.length > 0) {
        where.user_id = { ...(where.user_id || {}), in: userIds };
      } else {
        return { list: [], total: 0, page, page_size: pageSize };
      }
    } else {
      return { list: [], total: 0, page, page_size: pageSize };
    }
  }
  if (query.grade) {
    orConditions.push({ profile: { grade: { contains: query.grade } } });
  }
  if (query.major) where.profile = { ...(where.profile || {}), major: { contains: String(query.major) } };
  if (query.admin_class_id) where.profile = { ...(where.profile || {}), admin_class_id: Number(query.admin_class_id) };
  if (String(query.needs_intervention || '') === 'true') {
    where.student_interventions = { some: { teacher_user_id: user.user_id, status: 'open' } };
  }
  if (orConditions.length > 0) {
    where.OR = orConditions;
  }

  const skip = (page - 1) * pageSize;

  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        profile: true,
        student_course_enrollments: {
          where: { enrollment_status: 'active', teaching_class_id: { in: accessibleClassIds } },
          include: { course: true, teachingClass: true },
        },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  const studentIds = students.map((item) => item.user_id);
  const [mastery, recipients, submissions, activity, exams, openInterventions] = studentIds.length ? await Promise.all([
    prisma.studentMasteryRecord.groupBy({ by: ['student_user_id'], where: { student_user_id: { in: studentIds }, ...(courseId ? { course_id: courseId } : {}) }, _avg: { mastery_score: true } }),
    prisma.learningTaskRecipient.findMany({ where: { student_user_id: { in: studentIds }, teaching_class_id: { in: classId ? [classId] : accessibleClassIds } }, select: { student_user_id: true, task_id: true } }),
    prisma.taskSubmission.findMany({ where: { student_user_id: { in: studentIds }, task: { teaching_class_id: { in: classId ? [classId] : accessibleClassIds } } }, select: { student_user_id: true, task_id: true } }),
    prisma.studyRecord.groupBy({ by: ['student_user_id'], where: { student_user_id: { in: studentIds }, ...(courseId ? { course_id: courseId } : {}) }, _count: { _all: true }, _sum: { duration_seconds: true } }),
    prisma.taskSubmission.findMany({ where: { student_user_id: { in: studentIds }, task: { task_type: 'EXAM', teaching_class_id: { in: classId ? [classId] : accessibleClassIds } }, total_score: { not: null } }, select: { student_user_id: true, total_score: true } }),
    prisma.teacherStudentIntervention.groupBy({ by: ['student_user_id'], where: { teacher_user_id: user.user_id, student_user_id: { in: studentIds }, status: 'open' }, _count: { _all: true } }),
  ]) : [[], [], [], [], [], []];
  const masteryMap = new Map(mastery.map((item) => [item.student_user_id, Math.round((item._avg.mastery_score || 0) * 10) / 10]));
  const recipientMap = new Map();
  recipients.forEach((item) => recipientMap.set(item.student_user_id, (recipientMap.get(item.student_user_id) || 0) + 1));
  const submittedByStudent = new Map();
  submissions.forEach((item) => {
    if (!submittedByStudent.has(item.student_user_id)) submittedByStudent.set(item.student_user_id, new Set());
    submittedByStudent.get(item.student_user_id).add(item.task_id);
  });
  const activityMap = new Map(activity.map((item) => [item.student_user_id, item]));
  const examMap = new Map();
  exams.forEach((item) => {
    const list = examMap.get(item.student_user_id) || [];
    list.push(Number(item.total_score));
    examMap.set(item.student_user_id, list);
  });
  const interventionMap = new Map(openInterventions.map((item) => [item.student_user_id, item._count._all]));

  return {
    list: students.map((stu) => {
      const recipientCount = recipientMap.get(stu.user_id) || 0;
      const submittedCount = submittedByStudent.get(stu.user_id)?.size || 0;
      const examScores = examMap.get(stu.user_id) || [];
      return ({
      student_user_id: stu.user_id,
      username: stu.username,
      student_name: stu.profile?.real_name || null,
      student_no: stu.profile?.student_no || null,
      college: stu.profile?.college || null,
      major: stu.profile?.major || null,
      grade: stu.profile?.grade || null,
      email: stu.email,
      courses: stu.student_course_enrollments.map((e) => ({
        course_id: e.course_id,
        course_name: e.course?.course_name || null,
        class_id: e.teaching_class_id,
        class_name: e.teachingClass?.teaching_class_name || null,
      })),
      metrics: {
        mastery_score: masteryMap.get(stu.user_id) || 0,
        homework_completion_rate: recipientCount ? Math.round((submittedCount / recipientCount) * 1000) / 10 : 0,
        average_exam_score: examScores.length ? Math.round((examScores.reduce((sum, value) => sum + value, 0) / examScores.length) * 10) / 10 : null,
        activity_count: activityMap.get(stu.user_id)?._count?._all || 0,
        study_duration_seconds: activityMap.get(stu.user_id)?._sum?.duration_seconds || 0,
        open_intervention_count: interventionMap.get(stu.user_id) || 0,
      },
    }); }),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 学生详情 ----------

async function getStudent(user, studentUserId) {
  const student = await ensureStudentAccess(user, studentUserId);
  const accessibleClassIds = await getAccessibleTeachingClassIds(user);
  const accessibleCourseIds = await getAccessibleCourseIds(user);

  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: studentUserId, enrollment_status: 'active', teaching_class_id: { in: accessibleClassIds } },
    include: {
      course: true,
      teachingClass: true,
    },
  });

  const scopedCourseIds = accessibleCourseIds || [...new Set(enrollments.map((item) => item.course_id))];
  const [summary, mastery, wrongQuestions, taskSubmissions, studyRecords, learningPlans, questionRecords, interventions] = await Promise.all([
    prisma.practiceSession.aggregate({
      _count: { practice_session_id: true },
      _sum: { correct_count: true, question_count: true, duration_seconds: true },
      where: { student_user_id: studentUserId, course_id: { in: scopedCourseIds }, status: { notIn: ['IN_PROGRESS', 'in_progress'] } },
    }),
    prisma.studentMasteryRecord.findMany({
      where: { student_user_id: studentUserId, course_id: { in: scopedCourseIds } },
      include: { course: true, knowledge_point: true },
      orderBy: { mastery_score: 'asc' },
      take: 100,
    }),
    prisma.wrongQuestion.findMany({
      where: { student_user_id: studentUserId, course_id: { in: scopedCourseIds } },
      include: { question: { include: { options: true } }, course: true, knowledge_point: true },
      orderBy: { updated_at: 'desc' },
      take: 30,
    }),
    prisma.taskSubmission.findMany({
      where: { student_user_id: studentUserId, task: { teaching_class_id: { in: accessibleClassIds } } },
      include: { task: { include: { course: true, teaching_class: true } } },
      orderBy: { updated_at: 'desc' },
      take: 30,
    }),
    prisma.studyRecord.findMany({
      where: { student_user_id: studentUserId, course_id: { in: scopedCourseIds } },
      include: { course: true, knowledge_point: true },
      orderBy: { started_at: 'desc' },
      take: 30,
    }),
    prisma.studentLearningPlan.findMany({
      where: { studentUserId: studentUserId, courseId: { in: scopedCourseIds } },
      include: { course: true, knowledgePoint: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.studentQuestionRecord.findMany({
      where: { student_user_id: studentUserId, course_id: { in: scopedCourseIds } },
      include: { course: true, analysis_records: { include: { keywords: true, confusion_tags: true, knowledge_point: true } } },
      orderBy: { created_at: 'desc' },
      take: 30,
    }),
    prisma.teacherStudentIntervention.findMany({
      where: {
        student_user_id: studentUserId,
        course_id: { in: scopedCourseIds },
        ...(isAdmin(user) ? {} : { teacher_user_id: user.user_id }),
      },
      orderBy: { created_at: 'desc' },
      take: 30,
    }),
  ]);

  return {
    student: {
      student_user_id: student.user_id,
      username: student.username,
      student_name: student.profile?.real_name || null,
      student_no: student.profile?.student_no || null,
      gender: student.profile?.gender ? toLower(student.profile.gender) : null,
      college: student.profile?.college || null,
      major: student.profile?.major || null,
      grade: student.profile?.grade || null,
      email: student.email,
      phone: student.phone,
      avatar_url: student.profile?.avatar_url || null,
      administrative_class: student.profile?.admin_class
        ? {
            administrative_class_id: student.profile.admin_class.admin_class_id,
            name: student.profile.admin_class.class_name,
            grade: student.profile.admin_class.grade,
          }
        : null,
    },
    courses: enrollments.map((e) => ({
      course_id: e.course_id,
      course_name: e.course?.course_name || null,
      class_id: e.teaching_class_id,
      class_name: e.teachingClass?.teaching_class_name || null,
    })),
    summary: {
      total_sessions: summary._count.practice_session_id || 0,
      total_questions: summary._sum.question_count || 0,
      total_correct: summary._sum.correct_count || 0,
      total_duration: summary._sum.duration_seconds || 0,
    },
    mastery: mastery.map((item) => ({
      course_id: item.course_id,
      course_name: item.course.course_name,
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point.knowledge_point_name,
      mastery_score: item.mastery_score,
      mastery_level: toLower(item.mastery_level),
      teacher_comment: item.teacher_comment,
      updated_at: item.updated_at.toISOString(),
    })),
    weak_knowledge_points: mastery.filter((item) => item.mastery_score < 60).slice(0, 10).map((item) => ({
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point.knowledge_point_name,
      mastery_score: item.mastery_score,
    })),
    wrong_questions: wrongQuestions.map((item) => ({
      wrong_question_id: item.wrong_question_id,
      question_id: item.question_id,
      course_name: item.course?.course_name || null,
      knowledge_point_name: item.knowledge_point?.knowledge_point_name || null,
      question: item.question.content,
      correct_answer: item.question.correct_answer,
      options: item.question.options,
      wrong_reason: toLower(item.wrong_reason),
      status: toLower(item.status),
      last_wrong_at: item.last_wrong_at?.toISOString() || null,
    })),
    tasks: taskSubmissions.map((item) => ({
      task_id: item.task_id,
      title: item.task.title,
      task_type: toLower(item.task.task_type),
      course_name: item.task.course.course_name,
      teaching_class_name: item.task.teaching_class.teaching_class_name,
      submission_status: toLower(item.submission_status),
      score: item.total_score,
      submitted_at: item.submitted_at?.toISOString() || null,
    })),
    study_records: studyRecords.map((item) => ({
      study_record_id: item.study_record_id,
      course_name: item.course?.course_name || null,
      knowledge_point_name: item.knowledge_point?.knowledge_point_name || null,
      duration_seconds: item.duration_seconds,
      started_at: item.started_at?.toISOString() || null,
    })),
    learning_plans: learningPlans.map((item) => ({
      id: item.id,
      course_name: item.course.course_name,
      knowledge_point_name: item.knowledgePoint?.knowledge_point_name || null,
      status: toLower(item.status),
      progress: item.progress,
      estimated_minutes: item.estimatedMinutes,
      updated_at: item.updatedAt.toISOString(),
    })),
    dialogue_insights: questionRecords.map((item) => ({
      question_id: item.student_question_id,
      question: item.raw_question,
      course_name: item.course?.course_name || null,
      keywords: item.analysis_records.flatMap((analysis) => analysis.keywords.map((keyword) => keyword.keyword)),
      misconceptions: item.analysis_records.flatMap((analysis) => analysis.confusion_tags.map((tag) => tag.tag)),
      resolved: item.analysis_records.every((analysis) => !analysis.need_teacher_review),
      created_at: item.created_at.toISOString(),
    })),
    interventions: interventions.map((item) => ({
      intervention_id: item.intervention_id,
      type: item.intervention_type,
      content: item.content,
      status: item.status,
      follow_up_at: item.follow_up_at?.toISOString() || null,
      created_at: item.created_at.toISOString(),
    })),
  };
}

// ---------- 学生掌握度 ----------

async function getStudentMastery(user, studentUserId, query) {
  const student = await ensureStudentAccess(user, studentUserId);

  const where = { student_user_id: studentUserId };
  if (query.course_id) {
    where.course_id = Number.parseInt(query.course_id, 10);
  }

  const records = await prisma.studentMasteryRecord.findMany({
    where,
    include: {
      knowledge_point: true,
      course: true,
    },
    orderBy: { mastery_score: 'asc' },
  });

  return {
    student: {
      student_user_id: student.user_id,
      student_name: student.profile?.real_name || student.username,
    },
    mastery_records: records.map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
      course_id: r.course_id,
      course_name: r.course?.course_name || null,
      mastery_score: r.mastery_score,
      mastery_level: toLower(r.mastery_level),
      source_scores: {
        quiz_score: r.quiz_score,
        question_score: r.question_score,
        study_progress_score: r.study_progress_score,
        teacher_mark_score: r.teacher_mark_score,
        teacher_mark_level: r.teacher_mark_level ? toLower(r.teacher_mark_level) : null,
        system_score: r.system_score,
      },
      teacher_comment: r.teacher_comment,
      updated_at: r.updated_at.toISOString(),
    })),
  };
}

// ---------- 教师标记掌握度 ----------

async function markMastery(user, studentUserId, kpId, body) {
  await ensureStudentAccess(user, studentUserId);

  const { teacher_mark_score, teacher_comment } = body;
  if (teacher_mark_score == null || teacher_mark_score < 0 || teacher_mark_score > 100) {
    throw Object.assign(new Error('teacher_mark_score 必须在 0-100 之间'), { code: 40001 });
  }

  const record = await prisma.studentMasteryRecord.findUnique({
    where: {
      student_user_id_course_id_knowledge_point_id: {
        student_user_id: studentUserId,
        course_id: Number(body.course_id) || undefined,
        knowledge_point_id: kpId,
      },
    },
  });

  if (!record) {
    // 如果没有记录则创建
    const courseId = Number(body.course_id);
    if (!courseId) throw Object.assign(new Error('course_id 为必填项'), { code: 40001 });

    await prisma.studentMasteryRecord.create({
      data: {
        student_user_id: studentUserId,
        course_id: courseId,
        knowledge_point_id: kpId,
        mastery_score: teacher_mark_score,
        mastery_level: getMasteryLevel(teacher_mark_score),
        teacher_mark_score,
        teacher_mark_level: getMasteryLevel(teacher_mark_score),
        teacher_comment: teacher_comment || null,
        system_score: teacher_mark_score,
      },
    });
  } else {
    await prisma.studentMasteryRecord.update({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: studentUserId,
          course_id: record.course_id,
          knowledge_point_id: kpId,
        },
      },
      data: {
        teacher_mark_score,
        teacher_comment: teacher_comment || null,
        mastery_score: Math.max(teacher_mark_score, record.mastery_score),
        teacher_mark_level: getMasteryLevel(teacher_mark_score),
      },
    });
  }

  return { student_user_id: studentUserId, knowledge_point_id: kpId, teacher_mark_score };
}

function getMasteryLevel(score) {
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'GOOD';
  if (score >= 60) return 'GENERAL';
  return 'WEAK';
}

// ---------- 学生画像 ----------

async function getStudentPortrait(user, studentUserId, query) {
  const student = await ensureStudentAccess(user, studentUserId);

  const where = { student_user_id: studentUserId };
  if (query.course_id) {
    where.course_id = Number.parseInt(query.course_id, 10);
  }

  const portrait = await prisma.studentPortrait.findFirst({ where });
  const masteryRecords = await prisma.studentMasteryRecord.findMany({
    where,
    include: { knowledge_point: true },
  });

  return {
    student: {
      student_user_id: student.user_id,
      student_name: student.profile?.real_name || student.username,
      student_no: student.profile?.student_no || null,
    },
    learning_ability: portrait ? {
      total_score: portrait.learning_total_score,
      progress_score: portrait.progress_score,
      mastery_score: portrait.mastery_score,
      test_score: portrait.test_score,
      wrong_question_score: portrait.wrong_question_score,
      activity_score: portrait.activity_score,
      qa_score: portrait.qa_score,
    } : null,
    mastered_knowledge_points: masteryRecords
      .filter((r) => r.mastery_level === 'GOOD' || r.mastery_level === 'EXCELLENT')
      .map((r) => ({
        knowledge_point_id: r.knowledge_point_id,
        knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
        mastery_score: r.mastery_score,
        mastery_level: toLower(r.mastery_level),
      })),
    weak_knowledge_points: masteryRecords
      .filter((r) => r.mastery_level === 'WEAK')
      .map((r) => ({
        knowledge_point_id: r.knowledge_point_id,
        knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
        mastery_score: r.mastery_score,
        mastery_level: toLower(r.mastery_level),
      })),
    research_ability: null, // 预留字段
    competition_ability: null, // 预留字段
  };
}

// ---------- 刷新画像（基础版） ----------

async function refreshPortrait(user, studentUserId, body) {
  await ensureStudentAccess(user, studentUserId);
  const courseId = Number(body.course_id);
  if (!courseId) throw Object.assign(new Error('course_id 为必填项'), { code: 40001 });

  // 计算基础画像分数
  const masteryRecords = await prisma.studentMasteryRecord.findMany({
    where: { student_user_id: studentUserId, course_id: courseId },
  });

  const avgMastery = masteryRecords.length > 0
    ? Math.round(masteryRecords.reduce((s, r) => s + r.mastery_score, 0) / masteryRecords.length)
    : 0;

  const sessions = await prisma.practiceSession.findMany({
    where: { student_user_id: studentUserId, course_id: courseId, status: { notIn: ['IN_PROGRESS', 'in_progress'] } },
  });

  const totalQuestions = sessions.reduce((s, sess) => s + (sess.question_count || 0), 0);
  const totalCorrect = sessions.reduce((s, sess) => s + (sess.correct_count || 0), 0);
  const avgTestScore = sessions.filter((s) => s.max_score > 0 && s.total_score != null).length > 0
    ? Math.round(
        sessions
          .filter((s) => s.max_score > 0 && s.total_score != null)
          .reduce((s, sess) => s + (sess.total_score / sess.max_score) * 100, 0) /
          sessions.filter((s) => s.max_score > 0 && s.total_score != null).length
      )
    : 0;

  const wrongCount = await prisma.wrongQuestion.count({
    where: { student_user_id: studentUserId, course_id: courseId, status: { not: 'REMOVED' } },
  });

  const wrongScore = wrongCount > 0 ? Math.max(0, 100 - wrongCount * 5) : 100;

  const studyRecords = await prisma.studyRecord.count({
    where: { student_user_id: studentUserId, course_id: courseId },
  });
  const activityScore = Math.min(100, Math.round((studyRecords / 10) * 100));

  const qaCount = await prisma.studentQuestionRecord.count({
    where: { student_user_id: studentUserId, course_id: courseId },
  });
  const qaScore = Math.min(100, Math.round((qaCount / 5) * 100));

  const totalScore = Math.round(
    (avgMastery * 0.3 + avgTestScore * 0.25 + wrongScore * 0.15 + activityScore * 0.15 + qaScore * 0.15)
  );

  await prisma.studentPortrait.upsert({
    where: {
      student_user_id_course_id: { student_user_id: studentUserId, course_id: courseId },
    },
    update: {
      learning_total_score: totalScore,
      progress_score: avgMastery,
      mastery_score: avgMastery,
      test_score: avgTestScore,
      wrong_question_score: wrongScore,
      activity_score: activityScore,
      qa_score,
    },
    create: {
      student_user_id: studentUserId,
      course_id: courseId,
      learning_total_score: totalScore,
      progress_score: avgMastery,
      mastery_score: avgMastery,
      test_score: avgTestScore,
      wrong_question_score: wrongScore,
      activity_score: activityScore,
      qa_score,
    },
  });

  return { student_user_id: studentUserId, course_id: courseId, refreshed: true };
}

// ---------- 教师手动添加学生 ----------

async function createStudent(user, body) {
  const { username, password, real_name, student_no, college, major, gender, phone, email, teaching_class_id } = body;

  if (!username || !password || !real_name) {
    throw Object.assign(new Error('用户名、密码、真实姓名为必填项'), { code: 40001 });
  }

  // 检查用户名唯一性
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw Object.assign(new Error('用户名已存在'), { code: 40003 });
  }

  // 检查学号唯一性
  if (student_no) {
    const dupNo = await prisma.userProfile.findFirst({ where: { student_no } });
    if (dupNo) {
      throw Object.assign(new Error('学号已被占用'), { code: 40003 });
    }
  }

  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash(password, 10);

  const teachingClass = teaching_class_id ? await ensureTeachingClassAccess(user, Number(teaching_class_id)) : null;
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username,
        password_hash,
        role: 'STUDENT',
        status: 'ACTIVE',
        phone: phone || null,
        email: email || null,
      },
    });

    await tx.userProfile.create({
      data: {
        user_id: user.user_id,
        real_name,
        gender: gender ? gender.toUpperCase() : 'UNKNOWN',
        student_no: student_no || null,
        college: college || null,
        major: major || null,
      },
    });

    return user;
  });

  // 可选：自动加入教学班级
  let enrollment = null;
  if (teaching_class_id) {
    if (teachingClass) {
      enrollment = await prisma.studentCourseEnrollment.create({
        data: {
          student_user_id: result.user_id,
          course_id: teachingClass.course_id,
          teaching_class_id: Number(teaching_class_id),
          enrollment_status: 'active',
        },
      });
    }
  }

  return {
    student_user_id: result.user_id,
    username: result.username,
    real_name,
    student_no: student_no || null,
    enrolled: !!enrollment,
    class_id: teaching_class_id || null,
  };
}

// ---------- 教师编辑学生信息 ----------

async function updateStudent(user, studentUserId, body) {
  await ensureStudentAccess(user, studentUserId);

  const { real_name, student_no, college, major, grade, gender, phone, email, status, teaching_class_id } = body;

  // 检查学号唯一性（如果变更）
  if (student_no) {
    const dupNo = await prisma.userProfile.findFirst({
      where: { student_no, user_id: { not: studentUserId } },
    });
    if (dupNo) {
      throw Object.assign(new Error('学号已被其他学生占用'), { code: 40003 });
    }
  }

  // 更新用户表字段
  const userUpdateData = {};
  if (phone !== undefined) userUpdateData.phone = phone || null;
  if (email !== undefined) userUpdateData.email = email || null;

  if (Object.keys(userUpdateData).length > 0) {
    await prisma.user.update({
      where: { user_id: studentUserId },
      data: userUpdateData,
    });
  }

  // 更新 profile 表字段
  const profileData = {};
  if (real_name !== undefined) profileData.real_name = real_name;
  if (student_no !== undefined) profileData.student_no = student_no || null;
  if (college !== undefined) profileData.college = college || null;
  if (major !== undefined) profileData.major = major || null;
  if (grade !== undefined) profileData.grade = grade || null;
  if (gender !== undefined) profileData.gender = gender.toUpperCase();

  if (Object.keys(profileData).length > 0) {
    await prisma.userProfile.update({
      where: { user_id: studentUserId },
      data: profileData,
    });
  }

  // 如果指定了教学班级，更新 enrollment
  if (teaching_class_id) {
    const tc = await ensureTeachingClassAccess(user, Number(teaching_class_id));
    await prisma.studentCourseEnrollment.upsert({
      where: { student_user_id_course_id_teaching_class_id: { student_user_id: studentUserId, course_id: tc.course_id, teaching_class_id: Number(teaching_class_id) } },
      update: { enrollment_status: 'active' },
      create: { student_user_id: studentUserId, course_id: tc.course_id, teaching_class_id: Number(teaching_class_id), enrollment_status: 'active' },
    });
  }

  return {
    student_user_id: studentUserId,
    updated: true,
  };
}

// ---------- 教师删除学生 ----------

async function deleteStudent(user, studentUserId) {
  await ensureStudentAccess(user, studentUserId);

  const classIds = await getAccessibleTeachingClassIds(user);
  const removed = await prisma.studentCourseEnrollment.updateMany({
    where: { student_user_id: studentUserId, teaching_class_id: { in: classIds }, enrollment_status: 'active' },
    data: { enrollment_status: 'removed' },
  });
  return { student_user_id: studentUserId, removed_enrollment_count: removed.count, user_deleted: false };
}

// ---------- 批量导入学生 ----------

async function batchImportStudents(user, studentsData) {
  if (!Array.isArray(studentsData) || studentsData.length === 0) {
    throw Object.assign(new Error('导入数据不能为空'), { code: 40001 });
  }

  const bcrypt = require('bcryptjs');
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < studentsData.length; i++) {
    const row = studentsData[i];
    const rowNum = i + 1;
    try {
      // 校验必填
      if (!row.username || !row.real_name) {
        throw new Error('用户名和真实姓名为必填项');
      }

      const teachingClassId = Number(row.teaching_class_id);
      if (!Number.isInteger(teachingClassId)) throw new Error('teaching_class_id 为必填稳定 ID');
      const teachingClass = await ensureTeachingClassAccess(user, teachingClassId);
      let existingUser = await prisma.user.findUnique({ where: { username: row.username } });
      if (existingUser && existingUser.role !== 'STUDENT') throw new Error(`用户名 "${row.username}" 已被非学生账号使用`);

      // 检查学号唯一性
      if (row.student_no) {
        const dupNo = await prisma.userProfile.findFirst({ where: { student_no: row.student_no, ...(existingUser ? { user_id: { not: existingUser.user_id } } : {}) } });
        if (dupNo) {
          throw new Error(`学号 "${row.student_no}" 已被占用`);
        }
      }

      const password_hash = await bcrypt.hash(row.password || '123456', 10);

      const u = existingUser || await prisma.user.create({ data: {
          username: row.username,
          password_hash,
          role: 'STUDENT',
          status: 'ACTIVE',
          phone: row.phone || null,
          email: row.email || null,
        } });

      await prisma.userProfile.upsert({
        where: { user_id: u.user_id },
        update: {},
        create: {
          user_id: u.user_id,
          real_name: row.real_name,
          gender: row.gender ? row.gender.toUpperCase() : 'UNKNOWN',
          student_no: row.student_no || null,
          college: row.college || null,
          major: row.major || null,
          grade: row.grade || null,
        },
      });
      await prisma.studentCourseEnrollment.upsert({
        where: { student_user_id_course_id_teaching_class_id: { student_user_id: u.user_id, course_id: teachingClass.course_id, teaching_class_id: teachingClassId } },
        update: { enrollment_status: 'active' },
        create: { student_user_id: u.user_id, course_id: teachingClass.course_id, teaching_class_id: teachingClassId, enrollment_status: 'active' },
      });

      successCount++;
      results.push({ row: rowNum, username: row.username, real_name: row.real_name, success: true });
    } catch (err) {
      failCount++;
      results.push({ row: rowNum, username: row.username || '-', real_name: row.real_name || '-', success: false, reason: err.message });
    }
  }

  return {
    total: studentsData.length,
    success_count: successCount,
    fail_count: failCount,
    results,
  };
}

async function createIntervention(user, studentUserId, body = {}) {
  await ensureStudentAccess(user, studentUserId, { teaching_class_id: body.teaching_class_id, course_id: body.course_id });
  const courseId = Number(body.course_id);
  if (!Number.isInteger(courseId)) throw Object.assign(new Error('course_id 为必填项'), { code: 40001 });
  const teachingClassId = body.teaching_class_id ? Number(body.teaching_class_id) : null;
  if (teachingClassId) await ensureTeachingClassAccess(user, teachingClassId);
  const content = String(body.content || '').trim();
  if (!content) throw Object.assign(new Error('干预内容不能为空'), { code: 40001 });
  const record = await prisma.teacherStudentIntervention.create({ data: {
    teacher_user_id: user.user_id,
    student_user_id: studentUserId,
    course_id: courseId,
    teaching_class_id: teachingClassId,
    intervention_type: String(body.intervention_type || 'teacher_note').slice(0, 50),
    content,
    follow_up_at: body.follow_up_at ? new Date(body.follow_up_at) : null,
  } });
  if (body.notify_student) {
    await prisma.notification.create({ data: {
      receiver_user_id: studentUserId,
      sender_user_id: user.user_id,
      notification_type: 'SYSTEM',
      title: '教师学习建议',
      content,
      business_type: 'teacher_intervention',
      business_id: record.intervention_id,
    } });
  }
  return record;
}

async function batchNotifyStudents(user, body = {}) {
  const ids = [...new Set((body.student_user_ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length || ids.length > 200) throw Object.assign(new Error('请选择 1-200 名学生'), { code: 40001 });
  await Promise.all(ids.map((id) => ensureStudentAccess(user, id, { teaching_class_id: body.teaching_class_id, course_id: body.course_id })));
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title || !content) throw Object.assign(new Error('通知标题和内容不能为空'), { code: 40001 });
  const result = await prisma.notification.createMany({ data: ids.map((id) => ({
    receiver_user_id: id,
    sender_user_id: user.user_id,
    notification_type: 'SYSTEM',
    title,
    content,
    business_type: 'teacher_message',
    business_id: body.teaching_class_id ? Number(body.teaching_class_id) : null,
  })) });
  return { sent_count: result.count };
}

module.exports = {
  listStudents,
  getStudent,
  getStudentMastery,
  markMastery,
  getStudentPortrait,
  refreshPortrait,
  createStudent,
  updateStudent,
  deleteStudent,
  batchImportStudents,
  createIntervention,
  batchNotifyStudents,
};
