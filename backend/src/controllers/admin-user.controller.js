// 管理员端用户管理控制器

const { success, fail } = require('../utils/response');
const userService = require('../services/admin-user.service');

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
    const userId = parseInt(req.params.user_id, 10);
    if (!userId || userId < 1) {
      return fail(res, 40001, '用户 ID 不合法');
    }

    const { status } = req.body;
    if (!status || !['active', 'disabled'].includes(status)) {
      return fail(res, 40001, '状态值不合法，仅支持 active / disabled');
    }

    const data = await userService.updateUserStatus(userId, status);
    return success(res, data, '用户状态已更新');
  } catch (err) {
    console.error('[admin-user] updateUserStatus error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function resetUserPassword(req, res) {
  try {
    const userId = parseInt(req.params.user_id, 10);
    if (!userId || userId < 1) {
      return fail(res, 40001, '用户 ID 不合法');
    }

    const { new_password } = req.body;
    if (!new_password || String(new_password).length < 6) {
      return fail(res, 40001, '密码不能少于 6 位');
    }

    const data = await userService.resetUserPassword(userId, new_password);
    return success(res, data, '密码已重置');
  } catch (err) {
    console.error('[admin-user] resetUserPassword error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function deleteUser(req, res) {
  try {
    const userId = parseInt(req.params.user_id, 10);
    if (!userId || userId < 1) {
      return fail(res, 40001, '用户 ID 不合法');
    }

    const data = await userService.deleteUser(userId);
    return success(res, data, '用户已禁用');
  } catch (err) {
    console.error('[admin-user] deleteUser error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function updateUser(req, res) {
  try {
    const userId = parseInt(req.params.user_id, 10);
    if (!userId || userId < 1) {
      return fail(res, 40001, '用户 ID 不合法');
    }
    const data = await userService.updateUser(userId, req.body || {});
    return success(res, data, '用户信息已更新');
  } catch (err) {
    console.error('[admin-user] updateUser error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function createUser(req, res) {
  try {
    const data = await userService.createUser(req.body || {});
    return success(res, data, '用户创建成功');
  } catch (err) {
    console.error('[admin-user] createUser error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

module.exports = { getUserList, updateUserStatus, resetUserPassword, deleteUser, updateUser, createUser };
