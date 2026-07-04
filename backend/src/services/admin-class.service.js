// 管理员端班级管理服务
// 提供行政班级和教学班级的 CRUD 管理

const prisma = require('../config/prisma');

// ======================== 行政班级 ========================

/**
 * 获取行政班级列表
 */
async function getAdminClassList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = {};

  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.class_name = { contains: keyword };
  }
  if (query.college) {
    where.college = { contains: String(query.college) };
  }
  if (query.grade) {
    where.grade = String(query.grade);
  }

  const [adminClasses, total] = await Promise.all([
    prisma.adminClass.findMany({
      where,
      orderBy: [{ grade: 'desc' }, { class_name: 'asc' }],
      skip,
      take: pageSize,
    }),
    prisma.adminClass.count({ where }),
  ]);

  const list = await Promise.all(adminClasses.map(async (ac) => {
    const studentCount = await prisma.userProfile.count({
      where: { admin_class_id: ac.admin_class_id },
    });
    return {
      admin_class_id: ac.admin_class_id,
      class_name: ac.class_name,
      college: ac.college,
      major: ac.major,
      grade: ac.grade,
      student_count: studentCount,
      created_at: ac.created_at,
    };
  }));

  return { list, total, page, page_size: pageSize };
}

/**
 * 创建行政班级
 */
async function createAdminClass(data) {
  const existing = await prisma.adminClass.findUnique({
    where: { class_name_grade: { class_name: data.class_name, grade: data.grade || '' } },
  });
  if (existing) {
    throw Object.assign(new Error('该班级名称已存在'), { code: 40003 });
  }

  const ac = await prisma.adminClass.create({
    data: {
      class_name: data.class_name,
      college: data.college || null,
      major: data.major || null,
      grade: data.grade || null,
    },
  });

  return {
    admin_class_id: ac.admin_class_id,
    class_name: ac.class_name,
    college: ac.college,
    major: ac.major,
    grade: ac.grade,
    created_at: ac.created_at,
  };
}

/**
 * 更新行政班级
 */
async function updateAdminClass(classId, data) {
  const ac = await prisma.adminClass.findUnique({ where: { admin_class_id: classId } });
  if (!ac) {
    throw Object.assign(new Error('行政班级不存在'), { code: 40002 });
  }

  const updateData = {};
  if (data.class_name !== undefined) updateData.class_name = data.class_name;
  if (data.college !== undefined) updateData.college = data.college;
  if (data.major !== undefined) updateData.major = data.major;
  if (data.grade !== undefined) updateData.grade = data.grade;

  const updated = await prisma.adminClass.update({
    where: { admin_class_id: classId },
    data: updateData,
  });

  return {
    admin_class_id: updated.admin_class_id,
    class_name: updated.class_name,
    college: updated.college,
    major: updated.major,
    grade: updated.grade,
    created_at: updated.created_at,
  };
}

/**
 * 删除行政班级
 */
async function deleteAdminClass(classId) {
  const ac = await prisma.adminClass.findUnique({ where: { admin_class_id: classId } });
  if (!ac) {
    throw Object.assign(new Error('行政班级不存在'), { code: 40002 });
  }

  // 检查是否有学生关联
  const studentCount = await prisma.userProfile.count({
    where: { admin_class_id: classId },
  });
  if (studentCount > 0) {
    throw Object.assign(new Error(`该班级下有 ${studentCount} 名学生，无法删除`), { code: 40001 });
  }

  await prisma.adminClass.delete({ where: { admin_class_id: classId } });
  return { admin_class_id: classId };
}

// ======================== 教学班级 ========================

/**
 * 获取教学班级列表
 */
async function getTeachingClassList(courseId) {
  const classes = await prisma.teachingClass.findMany({
    where: { course_id: courseId },
    orderBy: { created_at: 'asc' },
  });

  const list = await Promise.all(classes.map(async (tc) => {
    const studentCount = await prisma.studentCourseEnrollment.count({
      where: { teaching_class_id: tc.teaching_class_id, enrollment_status: 'active' },
    });
    return {
      teaching_class_id: tc.teaching_class_id,
      course_id: tc.course_id,
      teaching_class_name: tc.teaching_class_name,
      semester: tc.semester,
      description: tc.description,
      student_count: studentCount,
      created_at: tc.created_at,
    };
  }));

  return list;
}

/**
 * 创建教学班级
 */
async function createTeachingClass(courseId, data) {
  const course = await prisma.course.findUnique({ where: { course_id: courseId } });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  const tc = await prisma.teachingClass.create({
    data: {
      course_id: courseId,
      teaching_class_name: data.teaching_class_name,
      semester: data.semester || null,
      description: data.description || null,
    },
  });

  return {
    teaching_class_id: tc.teaching_class_id,
    course_id: tc.course_id,
    teaching_class_name: tc.teaching_class_name,
    semester: tc.semester,
    description: tc.description,
    created_at: tc.created_at,
  };
}

/**
 * 更新教学班级
 */
async function updateTeachingClass(classId, data) {
  const tc = await prisma.teachingClass.findUnique({ where: { teaching_class_id: classId } });
  if (!tc) {
    throw Object.assign(new Error('教学班级不存在'), { code: 40002 });
  }

  const updateData = {};
  if (data.teaching_class_name !== undefined) updateData.teaching_class_name = data.teaching_class_name;
  if (data.semester !== undefined) updateData.semester = data.semester;
  if (data.description !== undefined) updateData.description = data.description;

  const updated = await prisma.teachingClass.update({
    where: { teaching_class_id: classId },
    data: updateData,
  });

  return {
    teaching_class_id: updated.teaching_class_id,
    course_id: updated.course_id,
    teaching_class_name: updated.teaching_class_name,
    semester: updated.semester,
    description: updated.description,
    created_at: updated.created_at,
  };
}

/**
 * 删除教学班级
 */
async function deleteTeachingClass(classId) {
  const tc = await prisma.teachingClass.findUnique({ where: { teaching_class_id: classId } });
  if (!tc) {
    throw Object.assign(new Error('教学班级不存在'), { code: 40002 });
  }

  await prisma.teachingClass.delete({ where: { teaching_class_id: classId } });
  return { teaching_class_id: classId };
}

/**
 * 获取教学班学生列表
 */
async function getClassStudentList(classId, query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const enrollWhere = { teaching_class_id: classId, enrollment_status: 'active' };

  const total = await prisma.studentCourseEnrollment.count({ where: enrollWhere });

  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where: enrollWhere,
    include: {
      student: {
        include: { profile: true },
      },
    },
    orderBy: { created_at: 'desc' },
    skip,
    take: pageSize,
  });

  let list = enrollments.map((e) => ({
    enrollment_id: e.enrollment_id,
    student_user_id: e.student_user_id,
    username: e.student.username,
    real_name: e.student.profile?.real_name || null,
    student_no: e.student.profile?.student_no || null,
    created_at: e.created_at,
  }));

  // 关键词搜索（内存过滤）
  if (query.keyword) {
    const kw = String(query.keyword).trim().toLowerCase();
    list = list.filter((s) =>
      (s.real_name && s.real_name.toLowerCase().includes(kw)) ||
      (s.username && s.username.toLowerCase().includes(kw)) ||
      (s.student_no && s.student_no.toLowerCase().includes(kw))
    );
  }

  return { list, total, page, page_size: pageSize };
}

/**
 * 添加学生到教学班
 */
async function addClassStudents(classId, studentUserIds) {
  const tc = await prisma.teachingClass.findUnique({ where: { teaching_class_id: classId } });
  if (!tc) {
    throw Object.assign(new Error('教学班级不存在'), { code: 40002 });
  }

  const results = [];
  for (const userId of studentUserIds) {
    try {
      await prisma.studentCourseEnrollment.create({
        data: {
          student_user_id: userId,
          course_id: tc.course_id,
          teaching_class_id: classId,
          enrollment_status: 'active',
        },
      });
      results.push({ student_user_id: userId, success: true });
    } catch (err) {
      results.push({ student_user_id: userId, success: false, reason: '添加失败，可能已存在' });
    }
  }

  return { teaching_class_id: classId, results };
}

/**
 * 从教学班移除学生
 */
async function removeClassStudent(classId, studentUserId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: studentUserId,
      teaching_class_id: classId,
    },
  });

  if (!enrollment) {
    throw Object.assign(new Error('该学生不在该教学班中'), { code: 40002 });
  }

  await prisma.studentCourseEnrollment.delete({
    where: { enrollment_id: enrollment.enrollment_id },
  });

  return { teaching_class_id: classId, student_user_id: studentUserId };
}

module.exports = {
  getAdminClassList,
  createAdminClass,
  updateAdminClass,
  deleteAdminClass,
  getTeachingClassList,
  createTeachingClass,
  updateTeachingClass,
  deleteTeachingClass,
  getClassStudentList,
  addClassStudents,
  removeClassStudent,
};
