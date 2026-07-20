// Auth Service — 认证业务逻辑层
// 所有数据库操作使用统一的 prisma 实例（从 ../config/prisma 导入）

const bcrypt = require('bcryptjs');
const { initializeNewStudent } = require('./student-cold-start.service');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');
const {
  toPrismaRole,
  fromPrismaRole,
  toPrismaGender,
  fromPrismaGender,
  fromPrismaStatus,
} = require('../utils/enum');

const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 14);
const REFRESH_TOKEN_TTL_MS = Math.max(1, REFRESH_TOKEN_DAYS) * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_COOKIE_NAME = process.env.REFRESH_TOKEN_COOKIE_NAME || 'discimind_refresh_token';

// 会话空闲超时：30分钟无操作自动退出
const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MINUTES || 30) * 60 * 1000;
// 会话活动更新节流：至少间隔1分钟才更新数据库
const SESSION_TOUCH_THROTTLE_MS = 60 * 1000;
const LOGIN_PORTAL_ROLES = new Set(['student', 'teacher', 'admin']);
const LOGIN_PORTAL_LABELS = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
};

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

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createRawRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function getRefreshTokenExpiresAt() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
}

function buildAccessToken(user, sessionId) {
  const payload = {
    user_id: user.user_id,
    role: fromPrismaRole(user.role),
  };
  if (sessionId) payload.session_id = sessionId;
  return signToken(payload);
}

function getClientMeta(meta = {}) {
  return {
    device_info: meta.deviceInfo ? String(meta.deviceInfo).slice(0, 255) : null,
    ip_address: meta.ipAddress ? String(meta.ipAddress).slice(0, 64) : null,
  };
}

async function createRefreshToken(userId, meta = {}) {
  const refreshToken = createRawRefreshToken();
  const expiresAt = getRefreshTokenExpiresAt();
  await prisma.refreshToken.create({
    data: {
      user_id: userId,
      token_hash: hashRefreshToken(refreshToken),
      expires_at: expiresAt,
      ...getClientMeta(meta),
    },
  });
  return { refreshToken, expiresAt };
}

async function revokeRefreshToken(rawToken) {
  if (!rawToken) return false;
  await prisma.refreshToken.updateMany({
    where: {
      token_hash: hashRefreshToken(rawToken),
      revoked_at: null,
    },
    data: { revoked_at: new Date() },
  });
  return true;
}

async function revokeAllRefreshTokensForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

// ---------- 会话管理 ----------

function getSessionExpiresAt() {
  return new Date(Date.now() + SESSION_IDLE_MS);
}

async function createSession(userId, refreshTokenId, meta = {}) {
  const expiresAt = getSessionExpiresAt();
  const session = await prisma.authSession.create({
    data: {
      user_id: userId,
      refresh_token_id: refreshTokenId || null,
      expires_at: expiresAt,
      last_activity_at: new Date(),
      ...getClientMeta(meta),
    },
  });
  return session;
}

async function validateSession(sessionId) {
  if (!sessionId) return null;
  const session = await prisma.authSession.findUnique({
    where: { session_id: sessionId },
    include: { user: { include: { profile: true } } },
  });
  if (!session || session.revoked_at) return null;
  if (new Date(session.expires_at) <= new Date()) return null;
  if (!session.user || session.user.status !== 'ACTIVE') return null;
  return session;
}

async function touchSession(sessionId) {
  if (!sessionId) return;
  const session = await prisma.authSession.findUnique({
    where: { session_id: sessionId },
  });
  if (!session || session.revoked_at) return;
  // 节流：距离上次更新不超过1分钟则跳过数据库写入
  const now = new Date();
  const lastTouch = new Date(session.last_activity_at);
  if (now - lastTouch < SESSION_TOUCH_THROTTLE_MS) return;
  const newExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  await prisma.authSession.update({
    where: { session_id: sessionId },
    data: { last_activity_at: now, expires_at: newExpiresAt },
  });
}

async function revokeSession(sessionId) {
  if (!sessionId) return false;
  await prisma.authSession.updateMany({
    where: { session_id: sessionId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  return true;
}

async function revokeAllSessionsForUser(userId) {
  await prisma.authSession.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

async function checkSessionIdle(sessionId) {
  if (!sessionId) return { valid: false, reason: 'no_session' };
  const session = await prisma.authSession.findUnique({
    where: { session_id: sessionId },
  });
  if (!session || session.revoked_at) {
    return { valid: false, reason: 'revoked' };
  }
  if (new Date(session.expires_at) <= new Date()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, session };
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
  const normalizedRole = String(role).trim().toLowerCase();
  if (normalizedRole === 'admin') {
    const err = new Error('管理员账号只能由已有管理员在管理端创建');
    err.code = 40301;
    throw err;
  }
  const teacherRegistrationEnabled = String(process.env.PUBLIC_TEACHER_REGISTRATION_ENABLED
    ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')).toLowerCase() === 'true';
  if (normalizedRole === 'teacher' && !teacherRegistrationEnabled) {
    const err = new Error('教师账号请联系管理员创建');
    err.code = 40301;
    throw err;
  }
  if (!['student', 'teacher'].includes(normalizedRole)) {
    const err = new Error(`无效的角色: ${role}`);
    err.code = 40001;
    throw err;
  }
  const prismaRole = toPrismaRole(normalizedRole);
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

    if (normalizedRole === 'student') {
      await initializeNewStudent(tx, user.user_id);
    }

    return { ...user, profile };
  });

  // 6. 格式化并返回（去掉 password_hash）
  return formatUser(result);
}

/**
 * 登录
 * account 支持 username / phone / email
 */
async function login({ account, password, role, deviceInfo, ipAddress }) {
  // 1. 参数校验
  if (!account || !password) {
    const err = new Error('账号和密码不能为空');
    err.code = 40001;
    throw err;
  }

  // role 为登录页所选入口。保留省略 role 的兼容性，供既有可信服务调用；
  // 浏览器登录必须传入它，服务端据此强制账号与入口角色一致。
  const portalRole = role == null || role === '' ? null : String(role).trim().toLowerCase();
  if (portalRole && !LOGIN_PORTAL_ROLES.has(portalRole)) {
    const err = new Error('无效的登录入口角色');
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

  const actualRole = fromPrismaRole(user.role);
  if (portalRole && actualRole !== portalRole) {
    const err = new Error(`当前为${LOGIN_PORTAL_LABELS[portalRole]}登录入口，请切换到${LOGIN_PORTAL_LABELS[actualRole] || '对应'}登录后重试`);
    err.code = 40009;
    throw err;
  }

  // 5. 更新最后登录时间
  await prisma.user.update({
    where: { user_id: user.user_id },
    data: { last_login_at: new Date() },
  });

  // 6. 创建 AuthSession
  const session = await createSession(user.user_id, null, { deviceInfo, ipAddress });

  // 7. 生成短期 Access Token（含 sessionId）+ 长期 Refresh Token
  const token = buildAccessToken(user, session.session_id);
  const refresh = await createRefreshToken(user.user_id, { deviceInfo, ipAddress });

  // 关联 refresh token 到 session
  await prisma.refreshToken.update({
    where: { token_hash: hashRefreshToken(refresh.refreshToken) },
    data: { session_id: session.session_id },
  });

  // 8. 返回 token 和用户信息
  return {
    token,
    accessToken: token,
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '20m',
    refreshToken: refresh.refreshToken,
    refreshTokenExpiresAt: refresh.expiresAt,
    sessionId: session.session_id,
    user: formatUser(user),
  };
}

async function refreshSession(rawRefreshToken, meta = {}) {
  if (!rawRefreshToken) {
    const err = new Error('Refresh Token 缺失');
    err.code = 40101;
    throw err;
  }

  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { token_hash: hashRefreshToken(rawRefreshToken) },
    include: { user: { include: { profile: true } } },
  });

  if (!tokenRecord || tokenRecord.revoked_at || new Date(tokenRecord.expires_at) <= new Date()) {
    const err = new Error('登录状态已过期，请重新登录');
    err.code = 40102;
    throw err;
  }

  if (!tokenRecord.user || tokenRecord.user.status !== 'ACTIVE') {
    await revokeRefreshToken(rawRefreshToken);
    const err = new Error('账号不存在或已被禁用，请重新登录');
    err.code = 40102;
    throw err;
  }

  await prisma.refreshToken.update({
    where: { refresh_token_id: tokenRecord.refresh_token_id },
    data: {
      last_used_at: new Date(),
      ...getClientMeta(meta),
    },
  });

  // 如果 refresh token 有关联 session，验证并续期
  let sessionId = null;
  if (tokenRecord.session_id) {
    const sessionCheck = await checkSessionIdle(tokenRecord.session_id);
    if (!sessionCheck.valid) {
      await revokeRefreshToken(rawRefreshToken);
      const err = new Error('登录会话已过期，请重新登录');
      err.code = 40102;
      throw err;
    }
    await touchSession(tokenRecord.session_id);
    sessionId = tokenRecord.session_id;
  }

  const token = buildAccessToken(tokenRecord.user, sessionId);

  return {
    token,
    accessToken: token,
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '20m',
    sessionId,
    user: formatUser(tokenRecord.user),
  };
}

async function logout(rawRefreshToken) {
  // 撤销 refresh token
  await revokeRefreshToken(rawRefreshToken);
  // 如果 refresh token 关联了 session，也撤销 session
  if (rawRefreshToken) {
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token_hash: hashRefreshToken(rawRefreshToken) },
    });
    if (tokenRecord?.session_id) {
      await revokeSession(tokenRecord.session_id);
    }
  }
  return true;
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
  if (user.status !== 'ACTIVE') {
    const err = new Error('账号已被禁用');
    err.code = 40102;
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
  await prisma.$transaction([
    prisma.user.update({
      where: { user_id },
      data: { password_hash },
    }),
    prisma.refreshToken.updateMany({
      where: { user_id, revoked_at: null },
      data: { revoked_at: new Date() },
    }),
    prisma.authSession.updateMany({
      where: { user_id, revoked_at: null },
      data: { revoked_at: new Date() },
    }),
  ]);

  return true;
}

async function revokeUserSessions(userId) {
  await revokeAllRefreshTokensForUser(userId);
  await revokeAllSessionsForUser(userId);
  return true;
}

module.exports = {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_TTL_MS,
  SESSION_IDLE_MS,
  register,
  login,
  refreshSession,
  logout,
  getMe,
  updateMe,
  updateAvatar,
  changePassword,
  revokeUserSessions,
  createSession,
  validateSession,
  touchSession,
  revokeSession,
  checkSessionIdle,
};
