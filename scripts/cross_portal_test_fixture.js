#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');
const prisma = require('../backend/src/config/prisma');

const TEST_ACCOUNTS = {
  admin: process.env.DISCIMIND_TEST_ADMIN_ACCOUNT,
  teacher: process.env.DISCIMIND_TEST_TEACHER_ACCOUNT,
  student: process.env.DISCIMIND_TEST_STUDENT_ACCOUNT,
  studentB: process.env.DISCIMIND_TEST_SECONDARY_STUDENT_ACCOUNT,
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function account(username) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { user_id: true, username: true, role: true },
  });
  if (!user) throw new Error(`fixture account not found: ${username}`);
  return user;
}

async function setupUnified(marker) {
  Object.entries(TEST_ACCOUNTS).forEach(([role, username]) => required(username, `DISCIMIND_TEST_${role.toUpperCase()}_ACCOUNT`));
  const users = await Promise.all([
    account(TEST_ACCOUNTS.admin),
    account(TEST_ACCOUNTS.teacher),
    account(TEST_ACCOUNTS.student),
    account(TEST_ACCOUNTS.studentB),
  ]);
  const sender = users[0];
  await prisma.notification.deleteMany({ where: { idempotency_key: { startsWith: `cross-portal:${marker}:` } } });
  const rows = [];
  for (const user of users) {
    const row = await prisma.notification.create({
      data: {
        receiver_user_id: user.user_id,
        sender_user_id: sender.user_id,
        notification_type: 'SYSTEM_NOTICE',
        title: `统一中心验收 ${marker} ${user.username}`,
        content: `仅用于统一任务与消息中心 API 验收，角色 ${String(user.role).toLowerCase()}。`,
        target_type: 'cross_portal_test',
        business_type: 'cross_portal_test',
        idempotency_key: `cross-portal:${marker}:${user.username}`,
      },
    });
    rows.push({ username: user.username, role: String(user.role).toLowerCase(), user_id: user.user_id, notification_id: row.notification_id });
  }
  return { marker, notifications: rows };
}

async function cleanupUnified(marker) {
  const result = await prisma.notification.deleteMany({ where: { idempotency_key: { startsWith: `cross-portal:${marker}:` } } });
  return { marker, deleted_notifications: result.count };
}

async function cleanupCourse(marker, username) {
  const documents = await prisma.knowledgeDocument.findMany({
    where: {
      is_teaching_resource: true,
      resource_kind: 'course_file',
      OR: [
        { title: { contains: marker } },
        { original_filename: { contains: marker } },
      ],
    },
    select: { document_id: true, file_url: true },
  });
  const documentIds = documents.map((item) => item.document_id);
  const user = username ? await prisma.user.findUnique({ where: { username }, select: { user_id: true } }) : null;
  const report = await prisma.$transaction(async (tx) => {
    const deletedNotifications = documentIds.length
      ? await tx.notification.deleteMany({ where: { business_type: 'course_file', business_id: { in: documentIds } } })
      : { count: 0 };
    const deletedLogs = documentIds.length
      ? await tx.operationLog.deleteMany({ where: { target_type: 'course_file', target_id: { in: documentIds } } })
      : { count: 0 };
    const deletedDistributions = documentIds.length
      ? await tx.resourceDistribution.deleteMany({ where: { resource_id: { in: documentIds } } })
      : { count: 0 };
    const deletedDocuments = documentIds.length
      ? await tx.knowledgeDocument.deleteMany({ where: { document_id: { in: documentIds } } })
      : { count: 0 };
    let deletedUsers = { count: 0 };
    let deletedUserLogs = { count: 0 };
    if (user) {
      deletedUserLogs = await tx.operationLog.deleteMany({
        where: { OR: [{ user_id: user.user_id }, { target_type: 'user', target_id: user.user_id }] },
      });
      deletedUsers = await tx.user.deleteMany({ where: { user_id: user.user_id } });
    }
    return {
      deleted_notifications: deletedNotifications.count,
      deleted_operation_logs: deletedLogs.count + deletedUserLogs.count,
      deleted_distributions: deletedDistributions.count,
      deleted_documents: deletedDocuments.count,
      deleted_users: deletedUsers.count,
    };
  });
  const storageRoot = path.resolve(__dirname, '../storage/course-files');
  let deletedPhysicalFiles = 0;
  for (const document of documents) {
    const target = path.resolve(storageRoot, path.basename(document.file_url || ''));
    if (!target.startsWith(`${storageRoot}${path.sep}`)) continue;
    try { await fs.unlink(target); deletedPhysicalFiles += 1; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { marker, document_ids: documentIds, ...report, deleted_physical_files: deletedPhysicalFiles };
}

async function main() {
  const [command, rawMarker, rawUsername] = process.argv.slice(2);
  const marker = required(rawMarker, 'marker');
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(marker)) throw new Error('marker contains unsupported characters');
  let result;
  if (command === 'unified-setup') result = await setupUnified(marker);
  else if (command === 'unified-cleanup') result = await cleanupUnified(marker);
  else if (command === 'course-cleanup') result = await cleanupCourse(marker, String(rawUsername || '').trim());
  else throw new Error(`unknown command: ${command || '(empty)'}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .catch((error) => fail(error.stack || error.message))
  .finally(async () => { await prisma.$disconnect(); });
