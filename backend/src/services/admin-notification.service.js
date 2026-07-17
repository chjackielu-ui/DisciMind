// 管理员端通知管理服务：真实分页、筛选、原子广播和审计。

const prisma = require('../config/prisma');

const NOTIFICATION_TYPES = Object.freeze([
  'TASK_PUBLISHED', 'TASK_DEADLINE', 'TASK_SUBMITTED', 'EXAM_SUBMITTED',
  'DOCUMENT_REVIEW', 'DOCUMENT_PARSED', 'KNOWLEDGE_APPLICATION',
  'AI_GRADING_DONE', 'FILE_GENERATED', 'AI_TASK_DONE', 'STUDENT_RISK',
  'CLASS_ALERT', 'FREQUENT_QUESTION', 'RESOURCE_SHARED', 'SYSTEM_NOTICE',
]);
const PUBLIC_TO_DB_TYPE = Object.freeze(Object.fromEntries(NOTIFICATION_TYPES.map((value) => [value.toLowerCase(), value])));
const TARGET_ROLES = new Set(['all', 'admin', 'teacher', 'student']);

function inputError(message) {
  return Object.assign(new Error(message), { code: 40001 });
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw inputError(`${label}不合法`);
  return parsed;
}

function parseDate(value, label, endExclusive = false) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const parsed = new Date(dateOnly ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) throw inputError(`${label}格式不正确`);
  if (endExclusive && dateOnly) parsed.setDate(parsed.getDate() + 1);
  return parsed;
}

function normalizeType(value, required = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized && !required) return null;
  const databaseValue = PUBLIC_TO_DB_TYPE[normalized];
  if (!databaseValue) throw inputError('通知类型不合法');
  return databaseValue;
}

function buildWhere(query = {}, { forceUnread = false } = {}) {
  const where = { deleted_at: null, AND: [] };
  where.AND.push({ OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] });

  const notificationType = normalizeType(query.notification_type);
  if (notificationType) where.notification_type = notificationType;

  if (forceUnread) {
    where.is_read = false;
  } else if (query.is_read !== undefined && query.is_read !== '') {
    const value = String(query.is_read).toLowerCase();
    if (!['true', 'false'].includes(value)) throw inputError('阅读状态不合法');
    where.is_read = value === 'true';
  }

  if (query.receiver_user_id !== undefined && query.receiver_user_id !== '') {
    where.receiver_user_id = parsePositiveInt(query.receiver_user_id, '接收人 ID');
  }

  const keyword = String(query.keyword || '').trim();
  if (keyword) {
    where.AND.push({ OR: [
      { title: { contains: keyword } },
      { content: { contains: keyword } },
    ] });
  }

  const receiver = String(query.receiver || '').trim();
  if (receiver) {
    where.AND.push({ receiver: { is: { OR: [
      { username: { contains: receiver } },
      { profile: { real_name: { contains: receiver } } },
    ] } } });
  }

  const start = parseDate(query.start_date, '开始时间');
  const end = parseDate(query.end_date, '结束时间', true);
  if (start && end && start >= end) throw inputError('开始时间必须早于结束时间');
  if (start || end) where.created_at = { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };

  return where;
}

function formatNotification(notification) {
  return {
    notification_id: notification.notification_id,
    receiver_user_id: notification.receiver_user_id,
    receiver_name: notification.receiver?.profile?.real_name || notification.receiver?.username || null,
    receiver_username: notification.receiver?.username || null,
    sender_user_id: notification.sender_user_id,
    sender_name: notification.sender?.profile?.real_name || notification.sender?.username || null,
    notification_type: String(notification.notification_type).toLowerCase(),
    title: notification.title,
    content: notification.content,
    target_type: notification.target_type,
    target_id: notification.target_id,
    is_read: notification.is_read,
    read_at: notification.read_at,
    expires_at: notification.expires_at,
    created_at: notification.created_at,
  };
}

function auditData(req, operationType, targetType, targetId, afterSummary) {
  return {
    user_id: req?.user?.user_id ? Number(req.user.user_id) : null,
    role: req?.user?.role ? String(req.user.role).toUpperCase() : null,
    operation_type: operationType,
    operation_desc: '管理员通知管理操作',
    target_type: targetType,
    target_id: targetId || null,
    ip_address: req?.ip ? String(req.ip).slice(0, 50) : null,
    request_id: req?.id ? String(req.id).slice(0, 100) : null,
    action_status: 'success',
    after_summary_json: afterSummary,
  };
}

async function getNotificationList(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size, 10) || 10));
  const where = buildWhere(query);
  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        receiver: { include: { profile: true } },
        sender: { include: { profile: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  return {
    list: notifications.map(formatNotification),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function createNotification(data, senderUserId, req) {
  const notificationType = normalizeType(data.notification_type, true);
  const targetRole = String(data.target_role || 'all').trim().toLowerCase();
  if (!TARGET_ROLES.has(targetRole)) throw inputError('发送对象不合法');
  const title = String(data.title || '').trim();
  const content = data.content == null ? null : String(data.content).trim();
  if (!title) throw inputError('通知标题不能为空');
  if (title.length > 200) throw inputError('通知标题不能超过 200 个字符');
  if (content && content.length > 20000) throw inputError('通知内容不能超过 20000 个字符');

  const userFilter = { status: 'ACTIVE' };
  if (targetRole !== 'all') userFilter.role = targetRole.toUpperCase();
  const users = await prisma.user.findMany({ where: userFilter, select: { user_id: true } });
  if (!users.length) throw Object.assign(new Error('没有匹配的接收用户'), { code: 42201 });

  const targetId = data.target_id === undefined || data.target_id === null || data.target_id === ''
    ? null
    : parsePositiveInt(data.target_id, '业务对象 ID');
  const rows = users.map((user) => ({
    receiver_user_id: user.user_id,
    sender_user_id: Number(senderUserId),
    notification_type: notificationType,
    title,
    content: content || null,
    target_type: data.target_type ? String(data.target_type).slice(0, 50) : null,
    target_id: targetId,
  }));

  const created = await prisma.$transaction(async (tx) => {
    const result = await tx.notification.createMany({ data: rows });
    await tx.operationLog.create({ data: auditData(req, 'CREATE_ADMIN_NOTIFICATION', 'notification_broadcast', null, {
      notification_type: notificationType.toLowerCase(), target_role: targetRole, recipient_count: result.count,
    }) });
    return result;
  });
  return { broadcast: true, target_role: targetRole, count: created.count };
}

async function markNotificationRead(notificationId, req) {
  const id = parsePositiveInt(notificationId, '通知 ID');
  return prisma.$transaction(async (tx) => {
    const notification = await tx.notification.findFirst({ where: { notification_id: id, deleted_at: null } });
    if (!notification) throw Object.assign(new Error('通知不存在'), { code: 40401 });
    const updated = notification.is_read ? notification : await tx.notification.update({
      where: { notification_id: id },
      data: { is_read: true, read_at: notification.read_at || new Date() },
    });
    await tx.operationLog.create({ data: auditData(req, 'MARK_ADMIN_NOTIFICATION_READ', 'notification', id, {
      receiver_user_id: notification.receiver_user_id, changed: !notification.is_read,
    }) });
    return formatNotification(updated);
  });
}

async function markAllNotificationsRead(filters = {}, req) {
  const where = buildWhere(filters, { forceUnread: true });
  return prisma.$transaction(async (tx) => {
    const result = await tx.notification.updateMany({ where, data: { is_read: true, read_at: new Date() } });
    await tx.operationLog.create({ data: auditData(req, 'MARK_ALL_ADMIN_NOTIFICATIONS_READ', 'notification', null, {
      updated_count: result.count,
      filters: {
        notification_type: filters.notification_type || null,
        receiver_user_id: filters.receiver_user_id || null,
        receiver: filters.receiver || null,
        start_date: filters.start_date || null,
        end_date: filters.end_date || null,
      },
    }) });
    return { updated_count: result.count };
  });
}

module.exports = {
  NOTIFICATION_TYPES,
  buildWhere,
  getNotificationList,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
};
