// 教师端学生管理服务

const prisma = require('../config/prisma');

// ---------- 辅助函数 ----------

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

async function getAccessibleCourseIds(user) {
  if (user.role === 'admin') return null;
  const relations = await prisma.courseTeacherRelation.findMany({
    where: { teacher_user_id: user.user_id },
    select: { course_id: true },
  });
  return relations.map((item) => item.course_id);
}

async function ensureStudentAccess(user, studentUserId) {
  const student = await prisma.user.findUnique({
    where: { user_id: studentUserId },
    include: { profile: true },
  });
  if (!student || student.role !== 'STUDENT') {
    throw Object.assign(new Error('学生不存在'), { code: 40002 });
  }
  if (user.role === 'admin') return student;

  const courseIds = await getAccessibleCourseIds(user);
  if (!courseIds || courseIds.length === 0) {
    throw Object.assign(new Error('无权访问该学生数据'), { code: 40301 });
  }
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: studentUserId,
      course_id: { in: courseIds },
      enrollment_status: 'active',
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('无权访问该学生数据'), { code: 40301 });
  }
  return student;
}

// ---------- 学生列表 ----------

async function listStudents(user, query) {
  const courseIds = await getAccessibleCourseIds(user);

  const where = { role: 'STUDENT', status: 'ACTIVE' };

  // 按班级筛选
  const classId = query.class_id ? Number.parseInt(query.class_id, 10) : null;
  let userIdsInClass = null;
  if (classId) {
    const enrollments = await prisma.studentCourseEnrollment.findMany({
      where: { teaching_class_id: classId, enrollment_status: 'active' },
      select: { student_user_id: true },
    });
    userIdsInClass = enrollments.map((e) => e.student_user_id);
    if (userIdsInClass.length === 0) {
      return { list: [], total: 0 };
    }
  }

  // 按课程筛选
  const courseId = query.course_id ? Number.parseInt(query.course_id, 10) : null;
  if (courseId && !courseIds?.includes(courseId) && user.role !== 'admin') {
    throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
  }
  let userIdsInCourse = null;
  if (courseId) {
    const enrollments = await prisma.studentCourseEnrollment.findMany({
      where: { course_id: courseId, enrollment_status: 'active' },
      select: { student_user_id: true },
    });
    userIdsInCourse = enrollments.map((e) => e.student_user_id);
  } else if (courseIds) {
    const enrollments = await prisma.studentCourseEnrollment.findMany({
      where: { course_id: { in: courseIds }, enrollment_status: 'active' },
      select: { student_user_id: true },
    });
    userIdsInCourse = [...new Set(enrollments.map((e) => e.student_user_id))];
  }

  let finalIds = null;
  if (userIdsInClass !== null && userIdsInCourse !== null) {
    finalIds = userIdsInClass.filter((id) => userIdsInCourse.includes(id));
  } else if (userIdsInClass !== null) {
    finalIds = userIdsInClass;
  } else if (userIdsInCourse !== null) {
    finalIds = userIdsInCourse;
  }

  if (finalIds !== null) {
    where.user_id = { in: finalIds };
  }

  // 关键词搜索
  if (query.keyword) {
    where.OR = [
      { username: { contains: query.keyword } },
      { profile: { real_name: { contains: query.keyword } } },
    ];
  }

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));
  const skip = (page - 1) * pageSize;

  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        profile: true,
        student_course_enrollments: {
          where: { enrollment_status: 'active' },
          include: { course: true, teachingClass: true },
        },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    list: students.map((stu) => ({
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
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 学生详情 ----------

async function getStudent(user, studentUserId) {
  const student = await ensureStudentAccess(user, studentUserId);

  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: studentUserId, enrollment_status: 'active' },
    include: {
      course: true,
      teachingClass: true,
    },
  });

  const summary = await prisma.practiceSession.aggregate({
    _count: { practice_session_id: true },
    _sum: { correct_count: true, question_count: true, duration_seconds: true },
    where: { student_user_id: studentUserId, status: { not: 'in_progress' } },
  });

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
    where: { student_user_id: studentUserId, course_id: courseId, status: { not: 'in_progress' } },
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
    const tc = await prisma.teachingClass.findUnique({ where: { teaching_class_id } });
    if (tc) {
      enrollment = await prisma.studentCourseEnrollment.create({
        data: {
          student_user_id: result.user_id,
          course_id: tc.course_id,
          teaching_class_id,
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

module.exports = {
  listStudents,
  getStudent,
  getStudentMastery,
  markMastery,
  getStudentPortrait,
  refreshPortrait,
  createStudent,
};
