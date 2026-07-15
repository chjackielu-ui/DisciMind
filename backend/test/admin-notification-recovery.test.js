const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const prisma = require('../src/config/prisma');
const notificationService = require('../src/services/admin-notification.service');

const token = `admin-notification-recovery-${crypto.randomUUID()}`;
let admin;
let req;

test.before(async () => {
  admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { user_id: true, role: true, username: true },
  });
  assert.ok(admin, 'an active admin is required');
  req = { user: admin, id: token, ip: '127.0.0.1' };
});

test.after(async () => {
  await prisma.notification.deleteMany({ where: { title: { startsWith: token } } });
  await prisma.operationLog.deleteMany({ where: { request_id: token } });
  await prisma.$disconnect();
});

test('admin notification broadcast, filters and read actions persist atomically', async () => {
  const first = await notificationService.createNotification({
    notification_type: 'system_notice',
    target_role: 'admin',
    title: `${token}-first`,
    content: '真实通知闭环测试',
  }, admin.user_id, req);
  assert.ok(first.count >= 1);

  await notificationService.createNotification({
    notification_type: 'resource_shared',
    target_role: 'admin',
    title: `${token}-second`,
    content: '筛选与批量已读测试',
  }, admin.user_id, req);

  const listed = await notificationService.getNotificationList({
    keyword: token,
    receiver: admin.username,
    page: 1,
    page_size: 100,
  });
  assert.ok(listed.total >= 2);
  assert.equal(listed.list.every((item) => item.title.startsWith(token)), true);
  assert.equal(listed.list.some((item) => item.notification_type === 'resource_shared'), true);

  const single = listed.list[0];
  const marked = await notificationService.markNotificationRead(single.notification_id, req);
  assert.equal(marked.is_read, true);

  const batch = await notificationService.markAllNotificationsRead({ keyword: token }, req);
  assert.ok(batch.updated_count >= 1);
  const remaining = await prisma.notification.count({ where: { title: { startsWith: token }, is_read: false } });
  assert.equal(remaining, 0);

  const auditCount = await prisma.operationLog.count({ where: { request_id: token } });
  assert.ok(auditCount >= 4, 'create/read operations must have durable audit rows');
});

test('invalid notification target role is rejected before any broadcast', async () => {
  await assert.rejects(
    notificationService.createNotification({
      notification_type: 'system_notice',
      target_role: 'unexpected-role',
      title: `${token}-invalid`,
    }, admin.user_id, req),
    /发送对象不合法/,
  );
  const count = await prisma.notification.count({ where: { title: `${token}-invalid` } });
  assert.equal(count, 0);
});

test('all Prisma notification enum values have a stable public representation', () => {
  assert.equal(notificationService.NOTIFICATION_TYPES.length, 15);
  assert.equal(notificationService.NOTIFICATION_TYPES.includes('FILE_GENERATED'), true);
  assert.equal(notificationService.NOTIFICATION_TYPES.includes('RESOURCE_SHARED'), true);
});

