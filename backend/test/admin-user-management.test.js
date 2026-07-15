const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const prisma = require('../src/config/prisma');
const userService = require('../src/services/admin-user.service');
const { getUserPermissions } = require('../src/services/admin-permission.service');

const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const createdUserIds = [];
let req;
let adminClass;

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
  req = {
    user: admin,
    id: `admin-user-management-${suffix}`,
    ip: '127.0.0.1',
    adminPermissions: await getUserPermissions(admin.user_id, 'admin'),
  };
  adminClass = await prisma.adminClass.findFirst({
    where: { status: 'active' },
    select: { admin_class_id: true },
  });
});

test.after(async () => {
  await prisma.operationLog.deleteMany({ where: { request_id: req?.id } });
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { user_id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

test('student and teacher management persists profiles, class assignment, lifecycle and audits', async () => {
  const student = await userService.createUser({
    username: `stu_${suffix}`,
    password: 'Student123!',
    role: 'student',
    real_name: '基础闭环学生',
    student_no: `S${suffix}`,
    college: '测试学院',
    major: '测试专业',
    grade: '2026',
    admin_class_id: adminClass?.admin_class_id || null,
  }, req);
  createdUserIds.push(student.user_id);
  assert.equal(student.role, 'student');
  assert.equal(student.admin_class_id, adminClass?.admin_class_id || null);

  const found = await userService.getUserList({ role: 'student', keyword: `S${suffix}` });
  assert.equal(found.total, 1);
  assert.equal(found.list[0].user_id, student.user_id);

  const updated = await userService.updateUser(student.user_id, {
    role: 'student',
    real_name: '基础闭环学生已更新',
    admin_class_id: adminClass?.admin_class_id || null,
  }, req);
  assert.equal(updated.real_name, '基础闭环学生已更新');

  await userService.updateUserStatus(student.user_id, 'disabled', req);
  const enabled = await userService.updateUserStatus(student.user_id, 'active', req);
  assert.equal(enabled.status, 'active');
  const reset = await userService.resetUserPassword(student.user_id, 'Student456!', req);
  assert.equal(reset.sessions_revoked, true);

  const teacher = await userService.createUser({
    username: `tea_${suffix}`,
    password: 'Teacher123!',
    role: 'teacher',
    real_name: '基础闭环教师',
    teacher_no: `T${suffix}`,
    college: '测试学院',
  }, req);
  createdUserIds.push(teacher.user_id);
  assert.equal(teacher.role, 'teacher');
  const removed = await userService.deleteUser(teacher.user_id, req);
  assert.equal(removed.deletion_mode, 'soft');
  const persistedTeacher = await prisma.user.findUnique({ where: { user_id: teacher.user_id } });
  assert.equal(persistedTeacher.status, 'DISABLED');

  const operationTypes = (await prisma.operationLog.findMany({
    where: { request_id: req.id, target_id: { in: [student.user_id, teacher.user_id] } },
    select: { operation_type: true },
  })).map((item) => item.operation_type);
  for (const expected of [
    'CREATE_USER',
    'UPDATE_USER',
    'DISABLE_USER',
    'ENABLE_USER',
    'RESET_USER_PASSWORD',
    'SOFT_DELETE_USER',
  ]) {
    assert.ok(operationTypes.includes(expected), `missing audit operation ${expected}`);
  }
});

test('administrator creation requires real role assignment and protected deletion is audited', async () => {
  await assert.rejects(
    () => userService.createUser({
      username: `adm_no_permission_${suffix}`,
      password: 'Admin123!',
      role: 'admin',
      real_name: '无系统权限管理员',
      role_codes: ['platform_admin'],
    }, { ...req, adminPermissions: ['admin.users.manage'] }),
    /系统管理权限/,
  );
  await assert.rejects(
    () => userService.createUser({
      username: `adm_no_role_${suffix}`,
      password: 'Admin123!',
      role: 'admin',
      real_name: '无角色管理员',
    }, req),
    /至少一个有效角色/,
  );

  const admin = await userService.createUser({
    username: `adm_${suffix}`,
    password: 'Admin123!',
    role: 'admin',
    real_name: '基础闭环管理员',
    role_codes: ['platform_admin'],
  }, req);
  createdUserIds.push(admin.user_id);
  assert.deepEqual(admin.admin_roles.map((item) => item.role_code), ['platform_admin']);
  const assignment = await prisma.adminUserRole.findFirst({
    where: { user_id: admin.user_id, role: { role_code: 'platform_admin' } },
  });
  assert.ok(assignment);
  assert.equal(assignment.granted_by, req.user.user_id);

  const removed = await userService.deleteUser(admin.user_id, req);
  assert.equal(removed.status, 'disabled');
  const persisted = await prisma.user.findUnique({ where: { user_id: admin.user_id } });
  assert.equal(persisted.status, 'DISABLED');

  const audits = await prisma.operationLog.findMany({
    where: { request_id: req.id, target_id: admin.user_id },
    select: { operation_type: true, after_summary_json: true },
  });
  assert.ok(audits.some((item) => item.operation_type === 'CREATE_USER'));
  assert.ok(audits.some((item) => item.operation_type === 'SOFT_DELETE_USER'));
  assert.ok(audits.every((item) => !JSON.stringify(item.after_summary_json).includes('Admin123!')));
});

test('current and last super administrator protections cannot be bypassed', async () => {
  await assert.rejects(
    () => userService.deleteUser(req.user.user_id, req),
    /不能禁用或移除当前登录/,
  );
  await assert.rejects(
    () => userService.updateUserStatus(req.user.user_id, 'disabled', req),
    /不能禁用或移除当前登录/,
  );
});
