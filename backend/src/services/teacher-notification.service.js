// 教师端消息通知服务

const prisma = require('../config/prisma');

const NOTIFICATION_TYPE_MAP = {
  task_published: 'TASK_PUBLISHED',
  task_deadline: 'TASK_DEADLINE',
  document_review: 'DOCUMENT_REVIEW',
  document_parsed: 'DOCUMENT_PARSED',
  ai_grading_done: 'AI_GRADING_DONE',
  system_notice: 'SYSTEM_NOTICE',
};

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

// ---------- 消息列表 ----------

async function listNotifications(user, query) {
  const where = { receiver_user_id: user.user_id };

  if (query.is_read !== undefined) {
    where.is_read = query.is_read === 'true' || query.is_read === true;
  }
  if (query.notification_type) {
    const nt = NOTIFICATION_TYPE_MAP[query.notification_type];
    if (nt) where.notification_type = nt;
  }

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));
  const skip = (page - 1) * pageSize;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        sender: { include: { profile: true } },
      },
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    list: notifications.map((n) => ({
      notification_id: n.notification_id,
      notification_type: toLower(n.notification_type),
      title: n.title,
      content: n.content,
      target_type: n.target_type,
      target_id: n.target_id,
      is_read: n.is_read,
      sender_name: n.sender?.profile?.real_name || n.sender?.username || null,
      created_at: n.created_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 标记已读 ----------

async function markRead(user, notificationId) {
  const notification = await prisma.notification.findUnique({
    where: { notification_id: notificationId },
  });

  if (!notification) throw Object.assign(new Error('消息不存在'), { code: 40002 });
  if (notification.receiver_user_id !== user.user_id) {
    throw Object.assign(new Error('无权操作该消息'), { code: 40301 });
  }

  await prisma.notification.update({
    where: { notification_id: notificationId },
    data: { is_read: true, read_at: new Date() },
  });

  return { notification_id: notificationId, is_read: true };
}

// ---------- 全部标记已读 ----------

async function markAllRead(user) {
  const result = await prisma.notification.updateMany({
    where: { receiver_user_id: user.user_id, is_read: false },
    data: { is_read: true, read_at: new Date() },
  });

  return { updated_count: result.count };
}

// ---------- 未读数量 ----------

async function getUnreadCount(user) {
  const count = await prisma.notification.count({
    where: { receiver_user_id: user.user_id, is_read: false },
  });

  return { unread_count: count };
}

module.exports = {
  listNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
};
