// 教师端课程管理服务

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

async function ensureCourseAccess(user, courseId) {
  if (user.role === 'admin') return;
  const accessibleIds = await getAccessibleCourseIds(user);
  if (!accessibleIds || !accessibleIds.includes(courseId)) {
    throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
  }
}

async function ensureTeachingClassAccess(user, classId) {
  const tc = await prisma.teachingClass.findUnique({
    where: { teaching_class_id: classId },
    include: { course: true },
  });
  if (!tc) throw Object.assign(new Error('教学班级不存在'), { code: 40002 });
  await ensureCourseAccess(user, tc.course_id);
  return tc;
}

// ---------- 课程 ----------

async function listCourses(user, query) {
  const accessibleIds = await getAccessibleCourseIds(user);
  const where = {};
  if (accessibleIds) where.course_id = { in: accessibleIds };

  const { keyword } = query;
  if (keyword) where.course_name = { contains: keyword };

  const courses = await prisma.course.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      teacher_relations: {
        include: {
          teacher: { include: { profile: true } },
        },
      },
      _count: {
        select: {
          teaching_classes: true,
          enrollments: true,
        },
      },
    },
  });

  return {
    list: courses.map((c) => ({
      course_id: c.course_id,
      course_name: c.course_name,
      course_code: c.course_code,
      subject_category: c.subject_category,
      description: c.description,
      cover_url: c.cover_url,
      status: toLower(c.status),
      teacher_list: c.teacher_relations.map((tr) => ({
        user_id: tr.teacher_user_id,
        real_name: tr.teacher?.profile?.real_name || tr.teacher?.username || null,
        teacher_role: toLower(tr.teacher_role),
      })),
      teaching_class_count: c._count.teaching_classes,
      student_count: c._count.enrollments,
      created_at: c.created_at.toISOString(),
    })),
    total: courses.length,
  };
}

async function createCourse(user, body) {
  const { course_name, course_code, subject_category, description, cover_url, status } = body;
  if (!course_name || !course_code) {
    throw Object.assign(new Error('课程名称和课程编码为必填项'), { code: 40001 });
  }

  const course = await prisma.course.create({
    data: {
      course_name,
      course_code,
      subject_category: subject_category || '计算机大类学科',
      description: description || null,
      cover_url: cover_url || null,
      status: status === 'archived' ? 'ARCHIVED' : 'ACTIVE',
    },
  });

  // 自动绑定创建者为教师
  await prisma.courseTeacherRelation.create({
    data: {
      course_id: course.course_id,
      teacher_user_id: user.user_id,
      teacher_role: 'MAIN_TEACHER',
    },
  });

  return {
    course_id: course.course_id,
    course_name: course.course_name,
  };
}

async function getCourse(user, courseId) {
  await ensureCourseAccess(user, courseId);

  const course = await prisma.course.findUnique({
    where: { course_id: courseId },
    include: {
      teacher_relations: {
        include: {
          teacher: { include: { profile: true } },
        },
      },
      teaching_classes: true,
      chapters: { orderBy: { chapter_order: 'asc' } },
      _count: { select: { enrollments: true, knowledge_points: true } },
    },
  });

  if (!course) throw Object.assign(new Error('课程不存在'), { code: 40002 });

  return {
    course_id: course.course_id,
    course_name: course.course_name,
    course_code: course.course_code,
    subject_category: course.subject_category,
    description: course.description,
    cover_url: course.cover_url,
    status: toLower(course.status),
    teacher_list: course.teacher_relations.map((tr) => ({
      user_id: tr.teacher_user_id,
      real_name: tr.teacher?.profile?.real_name || tr.teacher?.username || null,
      teacher_role: toLower(tr.teacher_role),
    })),
    teaching_classes: course.teaching_classes.map((tc) => ({
      teaching_class_id: tc.teaching_class_id,
      teaching_class_name: tc.teaching_class_name,
      semester: tc.semester,
      description: tc.description,
    })),
    chapters: course.chapters.map((ch) => ({
      chapter_id: ch.chapter_id,
      chapter_name: ch.chapter_name,
      chapter_order: ch.chapter_order,
      description: ch.description,
    })),
    student_count: course._count.enrollments,
    knowledge_point_count: course._count.knowledge_points,
    created_at: course.created_at.toISOString(),
  };
}

async function updateCourse(user, courseId, body) {
  await ensureCourseAccess(user, courseId);

  const { course_name, subject_category, description, cover_url, status } = body;
  const data = {};
  if (course_name !== undefined) data.course_name = course_name;
  if (subject_category !== undefined) data.subject_category = subject_category;
  if (description !== undefined) data.description = description;
  if (cover_url !== undefined) data.cover_url = cover_url;
  if (status !== undefined) data.status = status === 'archived' ? 'ARCHIVED' : 'ACTIVE';

  if (Object.keys(data).length === 0) {
    throw Object.assign(new Error('没有需要更新的字段'), { code: 40001 });
  }

  const course = await prisma.course.update({
    where: { course_id: courseId },
    data,
  });

  return { course_id: course.course_id, course_name: course.course_name };
}

async function deleteCourse(user, courseId) {
  await ensureCourseAccess(user, courseId);
  await prisma.course.delete({ where: { course_id: courseId } });
}

// ---------- 教学班级 ----------

async function listTeachingClasses(user, courseId, query) {
  await ensureCourseAccess(user, courseId);

  const where = { course_id: courseId };
  if (query.keyword) where.teaching_class_name = { contains: query.keyword };

  const classes = await prisma.teachingClass.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      _count: { select: { enrollments: true } },
    },
  });

  return {
    list: classes.map((tc) => ({
      teaching_class_id: tc.teaching_class_id,
      teaching_class_name: tc.teaching_class_name,
      semester: tc.semester,
      description: tc.description,
      student_count: tc._count.enrollments,
      created_at: tc.created_at.toISOString(),
    })),
    total: classes.length,
  };
}

async function createTeachingClass(user, courseId, body) {
  await ensureCourseAccess(user, courseId);

  const { teaching_class_name, semester, description } = body;
  if (!teaching_class_name) {
    throw Object.assign(new Error('教学班级名称为必填项'), { code: 40001 });
  }

  const tc = await prisma.teachingClass.create({
    data: {
      course_id: courseId,
      teaching_class_name,
      semester: semester || null,
      description: description || null,
    },
  });

  return {
    teaching_class_id: tc.teaching_class_id,
    teaching_class_name: tc.teaching_class_name,
  };
}

async function updateTeachingClass(user, classId, body) {
  const tc = await ensureTeachingClassAccess(user, classId);
  const { teaching_class_name, semester, description } = body;

  const data = {};
  if (teaching_class_name !== undefined) data.teaching_class_name = teaching_class_name;
  if (semester !== undefined) data.semester = semester;
  if (description !== undefined) data.description = description;

  if (Object.keys(data).length === 0) {
    throw Object.assign(new Error('没有需要更新的字段'), { code: 40001 });
  }

  const updated = await prisma.teachingClass.update({
    where: { teaching_class_id: classId },
    data,
  });

  return { teaching_class_id: updated.teaching_class_id, teaching_class_name: updated.teaching_class_name };
}

async function deleteTeachingClass(user, classId) {
  await ensureTeachingClassAccess(user, classId);
  await prisma.teachingClass.delete({ where: { teaching_class_id: classId } });
}

async function listClassStudents(user, classId, query) {
  const tc = await ensureTeachingClassAccess(user, classId);

  const where = {
    teaching_class_id: classId,
    enrollment_status: 'active',
  };

  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where,
    include: {
      student: {
        include: { profile: true },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return {
    list: enrollments.map((e) => ({
      student_user_id: e.student_user_id,
      student_name: e.student?.profile?.real_name || e.student?.username || null,
      student_no: e.student?.profile?.student_no || null,
      college: e.student?.profile?.college || null,
      major: e.student?.profile?.major || null,
      enrollment_status: e.enrollment_status,
      enrolled_at: e.created_at.toISOString(),
    })),
    total: enrollments.length,
    class: {
      teaching_class_id: tc.teaching_class_id,
      teaching_class_name: tc.teaching_class_name,
      course_id: tc.course_id,
    },
  };
}

async function addClassStudents(user, classId, body) {
  const tc = await ensureTeachingClassAccess(user, classId);
  const { student_user_ids } = body;
  if (!student_user_ids || !Array.isArray(student_user_ids) || student_user_ids.length === 0) {
    throw Object.assign(new Error('student_user_ids 为必填项，需传入学生 ID 数组'), { code: 40001 });
  }

  const results = [];
  for (const studentUserId of student_user_ids) {
    try {
      await prisma.studentCourseEnrollment.create({
        data: {
          student_user_id: studentUserId,
          course_id: tc.course_id,
          teaching_class_id: classId,
          enrollment_status: 'active',
        },
      });
      results.push({ student_user_id: studentUserId, success: true });
    } catch (err) {
      results.push({ student_user_id: studentUserId, success: false, reason: err.message });
    }
  }

  return { results };
}

async function removeClassStudent(user, classId, studentUserId) {
  const tc = await ensureTeachingClassAccess(user, classId);
  const enrollment = await prisma.studentCourseEnrollment.findUnique({
    where: {
      student_user_id_course_id_teaching_class_id: {
        student_user_id: studentUserId,
        course_id: tc.course_id,
        teaching_class_id: classId,
      },
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('该学生不在本班级中'), { code: 40002 });
  }
  await prisma.studentCourseEnrollment.delete({
    where: { enrollment_id: enrollment.enrollment_id },
  });
}

// ---------- 章节 ----------

async function listChapters(user, courseId) {
  await ensureCourseAccess(user, courseId);

  const chapters = await prisma.chapter.findMany({
    where: { course_id: courseId },
    orderBy: { chapter_order: 'asc' },
    include: {
      _count: { select: { knowledge_points: true } },
    },
  });

  return {
    list: chapters.map((ch) => ({
      chapter_id: ch.chapter_id,
      chapter_name: ch.chapter_name,
      chapter_order: ch.chapter_order,
      description: ch.description,
      knowledge_point_count: ch._count.knowledge_points,
      created_at: ch.created_at.toISOString(),
    })),
    total: chapters.length,
  };
}

async function createChapter(user, courseId, body) {
  await ensureCourseAccess(user, courseId);

  const { chapter_name, chapter_order, description } = body;
  if (!chapter_name) {
    throw Object.assign(new Error('章节名称为必填项'), { code: 40001 });
  }

  const chapter = await prisma.chapter.create({
    data: {
      course_id: courseId,
      chapter_name,
      chapter_order: chapter_order ?? 0,
      description: description || null,
    },
  });

  return {
    chapter_id: chapter.chapter_id,
    chapter_name: chapter.chapter_name,
    chapter_order: chapter.chapter_order,
  };
}

async function updateChapter(user, chapterId, body) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) throw Object.assign(new Error('章节不存在'), { code: 40002 });
  await ensureCourseAccess(user, chapter.course_id);

  const { chapter_name, chapter_order, description } = body;
  const data = {};
  if (chapter_name !== undefined) data.chapter_name = chapter_name;
  if (chapter_order !== undefined) data.chapter_order = chapter_order;
  if (description !== undefined) data.description = description;

  const updated = await prisma.chapter.update({
    where: { chapter_id: chapterId },
    data,
  });

  return { chapter_id: updated.chapter_id, chapter_name: updated.chapter_name };
}

async function deleteChapter(user, chapterId) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) throw Object.assign(new Error('章节不存在'), { code: 40002 });
  await ensureCourseAccess(user, chapter.course_id);
  await prisma.chapter.delete({ where: { chapter_id: chapterId } });
}

// ---------- 知识点 ----------

async function listKnowledgePoints(user, courseId, query) {
  await ensureCourseAccess(user, courseId);

  const where = { course_id: courseId };
  if (query.chapter_id) {
    where.chapter_id = Number.parseInt(query.chapter_id, 10) || undefined;
  }

  const kps = await prisma.knowledgePoint.findMany({
    where,
    orderBy: [{ sort_order: 'asc' }, { knowledge_point_id: 'asc' }],
    include: {
      chapter: { select: { chapter_id: true, chapter_name: true } },
      _count: { select: { questions: true } },
    },
  });

  return {
    list: kps.map((kp) => ({
      knowledge_point_id: kp.knowledge_point_id,
      knowledge_point_name: kp.knowledge_point_name,
      knowledge_point_code: kp.knowledge_point_code,
      chapter_id: kp.chapter_id,
      chapter_name: kp.chapter?.chapter_name || null,
      difficulty_level: toLower(kp.difficulty_level),
      description: kp.description,
      question_count: kp._count.questions,
      sort_order: kp.sort_order,
    })),
    total: kps.length,
  };
}

async function createKnowledgePoint(user, chapterId, body) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) throw Object.assign(new Error('章节不存在'), { code: 40002 });
  await ensureCourseAccess(user, chapter.course_id);

  const { knowledge_point_name, knowledge_point_code, description, difficulty_level, sort_order, parent_id } = body;
  if (!knowledge_point_name || !knowledge_point_code) {
    throw Object.assign(new Error('知识点名称和编码为必填项'), { code: 40001 });
  }

  const kp = await prisma.knowledgePoint.create({
    data: {
      course_id: chapter.course_id,
      chapter_id: chapterId,
      knowledge_point_name,
      knowledge_point_code,
      description: description || null,
      difficulty_level: difficulty_level ? difficulty_level.toUpperCase() : 'BASIC',
      parent_id: parent_id || null,
      sort_order: sort_order ?? 0,
    },
  });

  return {
    knowledge_point_id: kp.knowledge_point_id,
    knowledge_point_name: kp.knowledge_point_name,
    knowledge_point_code: kp.knowledge_point_code,
  };
}

async function updateKnowledgePoint(user, kpId, body) {
  const kp = await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: kpId } });
  if (!kp) throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  await ensureCourseAccess(user, kp.course_id);

  const { knowledge_point_name, description, difficulty_level, sort_order } = body;
  const data = {};
  if (knowledge_point_name !== undefined) data.knowledge_point_name = knowledge_point_name;
  if (description !== undefined) data.description = description;
  if (difficulty_level !== undefined) data.difficulty_level = difficulty_level.toUpperCase();
  if (sort_order !== undefined) data.sort_order = sort_order;

  const updated = await prisma.knowledgePoint.update({
    where: { knowledge_point_id: kpId },
    data,
  });

  return { knowledge_point_id: updated.knowledge_point_id, knowledge_point_name: updated.knowledge_point_name };
}

async function deleteKnowledgePoint(user, kpId) {
  const kp = await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: kpId } });
  if (!kp) throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  await ensureCourseAccess(user, kp.course_id);
  await prisma.knowledgePoint.delete({ where: { knowledge_point_id: kpId } });
}

module.exports = {
  listCourses,
  createCourse,
  getCourse,
  updateCourse,
  deleteCourse,
  listTeachingClasses,
  createTeachingClass,
  updateTeachingClass,
  deleteTeachingClass,
  listClassStudents,
  addClassStudents,
  removeClassStudent,
  listChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  listKnowledgePoints,
  createKnowledgePoint,
  updateKnowledgePoint,
  deleteKnowledgePoint,
};
