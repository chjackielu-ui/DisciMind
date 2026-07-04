// 管理员端通知管理服务
// 提供通知的查询、创建、标记已读等功能

const prisma = require('../config/prisma');

const NOTIFICATION_TYPE_MAP = {
  task_published: 'TASK_PUBLISHED',
  task_deadline: 'TASK_DEADLINE',
  document_review: 'DOCUMENT_REVIEW',
  document_parsed: 'DOCUMENT_PARSED',
  ai_grading_done: 'AI_GRADING_DONE',
  system_notice: 'SYSTEM_NOTICE',
};

/**
 * 获取通知列表（分页 + 筛选）
 */
async function getNotificationList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = {};

  if (query.notification_type) {
    const nt = NOTIFICATION_TYPE_MAP[query.notification_type];
    if (nt) where.notification_type = nt;
  }

  if (query.is_read !== undefined && query.is_read !== '') {
    where.is_read = query.is_read === 'true' || query.is_read === true;
  }

  if (query.receiver_user_id) {
    where.receiver_user_id = parseInt(query.receiver_user_id, 10);
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        receiver: { include: { profile: true } },
        sender: { include: { profile: true } },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);

  const notificationTypeLabels = {
    TASK_PUBLISHED: 'task_published',
    TASK_DEADLINE: 'task_deadline',
    DOCUMENT_REVIEW: 'document_review',
    DOCUMENT_PARSED: 'document_parsed',
    AI_GRADING_DONE: 'ai_grading_done',
    SYSTEM_NOTICE: 'system_notice',
  };

  const list = notifications.map((n) => ({
    notification_id: n.notification_id,
    receiver_user_id: n.receiver_user_id,
    receiver_name: n.receiver?.profile?.real_name || n.receiver?.username || null,
    sender_user_id: n.sender_user_id,
    sender_name: n.sender?.profile?.real_name || n.sender?.username || null,
    notification_type: notificationTypeLabels[n.notification_type] || n.notification_type,
    title: n.title,
    content: n.content,
    target_type: n.target_type,
    target_id: n.target_id,
    is_read: n.is_read,
    read_at: n.read_at,
    created_at: n.created_at,
  }));

  return { list, total, page, page_size: pageSize };
}

/**
 * 创建通知
 */
async function createNotification(data, senderUserId) {
  const ntype = NOTIFICATION_TYPE_MAP[data.notification_type];
  if (!ntype) {
    throw Object.assign(new Error('无效的通知类型'), { code: 40001 });
  }

  if (!data.title) {
    throw Object.assign(new Error('通知标题不能为空'), { code: 40001 });
  }

  // 按角色筛选接收用户
  let userFilter = { status: 'ACTIVE' };

  if (data.target_role === 'teacher') {
    userFilter.role = 'TEACHER';
  } else if (data.target_role === 'student') {
    userFilter.role = 'STUDENT';
  }
  // target_role === 'all' 或不传 → 发给所有活跃用户

  const users = await prisma.user.findMany({
    where: userFilter,
    select: { user_id: true },
  });

  if (users.length === 0) {
    throw Object.assign(new Error('没有匹配的接收用户'), { code: 40002 });
  }

  const created = [];
  for (const user of users) {
    const notification = await prisma.notification.create({
      data: {
        receiver_user_id: user.user_id,
        sender_user_id: senderUserId,
        notification_type: ntype,
        title: data.title,
        content: data.content || null,
        target_type: data.target_type || null,
        target_id: data.target_id ? parseInt(data.target_id, 10) : null,
      },
    });
    created.push(formatNotification(notification));
  }

  return { broadcast: true, target_role: data.target_role || 'all', count: created.length, list: created };
}

/**
 * 标记通知已读
 */
async function markNotificationRead(notificationId) {
  const notification = await prisma.notification.findUnique({
    where: { notification_id: notificationId },
  });
  if (!notification) {
    throw Object.assign(new Error('通知不存在'), { code: 40002 });
  }

  const updated = await prisma.notification.update({
    where: { notification_id: notificationId },
    data: { is_read: true, read_at: new Date() },
  });

  return formatNotification(updated);
}

/**
 * 批量标记已读
 */
async function markAllNotificationsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { receiver_user_id: userId, is_read: false },
    data: { is_read: true, read_at: new Date() },
  });

  return { updated_count: result.count };
}

function formatNotification(n) {
  const ntypeLabels = {
    TASK_PUBLISHED: 'task_published',
    TASK_DEADLINE: 'task_deadline',
    DOCUMENT_REVIEW: 'document_review',
    DOCUMENT_PARSED: 'document_parsed',
    AI_GRADING_DONE: 'ai_grading_done',
    SYSTEM_NOTICE: 'system_notice',
  };

  return {
    notification_id: n.notification_id,
    receiver_user_id: n.receiver_user_id,
    notification_type: ntypeLabels[n.notification_type] || n.notification_type,
    title: n.title,
    content: n.content,
    is_read: n.is_read,
    created_at: n.created_at,
  };
}

module.exports = {
  getNotificationList,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
};
