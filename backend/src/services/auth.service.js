// Auth Service — 认证业务逻辑层
// 所有数据库操作使用统一的 prisma 实例（从 ../config/prisma 导入）

const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');
const {
  toPrismaRole,
  fromPrismaRole,
  toPrismaGender,
  fromPrismaGender,
  fromPrismaStatus,
} = require('../utils/enum');

// ---------- 内部工具函数 ----------

/**
 * 格式化用户返回数据：
 * - 去掉 password_hash
 * - role / gender / status 转为前端小写格式
 */
function formatUser(user) {
  const { password_hash, ...rest } = user;
  return {
    ...rest,
    role: fromPrismaRole(user.role),
    status: fromPrismaStatus(user.status),
    profile: user.profile
      ? {
          ...user.profile,
          gender: fromPrismaGender(user.profile.gender),
        }
      : null,
  };
}

function cleanOptionalString(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

async function assertUniqueContact({ user_id, phone, email }) {
  const conflicts = [];

  if (phone) {
    const phoneUser = await prisma.user.findFirst({
      where: { phone, NOT: { user_id } },
    });
    if (phoneUser) conflicts.push('手机号已被注册');
  }

  if (email) {
    const emailUser = await prisma.user.findFirst({
      where: { email, NOT: { user_id } },
    });
    if (emailUser) conflicts.push('邮箱已被注册');
  }

  if (conflicts.length > 0) {
    const err = new Error(conflicts.join('；'));
    err.code = 40003;
    throw err;
  }
}

// ---------- 公开方法 ----------

/**
 * 注册新用户（同时创建 users 和 user_profiles）
 */
async function register(params) {
  const {
    username,
    password,
    role,          // 前端传入小写：admin / teacher / student
    phone,         // 可选
    email,         // 可选
    real_name,     // 可选
    gender,        // 可选，前端传入小写：male / female / unknown
    student_no,    // 可选
    teacher_no,    // 可选
    college,       // 可选
    major,         // 可选
    grade,         // 可选
    admin_class_id,// 可选
    avatar_url,    // 可选
  } = params;

  // 1. 字段校验
  if (!username || !password || !role) {
    const err = new Error('用户名、密码、角色不能为空');
    err.code = 40001;
    throw err;
  }

  // 2. 角色映射
  const prismaRole = toPrismaRole(role);
  const prismaGender = toPrismaGender(gender);

  // 3. 唯一性检查（并行检查以提升性能）
  const conflicts = [];

  const existingUser = await prisma.user.findFirst({
    where: { username },
  });
  if (existingUser) conflicts.push('用户名已存在');

  if (phone) {
    const phoneUser = await prisma.user.findFirst({ where: { phone } });
    if (phoneUser) conflicts.push('手机号已被注册');
  }

  if (email) {
    const emailUser = await prisma.user.findFirst({ where: { email } });
    if (emailUser) conflicts.push('邮箱已被注册');
  }

  if (student_no) {
    const dupStudentNo = await prisma.userProfile.findFirst({
      where: { student_no },
    });
    if (dupStudentNo) conflicts.push('学号已被占用');
  }

  if (teacher_no) {
    const dupTeacherNo = await prisma.userProfile.findFirst({
      where: { teacher_no },
    });
    if (dupTeacherNo) conflicts.push('教师工号已被占用');
  }

  if (conflicts.length > 0) {
    const err = new Error(conflicts.join('；'));
    err.code = 40003;
    throw err;
  }

  // 4. 密码加密
  const saltRounds = 10;
  const password_hash = await bcrypt.hash(password, saltRounds);

  // 5. 使用事务创建 User + UserProfile
  const result = await prisma.$transaction(async (tx) => {
    // 创建 users 记录
    const user = await tx.user.create({
      data: {
        username,
        password_hash,
        role: prismaRole,
        phone: phone || null,
        email: email || null,
      },
    });

    // 创建 user_profiles 记录
    const profile = await tx.userProfile.create({
      data: {
        user_id: user.user_id,
        real_name: real_name || username,
        gender: prismaGender,
        student_no: student_no || null,
        teacher_no: teacher_no || null,
        college: college || null,
        major: major || null,
        grade: grade || null,
        admin_class_id: admin_class_id || null,
        avatar_url: avatar_url || null,
      },
    });

    return { ...user, profile };
  });

  // 6. 格式化并返回（去掉 password_hash）
  return formatUser(result);
}

/**
 * 登录
 * account 支持 username / phone / email
 */
async function login({ account, password }) {
  // 1. 参数校验
  if (!account || !password) {
    const err = new Error('账号和密码不能为空');
    err.code = 40001;
    throw err;
  }

  // 2. 查找用户：按 username / phone / email 匹配
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: account },
        { phone: account },
        { email: account },
      ],
    },
    include: {
      profile: true,
    },
  });

  if (!user) {
    const err = new Error('账号或密码错误');
    err.code = 40007;
    throw err;
  }

  // 3. 检查用户状态
  if (user.status === 'DISABLED') {
    const err = new Error('账号已被禁用');
    err.code = 40008;
    throw err;
  }

  // 4. 验证密码
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    const err = new Error('账号或密码错误');
    err.code = 40007;
    throw err;
  }

  // 5. 更新最后登录时间
  await prisma.user.update({
    where: { user_id: user.user_id },
    data: { last_login_at: new Date() },
  });

  // 6. 生成 JWT
  const token = signToken({
    user_id: user.user_id,
    role: fromPrismaRole(user.role),
  });

  // 7. 返回 token 和用户信息
  return {
    token,
    user: formatUser(user),
  };
}

/**
 * 查询当前登录用户信息
 * @param {number} user_id - 从 token 中解出的用户 ID
 */
async function getMe(user_id) {
  const user = await prisma.user.findUnique({
    where: { user_id },
    include: {
      profile: {
        include: {
          admin_class: true,
        },
      },
    },
  });

  if (!user) {
    const err = new Error('用户不存在');
    err.code = 40008;
    throw err;
  }

  return formatUser(user);
}

async function updateMe(user_id, params) {
  const user = await prisma.user.findUnique({
    where: { user_id },
    include: { profile: true },
  });

  if (!user) {
    const err = new Error('用户不存在');
    err.code = 40008;
    throw err;
  }

  const userData = {};
  if (Object.prototype.hasOwnProperty.call(params, 'phone')) {
    userData.phone = cleanOptionalString(params.phone);
  }
  if (Object.prototype.hasOwnProperty.call(params, 'email')) {
    userData.email = cleanOptionalString(params.email);
  }
  await assertUniqueContact({ user_id, phone: userData.phone, email: userData.email });

  const realName = cleanOptionalString(params.real_name);
  const profileData = {};
  if (Object.prototype.hasOwnProperty.call(params, 'real_name')) {
    profileData.real_name = realName || user.profile?.real_name || user.username;
  }
  if (Object.prototype.hasOwnProperty.call(params, 'gender')) {
    profileData.gender = params.gender ? toPrismaGender(params.gender) : 'UNKNOWN';
  }
  for (const key of ['college', 'major', 'grade']) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      profileData[key] = cleanOptionalString(params[key]);
    }
  }

  const ops = [];
  if (Object.keys(userData).length > 0) {
    ops.push(prisma.user.update({
      where: { user_id },
      data: userData,
    }));
  }
  if (Object.keys(profileData).length > 0) {
    ops.push(prisma.userProfile.upsert({
      where: { user_id },
      update: profileData,
      create: {
        user_id,
        real_name: profileData.real_name || user.username,
        gender: profileData.gender || 'UNKNOWN',
        college: profileData.college,
        major: profileData.major,
        grade: profileData.grade,
      },
    }));
  }

  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }

  return getMe(user_id);
}

async function updateAvatar(user_id, avatar_url) {
  const user = await prisma.user.findUnique({
    where: { user_id },
    include: { profile: true },
  });

  if (!user) {
    const err = new Error('用户不存在');
    err.code = 40008;
    throw err;
  }

  await prisma.userProfile.upsert({
    where: { user_id },
    update: { avatar_url },
    create: {
      user_id,
      real_name: user.username,
      gender: 'UNKNOWN',
      avatar_url,
    },
  });

  return getMe(user_id);
}

async function changePassword(user_id, { current_password, new_password }) {
  if (!current_password || !new_password) {
    const err = new Error('当前密码和新密码不能为空');
    err.code = 40001;
    throw err;
  }

  if (String(new_password).length < 6) {
    const err = new Error('新密码长度不能少于 6 位');
    err.code = 40001;
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { user_id } });
  if (!user) {
    const err = new Error('用户不存在');
    err.code = 40008;
    throw err;
  }

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) {
    const err = new Error('当前密码不正确');
    err.code = 40007;
    throw err;
  }

  const password_hash = await bcrypt.hash(new_password, 10);
  await prisma.user.update({
    where: { user_id },
    data: { password_hash },
  });

  return true;
}

module.exports = { register, login, getMe, updateMe, updateAvatar, changePassword };
