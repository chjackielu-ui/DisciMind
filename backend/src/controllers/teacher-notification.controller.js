// 教师端消息通知控制器

const { success, fail } = require('../utils/response');
const teacherNotificationService = require('../services/teacher-notification.service');

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    const err = new Error(`${name} 参数不合法`);
    err.code = 40001;
    throw err;
  }
  return parsed;
}

function handleError(res, scope, err) {
  console.error(`[teacher-notification.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function listNotifications(req, res) {
  try {
    const data = await teacherNotificationService.listNotifications(req.user, req.query || {});
    return success(res, data, '获取消息列表成功');
  } catch (err) {
    return handleError(res, 'listNotifications', err);
  }
}

async function markRead(req, res) {
  try {
    const notificationId = parsePositiveInt(req.params.notification_id, 'notification_id');
    const data = await teacherNotificationService.markRead(req.user, notificationId);
    return success(res, data, '标记已读成功');
  } catch (err) {
    return handleError(res, 'markRead', err);
  }
}

async function markAllRead(req, res) {
  try {
    const data = await teacherNotificationService.markAllRead(req.user);
    return success(res, data, '全部标记已读成功');
  } catch (err) {
    return handleError(res, 'markAllRead', err);
  }
}

async function getUnreadCount(req, res) {
  try {
    const data = await teacherNotificationService.getUnreadCount(req.user);
    return success(res, data, '获取未读数量成功');
  } catch (err) {
    return handleError(res, 'getUnreadCount', err);
  }
}

module.exports = {
  listNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
};
