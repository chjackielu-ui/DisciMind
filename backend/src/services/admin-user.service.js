// 管理员端用户管理服务
// 学生、教师与管理员共用同一真实用户表；所有写操作与审计在同一事务中完成。

const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { fromPrismaRole, fromPrismaStatus, fromPrismaGender } = require('../utils/enum');
const { buildAdminOperationData } = require('./admin-audit.service');

const PASSWORD_HASH_ROUNDS = 10;
const ROLE_MAP = { admin: 'ADMIN', teacher: 'TEACHER', student: 'STUDENT' };
const STATUS_MAP = { active: 'ACTIVE', disabled: 'DISABLED' };

function publicError(message, code = 40001) {
  return Object.assign(new Error(message), { code });
}

function normalizeText(value, { max = 255, required = false, label = '字段' } = {}) {
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

function hasPermission(req, permission) {
  return Array.isArray(req?.adminPermissions) && req.adminPermissions.includes(permission);
}

function getUserInclude(now = new Date()) {
  return {
    profile: {
      include: { admin_class: { select: { admin_class_id: true, class_name: true } } },
    },
    admin_role_assignments: {
      where: {
        role: { enabled: true },
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
      },
      select: { expires_at: true, role: { select: { role_code: true, name: true } } },
    },
    _count: {
      select: {
        teacher_course_relations: true,
        primary_teaching_classes: true,
        student_course_enrollments: true,
      },
    },
  };
}

function formatUser(user) {
  return {
    user_id: user.user_id,
    username: user.username,
    role: fromPrismaRole(user.role),
    real_name: user.profile?.real_name || null,
    student_no: user.profile?.student_no || null,
    teacher_no: user.profile?.teacher_no || null,
    college: user.profile?.college || null,
    major: user.profile?.major || null,
    grade: user.profile?.grade || null,
    gender: fromPrismaGender(user.profile?.gender),
    email: user.email,
    phone: user.phone,
    status: fromPrismaStatus(user.status),
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    admin_class_id: user.profile?.admin_class?.admin_class_id || null,
    admin_class_name: user.profile?.admin_class?.class_name || null,
    admin_roles: (user.admin_role_assignments || []).map((assignment) => ({
      role_code: assignment.role.role_code,
      name: assignment.role.name,
      expires_at: assignment.expires_at,
    })),
    course_count: user._count?.teacher_course_relations || 0,
    primary_teaching_class_count: user._count?.primary_teaching_classes || 0,
    enrollment_count: user._count?.student_course_enrollments || 0,
  };
}

function summary(user) {
  if (!user) return null;
  return {
    user_id: user.user_id,
    username: user.username,
    role: fromPrismaRole(user.role),
    status: fromPrismaStatus(user.status),
    real_name: user.profile?.real_name || null,
    student_no: user.profile?.student_no || null,
    teacher_no: user.profile?.teacher_no || null,
    admin_class_id: user.profile?.admin_class_id || null,
    admin_role_codes: (user.admin_role_assignments || []).map((item) => item.role?.role_code).filter(Boolean),
  };
}

function translatePrismaError(error) {
  if (error?.code === 'P2002') {
    const fields = Array.isArray(error.meta?.target) ? error.meta.target.join('、') : '唯一字段';
    return publicError(`${fields} 已被使用`, 40003);
  }
  if (error?.code === 'P2003') return publicError('关联对象不存在或仍被业务数据引用', 40901);
  return error;
}

async function requireAdminClass(tx, classId) {
  if (classId == null) return null;
  const parsed = Number(classId);
  if (!Number.isInteger(parsed) || parsed < 1) throw publicError('行政班级 ID 不合法');
  const adminClass = await tx.adminClass.findUnique({
    where: { admin_class_id: parsed },
    select: { admin_class_id: true, status: true },
  });
  if (!adminClass || adminClass.status !== 'active') throw publicError('行政班级不存在或已停用', 40002);
  return parsed;
}

function isEffectiveAssignment(assignment, now = new Date()) {
  return assignment?.role?.enabled !== false
    && (!assignment?.expires_at || new Date(assignment.expires_at) > now);
}

async function protectAdminAccountMutation(tx, target, req, action) {
  if (target.role !== 'ADMIN') return;
  if (!hasPermission(req, 'admin.system.manage')) {
    throw publicError('管理管理员账号需要系统管理权限', 40301);
  }
  const actorId = Number(req?.user?.user_id);
  if (['disable', 'delete'].includes(action) && actorId === target.user_id) {
    throw publicError('不能禁用或移除当前登录的管理员账号', 40301);
  }

  const assignments = target.admin_role_assignments || [];
  const isSuperAdmin = assignments.some((item) => (
    item.role?.role_code === 'super_admin' && isEffectiveAssignment(item)
  ));
  if (isSuperAdmin && ['disable', 'delete'].includes(action)) {
    const otherSuperAdmins = await tx.adminUserRole.count({
      where: {
        user_id: { not: target.user_id },
        role: { role_code: 'super_admin', enabled: true },
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
        user: { role: 'ADMIN', status: 'ACTIVE' },
      },
    });
    if (!otherSuperAdmins) throw publicError('系统必须至少保留一名有效超级管理员', 40901);
  }

  if (action === 'enable' && !assignments.some((item) => isEffectiveAssignment(item))) {
    throw publicError('管理员必须先分配至少一个有效角色才能启用', 40901);
  }
}

/**
 * 获取用户列表（分页 + 精确搜索 + 角色筛选）。
 */
async function getUserList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;
  const where = {};
  const profileWhere = {};

  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { username: { contains: keyword } },
      { email: { contains: keyword } },
      { phone: { contains: keyword } },
      { profile: { is: { real_name: { contains: keyword } } } },
      { profile: { is: { student_no: { contains: keyword } } } },
      { profile: { is: { teacher_no: { contains: keyword } } } },
    ];
  } else {
    if (query.student_no) profileWhere.student_no = { contains: String(query.student_no).trim() };
    if (query.teacher_no) profileWhere.teacher_no = { contains: String(query.teacher_no).trim() };
    if (query.real_name) profileWhere.real_name = { contains: String(query.real_name).trim() };
    if (query.college) profileWhere.college = { contains: String(query.college).trim() };
    if (query.major) profileWhere.major = { contains: String(query.major).trim() };
    if (query.grade) profileWhere.grade = { contains: String(query.grade).trim() };
    if (query.class_name) {
      profileWhere.admin_class = { is: { class_name: { contains: String(query.class_name).trim() } } };
    }
  }

  if (ROLE_MAP[query.role]) where.role = ROLE_MAP[query.role];
  if (STATUS_MAP[query.status]) where.status = STATUS_MAP[query.status];
  if (Object.keys(profileWhere).length) where.profile = { is: profileWhere };

  const [list, total, userCount, studentCount, teacherCount, adminCount, disabledCount] = await Promise.all([
    prisma.user.findMany({ where, include: getUserInclude(), orderBy: { created_at: 'desc' }, skip, take: pageSize }),
    prisma.user.count({ where }),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.user.count({ where: { role: 'TEACHER' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.user.count({ where: { status: 'DISABLED' } }),
  ]);
  const stats = {
    total: userCount,
    student_count: studentCount,
    teacher_count: teacherCount,
    admin_count: adminCount,
    disabled_count: disabledCount,
  };
  return {
    list: list.map(formatUser),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    stats,
  };
}

async function updateUserStatus(userId, status, req) {
  const prismaStatus = STATUS_MAP[status];
  if (!prismaStatus) throw publicError('无效的用户状态');
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { user_id: userId }, include: getUserInclude() });
      if (!current) throw publicError('用户不存在', 40002);
      await protectAdminAccountMutation(tx, current, req, status === 'active' ? 'enable' : 'disable');
      const updated = await tx.user.update({
        where: { user_id: userId },
        data: { status: prismaStatus },
        include: getUserInclude(),
      });
      if (prismaStatus === 'DISABLED') {
        await Promise.all([
          tx.refreshToken.deleteMany({ where: { user_id: userId } }),
          tx.authSession.deleteMany({ where: { user_id: userId } }),
        ]);
      }
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: prismaStatus === 'ACTIVE' ? 'ENABLE_USER' : 'DISABLE_USER',
          targetType: 'user',
          targetId: userId,
          before: summary(current),
          after: summary(updated),
        }),
      });
      return formatUser(updated);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function resetUserPassword(userId, newPassword, req) {
  if (!newPassword || String(newPassword).length < 6) throw publicError('密码不能少于 6 位');
  const passwordHash = await bcrypt.hash(String(newPassword), PASSWORD_HASH_ROUNDS);
  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { user_id: userId }, include: getUserInclude() });
    if (!current) throw publicError('用户不存在', 40002);
    await protectAdminAccountMutation(tx, current, req, 'password');
    await tx.user.update({ where: { user_id: userId }, data: { password_hash: passwordHash } });
    await Promise.all([
      tx.refreshToken.deleteMany({ where: { user_id: userId } }),
      tx.authSession.deleteMany({ where: { user_id: userId } }),
    ]);
    await tx.operationLog.create({
      data: buildAdminOperationData({
        req,
        operationType: 'RESET_USER_PASSWORD',
        targetType: 'user',
        targetId: userId,
        before: { username: current.username },
        after: { username: current.username, password_reset: true, sessions_revoked: true },
      }),
    });
    return { user_id: userId, sessions_revoked: true };
  });
}

/**
 * 账号移除采用可审计软删除：禁用账号并撤销所有会话。
 */
async function deleteUser(userId, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { user_id: userId }, include: getUserInclude() });
      if (!current) throw publicError('用户不存在', 40002);
      await protectAdminAccountMutation(tx, current, req, 'delete');
      const updated = await tx.user.update({
        where: { user_id: userId },
        data: { status: 'DISABLED' },
        include: getUserInclude(),
      });
      await Promise.all([
        tx.refreshToken.deleteMany({ where: { user_id: userId } }),
        tx.authSession.deleteMany({ where: { user_id: userId } }),
      ]);
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'SOFT_DELETE_USER',
          targetType: 'user',
          targetId: userId,
          before: summary(current),
          after: { ...summary(updated), sessions_revoked: true },
        }),
      });
      return { user_id: userId, status: 'disabled', deletion_mode: 'soft' };
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function updateUser(userId, data, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { user_id: userId }, include: getUserInclude() });
      if (!current) throw publicError('用户不存在', 40002);
      if (data.role && ROLE_MAP[data.role] && ROLE_MAP[data.role] !== current.role) {
        throw publicError('不能通过资料编辑改变用户角色');
      }
      await protectAdminAccountMutation(tx, current, req, 'edit');

      const userData = {};
      if (data.email !== undefined) userData.email = normalizeText(data.email, { max: 100 });
      if (data.phone !== undefined) userData.phone = normalizeText(data.phone, { max: 20 });

      const profileData = {};
      if (data.real_name !== undefined) profileData.real_name = normalizeText(data.real_name, { max: 50, required: true, label: '真实姓名' });
      if (data.college !== undefined) profileData.college = normalizeText(data.college, { max: 100 });
      if (data.major !== undefined) profileData.major = normalizeText(data.major, { max: 100 });
      if (data.grade !== undefined) profileData.grade = normalizeText(data.grade, { max: 20 });
      if (data.gender !== undefined) {
        const genderMap = { male: 'MALE', female: 'FEMALE', unknown: 'UNKNOWN', '': 'UNKNOWN' };
        if (!(String(data.gender) in genderMap)) throw publicError('性别字段不合法');
        profileData.gender = genderMap[String(data.gender)];
      }
      if (current.role === 'STUDENT') {
        if (data.student_no !== undefined) profileData.student_no = normalizeText(data.student_no, { max: 50 });
        if (data.admin_class_id !== undefined) profileData.admin_class_id = await requireAdminClass(tx, data.admin_class_id);
      } else if (data.student_no !== undefined || data.admin_class_id !== undefined) {
        throw publicError('只有学生账号可以设置学号和行政班级');
      }
      if (current.role === 'TEACHER') {
        if (data.teacher_no !== undefined) profileData.teacher_no = normalizeText(data.teacher_no, { max: 50 });
      } else if (data.teacher_no !== undefined) {
        throw publicError('只有教师账号可以设置工号');
      }

      if (Object.keys(userData).length) await tx.user.update({ where: { user_id: userId }, data: userData });
      if (Object.keys(profileData).length) {
        await tx.userProfile.upsert({
          where: { user_id: userId },
          update: profileData,
          create: { user_id: userId, real_name: profileData.real_name || current.username, ...profileData },
        });
      }
      const updated = await tx.user.findUnique({ where: { user_id: userId }, include: getUserInclude() });
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'UPDATE_USER',
          targetType: 'user',
          targetId: userId,
          before: summary(current),
          after: summary(updated),
        }),
      });
      return formatUser(updated);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function createUser(data, req) {
  const username = normalizeText(data.username, { max: 50, required: true, label: '用户名' });
  if (!data.password || String(data.password).length < 6) throw publicError('密码不能少于 6 位');
  const prismaRole = ROLE_MAP[data.role];
  if (!prismaRole) throw publicError('无效的角色类型，仅支持 student / teacher / admin');
  if (prismaRole === 'ADMIN' && !hasPermission(req, 'admin.system.manage')) {
    throw publicError('创建管理员需要系统管理权限', 40301);
  }

  const roleCodes = [...new Set((data.role_codes || []).map((value) => String(value).trim()).filter(Boolean))];
  if (prismaRole === 'ADMIN' && !roleCodes.length) throw publicError('创建管理员时必须分配至少一个有效角色');
  if (prismaRole !== 'ADMIN' && roleCodes.length) throw publicError('只有管理员账号可以分配管理员角色');

  const passwordHash = await bcrypt.hash(String(data.password), PASSWORD_HASH_ROUNDS);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { username } });
      if (existing) throw publicError('用户名已存在', 40003);
      const adminClassId = prismaRole === 'STUDENT'
        ? await requireAdminClass(tx, data.admin_class_id)
        : null;
      const roles = prismaRole === 'ADMIN'
        ? await tx.adminRole.findMany({ where: { role_code: { in: roleCodes }, enabled: true } })
        : [];
      if (prismaRole === 'ADMIN' && roles.length !== roleCodes.length) {
        throw publicError('包含不存在或已停用的管理员角色');
      }

      const user = await tx.user.create({
        data: {
          username,
          password_hash: passwordHash,
          role: prismaRole,
          email: normalizeText(data.email, { max: 100 }),
          phone: normalizeText(data.phone, { max: 20 }),
          status: 'ACTIVE',
          profile: {
            create: {
              real_name: normalizeText(data.real_name || username, { max: 50, required: true, label: '真实姓名' }),
              student_no: prismaRole === 'STUDENT' ? normalizeText(data.student_no, { max: 50 }) : null,
              teacher_no: prismaRole === 'TEACHER' ? normalizeText(data.teacher_no, { max: 50 }) : null,
              college: normalizeText(data.college, { max: 100 }),
              major: prismaRole === 'STUDENT' ? normalizeText(data.major, { max: 100 }) : null,
              grade: prismaRole === 'STUDENT' ? normalizeText(data.grade, { max: 20 }) : null,
              admin_class_id: adminClassId,
              gender: data.gender === 'male' ? 'MALE' : data.gender === 'female' ? 'FEMALE' : 'UNKNOWN',
            },
          },
        },
      });
      if (roles.length) {
        await tx.adminUserRole.createMany({
          data: roles.map((role) => ({
            user_id: user.user_id,
            role_id: role.id,
            granted_by: Number(req?.user?.user_id) || null,
          })),
        });
      }
      const created = await tx.user.findUnique({ where: { user_id: user.user_id }, include: getUserInclude() });
      await tx.operationLog.create({
        data: buildAdminOperationData({
          req,
          operationType: 'CREATE_USER',
          targetType: 'user',
          targetId: user.user_id,
          after: summary(created),
        }),
      });
      return formatUser(created);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

module.exports = {
  getUserList,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
  updateUser,
  createUser,
};
