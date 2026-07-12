const fs = require('fs/promises');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { resolveStoredPath, WORD_MIME } = require('./document-export.service');
const { PDF_MIME } = require('./pdf-export.service');

const ACTIVE_EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];

const ARTIFACT_INCLUDE = {
  exports: { where: { deletedAt: null }, orderBy: { format: 'asc' } },
  agent: { select: { id: true, systemKey: true, isSystem: true, currentPublicVersion: { select: { name: true } }, currentDraftVersion: { select: { name: true } } } },
  conversation: { select: { id: true, title: true, agentVersion: { select: { name: true } } } },
  course: { select: { course_id: true, course_name: true } },
  resourceLinks: {
    where: { deletedAt: null },
    include: {
      knowledgePoint: { select: { knowledge_point_id: true, knowledge_point_name: true } },
      learningGoal: { select: { goal_id: true, normalized_title: true } },
      workflowTemplate: { select: { template_id: true, title: true } },
    },
  },
};

function serializeExport(record) {
  return {
    id: record.id,
    format: record.format,
    status: record.status,
    mimeType: record.mimeType,
    fileSizeBytes: record.fileSizeBytes == null ? null : Number(record.fileSizeBytes),
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    lastAccessedAt: record.lastAccessedAt,
    updatedAt: record.updatedAt,
  };
}

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
    exports: (artifact.exports || []).filter((item) => !item.deletedAt).map(serializeExport),
    sourceAgent: artifact.agent ? { id: artifact.agent.id, name: artifact.conversation?.agentVersion?.name || artifact.agent.currentPublicVersion?.name || artifact.agent.currentDraftVersion?.name || '文件生成智能体', systemKey: artifact.agent.systemKey, isSystem: artifact.agent.isSystem } : null,
    sourceConversation: artifact.conversation ? { id: artifact.conversation.id, title: artifact.conversation.title } : null,
    course: artifact.course ? { id: artifact.course.course_id, name: artifact.course.course_name } : null,
    knowledgePoints: artifact.knowledgePointsResolved || [],
    learningFlowLinks: (artifact.resourceLinks || []).map(link => ({
      id: link.id, resourceRole: link.resourceRole,
      knowledgePoint: link.knowledgePoint ? { id: link.knowledgePoint.knowledge_point_id, name: link.knowledgePoint.knowledge_point_name } : null,
      learningGoal: link.learningGoal ? { id: link.learningGoal.goal_id, title: link.learningGoal.normalized_title } : null,
      workflowTemplate: link.workflowTemplate ? { id: link.workflowTemplate.template_id, title: link.workflowTemplate.title } : null,
    })),
  };
  if (!adminMetadataOnly && detail) {
    data.requirements = artifact.requirementsJson;
    data.content = artifact.contentSchemaJson;
    data.previewHtml = artifact.previewHtml;
    data.aiNotice = '本产物由 AI 辅助生成，请结合课程要求核对后使用。';
    data.knowledgeSourceNotice = artifact.contentSchemaJson?.sourceNotice || artifact.requirementsJson?.knowledgeSourceNotice || '仅使用当前智能体允许访问的知识来源；未命中知识库时会标记为通用模型生成。';
  }
  if (data.ownerUserId === undefined) delete data.ownerUserId;
  return data;
}

async function findAccessible(user, id, { ownerOnly = false } = {}) {
  const artifact = await prisma.generatedArtifact.findFirst({
    where: { id: Number(id), deletedAt: null },
    include: ARTIFACT_INCLUDE,
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
      include: ARTIFACT_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.generatedArtifact.count({ where }),
  ]);
  const pointIds = [...new Set(records.flatMap(item => item.knowledgePointIdsJson || []).map(Number).filter(Number.isInteger))];
  const points = pointIds.length ? await prisma.knowledgePoint.findMany({ where: { knowledge_point_id: { in: pointIds } }, select: { knowledge_point_id: true, knowledge_point_name: true } }) : [];
  const pointMap = new Map(points.map(item => [item.knowledge_point_id, { id: item.knowledge_point_id, name: item.knowledge_point_name }]));
  records.forEach(item => { item.knowledgePointsResolved = (item.knowledgePointIdsJson || []).map(id => pointMap.get(Number(id))).filter(Boolean); });
  return { list: records.map((artifact) => serializeArtifact(artifact, { adminMetadataOnly })), total, page: query.page, pageSize: query.pageSize };
}

async function getArtifact(user, id) {
  const access = await findAccessible(user, id);
  const pointIds = (access.artifact.knowledgePointIdsJson || []).map(Number).filter(Number.isInteger);
  const points = pointIds.length ? await prisma.knowledgePoint.findMany({ where: { knowledge_point_id: { in: pointIds } }, select: { knowledge_point_id: true, knowledge_point_name: true } }) : [];
  access.artifact.knowledgePointsResolved = points.map(item => ({ id: item.knowledge_point_id, name: item.knowledge_point_name }));
  const data = serializeArtifact(access.artifact, { detail: true, adminMetadataOnly: access.adminMetadataOnly });
  if (!access.adminMetadataOnly) {
    data.exports = await Promise.all((access.artifact.exports || []).filter(item => !item.deletedAt).map(async item => ({
      ...serializeExport(item),
      downloadAvailable: await exportFileExists(item),
    })));
    data.downloadAvailable = data.exports.some(item => item.downloadAvailable);
    data.fileMissing = data.exports.some(item => item.status === 'READY' && !item.downloadAvailable);
  }
  return data;
}

async function getDownload(user, id) {
  const { artifact } = await findAccessible(user, id, { ownerOnly: true });
  const docxExport = (artifact.exports || []).find(item => item.format === 'DOCX' && !item.deletedAt);
  if (docxExport) return getExportDownload(user, id, 'DOCX');
  assert(artifact.status === 'READY' && artifact.storagePath, '文件尚未准备好', 40901, 409);
  const { absolutePath, stat } = await validateExportFile({ storagePath: artifact.storagePath, mimeType: WORD_MIME }, 'DOCX');
  await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { lastAccessedAt: new Date() } });
  return { absolutePath, fileName: `${artifact.title}.docx`, mimeType: WORD_MIME, size: stat.size };
}

async function exportFileExists(record) {
  if (!record?.storagePath || record.status !== 'READY') return false;
  try { return (await fs.stat(resolveStoredPath(record.storagePath))).isFile(); } catch { return false; }
}

async function validateExportFile(record, format) {
  const expectedMime = format === 'PDF' ? PDF_MIME : WORD_MIME;
  assert(record.mimeType === expectedMime, '文件格式与 MIME 不一致', 40901, 409);
  const absolutePath = resolveStoredPath(record.storagePath);
  let handle;
  try {
    const stat = await fs.stat(absolutePath);
    assert(stat.isFile(), '文件不存在或已失效', 40002, 404);
    handle = await fs.open(absolutePath, 'r');
    const length = format === 'PDF' ? 5 : 4;
    const signature = Buffer.alloc(length);
    await handle.read(signature, 0, length, 0);
    const valid = format === 'PDF'
      ? signature.toString() === '%PDF-'
      : signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    assert(valid, '文件内容与导出格式不一致', 40901, 409);
    return { absolutePath, stat };
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error('文件不存在或已失效'), { code: 40002, status: 404 });
  } finally { await handle?.close().catch(() => {}); }
}

async function getExportDownload(user, id, formatValue) {
  const { artifact } = await findAccessible(user, id, { ownerOnly: true });
  const format = String(formatValue || '').toUpperCase();
  assert(['DOCX', 'PDF'].includes(format), '不支持的导出格式', 40001, 400);
  const record = (artifact.exports || []).find((item) => item.format === format);
  assert(record?.ownerUserId === Number(user.user_id), '文件不存在或无权访问', 40301, 403);
  assert(record?.status === 'READY' && record.storagePath, `${format} 文件尚未准备好`, 40901, 409);
  const { absolutePath, stat } = await validateExportFile(record, format);
  const now = new Date();
  await Promise.all([
    prisma.generatedArtifactExport.update({ where: { id: record.id }, data: { lastAccessedAt: now } }),
    prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { lastAccessedAt: now } }),
  ]);
  return {
    absolutePath,
    fileName: `${artifact.title}.${format.toLowerCase()}`,
    mimeType: format === 'PDF' ? PDF_MIME : WORD_MIME,
    extension: format.toLowerCase(),
    size: stat.size,
  };
}

async function requestExport(user, id, operationId, requestedFormats = ['DOCX']) {
  const { artifact } = await findAccessible(user, id, { ownerOnly: true });
  assert(artifact.contentSchemaJson && artifact.previewHtml, '结构化内容尚未生成', 40901, 409);
  const formats = [...new Set(requestedFormats.map((value) => String(value).toUpperCase()))];
  const created = [];
  const readyExports = [];
  for (const format of formats) {
    assert(['DOCX', 'PDF'].includes(format), '不支持的导出格式', 40001, 400);
    const existingExport = await prisma.generatedArtifactExport.findUnique({ where: { artifactId_format: { artifactId: artifact.id, format } } });
    if (await exportFileExists(existingExport)) { readyExports.push(serializeExport(existingExport)); continue; }
    const taskRows = await prisma.asyncTask.findMany({
      where: { userId: Number(user.user_id), taskType: 'DOCUMENT_EXPORT', relatedResourceType: 'GENERATED_ARTIFACT', relatedResourceId: String(artifact.id) },
      orderBy: { createdAt: 'desc' },
    });
    let task = taskRows.find(item => String(item.metadataJson?.format || 'DOCX').toUpperCase() === format);
    if (task && ACTIVE_EXPORT_STATUSES.includes(task.status)) { created.push(tasks.serialize(task)); continue; }
    await prisma.generatedArtifactExport.upsert({
      where: { artifactId_format: { artifactId: artifact.id, format } },
      create: { artifactId: artifact.id, ownerUserId: artifact.ownerUserId, format, status: 'QUEUED', mimeType: format === 'PDF' ? PDF_MIME : WORD_MIME },
      update: { status: 'QUEUED', mimeType: format === 'PDF' ? PDF_MIME : WORD_MIME, errorCode: null, errorMessage: null, deletedAt: null },
    });
    const resultUrl = `#/student/artifacts/${artifact.id}?format=${format}`;
    if (task) {
      task = await prisma.asyncTask.update({ where: { id: task.id }, data: {
        status: 'QUEUED', stage: `等待导出 ${format}`, progressMode: 'DETERMINATE', progress: 0,
        errorCode: null, errorMessage: null, dismissedAt: null, startedAt: null, completedAt: null,
        lockedBy: null, lockedAt: null, attemptCount: 0, nextRunAt: new Date(), resultUrl,
        metadataJson: { artifactId: artifact.id, retryExport: true, format, requestOperationId: operationId },
      } });
      created.push(tasks.serialize(task));
      continue;
    }
    created.push(await tasks.createTask(Number(user.user_id), {
      operationId: `artifact-export-format-${artifact.id}-${format.toLowerCase()}`,
      taskType: 'DOCUMENT_EXPORT',
      title: `导出 ${artifact.title}（${format}）`,
      description: `从已生成的结构化内容导出 ${format}，不会重复生成正文`,
      status: 'QUEUED',
      stage: `等待导出 ${format}`,
      progressMode: 'DETERMINATE',
      progress: 0,
      relatedResourceType: 'GENERATED_ARTIFACT',
      relatedResourceId: artifact.id,
      resultType: 'ARTIFACT',
      resultId: artifact.id,
      resultUrl,
      cancellable: false,
      metadataJson: { artifactId: artifact.id, retryExport: true, format, requestOperationId: operationId },
    }));
  }
  return { artifact: serializeArtifact(artifact), tasks: created, task: created[0] || null, readyExports };
}

async function countResourceLinks(artifactId) {
  if (!prisma.learningFlowResourceLink) return 0;
  return prisma.learningFlowResourceLink.count({ where: { artifactId: Number(artifactId), deletedAt: null } });
}

async function deleteArtifact(user, id) {
  const { artifact } = await findAccessible(user, id, { ownerOnly: true });
  assert(await countResourceLinks(artifact.id) === 0, '该资料仍被学习流使用，请先解除关联后再删除。', 40901, 409);
  const originalStatus = artifact.status;
  await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { status: 'DELETING' } });
  const paths = [...new Set([artifact.storagePath, ...(artifact.exports || []).map((item) => item.storagePath)].filter(Boolean))];
  for (const storedPath of paths) {
    const absolutePath = resolveStoredPath(storedPath);
    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { status: originalStatus, errorCode: 'FILE_DELETE_FAILED' } });
        throw Object.assign(new Error('物理文件删除失败，请稍后重试'), { code: 50003, status: 500 });
      }
    }
  }
  await prisma.generatedArtifactExport.updateMany({
    where: { artifactId: artifact.id, deletedAt: null },
    data: { status: 'DELETED', storagePath: null, fileSizeBytes: null, deletedAt: new Date() },
  });
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
  getExportDownload,
  requestExport,
  deleteArtifact,
};
