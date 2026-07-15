const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const prisma = require('../src/config/prisma');
const classService = require('../src/services/admin-class.service');
const userService = require('../src/services/admin-user.service');
const { getUserPermissions } = require('../src/services/admin-permission.service');

const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const createdUserIds = [];
const createdAdminClassIds = [];
const createdTeachingClassIds = [];
let req;
let course;
let student;

test.before(async () => {
  const admin = await prisma.user.findFirst({
    where: {
      role: 'ADMIN',
      status: 'ACTIVE',
      admin_role_assignments: { some: { role: { role_code: 'super_admin', enabled: true } } },
    },
    select: { user_id: true, role: true },
  });
  assert.ok(admin, 'an active explicit super administrator is required');
  course = await prisma.course.findFirst({
    where: { status: 'ACTIVE' },
    select: { course_id: true, course_name: true },
  });
  assert.ok(course, 'an active course is required');
  req = {
    user: admin,
    id: `admin-class-management-${suffix}`,
    ip: '127.0.0.1',
    adminPermissions: await getUserPermissions(admin.user_id, 'admin'),
  };
  student = await userService.createUser({
    username: `class_stu_${suffix}`,
    password: 'Student123!',
    role: 'student',
    real_name: '班级闭环学生',
    student_no: `CS${suffix}`,
  }, req);
  createdUserIds.push(student.user_id);
});

test.after(async () => {
  await prisma.operationLog.deleteMany({ where: { request_id: req?.id } });
  if (createdTeachingClassIds.length) {
    await prisma.teachingClass.deleteMany({ where: { teaching_class_id: { in: createdTeachingClassIds } } });
  }
  if (createdAdminClassIds.length) {
    await prisma.adminClass.deleteMany({ where: { admin_class_id: { in: createdAdminClassIds } } });
  }
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { user_id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

test('administrative class CRUD and membership are real, paginated and audited', async () => {
  const adminClass = await classService.createAdminClass({
    class_name: `行政班-${suffix}`,
    college: '测试学院',
    major: '软件工程',
    grade: '2026',
  }, req);
  createdAdminClassIds.push(adminClass.admin_class_id);

  await classService.addAdminClassStudents(adminClass.admin_class_id, [student.user_id], req);
  const page = await classService.getAdminClassStudentList(adminClass.admin_class_id, {
    keyword: `CS${suffix}`,
    page: 1,
    page_size: 10,
  });
  assert.equal(page.total, 1);
  assert.equal(page.list[0].student_user_id, student.user_id);

  const filtered = await classService.getAdminClassList({ keyword: suffix, page: 1, page_size: 10 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.list[0].student_count, 1);

  await assert.rejects(
    () => classService.deleteAdminClass(adminClass.admin_class_id, req),
    /请先完成转班或移出/,
  );
  await classService.removeAdminClassStudent(adminClass.admin_class_id, student.user_id, req);
  const removed = await classService.deleteAdminClass(adminClass.admin_class_id, req);
  assert.equal(removed.deletion_mode, 'hard');
  createdAdminClassIds.splice(createdAdminClassIds.indexOf(adminClass.admin_class_id), 1);

  const auditTypes = (await prisma.operationLog.findMany({
    where: { request_id: req.id, target_id: adminClass.admin_class_id },
    select: { operation_type: true },
  })).map((item) => item.operation_type);
  for (const expected of [
    'CREATE_ADMIN_CLASS',
    'ADD_ADMIN_CLASS_STUDENTS',
    'REMOVE_ADMIN_CLASS_STUDENT',
    'DELETE_ADMIN_CLASS',
  ]) {
    assert.ok(auditTypes.includes(expected), `missing audit operation ${expected}`);
  }
});

test('teaching class membership can be added, searched, dropped and restored without duplicate-key assumptions', async () => {
  const adminClass = await classService.createAdminClass({
    class_name: `教学关联班-${suffix}`,
    college: '测试学院',
    major: '软件工程',
    grade: '2026',
  }, req);
  createdAdminClassIds.push(adminClass.admin_class_id);

  const teachingClass = await classService.createTeachingClass(course.course_id, {
    teaching_class_name: `教学班-${suffix}`,
    code: `TC${suffix}`,
    semester: '2026-2027-1',
    capacity: 2,
    teacher_user_id: req.user.user_id,
    admin_class_ids: [adminClass.admin_class_id],
  }, req);
  createdTeachingClassIds.push(teachingClass.teaching_class_id);
  assert.equal(teachingClass.admin_classes[0].admin_class_id, adminClass.admin_class_id);

  await assert.rejects(
    () => classService.updateTeachingClass(teachingClass.teaching_class_id, { capacity: 'invalid' }, req),
    /必须是正整数/,
  );

  await classService.addClassStudents(teachingClass.teaching_class_id, [student.user_id], req);
  let page = await classService.getClassStudentList(teachingClass.teaching_class_id, {
    keyword: `CS${suffix}`,
    page: 1,
    page_size: 10,
  });
  assert.equal(page.total, 1);
  assert.equal(page.list[0].student_user_id, student.user_id);

  await classService.removeClassStudent(teachingClass.teaching_class_id, student.user_id, req);
  page = await classService.getClassStudentList(teachingClass.teaching_class_id, { page: 1, page_size: 10 });
  assert.equal(page.total, 0);

  await classService.addClassStudents(teachingClass.teaching_class_id, [student.user_id], req);
  const enrollmentRows = await prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: student.user_id, course_id: course.course_id },
  });
  assert.equal(enrollmentRows.filter((item) => item.enrollment_status === 'active').length, 1);
  assert.equal(enrollmentRows.find((item) => item.enrollment_status === 'active').teaching_class_id, teachingClass.teaching_class_id);

  const globalPage = await classService.getTeachingClassPage({ keyword: suffix, page: 1, page_size: 10 });
  assert.equal(globalPage.total, 1);
  assert.equal(globalPage.list[0].student_count, 1);

  const archived = await classService.deleteTeachingClass(teachingClass.teaching_class_id, req);
  assert.equal(archived.deletion_mode, 'soft');
  assert.ok(archived.dependent_count >= 1);
  const persisted = await prisma.teachingClass.findUnique({ where: { teaching_class_id: teachingClass.teaching_class_id } });
  assert.equal(persisted.status, 'archived');

  const auditTypes = (await prisma.operationLog.findMany({
    where: { request_id: req.id, target_id: teachingClass.teaching_class_id },
    select: { operation_type: true },
  })).map((item) => item.operation_type);
  for (const expected of [
    'CREATE_TEACHING_CLASS',
    'ADD_TEACHING_CLASS_STUDENTS',
    'REMOVE_TEACHING_CLASS_STUDENT',
    'ARCHIVE_TEACHING_CLASS',
  ]) {
    assert.ok(auditTypes.includes(expected), `missing audit operation ${expected}`);
  }
});
