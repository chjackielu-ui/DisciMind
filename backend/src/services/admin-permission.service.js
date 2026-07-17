const prisma = require('../config/prisma');
const { safeSummary } = require('./admin-audit.service');
const { ALL_PERMISSIONS, ROLE_BY_CODE } = require('./admin-permission.catalog');
const { seedPermissionCatalog: seedCatalog } = require('./admin-permission.seed');

const PERMISSIONS = ALL_PERMISSIONS;

function publicError(message, code = 40001) {
  return Object.assign(new Error(message), { code });
}

function validAssignmentWhere(now = new Date()) {
  return {
    role: { enabled: true },
    OR: [{ expires_at: null }, { expires_at: { gt: now } }],
  };
}

async function getUserAccess(userId, legacyRole) {
  if (String(legacyRole).toLowerCase() !== 'admin') return { role_codes: [], permissions: [] };
  const assignments = await prisma.adminUserRole.findMany({
    where: { user_id: Number(userId), ...validAssignmentWhere() },
    select: {
      role: {
        select: {
          role_code: true,
          role_permissions: { select: { permission: { select: { permission_key: true } } } },
        },
      },
    },
  });
  const roleCodes = assignments.map((item) => item.role.role_code).sort();
  const permissions = [...new Set(assignments.flatMap((item) => (
    item.role.role_permissions.map((entry) => entry.permission.permission_key)
  )))].sort();
  return { role_codes: roleCodes, permissions };
}

async function getUserPermissions(userId, legacyRole) {
  return (await getUserAccess(userId, legacyRole)).permissions;
}

function requireAdminPermission(permission) {
  if (!PERMISSIONS.includes(permission)) throw new Error(`unknown admin permission: ${permission}`);
  return async (req, res, next) => {
    try {
      const access = await getUserAccess(req.user?.user_id, req.user?.role);
      if (!access.permissions.includes(permission)) {
        return res.status(403).json({ code: 40301, message: '权限不足，无法执行该管理操作', data: null });
      }
      req.adminRoles = access.role_codes;
      req.adminPermissions = access.permissions;
      req.adminPermission = permission;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function operationLogData(req, operationType, targetType, targetId, before, after) {
  return {
    user_id: Number(req?.user?.user_id) || null,
    role: req?.user?.role ? String(req.user.role).toUpperCase() : null,
    operation_type: operationType,
    operation_desc: `成功执行 ${operationType}`,
    target_type: targetType,
    target_id: Number(targetId) || null,
    ip_address: String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 50) || null,
    request_id: String(req?.id || '').slice(0, 100) || null,
    action_status: 'success',
    before_summary_json: safeSummary(before),
    after_summary_json: safeSummary(after),
  };
}

async function seedPermissionCatalog(options = {}) {
  return prisma.$transaction((tx) => seedCatalog(tx, options));
}

async function getRbacOverview() {
  const now = new Date();
  const [roles, permissions, admins] = await Promise.all([
    prisma.adminRole.findMany({
      orderBy: [{ built_in: 'desc' }, { id: 'asc' }],
      include: {
        role_permissions: {
          include: { permission: true },
          orderBy: { permission: { permission_key: 'asc' } },
        },
        user_roles: {
          where: { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
          select: { user_id: true },
        },
      },
    }),
    prisma.adminPermission.findMany({ orderBy: [{ module: 'asc' }, { permission_key: 'asc' }] }),
    prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { user_id: 'asc' },
      select: {
        user_id: true,
        username: true,
        status: true,
        profile: { select: { real_name: true } },
        admin_role_assignments: {
          where: { OR: [{ expires_at: null }, { expires_at: { gt: now } }], role: { enabled: true } },
          select: { expires_at: true, role: { select: { role_code: true, name: true } } },
        },
      },
    }),
  ]);

  return {
    roles: roles.map((item) => ({
      id: item.id,
      role_code: item.role_code,
      name: item.name,
      description: item.description,
      built_in: item.built_in,
      enabled: item.enabled,
      permission_keys: item.role_permissions.map((entry) => entry.permission.permission_key),
      assigned_user_count: item.user_roles.length,
    })),
    permissions: permissions.map((item) => ({
      id: item.id,
      permission_key: item.permission_key,
      module: item.module,
      name: item.name,
      description: item.description,
      sensitive: item.sensitive,
    })),
    admins: admins.map((item) => ({
      user_id: item.user_id,
      username: item.username,
      real_name: item.profile?.real_name || item.username,
      status: String(item.status).toLowerCase(),
      roles: item.admin_role_assignments.map((assignment) => ({
        role_code: assignment.role.role_code,
        name: assignment.role.name,
        expires_at: assignment.expires_at,
      })),
    })),
  };
}

async function replaceUserRoles(userId, { role_codes: roleCodes, expires_at: expiresAt }, req) {
  const targetId = Number(userId);
  if (!Number.isInteger(targetId) || targetId < 1) throw publicError('管理员用户 ID 不合法');
  const normalizedCodes = [...new Set((roleCodes || []).map((value) => String(value).trim()).filter(Boolean))];
  if (!normalizedCodes.length) throw publicError('管理员至少需要一个有效角色');
  const expiration = expiresAt ? new Date(expiresAt) : null;
  if (expiration && (!Number.isFinite(expiration.getTime()) || expiration <= new Date())) {
    throw publicError('角色有效期必须晚于当前时间');
  }

  const [target, roles] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: targetId },
      select: {
        user_id: true,
        username: true,
        role: true,
        status: true,
        admin_role_assignments: { select: { role: { select: { role_code: true } }, expires_at: true } },
      },
    }),
    prisma.adminRole.findMany({
      where: { role_code: { in: normalizedCodes }, enabled: true },
      include: { role_permissions: { include: { permission: true } } },
    }),
  ]);
  if (!target || target.role !== 'ADMIN') throw publicError('目标用户不是管理员', 40002);
  if (target.status !== 'ACTIVE') throw publicError('已禁用管理员不能分配有效角色', 40002);
  if (roles.length !== normalizedCodes.length) throw publicError('包含不存在或已停用的管理员角色');

  const selectedPermissions = new Set(roles.flatMap((item) => (
    item.role_permissions.map((entry) => entry.permission.permission_key)
  )));
  if (Number(req?.user?.user_id) === targetId && !selectedPermissions.has('admin.system.manage')) {
    throw publicError('不能移除自己当前会话的系统管理权限', 40301);
  }

  const beforeCodes = target.admin_role_assignments.map((item) => item.role.role_code);
  if (beforeCodes.includes('super_admin') && !normalizedCodes.includes('super_admin')) {
    const otherSuperAdmins = await prisma.adminUserRole.count({
      where: {
        user_id: { not: targetId },
        ...validAssignmentWhere(),
        role: { role_code: 'super_admin', enabled: true },
        user: { role: 'ADMIN', status: 'ACTIVE' },
      },
    });
    if (!otherSuperAdmins) throw publicError('系统必须至少保留一名有效超级管理员', 40901);
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUserRole.deleteMany({ where: { user_id: targetId } });
    await tx.adminUserRole.createMany({
      data: roles.map((item) => ({
        user_id: targetId,
        role_id: item.id,
        granted_by: Number(req?.user?.user_id) || null,
        expires_at: expiration,
      })),
    });
    await tx.operationLog.create({
      data: operationLogData(req, 'REPLACE_ADMIN_USER_ROLES', 'admin_user_role', targetId,
        { username: target.username, role_codes: beforeCodes },
        { username: target.username, role_codes: normalizedCodes, expires_at: expiration }),
    });
  });
  return { user_id: targetId, role_codes: normalizedCodes, expires_at: expiration };
}

async function replaceRolePermissions(roleCode, { permission_keys: permissionKeys }, req) {
  const code = String(roleCode || '').trim();
  const normalizedKeys = [...new Set((permissionKeys || []).map((value) => String(value).trim()).filter(Boolean))];
  if (!ROLE_BY_CODE[code]) throw publicError('只能调整系统内置管理员角色', 40002);
  if (!normalizedKeys.length) throw publicError('角色至少需要一个权限');
  if (normalizedKeys.some((key) => !PERMISSIONS.includes(key))) throw publicError('包含未知管理员权限');
  if (code === 'super_admin' && normalizedKeys.length !== PERMISSIONS.length) {
    throw publicError('超级管理员必须保留完整权限', 40301);
  }

  const [roleRecord, permissions] = await Promise.all([
    prisma.adminRole.findUnique({
      where: { role_code: code },
      include: { role_permissions: { include: { permission: true } } },
    }),
    prisma.adminPermission.findMany({ where: { permission_key: { in: normalizedKeys } } }),
  ]);
  if (!roleRecord || !roleRecord.enabled) throw publicError('管理员角色不存在或已停用', 40002);
  if (permissions.length !== normalizedKeys.length) throw publicError('权限目录尚未完整初始化', 50001);
  const beforeKeys = roleRecord.role_permissions.map((entry) => entry.permission.permission_key).sort();

  await prisma.$transaction(async (tx) => {
    await tx.adminRolePermission.deleteMany({ where: { role_id: roleRecord.id } });
    await tx.adminRolePermission.createMany({
      data: permissions.map((permission) => ({
        role_id: roleRecord.id,
        permission_id: permission.id,
        granted_by: Number(req?.user?.user_id) || null,
      })),
    });
    await tx.operationLog.create({
      data: operationLogData(req, 'REPLACE_ADMIN_ROLE_PERMISSIONS', 'admin_role', roleRecord.id,
        { role_code: code, permission_keys: beforeKeys },
        { role_code: code, permission_keys: normalizedKeys }),
    });
  });
  return { role_code: code, permission_keys: normalizedKeys.sort() };
}

module.exports = {
  PERMISSIONS,
  getUserAccess,
  getUserPermissions,
  requireAdminPermission,
  seedPermissionCatalog,
  getRbacOverview,
  replaceUserRoles,
  replaceRolePermissions,
};
