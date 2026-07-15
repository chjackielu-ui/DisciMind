const test = require('node:test');
const assert = require('node:assert/strict');
const {
  notificationWhere,
  serializeMessage,
  serializeTask,
} = require('../src/services/work-center.service');

test('work-center notification scope is always bound to the authenticated receiver', () => {
  const where = notificationWhere(42, { is_read: 'false' });
  assert.equal(where.receiver_user_id, 42);
  assert.equal(where.deleted_at, null);
  assert.equal(where.is_read, false);
  assert.ok(Array.isArray(where.OR));
});

test('course-file messages resolve to role-specific course detail routes', () => {
  const notification = {
    notification_id: 9,
    notification_type: 'RESOURCE_SHARED',
    title: '课程文件已发布',
    content: '第三章课件',
    is_read: false,
    target_type: 'resource_distribution',
    target_id: 17,
    business_type: 'course_file',
    business_id: 31,
    created_at: new Date('2026-07-15T08:00:00Z'),
  };
  const distribution = { course_id: 3, teaching_class_id: 4, resource_id: 31 };
  const student = serializeMessage(notification, 'student', distribution);
  const teacher = serializeMessage(notification, 'teacher', distribution);
  assert.equal(student.item_type, 'message');
  assert.equal(student.unread, true);
  assert.equal(student.action_url, '#/student/courses/3?tab=files&fileId=31');
  assert.equal(teacher.action_url, '#/teacher/courses/3?tab=files&fileId=31');
});

test('async tasks use the same feed contract without exposing another user scope', () => {
  const item = serializeTask({
    id: 12,
    taskType: 'FILE_GENERATION',
    title: '生成教学文件',
    status: 'RUNNING',
    updatedAt: new Date('2026-07-15T08:00:00Z'),
    requiresUserAction: false,
  }, 'admin');
  assert.equal(item.item_type, 'task');
  assert.equal(item.status, 'running');
  assert.equal(item.role_scope, 'admin');
  assert.equal(item.action_url, '#/admin/logs?taskId=12');
});
