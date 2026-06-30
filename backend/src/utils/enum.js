// 枚举映射工具
// 前端传入小写值（如 admin / male），Prisma 使用大写枚举名（如 ADMIN / MALE）
// 本模块提供双向转换，确保接口层与数据库层正确对接

// ---------- role 映射 ----------

const ROLE_TO_PRISMA = {
  admin: 'ADMIN',
  teacher: 'TEACHER',
  student: 'STUDENT',
};

const ROLE_FROM_PRISMA = {
  ADMIN: 'admin',
  TEACHER: 'teacher',
  STUDENT: 'student',
};

// ---------- gender 映射 ----------

const GENDER_TO_PRISMA = {
  male: 'MALE',
  female: 'FEMALE',
  unknown: 'UNKNOWN',
};

const GENDER_FROM_PRISMA = {
  MALE: 'male',
  FEMALE: 'female',
  UNKNOWN: 'unknown',
};

// ---------- status 映射 ----------

const STATUS_FROM_PRISMA = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
};

/**
 * 将前端 role 转为 Prisma 枚举值
 * @param {string} role - 前端传入的角色（admin / teacher / student）
 * @returns {string} Prisma 枚举值（ADMIN / TEACHER / STUDENT）
 */
function toPrismaRole(role) {
  const val = ROLE_TO_PRISMA[role];
  if (!val) {
    throw new Error(`无效的角色: ${role}`);
  }
  return val;
}

/**
 * 将 Prisma role 转为前端小写格式
 */
function fromPrismaRole(prismaRole) {
  return ROLE_FROM_PRISMA[prismaRole] || prismaRole.toLowerCase();
}

/**
 * 将前端 gender 转为 Prisma 枚举值
 * @param {string} gender - 前端传入的性别（male / female / unknown）
 * @returns {string} Prisma 枚举值（MALE / FEMALE / UNKNOWN）
 */
function toPrismaGender(gender) {
  if (!gender) return 'UNKNOWN';
  const val = GENDER_TO_PRISMA[gender];
  if (!val) {
    throw new Error(`无效的性别: ${gender}`);
  }
  return val;
}

/**
 * 将 Prisma gender 转为前端小写格式
 */
function fromPrismaGender(prismaGender) {
  return GENDER_FROM_PRISMA[prismaGender] || prismaGender.toLowerCase();
}

/**
 * 将 Prisma status 转为前端小写格式
 */
function fromPrismaStatus(prismaStatus) {
  return STATUS_FROM_PRISMA[prismaStatus] || prismaStatus.toLowerCase();
}

module.exports = {
  toPrismaRole,
  fromPrismaRole,
  toPrismaGender,
  fromPrismaGender,
  fromPrismaStatus,
};
