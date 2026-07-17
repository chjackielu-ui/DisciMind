// 管理员端班级管理服务
// 行政班（学生归属）与教学班（课程选课）保持独立语义，所有写操作均带事务审计。

const prisma = require('../config/prisma');
const { buildAdminOperationData } = require('./admin-audit.service');

function publicError(message, code = 40001) {
  return Object.assign(new Error(message), { code });
}

function parseId(value, label = 'ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw publicError(`${label} 不合法`);
  return id;
}

function text(value, { max = 255, required = false, label = '字段' } = {}) {
  if (value == null) {
    if (required) throw publicError(`${label}不能为空`);
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (required) throw publicError(`${label}不能为空`);
    return null;
  }
  if (normalized.length > max) throw publicError(`${label}不能超过 ${max} 个字符`);
  return normalized;
}

function uniqueIds(values, label = 'ID') {
  const ids = [...new Set((values || []).map(Number))];
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    throw publicError(`${label}列表不合法`);
  }
  return ids;
}

function positiveIntegerOrNull(value, label) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw publicError(`${label}必须是正整数`);
  return parsed;
}

function translatePrismaError(error) {
  if (error?.code === 'P2002') return publicError('同一范围内已存在相同名称或编码', 40003);
  if (error?.code === 'P2003') return publicError('该记录仍被其他业务数据引用，不能直接删除', 40901);
  return error;
}

function formatAdminClass(item) {
  return {
    admin_class_id: item.admin_class_id,
    class_name: item.class_name,
    college_id: item.college_id,
    major_id: item.major_id,
    college: item.college,
    major: item.major,
    grade: item.grade,
    advisor_user_id: item.advisor_user_id,
    advisor_name: item.advisor?.profile?.real_name || item.advisor?.username || null,
    status: item.status,
    student_count: item._count?.students || 0,
    teaching_class_count: item._count?.teaching_class_links || 0,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

const adminClassInclude = {
  advisor: { select: { username: true, profile: { select: { real_name: true } } } },
  _count: { select: { students: true, teaching_class_links: true } },
};

async function getAdminClassList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const where = {};
  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { class_name: { contains: keyword } },
      { college: { contains: keyword } },
      { major: { contains: keyword } },
    ];
  }
  if (query.college) where.college = { contains: String(query.college).trim() };
  if (query.grade) where.grade = String(query.grade).trim();
  if (query.status) where.status = String(query.status).trim();
  const [list, total] = await Promise.all([
    prisma.adminClass.findMany({
      where,
      include: adminClassInclude,
      orderBy: [{ grade: 'desc' }, { class_name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.adminClass.count({ where }),
  ]);
  return {
    list: list.map(formatAdminClass),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function validateAdvisor(tx, advisorUserId) {
  if (advisorUserId == null) return null;
  const id = parseId(advisorUserId, '辅导员用户 ID');
  const advisor = await tx.user.findFirst({
    where: { user_id: id, role: { in: ['TEACHER', 'ADMIN'] }, status: 'ACTIVE' },
    select: { user_id: true },
  });
  if (!advisor) throw publicError('辅导员必须是正常状态的教师或管理员', 40002);
  return id;
}

async function createAdminClass(data, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const payload = {
        class_name: text(data.class_name, { max: 100, required: true, label: '班级名称' }),
        college: text(data.college, { max: 100 }),
        major: text(data.major, { max: 100 }),
        grade: text(data.grade, { max: 20 }),
        advisor_user_id: await validateAdvisor(tx, data.advisor_user_id),
        status: 'active',
      };
      const created = await tx.adminClass.create({ data: payload, include: adminClassInclude });
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'CREATE_ADMIN_CLASS',
          targetType: 'admin_class',
          targetId: created.admin_class_id,
          after: formatAdminClass(created),
        }),
      });
      return formatAdminClass(created);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function updateAdminClass(classId, data, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.adminClass.findUnique({
        where: { admin_class_id: classId },
        include: adminClassInclude,
      });
      if (!current) throw publicError('行政班级不存在', 40002);
      const updateData = {};
      if (data.class_name !== undefined) updateData.class_name = text(data.class_name, { max: 100, required: true, label: '班级名称' });
      if (data.college !== undefined) updateData.college = text(data.college, { max: 100 });
      if (data.major !== undefined) updateData.major = text(data.major, { max: 100 });
      if (data.grade !== undefined) updateData.grade = text(data.grade, { max: 20 });
      if (data.advisor_user_id !== undefined) updateData.advisor_user_id = await validateAdvisor(tx, data.advisor_user_id);
      if (data.status !== undefined) {
        if (!['active', 'archived', 'disabled'].includes(data.status)) throw publicError('班级状态不合法');
        updateData.status = data.status;
      }
      const updated = await tx.adminClass.update({
        where: { admin_class_id: classId },
        data: updateData,
        include: adminClassInclude,
      });
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'UPDATE_ADMIN_CLASS',
          targetType: 'admin_class',
          targetId: classId,
          before: formatAdminClass(current),
          after: formatAdminClass(updated),
        }),
      });
      return formatAdminClass(updated);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function deleteAdminClass(classId, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.adminClass.findUnique({
        where: { admin_class_id: classId },
        include: adminClassInclude,
      });
      if (!current) throw publicError('行政班级不存在', 40002);
      if (current._count.students > 0) {
        throw publicError(`该班级下有 ${current._count.students} 名学生，请先完成转班或移出`, 40901);
      }
      if (current._count.teaching_class_links > 0) {
        throw publicError(`该班级关联 ${current._count.teaching_class_links} 个教学班，请先解除关联`, 40901);
      }
      await tx.adminClass.delete({ where: { admin_class_id: classId } });
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'DELETE_ADMIN_CLASS',
          targetType: 'admin_class',
          targetId: classId,
          before: formatAdminClass(current),
        }),
      });
      return { admin_class_id: classId, deletion_mode: 'hard' };
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function getAdminClassStudentList(classId, query = {}) {
  const targetId = parseId(classId, '行政班级 ID');
  const exists = await prisma.adminClass.findUnique({ where: { admin_class_id: targetId }, select: { admin_class_id: true } });
  if (!exists) throw publicError('行政班级不存在', 40002);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const where = {
    role: 'STUDENT',
    profile: { is: { admin_class_id: targetId } },
  };
  if (query.status && ['active', 'disabled'].includes(String(query.status))) {
    where.status = String(query.status).toUpperCase();
  }
  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { username: { contains: keyword } },
      { profile: { is: { admin_class_id: targetId, real_name: { contains: keyword } } } },
      { profile: { is: { admin_class_id: targetId, student_no: { contains: keyword } } } },
    ];
  }
  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { profile: true },
      orderBy: { user_id: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return {
    list: students.map((student) => ({
      student_user_id: student.user_id,
      username: student.username,
      real_name: student.profile?.real_name || null,
      student_no: student.profile?.student_no || null,
      status: String(student.status).toLowerCase(),
      joined_at: student.profile?.updated_at || student.created_at,
    })),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function addAdminClassStudents(classId, studentUserIds, req) {
  const targetId = parseId(classId, '行政班级 ID');
  const ids = uniqueIds(studentUserIds, '学生用户 ID');
  return prisma.$transaction(async (tx) => {
    const [adminClass, students] = await Promise.all([
      tx.adminClass.findFirst({
        where: { admin_class_id: targetId, status: 'active' },
        select: { admin_class_id: true, class_name: true },
      }),
      tx.user.findMany({
        where: { user_id: { in: ids }, role: 'STUDENT', status: 'ACTIVE' },
        include: { profile: true },
      }),
    ]);
    if (!adminClass) throw publicError('行政班级不存在或已停用', 40002);
    if (students.length !== ids.length) throw publicError('包含不存在、已禁用或非学生账号', 40002);
    const before = students.map((item) => ({ student_user_id: item.user_id, admin_class_id: item.profile?.admin_class_id || null }));
    for (const student of students) {
      await tx.userProfile.upsert({
        where: { user_id: student.user_id },
        update: { admin_class_id: targetId },
        create: { user_id: student.user_id, real_name: student.username, admin_class_id: targetId },
      });
    }
    await tx.operationLog.create({
      data: buildAdminOperationData({
        req,
        operationType: 'ADD_ADMIN_CLASS_STUDENTS',
        targetType: 'admin_class',
        targetId,
        before,
        after: { class_name: adminClass.class_name, student_user_ids: ids },
      }),
    });
    return { admin_class_id: targetId, student_user_ids: ids, affected_count: ids.length };
  });
}

async function removeAdminClassStudent(classId, studentUserId, req) {
  const targetId = parseId(classId, '行政班级 ID');
  const userId = parseId(studentUserId, '学生用户 ID');
  return prisma.$transaction(async (tx) => {
    const profile = await tx.userProfile.findFirst({
      where: { user_id: userId, admin_class_id: targetId, user: { role: 'STUDENT' } },
      include: { user: { select: { username: true } } },
    });
    if (!profile) throw publicError('该学生不在此行政班中', 40002);
    await tx.userProfile.update({ where: { user_id: userId }, data: { admin_class_id: null } });
    await tx.operationLog.create({
      data: buildAdminOperationData({
        req,
        operationType: 'REMOVE_ADMIN_CLASS_STUDENT',
        targetType: 'admin_class',
        targetId,
        before: { student_user_id: userId, username: profile.user.username, admin_class_id: targetId },
        after: { student_user_id: userId, admin_class_id: null },
      }),
    });
    return { admin_class_id: targetId, student_user_id: userId };
  });
}

const teachingClassInclude = {
  course: { select: { course_id: true, course_name: true, course_code: true } },
  primary_teacher: { select: { user_id: true, username: true, profile: { select: { real_name: true } } } },
  admin_class_links: {
    include: { admin_class: { select: { admin_class_id: true, class_name: true, grade: true } } },
  },
  _count: {
    select: {
      enrollments: { where: { enrollment_status: 'active' } },
      knowledge_bases: true,
      knowledge_documents: true,
      learning_tasks: true,
    },
  },
};

function formatTeachingClass(item) {
  return {
    teaching_class_id: item.teaching_class_id,
    course_id: item.course_id,
    course_name: item.course?.course_name || null,
    course_code: item.course?.course_code || null,
    course_offering_id: item.course_offering_id,
    teacher_user_id: item.teacher_user_id,
    teacher_name: item.primary_teacher?.profile?.real_name || item.primary_teacher?.username || null,
    teaching_class_name: item.teaching_class_name,
    code: item.code,
    semester: item.semester,
    description: item.description,
    schedule: item.schedule,
    location: item.location,
    capacity: item.capacity,
    status: item.status,
    archived_at: item.archived_at,
    student_count: item._count?.enrollments || 0,
    admin_classes: (item.admin_class_links || []).map((link) => link.admin_class),
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

async function validateTeacher(tx, teacherUserId) {
  if (teacherUserId == null) return null;
  const id = parseId(teacherUserId, '教师用户 ID');
  const teacher = await tx.user.findFirst({
    where: { user_id: id, role: { in: ['TEACHER', 'ADMIN'] }, status: 'ACTIVE' },
    select: { user_id: true },
  });
  if (!teacher) throw publicError('主讲教师必须是正常状态的教师或管理员', 40002);
  return id;
}

async function validateAdminClassIds(tx, values) {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw publicError('行政班级 ID 必须是数组');
  if (!values.length) return [];
  const ids = uniqueIds(values, '行政班级 ID');
  const count = await tx.adminClass.count({ where: { admin_class_id: { in: ids }, status: 'active' } });
  if (count !== ids.length) throw publicError('包含不存在或已停用的行政班级', 40002);
  return ids;
}

async function getTeachingClassList(courseId, query = {}) {
  const targetCourseId = parseId(courseId, '课程 ID');
  const where = { course_id: targetCourseId };
  if (query.status) where.status = String(query.status);
  const list = await prisma.teachingClass.findMany({
    where,
    include: teachingClassInclude,
    orderBy: { created_at: 'asc' },
  });
  return list.map(formatTeachingClass);
}

async function getTeachingClassPage(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const where = {};
  if (query.course_id) where.course_id = parseId(query.course_id, '课程 ID');
  if (query.teacher_user_id) where.teacher_user_id = parseId(query.teacher_user_id, '教师用户 ID');
  if (query.status) where.status = String(query.status);
  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { teaching_class_name: { contains: keyword } },
      { code: { contains: keyword } },
      { semester: { contains: keyword } },
      { course: { course_name: { contains: keyword } } },
    ];
  }
  const [list, total] = await Promise.all([
    prisma.teachingClass.findMany({
      where,
      include: teachingClassInclude,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.teachingClass.count({ where }),
  ]);
  return {
    list: list.map(formatTeachingClass),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function createTeachingClass(courseId, data, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const targetCourseId = parseId(courseId, '课程 ID');
      const course = await tx.course.findUnique({ where: { course_id: targetCourseId }, select: { course_id: true, status: true } });
      if (!course || course.status !== 'ACTIVE') throw publicError('课程不存在或已归档', 40002);
      const adminClassIds = await validateAdminClassIds(tx, data.admin_class_ids);
      const created = await tx.teachingClass.create({
        data: {
          course_id: targetCourseId,
          teaching_class_name: text(data.teaching_class_name, { max: 100, required: true, label: '教学班名称' }),
          code: text(data.code, { max: 80 }),
          semester: text(data.semester, { max: 50 }),
          description: text(data.description, { max: 5000 }),
          teacher_user_id: await validateTeacher(tx, data.teacher_user_id),
          location: text(data.location, { max: 200 }),
          capacity: positiveIntegerOrNull(data.capacity, '教学班容量'),
          status: 'active',
        },
      });
      if (adminClassIds?.length) {
        await tx.teachingClassAdminClass.createMany({
          data: adminClassIds.map((adminClassId) => ({
            teaching_class_id: created.teaching_class_id,
            admin_class_id: adminClassId,
          })),
        });
      }
      const result = await tx.teachingClass.findUnique({
        where: { teaching_class_id: created.teaching_class_id },
        include: teachingClassInclude,
      });
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'CREATE_TEACHING_CLASS',
          targetType: 'teaching_class',
          targetId: created.teaching_class_id,
          after: formatTeachingClass(result),
        }),
      });
      return formatTeachingClass(result);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function updateTeachingClass(classId, data, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.teachingClass.findUnique({
        where: { teaching_class_id: classId },
        include: teachingClassInclude,
      });
      if (!current) throw publicError('教学班级不存在', 40002);
      const updateData = {};
      if (data.teaching_class_name !== undefined) updateData.teaching_class_name = text(data.teaching_class_name, { max: 100, required: true, label: '教学班名称' });
      if (data.code !== undefined) updateData.code = text(data.code, { max: 80 });
      if (data.semester !== undefined) updateData.semester = text(data.semester, { max: 50 });
      if (data.description !== undefined) updateData.description = text(data.description, { max: 5000 });
      if (data.teacher_user_id !== undefined) updateData.teacher_user_id = await validateTeacher(tx, data.teacher_user_id);
      if (data.location !== undefined) updateData.location = text(data.location, { max: 200 });
      if (data.capacity !== undefined) updateData.capacity = positiveIntegerOrNull(data.capacity, '教学班容量');
      if (data.status !== undefined) {
        if (!['active', 'archived', 'disabled'].includes(data.status)) throw publicError('教学班状态不合法');
        updateData.status = data.status;
        updateData.archived_at = data.status === 'archived' ? new Date() : null;
      }
      const adminClassIds = await validateAdminClassIds(tx, data.admin_class_ids);
      await tx.teachingClass.update({ where: { teaching_class_id: classId }, data: updateData });
      if (adminClassIds !== undefined) {
        await tx.teachingClassAdminClass.deleteMany({ where: { teaching_class_id: classId } });
        if (adminClassIds.length) {
          await tx.teachingClassAdminClass.createMany({
            data: adminClassIds.map((adminClassId) => ({
              teaching_class_id: classId,
              admin_class_id: adminClassId,
            })),
          });
        }
      }
      const updated = await tx.teachingClass.findUnique({
        where: { teaching_class_id: classId },
        include: teachingClassInclude,
      });
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'UPDATE_TEACHING_CLASS',
          targetType: 'teaching_class',
          targetId: classId,
          before: formatTeachingClass(current),
          after: formatTeachingClass(updated),
        }),
      });
      return formatTeachingClass(updated);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function deleteTeachingClass(classId, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.teachingClass.findUnique({
        where: { teaching_class_id: classId },
        include: teachingClassInclude,
      });
      if (!current) throw publicError('教学班级不存在', 40002);
      const enrollmentHistoryCount = await tx.studentCourseEnrollment.count({
        where: { teaching_class_id: classId },
      });
      const dependentCount = enrollmentHistoryCount
        + (current._count.knowledge_bases || 0)
        + (current._count.knowledge_documents || 0)
        + (current._count.learning_tasks || 0);
      let deletionMode = 'hard';
      let after = null;
      if (dependentCount > 0) {
        deletionMode = 'soft';
        const archived = await tx.teachingClass.update({
          where: { teaching_class_id: classId },
          data: { status: 'archived', archived_at: new Date() },
          include: teachingClassInclude,
        });
        after = formatTeachingClass(archived);
      } else {
        await tx.teachingClass.delete({ where: { teaching_class_id: classId } });
      }
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: deletionMode === 'soft' ? 'ARCHIVE_TEACHING_CLASS' : 'DELETE_TEACHING_CLASS',
          targetType: 'teaching_class',
          targetId: classId,
          before: formatTeachingClass(current),
          after,
        }),
      });
      return { teaching_class_id: classId, deletion_mode: deletionMode, dependent_count: dependentCount };
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function getClassStudentList(classId, query = {}) {
  const targetId = parseId(classId, '教学班级 ID');
  const exists = await prisma.teachingClass.findUnique({ where: { teaching_class_id: targetId }, select: { teaching_class_id: true } });
  if (!exists) throw publicError('教学班级不存在', 40002);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const where = { teaching_class_id: targetId, enrollment_status: 'active' };
  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.student = {
      OR: [
        { username: { contains: keyword } },
        { profile: { is: { real_name: { contains: keyword } } } },
        { profile: { is: { student_no: { contains: keyword } } } },
      ],
    };
  }
  const [enrollments, total] = await Promise.all([
    prisma.studentCourseEnrollment.findMany({
      where,
      include: { student: { include: { profile: true } } },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.studentCourseEnrollment.count({ where }),
  ]);
  return {
    list: enrollments.map((item) => ({
      enrollment_id: item.enrollment_id,
      student_user_id: item.student_user_id,
      username: item.student.username,
      real_name: item.student.profile?.real_name || null,
      student_no: item.student.profile?.student_no || null,
      enrollment_status: item.enrollment_status,
      joined_at: item.joined_at,
    })),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function addClassStudents(classId, studentUserIds, req) {
  const targetId = parseId(classId, '教学班级 ID');
  const ids = uniqueIds(studentUserIds, '学生用户 ID');
  return prisma.$transaction(async (tx) => {
    const teachingClass = await tx.teachingClass.findFirst({
      where: { teaching_class_id: targetId, status: 'active' },
      select: { teaching_class_id: true, course_id: true, capacity: true },
    });
    if (!teachingClass) throw publicError('教学班级不存在或已归档', 40002);
    const students = await tx.user.findMany({
      where: { user_id: { in: ids }, role: 'STUDENT', status: 'ACTIVE' },
      select: { user_id: true },
    });
    if (students.length !== ids.length) throw publicError('包含不存在、已禁用或非学生账号', 40002);
    const activeCount = await tx.studentCourseEnrollment.count({
      where: { teaching_class_id: targetId, enrollment_status: 'active', student_user_id: { notIn: ids } },
    });
    if (teachingClass.capacity && activeCount + ids.length > teachingClass.capacity) {
      throw publicError(`教学班容量为 ${teachingClass.capacity}，无法加入这些学生`, 40901);
    }
    const before = await tx.studentCourseEnrollment.findMany({
      where: { student_user_id: { in: ids }, course_id: teachingClass.course_id },
      select: { enrollment_id: true, student_user_id: true, teaching_class_id: true, enrollment_status: true },
    });
    for (const userId of ids) {
      const current = before.find((item) => item.student_user_id === userId && item.enrollment_status === 'active')
        || before.find((item) => item.student_user_id === userId);
      if (current) {
        await tx.studentCourseEnrollment.update({
          where: { enrollment_id: current.enrollment_id },
          data: { teaching_class_id: targetId, enrollment_status: 'active', joined_at: new Date() },
        });
        const duplicates = before.filter((item) => item.student_user_id === userId && item.enrollment_id !== current.enrollment_id);
        if (duplicates.length) {
          await tx.studentCourseEnrollment.updateMany({
            where: { enrollment_id: { in: duplicates.map((item) => item.enrollment_id) } },
            data: { enrollment_status: 'dropped' },
          });
        }
      } else {
        await tx.studentCourseEnrollment.create({
          data: {
            student_user_id: userId,
            course_id: teachingClass.course_id,
            teaching_class_id: targetId,
            enrollment_status: 'active',
          },
        });
      }
    }
    await tx.operationLog.create({
      data: buildAdminOperationData({
        req,
        operationType: 'ADD_TEACHING_CLASS_STUDENTS',
        targetType: 'teaching_class',
        targetId,
        before,
        after: { student_user_ids: ids, course_id: teachingClass.course_id },
      }),
    });
    return { teaching_class_id: targetId, student_user_ids: ids, affected_count: ids.length };
  });
}

async function removeClassStudent(classId, studentUserId, req) {
  const targetId = parseId(classId, '教学班级 ID');
  const userId = parseId(studentUserId, '学生用户 ID');
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.studentCourseEnrollment.findFirst({
      where: { student_user_id: userId, teaching_class_id: targetId, enrollment_status: 'active' },
    });
    if (!enrollment) throw publicError('该学生不在该教学班中', 40002);
    await tx.studentCourseEnrollment.update({
      where: { enrollment_id: enrollment.enrollment_id },
      data: { enrollment_status: 'dropped' },
    });
    await tx.operationLog.create({
      data: buildAdminOperationData({
        req,
        operationType: 'REMOVE_TEACHING_CLASS_STUDENT',
        targetType: 'teaching_class',
        targetId,
        before: {
          enrollment_id: enrollment.enrollment_id,
          student_user_id: userId,
          enrollment_status: enrollment.enrollment_status,
        },
        after: { student_user_id: userId, enrollment_status: 'dropped' },
      }),
    });
    return { teaching_class_id: targetId, student_user_id: userId, enrollment_status: 'dropped' };
  });
}

module.exports = {
  getAdminClassList,
  createAdminClass,
  updateAdminClass,
  deleteAdminClass,
  getAdminClassStudentList,
  addAdminClassStudents,
  removeAdminClassStudent,
  getTeachingClassList,
  getTeachingClassPage,
  createTeachingClass,
  updateTeachingClass,
  deleteTeachingClass,
  getClassStudentList,
  addClassStudents,
  removeClassStudent,
};
