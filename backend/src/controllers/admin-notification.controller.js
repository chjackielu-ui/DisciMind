// 管理员端通知管理控制器

const { success, fail } = require('../utils/response');
const notificationService = require('../services/admin-notification.service');

async function getNotificationList(req, res) {
  try {
    const data = await notificationService.getNotificationList(req.query || {});
    return success(res, data, '获取通知列表成功');
  } catch (err) {
    console.error('[admin-notification] getNotificationList error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function createNotification(req, res) {
  try {
    const data = await notificationService.createNotification(req.body || {}, req.user.user_id);
    return success(res, data, '通知发送成功');
  } catch (err) {
    console.error('[admin-notification] createNotification error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function markNotificationRead(req, res) {
  try {
    const notificationId = parseInt(req.params.notification_id, 10);
    if (!notificationId || notificationId < 1) {
      return fail(res, 40001, '通知 ID 不合法');
    }
    const data = await notificationService.markNotificationRead(notificationId);
    return success(res, data, '通知已标记为已读');
  } catch (err) {
    console.error('[admin-notification] markNotificationRead error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return fail(res, 40001, '用户 ID 不能为空');
    }
    const data = await notificationService.markAllNotificationsRead(parseInt(user_id, 10));
    return success(res, data, '所有通知已标记为已读');
  } catch (err) {
    console.error('[admin-notification] markAllNotificationsRead error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

module.exports = { getNotificationList, createNotification, markNotificationRead, markAllNotificationsRead };
