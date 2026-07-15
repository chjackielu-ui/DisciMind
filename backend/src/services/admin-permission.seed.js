const { PERMISSION_DEFINITIONS, ROLE_DEFINITIONS } = require('./admin-permission.catalog');

async function seedPermissionCatalog(db, { assignUncoveredAdmins = true, grantedBy = null } = {}) {
  const roleRecords = new Map();
  const permissionRecords = new Map();

  for (const definition of ROLE_DEFINITIONS) {
    const record = await db.adminRole.upsert({
      where: { role_code: definition.code },
      create: {
        role_code: definition.code,
        name: definition.name,
        description: definition.description,
        built_in: true,
        enabled: true,
      },
      update: {
        name: definition.name,
        description: definition.description,
        built_in: true,
        enabled: true,
      },
    });
    roleRecords.set(definition.code, record);
  }

  for (const definition of PERMISSION_DEFINITIONS) {
    const record = await db.adminPermission.upsert({
      where: { permission_key: definition.key },
      create: {
        permission_key: definition.key,
        module: definition.module,
        name: definition.name,
        description: definition.description || null,
        sensitive: Boolean(definition.sensitive),
      },
      update: {
        module: definition.module,
        name: definition.name,
        description: definition.description || null,
        sensitive: Boolean(definition.sensitive),
      },
    });
    permissionRecords.set(definition.key, record);
  }

  for (const definition of ROLE_DEFINITIONS) {
    const roleRecord = roleRecords.get(definition.code);
    const desiredIds = definition.permissions.map((key) => permissionRecords.get(key).id);
    await db.adminRolePermission.deleteMany({
      where: { role_id: roleRecord.id, permission_id: { notIn: desiredIds } },
    });
    for (const permissionId of desiredIds) {
      await db.adminRolePermission.upsert({
        where: { role_id_permission_id: { role_id: roleRecord.id, permission_id: permissionId } },
        create: { role_id: roleRecord.id, permission_id: permissionId, granted_by: grantedBy },
        update: {},
      });
    }
  }

  let assignedAdmins = 0;
  if (assignUncoveredAdmins) {
    const now = new Date();
    const admins = await db.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: {
        user_id: true,
        admin_role_assignments: {
          where: {
            role: { enabled: true },
            OR: [{ expires_at: null }, { expires_at: { gt: now } }],
          },
          select: { id: true },
        },
      },
    });
    const superAdmin = roleRecords.get('super_admin');
    for (const admin of admins) {
      if (admin.admin_role_assignments.length) continue;
      await db.adminUserRole.upsert({
        where: { user_id_role_id: { user_id: admin.user_id, role_id: superAdmin.id } },
        create: { user_id: admin.user_id, role_id: superAdmin.id, granted_by: grantedBy },
        update: { expires_at: null, granted_by: grantedBy },
      });
      assignedAdmins += 1;
    }
  }

  return {
    roles: ROLE_DEFINITIONS.length,
    permissions: PERMISSION_DEFINITIONS.length,
    assigned_admins: assignedAdmins,
  };
}

module.exports = { seedPermissionCatalog };
