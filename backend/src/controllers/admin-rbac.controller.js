const { success, fail } = require('../utils/response');
const service = require('../services/admin-permission.service');
const schemas = require('../services/admin-rbac.schemas');

function parse(schema, value) {
  const result = schema.safeParse(value || {});
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || '参数'}：${issue.message}`).join('；');
    throw Object.assign(new Error(message), { code: 40001 });
  }
  return result.data;
}

function action(handler, message) {
  return async (req, res) => {
    try {
      return success(res, await handler(req), message);
    } catch (error) {
      return fail(res, error.code || 50001, error.message);
    }
  };
}

const getMyAccess = action(
  (req) => service.getUserAccess(req.user.user_id, req.user.role),
  '获取当前管理员权限成功',
);
const getOverview = action(() => service.getRbacOverview(), '获取管理员权限总览成功');
const replaceUserRoles = action(
  (req) => service.replaceUserRoles(req.params.user_id, parse(schemas.roleAssignmentInput, req.body), req),
  '管理员角色已更新',
);
const replaceRolePermissions = action(
  (req) => service.replaceRolePermissions(req.params.role_code, parse(schemas.rolePermissionInput, req.body), req),
  '角色权限已更新',
);

module.exports = { getMyAccess, getOverview, replaceUserRoles, replaceRolePermissions };
