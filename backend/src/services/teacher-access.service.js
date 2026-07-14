const prisma = require('../config/prisma');

function forbidden(message = '无权访问该资源') {
  return Object.assign(new Error(message), { code: 40301 });
}

function notFound(message) {
  return Object.assign(new Error(message), { code: 40002 });
}

function toId(value, field = 'id') {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw Object.assign(new Error(`${field} 参数不合法`), { code: 40001 });
  }
  return parsed;
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function teacherClassScope(user) {
  if (isAdmin(user)) return {};
  return {
    OR: [
      { teacher_user_id: user.user_id },
      {
        teacher_authorizations: {
          some: { teacher_user_id: user.user_id, status: 'active' },
        },
      },
      // 兼容迁移前没有班级负责人记录的数据。迁移会回填负责人，新建数据不依赖此分支。
      {
        teacher_user_id: null,
        teacher_authorizations: { none: {} },
        course: {
          teacher_relations: { some: { teacher_user_id: user.user_id } },
        },
      },
    ],
  };
}

async function getAccessibleCourseIds(user) {
  if (isAdmin(user)) return null;
  const [courseRelations, classRows] = await Promise.all([
    prisma.courseTeacherRelation.findMany({
      where: { teacher_user_id: user.user_id },
      select: { course_id: true },
    }),
    prisma.teachingClass.findMany({
      where: teacherClassScope(user),
      select: { course_id: true },
    }),
  ]);
  return [...new Set([
    ...courseRelations.map((item) => item.course_id),
    ...classRows.map((item) => item.course_id),
  ])];
}

async function ensureCourseAccess(user, courseId) {
  const id = toId(courseId, 'course_id');
  if (isAdmin(user)) return id;
  const relation = await prisma.courseTeacherRelation.findFirst({
    where: { course_id: id, teacher_user_id: user.user_id },
    select: { relation_id: true },
  });
  if (!relation) throw forbidden('无权访问该课程数据');
  return id;
}

async function getAccessibleTeachingClassIds(user, extraWhere = {}) {
  if (isAdmin(user)) {
    const rows = await prisma.teachingClass.findMany({ where: extraWhere, select: { teaching_class_id: true } });
    return rows.map((item) => item.teaching_class_id);
  }
  const rows = await prisma.teachingClass.findMany({
    where: { AND: [teacherClassScope(user), extraWhere] },
    select: { teaching_class_id: true },
  });
  return rows.map((item) => item.teaching_class_id);
}

async function ensureTeachingClassAccess(user, classId, options = {}) {
  const id = toId(classId, 'teaching_class_id');
  const teachingClass = await prisma.teachingClass.findFirst({
    where: {
      teaching_class_id: id,
      ...(isAdmin(user) ? {} : teacherClassScope(user)),
    },
    include: {
      course: true,
      course_offering: { include: { semester: true } },
      primary_teacher: { include: { profile: true } },
      teacher_authorizations: true,
      ...(options.include || {}),
    },
  });
  if (!teachingClass) {
    const exists = await prisma.teachingClass.findUnique({ where: { teaching_class_id: id }, select: { teaching_class_id: true } });
    if (!exists) throw notFound('教学班不存在');
    throw forbidden('无权访问该教学班数据');
  }
  return teachingClass;
}

async function ensureStudentAccess(user, studentUserId, filters = {}) {
  const studentId = toId(studentUserId, 'student_user_id');
  const student = await prisma.user.findUnique({
    where: { user_id: studentId },
    include: { profile: { include: { admin_class: true } } },
  });
  if (!student || student.role !== 'STUDENT') throw notFound('学生不存在');
  if (isAdmin(user)) return student;

  const classIds = await getAccessibleTeachingClassIds(user, filters.course_id ? { course_id: toId(filters.course_id, 'course_id') } : {});
  if (!classIds.length) throw forbidden('无权访问该学生数据');
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: studentId,
      teaching_class_id: { in: classIds },
      enrollment_status: 'active',
      ...(filters.teaching_class_id ? { teaching_class_id: toId(filters.teaching_class_id, 'teaching_class_id') } : {}),
      ...(filters.course_id ? { course_id: toId(filters.course_id, 'course_id') } : {}),
    },
    select: { enrollment_id: true },
  });
  if (!enrollment) throw forbidden('无权访问该学生数据');
  return student;
}

async function ensureDocumentAccess(user, documentId, options = {}) {
  const id = toId(documentId, 'document_id');
  const document = await prisma.knowledgeDocument.findUnique({
    where: { document_id: id },
    include: { knowledge_base: true, course: true, teaching_class: true, lesson_plan: true },
  });
  if (!document || document.deleted_at) throw notFound('文件不存在');
  if (isAdmin(user) || document.owner_user_id === user.user_id) return document;
  if (document.teaching_class_id) {
    await ensureTeachingClassAccess(user, document.teaching_class_id);
    return document;
  }
  if (document.course_id) {
    await ensureCourseAccess(user, document.course_id);
    return document;
  }
  if (options.allowReview && document.review_status === 'PENDING') {
    try {
      await ensureStudentAccess(user, document.owner_user_id);
      return document;
    } catch {
      // 继续按无权限处理，不能因为“待审核”向所有教师暴露文件。
    }
  }
  throw forbidden('无权访问该文件');
}

async function ensureStudentInTeachingClass(studentUserId, teachingClassId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: toId(studentUserId, 'student_user_id'),
      teaching_class_id: toId(teachingClassId, 'teaching_class_id'),
      enrollment_status: 'active',
    },
  });
  if (!enrollment) throw forbidden('未加入该教学班或任务不可访问');
  return enrollment;
}

module.exports = {
  forbidden,
  isAdmin,
  toId,
  teacherClassScope,
  getAccessibleCourseIds,
  getAccessibleTeachingClassIds,
  ensureCourseAccess,
  ensureTeachingClassAccess,
  ensureStudentAccess,
  ensureDocumentAccess,
  ensureStudentInTeachingClass,
};
