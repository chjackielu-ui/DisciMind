// 管理员端用户管理控制器

const { success, fail } = require('../utils/response');
const userService = require('../services/admin-user.service');
const { recordAdminOperation } = require('../services/admin-audit.service');

function parseUserId(value) {
  const userId = parseInt(value, 10);
  if (!userId || userId < 1) throw Object.assign(new Error('用户 ID 不合法'), { code: 40001 });
  return userId;
}

async function mutationFailure(req, operationType, err) {
  await recordAdminOperation({
    req,
    operationType,
    targetType: 'user',
    targetId: Number(req.params?.user_id) || null,
    success: false,
    failureReason: err.message,
  });
  return err;
}

async function getUserList(req, res) {
  try {
    const data = await userService.getUserList(req.query || {});
    return success(res, data, '获取用户列表成功');
  } catch (err) {
    console.error('[admin-user] getUserList error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function updateUserStatus(req, res) {
  try {
    const userId = parseUserId(req.params.user_id);

    const { status } = req.body;
    if (!status || !['active', 'disabled'].includes(status)) {
      throw Object.assign(new Error('状态值不合法，仅支持 active / disabled'), { code: 40001 });
    }

    const data = await userService.updateUserStatus(userId, status, req);
    return success(res, data, '用户状态已更新');
  } catch (err) {
    console.error('[admin-user] updateUserStatus error:', err.message);
    await mutationFailure(req, 'UPDATE_USER_STATUS', err);
    return fail(res, err.code || 50001, err.message);
  }
}

async function resetUserPassword(req, res) {
  try {
    const userId = parseUserId(req.params.user_id);

    const { new_password } = req.body;
    if (!new_password || String(new_password).length < 6) {
      throw Object.assign(new Error('密码不能少于 6 位'), { code: 40001 });
    }

    const data = await userService.resetUserPassword(userId, new_password, req);
    return success(res, data, '密码已重置');
  } catch (err) {
    console.error('[admin-user] resetUserPassword error:', err.message);
    await mutationFailure(req, 'RESET_USER_PASSWORD', err);
    return fail(res, err.code || 50001, err.message);
  }
}

async function deleteUser(req, res) {
  try {
    const userId = parseUserId(req.params.user_id);

    const data = await userService.deleteUser(userId, req);
    return success(res, data, '用户账号已移除（软删除）');
  } catch (err) {
    console.error('[admin-user] deleteUser error:', err.message);
    await mutationFailure(req, 'SOFT_DELETE_USER', err);
    return fail(res, err.code || 50001, err.message);
  }
}

async function updateUser(req, res) {
  try {
    const userId = parseUserId(req.params.user_id);
    const data = await userService.updateUser(userId, req.body || {}, req);
    return success(res, data, '用户信息已更新');
  } catch (err) {
    console.error('[admin-user] updateUser error:', err.message);
    await mutationFailure(req, 'UPDATE_USER', err);
    return fail(res, err.code || 50001, err.message);
  }
}

async function createUser(req, res) {
  try {
    const data = await userService.createUser(req.body || {}, req);
    return success(res, data, '用户创建成功');
  } catch (err) {
    console.error('[admin-user] createUser error:', err.message);
    await mutationFailure(req, 'CREATE_USER', err);
    return fail(res, err.code || 50001, err.message);
  }
}

module.exports = { getUserList, updateUserStatus, resetUserPassword, deleteUser, updateUser, createUser };
