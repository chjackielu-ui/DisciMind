const prisma = require('../config/prisma');

function notFound(message = '资源不存在或无权访问') {
  return Object.assign(new Error(message), { code: 40002, status: 404 });
}

async function activateDueDistributions(studentUserId) {
  const due = await prisma.resourceDistribution.findMany({
    where: {
      status: 'SCHEDULED',
      publish_at: { lte: new Date() },
      recipients: { some: { student_user_id: studentUserId } },
    },
    include: { recipients: { select: { student_user_id: true } }, resource: { select: { title: true } } },
  });
  for (const distribution of due) {
    await prisma.$transaction(async (tx) => {
      await tx.resourceDistribution.update({ where: { distribution_id: distribution.distribution_id }, data: { status: 'PUBLISHED' } });
      await tx.notification.createMany({
        data: distribution.recipients.map((recipient) => ({
          receiver_user_id: recipient.student_user_id,
          sender_user_id: distribution.sender_user_id,
          notification_type: 'RESOURCE_SHARED',
          title: `教学资源：${distribution.title || distribution.resource.title}`,
          content: distribution.description || '教师发布了新的教学资源',
          target_type: 'resource_distribution',
          target_id: distribution.distribution_id,
          business_type: 'resource_distribution',
          business_id: distribution.distribution_id,
          idempotency_key: `resource-distribution:${distribution.distribution_id}:student:${recipient.student_user_id}`,
        })),
        skipDuplicates: true,
      });
    });
  }
}

function serializeRecipient(record) {
  const distribution = record.distribution;
  const resource = distribution.resource;
  return {
    recipient_id: record.recipient_id,
    distribution_id: distribution.distribution_id,
    title: distribution.title,
    description: distribution.description,
    distribution_type: distribution.distribution_type,
    resource_version: distribution.resource_version,
    publish_at: distribution.publish_at.toISOString(),
    due_at: distribution.due_at?.toISOString() || null,
    status: String(record.status || 'UNREAD').toLowerCase(),
    read_at: record.read_at?.toISOString() || null,
    downloaded_at: record.downloaded_at?.toISOString() || null,
    completed_at: record.completed_at?.toISOString() || null,
    course: distribution.course ? { course_id: distribution.course.course_id, course_name: distribution.course.course_name } : null,
    teaching_class: distribution.teachingClass ? { teaching_class_id: distribution.teachingClass.teaching_class_id, teaching_class_name: distribution.teachingClass.teaching_class_name } : null,
    resource: {
      document_id: resource.document_id,
      resource_type: resource.resource_kind || resource.file_ext,
      file_ext: resource.file_ext,
      mime_type: resource.mime_type,
      external: Boolean(resource.external_url),
      open_url: `/api/student/resources/${record.recipient_id}/open`,
      download_url: `/api/student/resources/${record.recipient_id}/download`,
    },
  };
}

async function listResources(user, query = {}) {
  await activateDueDistributions(user.user_id);
  const where = {
    student_user_id: user.user_id,
    distribution: {
      status: 'PUBLISHED',
      publish_at: { lte: new Date() },
      resource: { deleted_at: null, resource_status: 'ACTIVE' },
    },
  };
  if (query.course_id) where.distribution.course_id = Number(query.course_id);
  if (query.distribution_type) where.distribution.distribution_type = String(query.distribution_type);
  const records = await prisma.resourceRecipient.findMany({
    where,
    include: {
      distribution: {
        include: {
          resource: true,
          course: { select: { course_id: true, course_name: true } },
          teachingClass: { select: { teaching_class_id: true, teaching_class_name: true } },
        },
      },
    },
    orderBy: { distribution: { publish_at: 'desc' } },
    take: Math.min(200, Math.max(1, Number(query.page_size || 100))),
  });
  return {
    list: records.map(serializeRecipient),
    unread_count: records.filter((record) => !record.read_at).length,
  };
}

async function ensureRecipient(user, recipientId) {
  const record = await prisma.resourceRecipient.findFirst({
    where: { recipient_id: Number(recipientId), student_user_id: user.user_id },
    include: { distribution: { include: { resource: true } } },
  });
  if (!record || record.distribution.status !== 'PUBLISHED' || record.distribution.publish_at > new Date() || record.distribution.resource.deleted_at) throw notFound();
  return record;
}

async function openResource(user, recipientId) {
  const record = await ensureRecipient(user, recipientId);
  const updated = await prisma.resourceRecipient.update({
    where: { recipient_id: record.recipient_id },
    data: { read_at: record.read_at || new Date(), status: record.completed_at ? 'COMPLETED' : 'READ' },
  });
  return {
    recipient_id: updated.recipient_id,
    external_url: record.distribution.resource.external_url,
    download_url: `/api/student/resources/${updated.recipient_id}/download`,
  };
}

async function getDownload(user, recipientId) {
  const record = await ensureRecipient(user, recipientId);
  await prisma.$transaction([
    prisma.resourceRecipient.update({
      where: { recipient_id: record.recipient_id },
      data: { read_at: record.read_at || new Date(), downloaded_at: new Date(), status: record.completed_at ? 'COMPLETED' : 'DOWNLOADED' },
    }),
    prisma.knowledgeDocument.update({ where: { document_id: record.distribution.resource_id }, data: { last_used_at: new Date() } }),
  ]);
  return record.distribution.resource;
}

async function completeResource(user, recipientId) {
  const record = await ensureRecipient(user, recipientId);
  const now = new Date();
  await prisma.resourceRecipient.update({ where: { recipient_id: record.recipient_id }, data: { read_at: record.read_at || now, completed_at: now, status: 'COMPLETED' } });
  return { completed: true, recipient_id: record.recipient_id };
}

module.exports = { activateDueDistributions, listResources, openResource, getDownload, completeResource };
