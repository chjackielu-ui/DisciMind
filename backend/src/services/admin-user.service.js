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
    gender: fromPrismaGender(user.profile?.gender),
    email: user.email,
    phone: user.phone,
    status: fromPrismaStatus(user.status),
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    // 行政班级信息
    admin_class_id: user.profile?.admin_class?.admin_class_id || null,
    admin_class_name: user.profile?.admin_class?.class_name || null,
  };
}

/**
 * 获取用户列表（分页 + 精确搜索 + 筛选）
 * 支持通用 keyword 搜索和精确字段搜索
 */
async function getUserList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = {};
  const profileWhere = {};

  // 关键词模糊搜索（用户名、姓名、邮箱、手机号）
  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { username: { contains: keyword } },
      { email: { contains: keyword } },
      { phone: { contains: keyword } },
      { profile: { real_name: { contains: keyword } } },
    ];
  }

  // 精确字段搜索（仅在不使用通用 keyword 时生效）
  if (!query.keyword) {
    // 学号精确搜索
    if (query.student_no) {
      profileWhere.student_no = { contains: String(query.student_no).trim() };
    }
    // 工号精确搜索
    if (query.teacher_no) {
      profileWhere.teacher_no = { contains: String(query.teacher_no).trim() };
    }
    // 姓名精确搜索
    if (query.real_name) {
      profileWhere.real_name = { contains: String(query.real_name).trim() };
    }
    // 学院精确搜索
    if (query.college) {
      profileWhere.college = { contains: String(query.college).trim() };
    }
    // 专业精确搜索
    if (query.major) {
      profileWhere.major = { contains: String(query.major).trim() };
    }
    // 年级精确搜索
    if (query.grade) {
      profileWhere.grade = { contains: String(query.grade).trim() };
    }
    // 班级名称搜索（通过 AdminClass 关联）
    if (query.class_name) {
      const className = String(query.class_name).trim();
      profileWhere.admin_class = { class_name: { contains: className } };
    }
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

  // 合并 profile 精确搜索条件
  if (Object.keys(profileWhere).length > 0) {
    where.profile = profileWhere;
  }

  const include = {
    profile: {
      include: { admin_class: { select: { admin_class_id: true, class_name: true } } },
    },
  };

  const [list, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include,
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

/**
 * 更新用户资料（管理员用）
 */
async function updateUser(userId, data) {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { code: 40002 });
  }

  const userData = {};
  if (data.email !== undefined) userData.email = data.email || null;
  if (data.phone !== undefined) userData.phone = data.phone || null;

  if (Object.keys(userData).length > 0) {
    await prisma.user.update({ where: { user_id: userId }, data: userData });
  }

  const profileData = {};
  if (data.real_name !== undefined) profileData.real_name = data.real_name;
  if (data.college !== undefined) profileData.college = data.college || null;
  if (data.major !== undefined) profileData.major = data.major || null;
  if (data.gender !== undefined) {
    const genderMap = { male: 'MALE', female: 'FEMALE', unknown: 'UNKNOWN' };
    profileData.gender = genderMap[data.gender] || 'UNKNOWN';
  }
  if (data.student_no !== undefined) profileData.student_no = data.student_no || null;
  if (data.teacher_no !== undefined) profileData.teacher_no = data.teacher_no || null;
  if (data.grade !== undefined) profileData.grade = data.grade || null;
  if (data.admin_class_id !== undefined) profileData.admin_class_id = data.admin_class_id || null;

  if (Object.keys(profileData).length > 0) {
    if (user.profile) {
      await prisma.userProfile.update({ where: { user_id: userId }, data: profileData });
    } else {
      await prisma.userProfile.create({
        data: { user_id: userId, real_name: profileData.real_name || user.username, ...profileData },
      });
    }
  }

  return { user_id: userId };
}

/**
 * 创建用户（管理员用）
 */
async function createUser(data) {
  if (!data.username || !data.password || !data.role) {
    throw Object.assign(new Error('用户名、密码和角色为必填项'), { code: 40001 });
  }

  if (String(data.password).length < 6) {
    throw Object.assign(new Error('密码不能少于 6 位'), { code: 40001 });
  }

  const roleMap = { admin: 'ADMIN', teacher: 'TEACHER', student: 'STUDENT' };
  const prismaRole = roleMap[data.role];
  if (!prismaRole) {
    throw Object.assign(new Error('无效的角色类型，仅支持 student / teacher / admin'), { code: 40001 });
  }

  // 检查用户名唯一性
  const existing = await prisma.user.findUnique({ where: { username: data.username } });
  if (existing) {
    throw Object.assign(new Error('用户名已存在'), { code: 40002 });
  }

  const passwordHash = await bcrypt.hash(String(data.password), PASSWORD_HASH_ROUNDS);

  const user = await prisma.user.create({
    data: {
      username: data.username,
      password_hash: passwordHash,
      role: prismaRole,
      email: data.email || null,
      phone: data.phone || null,
      status: 'ACTIVE',
      profile: {
        create: {
          real_name: data.real_name || data.username,
          student_no: data.student_no || null,
          teacher_no: data.teacher_no || null,
          college: data.college || null,
          major: data.major || null,
          grade: data.grade || null,
          gender: data.gender === 'male' ? 'MALE' : data.gender === 'female' ? 'FEMALE' : 'UNKNOWN',
        },
      },
    },
    include: { profile: true },
  });

  return formatUser(user);
}

module.exports = { getUserList, updateUserStatus, resetUserPassword, deleteUser, updateUser, createUser };
