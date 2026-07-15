const prisma = require('../config/prisma');
const asyncTaskService = require('../modules/async-task/async-task.service');
const { normalizeRunStatus } = require('../modules/subject-chat/subject-chat-state-machine');

const ACTIVE_TASK_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];
const ACTIVE_SUBJECT_RUN_STATUSES = ['queued', 'planning', 'running', 'waiting_tool', 'waiting_agent', 'generating', 'finalizing', 'pending'];

function inputError(message) {
  return Object.assign(new Error(message), { code: 40001, status: 400 });
}

function notFound() {
  return Object.assign(new Error('消息不存在或无权访问'), { code: 40401, status: 404 });
}

function positiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw inputError(`${label}不合法`);
  return parsed;
}

function notificationWhere(userId, query = {}) {
  const where = {
    receiver_user_id: Number(userId),
    deleted_at: null,
    OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
  };
  if (query.is_read !== undefined && query.is_read !== '') {
    if (!['true', 'false', true, false].includes(query.is_read)) throw inputError('阅读状态不合法');
    where.is_read = query.is_read === true || query.is_read === 'true';
  }
  if (query.notification_type) where.notification_type = String(query.notification_type).toUpperCase();
  return where;
}

function taskCenterUrl(role, task) {
  const taskId = encodeURIComponent(task.id);
  if (role === 'student') return `#/student/agent-tasks?taskId=${taskId}`;
  if (role === 'teacher') return `#/teacher/artifacts?taskId=${taskId}`;
  return `#/admin/logs?taskId=${taskId}`;
}

function notificationAction(role, notification, distribution) {
  const businessType = String(notification.business_type || notification.target_type || '').toLowerCase();
  if (role === 'student' && businessType === 'learning_card_daily') {
    return { type: 'learning_card_daily', url: '#/student/dashboard?focus=learning-cards' };
  }
  if (role === 'student' && businessType === 'ai_chat_run' && notification.business_id) {
    return { type: 'ai_chat_run', url: `#/student/ai-chat?conversationId=${notification.business_id}` };
  }
  if (['course_file', 'resource_distribution'].includes(businessType) || notification.target_type === 'resource_distribution') {
    const courseId = distribution?.course_id;
    const fileId = distribution?.resource_id;
    if (role === 'student' && courseId) return { type: 'course_file', url: `#/student/courses/${courseId}?tab=files&fileId=${fileId || ''}` };
    if (role === 'teacher' && courseId) return { type: 'course_file', url: `#/teacher/courses/${courseId}?tab=files&fileId=${fileId || ''}` };
    if (role === 'admin') return { type: 'notification', url: `#/admin/notifications?notificationId=${notification.notification_id}` };
  }
  if (businessType.includes('task') || String(notification.notification_type).includes('TASK')) {
    if (role === 'student' && notification.business_id) return { type: 'learning_task', url: `#/student/teaching-tasks/${notification.business_id}` };
    if (role === 'teacher' && notification.business_id) return { type: 'learning_task', url: `#/teacher/tasks/${notification.business_id}` };
  }
  return { type: 'message_detail', url: null };
}

function messagePriority(notification) {
  const type = String(notification.notification_type || '');
  if (/RISK|ALERT|DEADLINE/.test(type)) return 'high';
  if (/REVIEW|SUBMITTED/.test(type)) return 'normal';
  return 'low';
}

function serializeMessage(notification, role, distribution = null) {
  const action = notificationAction(role, notification, distribution);
  return {
    id: notification.notification_id,
    item_type: 'message',
    title: notification.title,
    summary: notification.content || '',
    status: notification.is_read ? 'read' : 'unread',
    unread: !notification.is_read,
    priority: messagePriority(notification),
    created_at: notification.created_at,
    source_type: String(notification.business_type || notification.target_type || notification.notification_type || 'notification').toLowerCase(),
    source_id: notification.business_id || notification.target_id || null,
    action_type: action.type,
    action_url: action.url,
    role_scope: role,
    notification_type: String(notification.notification_type || '').toLowerCase(),
    sender_name: notification.sender?.profile?.real_name || notification.sender?.username || null,
  };
}

function serializeTask(task, role) {
  const taskType = String(task.taskType || '').toLowerCase();
  const category = /file|artifact|document|handout|exam/.test(taskType)
    ? 'file_generation'
    : /learning.*flow|preload|node/.test(taskType)
      ? 'learning_flow'
      : /agent|chat|ai_/.test(taskType)
        ? 'ai_agent'
        : 'background_task';
  return {
    id: task.id,
    item_type: 'task',
    title: task.title,
    summary: task.description || task.stage || '',
    status: String(task.status || '').toLowerCase(),
    unread: false,
    priority: task.requiresUserAction ? 'high' : ACTIVE_TASK_STATUSES.includes(task.status) ? 'normal' : 'low',
    created_at: task.updatedAt || task.createdAt,
    source_type: String(task.relatedResourceType || task.taskType || 'async_task').toLowerCase(),
    source_id: task.relatedResourceId || task.id,
    action_type: 'task_detail',
    action_url: taskCenterUrl(role, task),
    role_scope: role,
    progress: task.progress,
    progress_mode: task.progressMode,
    stage: task.stage,
    task_category: category,
  };
}

function serializeSubjectRun(run) {
  const status = normalizeRunStatus(run.status);
  return {
    id: run.id,
    item_type: 'task',
    title: run.conversation?.title || '学科答疑任务',
    summary: run.currentTask || run.errorMessage || (status === 'completed' ? '回答已生成并保存' : '后台运行中'),
    status,
    unread: false,
    priority: ['failed', 'stalled'].includes(status) ? 'high' : ACTIVE_SUBJECT_RUN_STATUSES.includes(run.status) ? 'normal' : 'low',
    created_at: run.updatedAt || run.createdAt,
    source_type: 'ai_chat_run',
    source_id: run.conversationId,
    action_type: 'ai_chat_run',
    action_url: `#/student/ai-chat?conversationId=${run.conversationId}&runId=${encodeURIComponent(run.id)}`,
    role_scope: 'student',
    progress: run.progress,
    progress_mode: 'stage',
    stage: run.currentTask,
    task_category: 'ai_agent',
    completed_task_count: run.completedTaskCount,
    total_task_count: run.totalTaskCount,
    duration_ms: run.durationMs,
    error_code: run.errorCode,
  };
}

async function listSubjectRuns(user, { activeOnly = false, limit = 20 } = {}) {
  if (String(user.role).toLowerCase() !== 'student') return [];
  return prisma.subjectChatRun.findMany({
    where: {
      userId: Number(user.user_id),
      ...(activeOnly ? { status: { in: ACTIVE_SUBJECT_RUN_STATUSES } } : {}),
    },
    include: { conversation: { select: { title: true } } },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(50, Math.max(1, Number(limit) || 20)),
  });
}

async function distributionMapFor(notifications) {
  const ids = [...new Set(notifications
    .filter((item) => item.target_type === 'resource_distribution' && item.target_id)
    .map((item) => Number(item.target_id)))];
  if (!ids.length) return new Map();
  const rows = await prisma.resourceDistribution.findMany({
    where: { distribution_id: { in: ids } },
    select: { distribution_id: true, course_id: true, teaching_class_id: true, resource_id: true },
  });
  return new Map(rows.map((row) => [row.distribution_id, row]));
}

async function listMessageRecords(user, query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 10));
  const where = notificationWhere(user.user_id, query);
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: { sender: { include: { profile: true } } },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  const distributions = await distributionMapFor(rows);
  const role = String(user.role).toLowerCase();
  return {
    list: rows.map((row) => serializeMessage(row, role, distributions.get(row.target_id))),
    total,
    page,
    page_size: pageSize,
    has_more: page * pageSize < total,
  };
}

async function summary(user) {
  const where = notificationWhere(user.user_id);
  const [unreadMessages, pendingTasks, latestMessages, taskResult, subjectRuns] = await Promise.all([
    prisma.notification.count({ where: { ...where, is_read: false } }),
    prisma.asyncTask.count({ where: { userId: Number(user.user_id), userVisible: true, dismissedAt: null, status: { in: ACTIVE_TASK_STATUSES } } }),
    listMessageRecords(user, { page: 1, page_size: 5 }),
    asyncTaskService.listTasks(user.user_id, { page: 1, pageSize: 20, includeDismissed: false }),
    listSubjectRuns(user, { activeOnly: false, limit: 20 }),
  ]);
  const activeSubjectRuns = subjectRuns.filter((run) => ACTIVE_SUBJECT_RUN_STATUSES.includes(run.status));
  const tasks = [
    ...taskResult.list.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status)).map((task) => serializeTask(task, String(user.role).toLowerCase())),
    ...subjectRuns.map(serializeSubjectRun),
  ].sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  return {
    pending_task_count: pendingTasks + activeSubjectRuns.length,
    unread_message_count: unreadMessages,
    running_task_count: tasks.filter((task) => ['running', 'waiting_tool', 'waiting_agent', 'generating', 'finalizing'].includes(task.status)).length,
    tasks: tasks.slice(0, 12),
    messages: latestMessages.list,
    refreshed_at: new Date(),
  };
}

async function feed(user, query = {}) {
  const limit = Math.min(40, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const [messages, tasks, subjectRuns] = await Promise.all([
    listMessageRecords(user, { page: 1, page_size: limit }),
    asyncTaskService.listTasks(user.user_id, { page: 1, pageSize: limit, includeDismissed: false }),
    listSubjectRuns(user, { limit }),
  ]);
  return {
    list: [...messages.list, ...tasks.list.map((task) => serializeTask(task, String(user.role).toLowerCase())), ...subjectRuns.map(serializeSubjectRun)]
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
      .slice(0, limit),
  };
}

async function messages(user, query) {
  return listMessageRecords(user, query);
}

async function tasks(user, query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));
  const [result, subjectRuns] = await Promise.all([
    asyncTaskService.listTasks(user.user_id, { page, pageSize, includeDismissed: false, status: query.status }),
    listSubjectRuns(user, { limit: pageSize }),
  ]);
  const normalizedFilter = query.status ? String(query.status).toLowerCase() : null;
  const subjectItems = subjectRuns.map(serializeSubjectRun).filter((item) => !normalizedFilter || item.status === normalizedFilter);
  const list = [...result.list.map((task) => serializeTask(task, String(user.role).toLowerCase())), ...subjectItems]
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, pageSize);
  return { ...result, total: result.total + subjectItems.length, list };
}

async function messageDetail(user, id) {
  const notificationId = positiveInt(id, '消息 ID');
  const notification = await prisma.notification.findFirst({
    where: { ...notificationWhere(user.user_id), notification_id: notificationId },
    include: { sender: { include: { profile: true } } },
  });
  if (!notification) throw notFound();
  let distribution = null;
  if (notification.target_type === 'resource_distribution' && notification.target_id) {
    distribution = await prisma.resourceDistribution.findUnique({
      where: { distribution_id: notification.target_id },
      include: {
        course: { select: { course_id: true, course_name: true } },
        teachingClass: { select: { teaching_class_id: true, teaching_class_name: true } },
        resource: { select: { document_id: true, original_filename: true, title: true, file_size_bytes: true, mime_type: true } },
      },
    });
  }
  return {
    ...serializeMessage(notification, String(user.role).toLowerCase(), distribution),
    content: notification.content || '',
    related: distribution ? {
      course: distribution.course,
      teaching_class: distribution.teachingClass,
      file: distribution.resource,
      distribution_id: distribution.distribution_id,
    } : null,
  };
}

async function markMessageRead(user, id) {
  const notificationId = positiveInt(id, '消息 ID');
  const result = await prisma.notification.updateMany({
    where: { notification_id: notificationId, receiver_user_id: Number(user.user_id), deleted_at: null },
    data: { is_read: true, read_at: new Date() },
  });
  if (!result.count) throw notFound();
  return { notification_id: notificationId, is_read: true };
}

async function markAllMessagesRead(user) {
  const result = await prisma.notification.updateMany({
    where: { ...notificationWhere(user.user_id), is_read: false },
    data: { is_read: true, read_at: new Date() },
  });
  return { updated_count: result.count };
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  notificationWhere,
  serializeMessage,
  serializeTask,
  serializeSubjectRun,
  summary,
  feed,
  messages,
  tasks,
  messageDetail,
  markMessageRead,
  markAllMessagesRead,
};
