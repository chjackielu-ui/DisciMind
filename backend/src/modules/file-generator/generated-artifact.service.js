const fs = require('fs/promises');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { resolveStoredPath, WORD_MIME } = require('./document-export.service');

const ACTIVE_EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];

function serializeArtifact(artifact, { detail = false, adminMetadataOnly = false } = {}) {
  const data = {
    id: artifact.id,
    ownerUserId: adminMetadataOnly ? artifact.ownerUserId : undefined,
    agentId: artifact.agentId,
    conversationId: artifact.conversationId,
    taskId: artifact.taskId,
    artifactType: artifact.artifactType,
    title: artifact.title,
    description: artifact.description,
    courseId: artifact.courseId,
    knowledgePointIds: artifact.knowledgePointIdsJson || [],
    fileFormat: artifact.fileFormat,
    fileSizeBytes: artifact.fileSizeBytes == null ? null : Number(artifact.fileSizeBytes),
    status: artifact.status,
    errorCode: artifact.errorCode,
    lastAccessedAt: artifact.lastAccessedAt,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
  if (!adminMetadataOnly && detail) {
    data.requirements = artifact.requirementsJson;
    data.content = artifact.contentSchemaJson;
    data.previewHtml = artifact.previewHtml;
  }
  if (data.ownerUserId === undefined) delete data.ownerUserId;
  return data;
}

async function findAccessible(user, id, { ownerOnly = false } = {}) {
  const artifact = await prisma.generatedArtifact.findFirst({
    where: { id: Number(id), deletedAt: null },
  });
  assert(artifact, '文件不存在', 40002, 404);
  const isOwner = artifact.ownerUserId === Number(user.user_id);
  const adminMetadataOnly = user.role === 'admin' && !isOwner && !ownerOnly;
  assert(isOwner || adminMetadataOnly, '文件不存在或无权访问', 40301, 403);
  return { artifact, isOwner, adminMetadataOnly };
}

async function listArtifacts(user, query) {
  const adminMetadataOnly = user.role === 'admin';
  const where = { deletedAt: null };
  if (!adminMetadataOnly) where.ownerUserId = Number(user.user_id);
  if (query.status) where.status = query.status;
  if (query.artifactType) where.artifactType = query.artifactType;
  const [records, total] = await Promise.all([
    prisma.generatedArtifact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.generatedArtifact.count({ where }),
  ]);
  return { list: records.map((artifact) => serializeArtifact(artifact, { adminMetadataOnly })), total, page: query.page, pageSize: query.pageSize };
}

async function getArtifact(user, id) {
  const access = await findAccessible(user, id);
  return serializeArtifact(access.artifact, { detail: true, adminMetadataOnly: access.adminMetadataOnly });
}

async function getDownload(user, id) {
  const { artifact } = await findAccessible(user, id, { ownerOnly: true });
  assert(artifact.status === 'READY' && artifact.storagePath, '文件尚未准备好', 40901, 409);
  const absolutePath = resolveStoredPath(artifact.storagePath);
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    throw Object.assign(new Error('文件不存在或已失效'), { code: 40002, status: 404 });
  }
  assert(stat.isFile(), '文件不存在或已失效', 40002, 404);
  await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { lastAccessedAt: new Date() } });
  return { absolutePath, fileName: `${artifact.title}.docx`, mimeType: WORD_MIME, size: stat.size };
}

async function requestExport(user, id, operationId) {
  const { artifact } = await findAccessible(user, id, { ownerOnly: true });
  assert(artifact.contentSchemaJson && artifact.previewHtml, '结构化内容尚未生成', 40901, 409);
  const active = await prisma.asyncTask.findFirst({
    where: {
      userId: Number(user.user_id), taskType: 'DOCUMENT_EXPORT', relatedResourceType: 'GENERATED_ARTIFACT',
      relatedResourceId: String(artifact.id), status: { in: ACTIVE_EXPORT_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (active) return { artifact: serializeArtifact(artifact), task: tasks.serialize(active) };
  const task = await tasks.createTask(Number(user.user_id), {
    operationId: `artifact-export-${artifact.id}-${operationId}`,
    taskType: 'DOCUMENT_EXPORT',
    title: `导出 ${artifact.title}`,
    description: '重新生成 DOCX 文件，不重复生成内容',
    status: 'QUEUED',
    stage: '等待导出 DOCX',
    progressMode: 'DETERMINATE',
    progress: 0,
    relatedResourceType: 'GENERATED_ARTIFACT',
    relatedResourceId: artifact.id,
    resultType: 'ARTIFACT',
    resultId: artifact.id,
    resultUrl: `#/student/generated-artifacts/${artifact.id}`,
    cancellable: false,
    metadataJson: { artifactId: artifact.id, retryExport: true },
  });
  return { artifact: serializeArtifact(artifact), task };
}

async function countResourceLinks(artifactId) {
  if (!prisma.learningFlowResourceLink) return 0;
  return prisma.learningFlowResourceLink.count({ where: { artifactId: Number(artifactId), deletedAt: null } });
}

async function deleteArtifact(user, id) {
  const { artifact } = await findAccessible(user, id, { ownerOnly: true });
  assert(await countResourceLinks(artifact.id) === 0, '文件仍被学习流引用，请先解除关联', 40901, 409);
  await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { status: 'DELETING' } });
  if (artifact.storagePath) {
    const absolutePath = resolveStoredPath(artifact.storagePath);
    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw Object.assign(new Error('物理文件删除失败，请稍后重试'), { code: 50003, status: 500 });
    }
  }
  await prisma.generatedArtifact.update({
    where: { id: artifact.id },
    data: { status: 'DELETED', storagePath: null, fileSizeBytes: null, deletedAt: new Date() },
  });
  return { deleted: true };
}

module.exports = {
  serializeArtifact,
  findAccessible,
  listArtifacts,
  getArtifact,
  getDownload,
  requestExport,
  deleteArtifact,
};
