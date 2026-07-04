// 管理员端用户管理服务
// 提供用户列表查询、状态管理、密码重置等功能

const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { fromPrismaRole, fromPrismaStatus, fromPrismaGender } = require('../utils/enum');

const PASSWORD_HASH_ROUNDS = 10;

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
    email: user.email,
    phone: user.phone,
    status: fromPrismaStatus(user.status),
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

/**
 * 获取用户列表（分页 + 搜索 + 筛选）
 */
async function getUserList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = {};

  // 关键词搜索
  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { username: { contains: keyword } },
      { email: { contains: keyword } },
      { phone: { contains: keyword } },
      { profile: { real_name: { contains: keyword } } },
      { profile: { student_no: { contains: keyword } } },
    ];
  }

  // 角色筛选
  if (query.role) {
    const roleMap = { admin: 'ADMIN', teacher: 'TEACHER', student: 'STUDENT' };
    const prismaRole = roleMap[query.role];
    if (prismaRole) where.role = prismaRole;
  }

  // 状态筛选
  if (query.status) {
    const statusMap = { active: 'ACTIVE', disabled: 'DISABLED' };
    const prismaStatus = statusMap[query.status];
    if (prismaStatus) where.status = prismaStatus;
  }

  const [list, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { profile: true },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    list: list.map(formatUser),
    total,
    page,
    page_size: pageSize,
  };
}

/**
 * 修改用户状态
 */
async function updateUserStatus(userId, status) {
  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { code: 40002 });
  }

  const statusMap = { active: 'ACTIVE', disabled: 'DISABLED' };
  const prismaStatus = statusMap[status];
  if (!prismaStatus) {
    throw Object.assign(new Error('无效的用户状态'), { code: 40001 });
  }

  const updated = await prisma.user.update({
    where: { user_id: userId },
    data: { status: prismaStatus },
    include: { profile: true },
  });

  return formatUser(updated);
}

/**
 * 重置用户密码
 */
async function resetUserPassword(userId, newPassword) {
  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { code: 40002 });
  }

  if (!newPassword || String(newPassword).length < 6) {
    throw Object.assign(new Error('密码不能少于 6 位'), { code: 40001 });
  }

  const passwordHash = await bcrypt.hash(String(newPassword), PASSWORD_HASH_ROUNDS);

  await prisma.user.update({
    where: { user_id: userId },
    data: { password_hash: passwordHash },
  });

  return { user_id: userId };
}

/**
 * 删除用户（软删除 - 设为 disabled 状态）
 */
async function deleteUser(userId) {
  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { code: 40002 });
  }

  // 仅允许删除 student 角色
  if (user.role !== 'STUDENT') {
    throw Object.assign(new Error('仅允许删除学生账号'), { code: 40301 });
  }

  await prisma.user.update({
    where: { user_id: userId },
    data: { status: 'DISABLED' },
  });

  return { user_id: userId };
}

module.exports = { getUserList, updateUserStatus, resetUserPassword, deleteUser };
