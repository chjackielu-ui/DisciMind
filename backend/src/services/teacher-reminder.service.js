const prisma = require('../config/prisma');
const { ensureCourseAccess, ensureTeachingClassAccess, isAdmin } = require('./teacher-access.service');

const STATUSES = new Set(['pending', 'triggered', 'snoozed', 'completed', 'dismissed', 'cancelled']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function error(message, code = 40001) { throw Object.assign(new Error(message), { code }); }
function id(value) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) error('提醒 ID 不合法'); return parsed; }
function date(value, name, required = false) { if (!value && !required) return null; const parsed = new Date(value); if (!value || Number.isNaN(parsed.getTime())) error(`${name} 时间不合法`); return parsed; }
function ownedWhere(user, reminderId) { return { id: id(reminderId), ...(isAdmin(user) ? {} : { teacherUserId: user.user_id }) }; }

function serialize(item) {
  return {
    id: item.id, teacher_user_id: item.teacherUserId, title: item.title, description: item.description,
    reminder_type: item.reminderType, priority: item.priority, course_id: item.courseId, teaching_class_id: item.teachingClassId,
    business_type: item.businessType, business_id: item.businessId, start_at: item.startAt?.toISOString(), remind_at: item.remindAt?.toISOString(), end_at: item.endAt?.toISOString() || null,
    recurrence_rule: item.recurrenceRule, advance_minutes: item.advanceMinutes, status: item.status,
    snoozed_until: item.snoozedUntil?.toISOString() || null, completed_at: item.completedAt?.toISOString() || null, dismissed_at: item.dismissedAt?.toISOString() || null,
    notes: item.notes, created_at: item.createdAt?.toISOString(), updated_at: item.updatedAt?.toISOString(),
  };
}

async function validateScope(user, body) {
  if (body.course_id) await ensureCourseAccess(user, body.course_id);
  if (body.teaching_class_id) await ensureTeachingClassAccess(user, body.teaching_class_id);
}

function dataFrom(body, partial = false) {
  const data = {};
  if (!partial || body.title !== undefined) { const title = String(body.title || '').trim(); if (!title) error('提醒标题不能为空'); data.title = title.slice(0, 200); }
  for (const [input, field, limit] of [['description','description',4000],['notes','notes',4000],['reminder_type','reminderType',40],['business_type','businessType',50]]) if (body[input] !== undefined) data[field] = body[input] == null ? null : String(body[input]).trim().slice(0, limit);
  for (const [input, field] of [['course_id','courseId'],['teaching_class_id','teachingClassId'],['business_id','businessId']]) if (body[input] !== undefined) data[field] = body[input] ? Number(body[input]) : null;
  if (!partial || body.start_at !== undefined) data.startAt = date(body.start_at, '开始', true);
  if (!partial || body.remind_at !== undefined) data.remindAt = date(body.remind_at || body.start_at, '提醒', true);
  if (body.end_at !== undefined) data.endAt = body.end_at ? date(body.end_at, '结束') : null;
  if (body.priority !== undefined) { const priority = String(body.priority).toLowerCase(); if (!PRIORITIES.has(priority)) error('提醒优先级不合法'); data.priority = priority; }
  if (body.status !== undefined) { const status = String(body.status).toLowerCase(); if (!STATUSES.has(status)) error('提醒状态不合法'); data.status = status; }
  if (body.recurrence_rule !== undefined) data.recurrenceRule = body.recurrence_rule || null;
  if (body.advance_minutes !== undefined) data.advanceMinutes = Math.max(0, Math.min(10080, Number(body.advance_minutes) || 0));
  if (data.endAt && data.startAt && data.endAt < data.startAt) error('结束时间不能早于开始时间');
  return data;
}

async function list(user, query = {}) {
  const where = { ...(isAdmin(user) && query.teacher_user_id ? { teacherUserId: Number(query.teacher_user_id) } : { teacherUserId: user.user_id }) };
  if (query.status) where.status = { in: String(query.status).split(',').filter(item => STATUSES.has(item)) };
  if (query.course_id) { await ensureCourseAccess(user, query.course_id); where.courseId = Number(query.course_id); }
  if (query.start_at || query.end_at) where.startAt = { ...(query.start_at ? { gte: date(query.start_at, '开始') } : {}), ...(query.end_at ? { lte: date(query.end_at, '结束') } : {}) };
  const rows = await prisma.teacherReminder.findMany({ where, orderBy: [{ status: 'asc' }, { remindAt: 'asc' }], take: Math.min(200, Number(query.page_size) || 100) });
  return { list: rows.map(serialize), total: rows.length };
}

async function detail(user, reminderId) { const row = await prisma.teacherReminder.findFirst({ where: ownedWhere(user, reminderId) }); if (!row) error('提醒不存在或无权访问', 40301); return serialize(row); }
async function create(user, body) { await validateScope(user, body); const row = await prisma.teacherReminder.create({ data: { teacherUserId: user.user_id, ...dataFrom(body) } }); return serialize(row); }
async function update(user, reminderId, body) {
  const current = await detail(user, reminderId); await validateScope(user, body); const data = dataFrom(body, true);
  const nextStart = data.startAt || new Date(current.start_at); const nextEnd = data.endAt === undefined ? (current.end_at ? new Date(current.end_at) : null) : data.endAt;
  if (nextEnd && nextEnd < nextStart) error('结束时间不能早于开始时间');
  const row = await prisma.teacherReminder.update({ where: { id: id(reminderId) }, data }); return serialize(row);
}
async function cancel(user, reminderId) { await detail(user, reminderId); return serialize(await prisma.teacherReminder.update({ where: { id: id(reminderId) }, data: { status: 'cancelled' } })); }
async function complete(user, reminderId) { await detail(user, reminderId); return serialize(await prisma.teacherReminder.update({ where: { id: id(reminderId) }, data: { status: 'completed', completedAt: new Date() } })); }
async function dismiss(user, reminderId) { await detail(user, reminderId); return serialize(await prisma.teacherReminder.update({ where: { id: id(reminderId) }, data: { status: 'dismissed', dismissedAt: new Date() } })); }
async function snooze(user, reminderId, body = {}) { await detail(user, reminderId); const minutes = Math.max(1, Math.min(10080, Number(body.minutes) || 10)); const until = new Date(Date.now() + minutes * 60000); return serialize(await prisma.teacherReminder.update({ where: { id: id(reminderId) }, data: { status: 'snoozed', snoozedUntil: until } })); }

function nextOccurrence(item, now) {
  const rule = item.recurrenceRule || {}; const interval = Math.max(1, Number(rule.interval) || 1); const next = new Date(item.remindAt);
  if (rule.frequency === 'daily') next.setDate(next.getDate() + interval);
  else if (rule.frequency === 'weekly') next.setDate(next.getDate() + interval * 7);
  else if (rule.frequency === 'monthly') next.setMonth(next.getMonth() + interval);
  else return null;
  while (next <= now) { if (rule.frequency === 'daily') next.setDate(next.getDate() + interval); else if (rule.frequency === 'weekly') next.setDate(next.getDate() + interval * 7); else next.setMonth(next.getMonth() + interval); }
  return next;
}

async function checkDue(user) {
  const now = new Date();
  const rows = await prisma.teacherReminder.findMany({ where: { teacherUserId: user.user_id, OR: [{ status: 'pending', remindAt: { lte: now } }, { status: 'snoozed', snoozedUntil: { lte: now } }] }, orderBy: [{ priority: 'desc' }, { remindAt: 'asc' }], take: 20 });
  const triggered = [];
  for (const item of rows) {
    const occurrence = item.status === 'snoozed' && item.snoozedUntil ? item.snoozedUntil : item.remindAt;
    const key = `teacher-reminder:${item.id}:${occurrence.toISOString()}`;
    await prisma.notification.upsert({ where: { idempotency_key: key }, create: { receiver_user_id: item.teacherUserId, sender_user_id: item.teacherUserId, notification_type: 'SYSTEM_NOTICE', title: item.title, content: item.description || '教师提醒已到达', target_type: 'teacher_reminder', target_id: item.id, business_type: 'teacher_reminder', business_id: item.id, idempotency_key: key }, update: {} });
    const next = nextOccurrence(item, now);
    const shift = next ? next.getTime() - item.remindAt.getTime() : 0;
    await prisma.teacherReminder.update({ where: { id: item.id }, data: next ? {
      status: 'pending', remindAt: next, startAt: new Date(item.startAt.getTime() + shift),
      endAt: item.endAt ? new Date(item.endAt.getTime() + shift) : null, snoozedUntil: null,
    } : { status: 'triggered', snoozedUntil: null } });
    triggered.push({ ...serialize(item), status: 'triggered', triggered_at: occurrence.toISOString() });
  }
  return { triggered, count: triggered.length, checked_at: now.toISOString() };
}

module.exports = { list, detail, create, update, cancel, complete, dismiss, snooze, checkDue, serialize };
