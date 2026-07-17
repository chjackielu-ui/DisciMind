const crypto = require('crypto');
const fs = require('fs/promises');
const mammoth = require('mammoth');
const prisma = require('../config/prisma');
const generatedArtifactService = require('../modules/file-generator/generated-artifact.service');
const teacherKnowledgeService = require('./teacher-knowledge.service');
const documentConversionService = require('./document-conversion.service');
const preparationDocumentService = require('./teacher-preparation-document.service');

const ACTIVE_TASK_STATUSES = new Set(['QUEUED', 'RUNNING', 'PAUSED']);
const GENERATED_STATUS = {
  DRAFT: 'generating', GENERATING: 'generating', CONTENT_READY: 'generating', EXPORTING: 'generating',
  READY: 'ready', FAILED: 'failed', EXPIRED: 'failed', DELETING: 'deleted', DELETED: 'deleted',
};

function serviceError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function sourceId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw serviceError('产物 ID 不合法');
  return parsed;
}

function sourceType(value) {
  const normalized = String(value || '').toLowerCase();
  if (!['generated_artifact', 'teacher_resource', 'editable_document'].includes(normalized)) throw serviceError('产物来源不合法');
  return normalized;
}

function artifactStatus(item) {
  if (item.requirementsJson?.teacherArtifactArchived === true) return 'archived';
  if (item.task && ACTIVE_TASK_STATUSES.has(item.task.status)) return item.task.taskType === 'DOCUMENT_EXPORT' ? 'converting' : 'generating';
  return GENERATED_STATUS[item.status] || 'generating';
}

function resourceStatus(item) {
  if (String(item.resource_status).toUpperCase() === 'ARCHIVED') return 'archived';
  const state = String(item.processing_state || '').toLowerCase();
  if (state === 'failed' || item.error_code) return 'failed';
  if (state.includes('convert')) return 'converting';
  if (['uploaded', 'parsing', 'chunking', 'indexing'].includes(state) || ['UPLOADED', 'PARSING'].includes(item.parse_status)) return 'parsing';
  return 'ready';
}

function generatedRow(item) {
  const exports = (item.exports || []).filter(record => !record.deletedAt);
  const readyExports = exports.filter(record => record.status === 'READY' && record.storagePath);
  return {
    id: `generated_artifact:${item.id}`, source_type: 'generated_artifact', source_id: item.id,
    title: item.title, description: item.description, artifact_type: String(item.artifactType || '').toLowerCase(),
    mime_type: readyExports[0]?.mimeType || item.mimeType || null, file_ext: readyExports[0]?.format?.toLowerCase() || item.fileFormat?.toLowerCase() || null,
    size_bytes: Number(readyExports[0]?.fileSizeBytes || item.fileSizeBytes || 0), course_id: item.courseId,
    course_name: item.course?.course_name || null, teaching_class_id: null, teaching_class_name: null,
    lesson_plan_id: item.lessonPlanId, task_id: item.taskId, status: artifactStatus(item), version: 1,
    source_label: item.agentId ? 'Agent / AI 生成' : 'AI 生成', created_by: item.ownerUserId,
    created_at: item.createdAt?.toISOString?.() || item.createdAt, updated_at: item.updatedAt?.toISOString?.() || item.updatedAt,
    downloadable: readyExports.length > 0 || Boolean(item.storagePath), previewable: Boolean(item.previewHtml) || readyExports.length > 0,
    distribution_count: item.teachingResources?.reduce((sum, resource) => sum + Number(resource._count?.distributions || 0), 0) || 0,
    progress: item.task?.progress ?? null, error_code: item.errorCode || item.task?.errorCode || null,
    formats: readyExports.map(record => record.format), output_resource_id: item.teachingResources?.[0]?.document_id || null,
  };
}

function resourceRow(item) {
  const conversion = item.metadata_json?.conversion || null;
  return {
    id: `teacher_resource:${item.document_id}`, source_type: 'teacher_resource', source_id: item.document_id,
    title: item.title, description: item.resource_category, artifact_type: String(item.resource_kind || item.resource_category || item.file_ext || 'file').toLowerCase(),
    mime_type: item.mime_type, file_ext: String(item.file_ext || '').toLowerCase(), size_bytes: Number(item.file_size_bytes || 0),
    course_id: item.course_id, course_name: item.course?.course_name || null, teaching_class_id: item.teaching_class_id,
    teaching_class_name: item.teaching_class?.teaching_class_name || null, lesson_plan_id: item.lesson_plan_id,
    task_id: conversion?.taskId || null, status: resourceStatus(item), version: item.resource_version || 1,
    source_label: item.version_source === 'PPT_CONVERSION' ? 'PPT 转换' : item.source_artifact_id ? 'AI / 备课产物' : item.version_source === 'LOCAL_IMPORT' ? '我的上传' : '教学资源',
    created_by: item.owner_user_id, created_at: item.created_at?.toISOString?.() || item.created_at,
    updated_at: item.updated_at?.toISOString?.() || item.updated_at, downloadable: Boolean(item.file_url || item.external_url),
    previewable: ['pdf', 'docx', 'md', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(String(item.file_ext || '').toLowerCase()) || Boolean(conversion?.outputResourceId),
    distribution_count: item._count?.distributions || 0, progress: null, error_code: conversion?.errorCode || item.error_code || null,
    retryable: item.retryable !== false, output_resource_id: conversion?.outputResourceId || null,
  };
}

function editableRow(item) {
  return {
    id: `editable_document:${item.id}`, source_type: 'editable_document', source_id: item.id,
    title: item.title, description: item.lesson_plan?.topic || '沉浸式教案', artifact_type: 'lesson_plan',
    mime_type: 'text/html', file_ext: 'doc', size_bytes: Buffer.byteLength(item.current_version?.sanitized_html || '', 'utf8'),
    course_id: item.course_id, course_name: item.course?.course_name || null, teaching_class_id: item.teaching_class_id,
    teaching_class_name: item.teaching_class?.teaching_class_name || null, lesson_plan_id: item.lesson_plan_id,
    task_id: null, status: String(item.status).toUpperCase() === 'ARCHIVED' ? 'archived' : 'ready',
    version: item.current_version?.version_number || 1, source_label: '沉浸式备课', created_by: item.owner_user_id,
    created_at: item.created_at?.toISOString?.() || item.created_at, updated_at: item.updated_at?.toISOString?.() || item.updated_at,
    downloadable: false, previewable: true, distribution_count: 0, progress: null, error_code: null,
  };
}

function matches(row, query) {
  if (query.source_type && row.source_type !== query.source_type) return false;
  if (query.status && row.status !== query.status) return false;
  if (query.artifact_type && !row.artifact_type.includes(String(query.artifact_type).toLowerCase())) return false;
  if (query.course_id && Number(row.course_id) !== Number(query.course_id)) return false;
  if (query.teaching_class_id && Number(row.teaching_class_id) !== Number(query.teaching_class_id)) return false;
  if (query.previewable === 'true' && !row.previewable) return false;
  if (query.downloadable === 'true' && !row.downloadable) return false;
  if (query.q && ![row.title, row.description, row.source_label, row.course_name, row.teaching_class_name].join(' ').toLowerCase().includes(String(query.q).trim().toLowerCase())) return false;
  const created = new Date(row.created_at).getTime();
  if (query.date_from && created < new Date(query.date_from).getTime()) return false;
  if (query.date_to && created > new Date(`${query.date_to}T23:59:59.999`).getTime()) return false;
  return true;
}

async function list(user, query = {}) {
  const ownerId = Number(user.user_id);
  const [generated, resources, documents] = await Promise.all([
    prisma.generatedArtifact.findMany({
      where: { ownerUserId: ownerId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 200,
      include: {
        task: true, course: { select: { course_id: true, course_name: true } },
        exports: { where: { deletedAt: null } },
        teachingResources: { where: { deleted_at: null }, select: { document_id: true, _count: { select: { distributions: true } } } },
      },
    }),
    prisma.knowledgeDocument.findMany({
      where: { owner_user_id: ownerId, is_teaching_resource: true, deleted_at: null }, orderBy: { updated_at: 'desc' }, take: 300,
      include: { course: { select: { course_name: true } }, teaching_class: { select: { teaching_class_name: true } }, _count: { select: { distributions: true } } },
    }),
    prisma.editableTeachingDocument.findMany({
      where: { owner_user_id: ownerId, deleted_at: null }, orderBy: { updated_at: 'desc' }, take: 200,
      include: { current_version: { select: { version_number: true, sanitized_html: true } }, course: { select: { course_name: true } }, teaching_class: { select: { teaching_class_name: true } }, lesson_plan: { select: { topic: true } } },
    }),
  ]);
  const rows = [...generated.map(generatedRow), ...resources.map(resourceRow), ...documents.map(editableRow)].filter(row => matches(row, query));
  const sort = String(query.sort || 'updated_desc');
  rows.sort((a, b) => sort === 'title_asc' ? a.title.localeCompare(b.title, 'zh-CN')
    : sort === 'size_desc' ? b.size_bytes - a.size_bytes
      : sort === 'created_desc' ? new Date(b.created_at) - new Date(a.created_at)
        : new Date(b.updated_at) - new Date(a.updated_at));
  const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 50));
  const start = (page - 1) * pageSize;
  return { list: rows.slice(start, start + pageSize), total: rows.length, page, page_size: pageSize };
}

async function detail(user, rawType, rawId) {
  const type = sourceType(rawType); const id = sourceId(rawId); const ownerId = Number(user.user_id);
  if (type === 'generated_artifact') {
    const item = await generatedArtifactService.getArtifact(user, id);
    return { ...item, source_type: type, source_id: id, preview_html: item.previewHtml || null };
  }
  if (type === 'teacher_resource') {
    const item = await prisma.knowledgeDocument.findFirst({ where: { document_id: id, owner_user_id: ownerId, deleted_at: null } });
    if (!item) throw serviceError('产物不存在或无权访问', 40301, 403);
    let previewHtml = null;
    if (['docx', 'md', 'txt'].includes(String(item.file_ext).toLowerCase()) && Number(item.file_size_bytes || 0) <= 20 * 1024 * 1024) {
      try {
        const source = await preparationDocumentService.getSourceFile(user, 'resource', item.document_id);
        const buffer = await fs.readFile(source.absolute);
        if (String(item.file_ext).toLowerCase() === 'docx') previewHtml = preparationDocumentService.sanitizeHtml((await mammoth.convertToHtml({ buffer })).value);
        else if (String(item.file_ext).toLowerCase() === 'md') previewHtml = preparationDocumentService.sanitizeHtml(preparationDocumentService.markdownToHtml(buffer.toString('utf8')));
        else previewHtml = preparationDocumentService.sanitizeHtml(preparationDocumentService.extractedTextToHtml(buffer.toString('utf8'), item.title));
      } catch { previewHtml = null; }
    }
    return { ...resourceRow(item), preview_html: previewHtml, cleaned_text: item.cleaned_text || null, conversion: item.metadata_json?.conversion || null, external_url: item.external_url || null };
  }
  const item = await prisma.editableTeachingDocument.findFirst({ where: { id, owner_user_id: ownerId, deleted_at: null }, include: { current_version: true, course: true, teaching_class: true, lesson_plan: true } });
  if (!item) throw serviceError('产物不存在或无权访问', 40301, 403);
  return { ...editableRow(item), preview_html: item.current_version?.sanitized_html || '', plain_text: item.current_version?.plain_text || '' };
}

async function rename(user, rawType, rawId, title) {
  const type = sourceType(rawType); const id = sourceId(rawId); const ownerId = Number(user.user_id); const safeTitle = String(title || '').trim().slice(0, 200);
  if (!safeTitle) throw serviceError('产物名称不能为空');
  if (type === 'generated_artifact') return generatedArtifactService.renameArtifact(user, id, safeTitle);
  if (type === 'teacher_resource') return teacherKnowledgeService.updateResource(user, id, { title: safeTitle });
  const result = await prisma.editableTeachingDocument.updateMany({ where: { id, owner_user_id: ownerId, deleted_at: null }, data: { title: safeTitle } });
  if (!result.count) throw serviceError('产物不存在或无权访问', 40301, 403);
  return { id, title: safeTitle };
}

async function setArchived(user, type, id, archived) {
  const ownerId = Number(user.user_id);
  if (type === 'generated_artifact') {
    const item = await prisma.generatedArtifact.findFirst({ where: { id, ownerUserId: ownerId, deletedAt: null } });
    if (!item) throw serviceError('产物不存在或无权访问', 40301, 403);
    await prisma.generatedArtifact.update({ where: { id }, data: { requirementsJson: { ...(item.requirementsJson || {}), teacherArtifactArchived: archived } } });
  } else if (type === 'teacher_resource') {
    const result = await prisma.knowledgeDocument.updateMany({ where: { document_id: id, owner_user_id: ownerId, deleted_at: null }, data: { resource_status: archived ? 'ARCHIVED' : 'ACTIVE' } });
    if (!result.count) throw serviceError('产物不存在或无权访问', 40301, 403);
  } else {
    const result = await prisma.editableTeachingDocument.updateMany({ where: { id, owner_user_id: ownerId, deleted_at: null }, data: { status: archived ? 'ARCHIVED' : 'DRAFT' } });
    if (!result.count) throw serviceError('产物不存在或无权访问', 40301, 403);
  }
  return { archived };
}

async function remove(user, type, id) {
  const ownerId = Number(user.user_id);
  if (type === 'generated_artifact') {
    const item = await prisma.generatedArtifact.findFirst({ where: { id, ownerUserId: ownerId, deletedAt: null }, include: { task: true } });
    if (!item) throw serviceError('产物不存在或无权访问', 40301, 403);
    if (item.task && ACTIVE_TASK_STATUSES.has(item.task.status)) throw serviceError('运行中的任务不能删除，请先停止任务', 40901, 409);
    return generatedArtifactService.deleteArtifact(user, id);
  }
  if (type === 'teacher_resource') {
    const item = await prisma.knowledgeDocument.findFirst({ where: { document_id: id, owner_user_id: ownerId, deleted_at: null } });
    if (!item) throw serviceError('产物不存在或无权访问', 40301, 403);
    if (String(item.processing_state).includes('convert')) throw serviceError('转换中的文件不能删除', 40901, 409);
    return teacherKnowledgeService.deleteResource(user, id);
  }
  const result = await prisma.editableTeachingDocument.updateMany({ where: { id, owner_user_id: ownerId, deleted_at: null }, data: { deleted_at: new Date() } });
  if (!result.count) throw serviceError('产物不存在或无权访问', 40301, 403);
  return { deleted: true };
}

async function retry(user, type, id) {
  if (type === 'teacher_resource') return documentConversionService.startConversion(user, id, { retry: true });
  if (type !== 'generated_artifact') throw serviceError('当前产物没有可重试任务');
  const item = await prisma.generatedArtifact.findFirst({ where: { id, ownerUserId: Number(user.user_id), deletedAt: null }, include: { exports: { where: { deletedAt: null } } } });
  if (!item) throw serviceError('产物不存在或无权访问', 40301, 403);
  const formats = [...new Set(item.exports.filter(record => record.status === 'FAILED').map(record => record.format))];
  return generatedArtifactService.requestExport(user, id, `artifact-retry-${crypto.randomUUID()}`, formats.length ? formats : ['DOCX', 'PDF']);
}

async function materializeGeneratedResource(user, artifactId) {
  const ownerId = Number(user.user_id);
  const existing = await prisma.knowledgeDocument.findFirst({ where: { source_artifact_id: artifactId, owner_user_id: ownerId, deleted_at: null }, orderBy: { resource_version: 'desc' } });
  if (existing) return existing;
  const artifact = await prisma.generatedArtifact.findFirst({ where: { id: artifactId, ownerUserId: ownerId, deletedAt: null }, include: { exports: { where: { status: 'READY', deletedAt: null }, orderBy: { format: 'asc' } } } });
  if (!artifact) throw serviceError('产物不存在或无权访问', 40301, 403);
  const exported = artifact.exports.find(record => record.format === 'PDF') || artifact.exports.find(record => record.format === 'DOCX');
  if (!exported?.storagePath) throw serviceError('请先完成 PDF 或 DOCX 导出，再下发学生', 40901, 409);
  return prisma.knowledgeDocument.create({ data: {
    title: artifact.title, original_filename: `${artifact.title}.${exported.format.toLowerCase()}`, file_ext: exported.format.toLowerCase(),
    file_size_bytes: Number(exported.fileSizeBytes || 0), mime_type: exported.mimeType, storage_type: 'LOCAL',
    file_url: `/generated-artifacts/${exported.storagePath}`, scope_type: artifact.courseId ? 'COURSE' : 'PERSONAL', visibility: 'PRIVATE',
    course_id: artifact.courseId, lesson_plan_id: artifact.lessonPlanId, source_artifact_id: artifact.id, owner_user_id: ownerId,
    is_teaching_resource: true, resource_kind: artifact.artifactType === 'STUDY_HANDOUT' ? 'student_handout' : 'exam_paper',
    resource_category: 'AI 生成产物', metadata_json: { generatedArtifactId: artifact.id, exportFormat: exported.format },
    resource_group_id: `artifact-${artifact.id}`, resource_version: 1, version_source: 'AI_GENERATED', file_checksum: exported.checksum,
    parse_status: 'PARSED', review_status: 'APPROVED', marketplace_status: 'READY', processing_state: 'ready',
  } });
}

async function share(user, type, id, payload) {
  if (type === 'editable_document') throw serviceError('请先在教案中生成学生材料，再下发教学班', 40901, 409);
  const resource = type === 'teacher_resource'
    ? await prisma.knowledgeDocument.findFirst({ where: { document_id: id, owner_user_id: Number(user.user_id), deleted_at: null } })
    : await materializeGeneratedResource(user, id);
  if (!resource) throw serviceError('产物不存在或无权访问', 40301, 403);
  return teacherKnowledgeService.shareResource(user, resource.document_id, payload);
}

async function batch(user, body = {}) {
  const action = String(body.action || '').toLowerCase();
  if (!['archive', 'unarchive', 'delete', 'retry', 'share'].includes(action)) throw serviceError('批量操作不合法');
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  if (!rawItems.length) throw serviceError('请选择产物');
  const successIds = []; const failedItems = [];
  for (const raw of rawItems) {
    const key = `${raw.source_type}:${raw.source_id}`;
    try {
      const type = sourceType(raw.source_type); const id = sourceId(raw.source_id);
      if (action === 'archive' || action === 'unarchive') await setArchived(user, type, id, action === 'archive');
      else if (action === 'delete') await remove(user, type, id);
      else if (action === 'retry') await retry(user, type, id);
      else await share(user, type, id, { ...(body.payload || {}), operation_id: `${body.payload?.operation_id || crypto.randomUUID()}:${type}:${id}`.slice(0, 80) });
      successIds.push(key);
    } catch (error) {
      failedItems.push({ id: key, errorCode: error.code || 50001, message: error.message || '操作失败' });
    }
  }
  return { successIds, failedItems, action };
}

module.exports = { list, detail, rename, batch };
