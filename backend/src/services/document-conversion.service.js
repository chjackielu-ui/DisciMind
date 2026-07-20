const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const prisma = require('../config/prisma');
const asyncTaskService = require('../modules/async-task/async-task.service');
const { ensureDocumentAccess } = require('./teacher-access.service');

const PROJECT_STORAGE_ROOT = path.resolve(__dirname, '../../../storage');
const BACKEND_STORAGE_ROOT = path.resolve(__dirname, '../../storage');
const OUTPUT_ROOT = path.resolve(PROJECT_STORAGE_ROOT, 'lesson-plans/conversions');
const TIMEOUT_MS = Math.max(10_000, Number(process.env.DOCUMENT_CONVERSION_TIMEOUT_MS) || 120_000);
const MAX_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.DOCUMENT_CONVERSION_MAX_CONCURRENCY) || 2));
const queue = [];
let active = 0;

function commonLibreOfficePaths() {
  return [
    process.env.LIBREOFFICE_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe' : null,
    process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : null,
    process.platform !== 'win32' ? '/usr/bin/libreoffice' : null,
    process.platform !== 'win32' ? '/usr/bin/soffice' : null,
  ].filter(Boolean);
}

function detectConverter() {
  const configured = String(process.env.LIBREOFFICE_PATH || '').trim();
  if (configured) return fsSync.existsSync(configured) ? { path: configured, source: 'environment' } : { path: null, source: 'environment', configured };
  const candidate = commonLibreOfficePaths().find(item => fsSync.existsSync(item));
  return candidate ? { path: candidate, source: 'common_path' } : { path: null, source: 'not_found' };
}

function publicFailure(error) {
  if (error?.code === 'PPT_CONVERTER_UNAVAILABLE') return { code: error.code, message: '当前环境未配置 PPT 转换服务。请配置 LIBREOFFICE_PATH 后重试。', retryable: true };
  if (error?.code === 'PPT_CONVERSION_TIMEOUT') return { code: error.code, message: 'PPT 转换超时，可以检查文件后重试。', retryable: true };
  if (error?.code === 'PPT_OUTPUT_INVALID') return { code: error.code, message: '转换程序未生成有效 PDF，请检查源课件。', retryable: true };
  return { code: 'PPT_CONVERSION_FAILED', message: 'PPT 转换失败，可以下载原文件或稍后重试。', retryable: true };
}

async function sourcePath(resource) {
  const candidates = [String(resource.file_url || '').replace(/^\/+/, '')];
  if (resource.source_artifact_id) {
    const artifact = await prisma.generatedArtifact.findUnique({ where: { id: Number(resource.source_artifact_id) }, select: { storagePath: true } });
    if (artifact?.storagePath) candidates.push(path.posix.join('generated-artifacts', String(artifact.storagePath).replace(/\\/g, '/').replace(/^\/+/, '')));
  }
  for (const candidate of candidates) {
    const relative = String(candidate || '').replace(/\//g, path.sep);
    if (!relative || relative.split(path.sep).includes('..')) continue;
    for (const root of [PROJECT_STORAGE_ROOT, BACKEND_STORAGE_ROOT]) {
      const absolute = path.resolve(root, relative);
      if (!absolute.startsWith(`${root}${path.sep}`)) continue;
      try { await fs.access(absolute); return absolute; } catch {}
    }
  }
  throw Object.assign(new Error('资源文件不存在'), { code: 'PPT_SOURCE_MISSING' });
}

function conversionMetadata(resource, taskId, patch = {}) {
  return {
    ...(resource.metadata_json || {}),
    conversion: {
      sourceResourceId: resource.document_id,
      outputResourceId: resource.metadata_json?.conversion?.outputResourceId || null,
      taskId,
      sourceMimeType: resource.mime_type,
      outputMimeType: 'application/pdf',
      status: 'queued',
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      retryCount: Number(resource.metadata_json?.conversion?.retryCount || 0),
      ...patch,
    },
  };
}

function runProcess(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 2000); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('conversion timeout'), { code: 'PPT_CONVERSION_TIMEOUT' }));
    }, TIMEOUT_MS);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Object.assign(new Error(stderr || `converter exited ${code}`), { code: 'PPT_CONVERSION_FAILED' }));
    });
  });
}

async function createOutputResource(source, output, checksum, taskId) {
  const groupId = `ppt-pdf-${source.document_id}-${String(source.file_checksum || checksum).slice(0, 32)}`.slice(0, 64);
  const existing = await prisma.knowledgeDocument.findFirst({ where: { resource_group_id: groupId, file_ext: 'pdf', deleted_at: null } });
  if (existing) return existing;
  const directory = path.resolve(OUTPUT_ROOT, String(source.owner_user_id));
  const fileName = `${source.document_id}-${checksum.slice(0, 20)}.pdf`;
  const absolute = path.resolve(directory, fileName);
  if (!absolute.startsWith(`${directory}${path.sep}`)) throw Object.assign(new Error('invalid output path'), { code: 'PPT_OUTPUT_INVALID' });
  await fs.mkdir(directory, { recursive: true });
  await fs.copyFile(output, absolute);
  const stat = await fs.stat(absolute);
  return prisma.knowledgeDocument.create({ data: {
    title: `${source.title}（PDF 预览）`, original_filename: `${path.parse(source.original_filename).name}.pdf`, file_ext: 'pdf',
    file_size_bytes: Number(stat.size), mime_type: 'application/pdf', storage_type: 'LOCAL',
    file_url: `/lesson-plans/conversions/${source.owner_user_id}/${fileName}`, scope_type: source.scope_type, visibility: source.visibility,
    course_id: source.course_id, teaching_class_id: source.teaching_class_id, lesson_plan_id: source.lesson_plan_id,
    source_artifact_id: source.source_artifact_id, owner_user_id: source.owner_user_id, is_teaching_resource: true,
    resource_kind: 'presentation_preview', resource_category: 'PPT 转换文件', resource_group_id: groupId,
    version_source: 'PPT_CONVERSION', parse_status: 'UPLOADED', review_status: 'APPROVED', file_checksum: checksum,
    marketplace_status: 'READY', processing_state: 'ready', retryable: true,
    metadata_json: { conversion: { sourceResourceId: source.document_id, taskId, sourceMimeType: source.mime_type, outputMimeType: 'application/pdf' } },
  } });
}

async function execute(job) {
  const { taskId, sourceResourceId } = job;
  let source = await prisma.knowledgeDocument.findUnique({ where: { document_id: sourceResourceId } });
  if (!source) return;
  const converter = detectConverter();
  const startedAt = new Date();
  try {
    if (!converter.path) throw Object.assign(new Error('converter unavailable'), { code: 'PPT_CONVERTER_UNAVAILABLE' });
    await prisma.$transaction([
      prisma.asyncTask.update({ where: { id: taskId }, data: { status: 'RUNNING', stage: 'LibreOffice 正在转换', startedAt, attemptCount: { increment: 1 }, errorCode: null, errorMessage: null } }),
      prisma.knowledgeDocument.update({ where: { document_id: source.document_id }, data: { processing_state: 'converting', error_code: null, error_message: null, failed_at: null, metadata_json: conversionMetadata(source, taskId, { status: 'running', startedAt: startedAt.toISOString() }) } }),
    ]);
    const absolute = await sourcePath(source);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'discimind-ppt-'));
    try {
      const userInstallation = path.resolve(temporary, 'libreoffice-profile');
      await fs.mkdir(userInstallation, { recursive: true });
      await runProcess(converter.path, [
        `-env:UserInstallation=${pathToFileURL(userInstallation).href}`,
        '--headless', '--nologo', '--nodefault', '--nolockcheck', '--norestore',
        '--convert-to', 'pdf', '--outdir', temporary, absolute,
      ], temporary);
      const files = await fs.readdir(temporary);
      const outputName = files.find(name => name.toLowerCase().endsWith('.pdf'));
      if (!outputName) throw Object.assign(new Error('pdf output missing'), { code: 'PPT_OUTPUT_INVALID' });
      const output = path.resolve(temporary, outputName);
      const buffer = await fs.readFile(output);
      if (buffer.length < 8 || buffer.subarray(0, 5).toString() !== '%PDF-') throw Object.assign(new Error('invalid pdf header'), { code: 'PPT_OUTPUT_INVALID' });
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      const result = await createOutputResource(source, output, checksum, taskId);
      const completedAt = new Date();
      source = await prisma.knowledgeDocument.findUnique({ where: { document_id: sourceResourceId } });
      await prisma.$transaction([
        prisma.asyncTask.update({ where: { id: taskId }, data: { status: 'SUCCEEDED', stage: 'PDF 预览已生成', progress: 100, resultType: 'KNOWLEDGE_DOCUMENT', resultId: String(result.document_id), completedAt, errorCode: null, errorMessage: null } }),
        prisma.knowledgeDocument.update({ where: { document_id: sourceResourceId }, data: { processing_state: 'ready', marketplace_status: 'READY', metadata_json: conversionMetadata(source, taskId, { status: 'succeeded', outputResourceId: result.document_id, completedAt: completedAt.toISOString() }) } }),
      ]);
    } finally { await fs.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
  } catch (error) {
    const failure = publicFailure(error);
    source = await prisma.knowledgeDocument.findUnique({ where: { document_id: sourceResourceId } });
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.asyncTask.update({ where: { id: taskId }, data: { status: 'FAILED', stage: 'PPT 转换失败', completedAt, errorCode: failure.code, errorMessage: failure.message, requiresUserAction: failure.code === 'PPT_CONVERTER_UNAVAILABLE' } }),
      prisma.knowledgeDocument.update({ where: { document_id: sourceResourceId }, data: { processing_state: 'failed', error_code: failure.code, error_message: failure.message, error_stage: 'conversion', failed_at: completedAt, retryable: failure.retryable, metadata_json: conversionMetadata(source, taskId, { status: 'failed', completedAt: completedAt.toISOString(), errorCode: failure.code, errorMessage: failure.message }) } }),
    ]);
  }
}

function drain() {
  while (active < MAX_CONCURRENCY && queue.length) {
    const job = queue.shift(); active += 1;
    execute(job).catch(() => {}).finally(() => { active -= 1; drain(); });
  }
}

function enqueue(job) { queue.push(job); Promise.resolve().then(drain); }

async function startConversion(user, resourceId, { retry = false } = {}) {
  const source = await ensureDocumentAccess(user, resourceId);
  if (!['ppt', 'pptx'].includes(String(source.file_ext).toLowerCase())) throw Object.assign(new Error('所选资源不是 PPT/PPTX'), { code: 40001 });
  const existingOutputId = Number(source.metadata_json?.conversion?.outputResourceId);
  if (existingOutputId) {
    const output = await prisma.knowledgeDocument.findFirst({ where: { document_id: existingOutputId, deleted_at: null, processing_state: 'ready' } });
    if (output) return { status: 'succeeded', task_id: source.metadata_json?.conversion?.taskId || null, output_resource_id: output.document_id, reused: true, converter: detectConverter().source };
  }
  const dedupeKey = crypto.createHash('sha256').update(`ppt-pdf:${source.file_checksum || source.document_id}:pdf`).digest('hex');
  let task;
  const previousTaskId = Number(source.metadata_json?.conversion?.taskId);
  if (retry && previousTaskId) {
    task = await prisma.asyncTask.findFirst({ where: { id: previousTaskId, userId: user.user_id } });
    if (task) task = await prisma.asyncTask.update({ where: { id: task.id }, data: {
      status: 'QUEUED', stage: '等待重新转换', progress: 0, attemptCount: 0,
      completedAt: null, startedAt: null, cancelledAt: null, errorCode: null, errorMessage: null,
      requiresUserAction: false, lockedBy: null, lockedAt: null, nextRunAt: new Date(),
    } });
  }
  if (!task) {
    const created = await asyncTaskService.createTask(user.user_id, {
      taskType: 'DOCUMENT_EXPORT', operationId: `ppt-convert-${source.document_id}-${source.file_checksum || source.updated_at.getTime()}`,
      dedupeKey, title: `转换课件：${source.title}`, description: '将 PPT/PPTX 转换为 PDF 连续预览',
      status: 'QUEUED', stage: '等待 PPT 转换', progressMode: 'DETERMINATE', progress: 0,
      relatedResourceType: 'KNOWLEDGE_DOCUMENT', relatedResourceId: source.document_id,
      maxAttempts: 3, metadataJson: { operation: 'ppt_to_pdf', source_resource_id: source.document_id },
    });
    task = await prisma.asyncTask.findUnique({ where: { id: created.id } });
  }
  const metadata = conversionMetadata(source, task.id, { status: 'queued', retryCount: Number(source.metadata_json?.conversion?.retryCount || 0) + (retry ? 1 : 0) });
  await prisma.knowledgeDocument.update({ where: { document_id: source.document_id }, data: { processing_state: 'converting', metadata_json: metadata } });
  const converter = detectConverter();
  if (!converter.path) await execute({ taskId: task.id, sourceResourceId: source.document_id });
  else enqueue({ taskId: task.id, sourceResourceId: source.document_id });
  const refreshed = await prisma.asyncTask.findUnique({ where: { id: task.id } });
  return { status: String(refreshed.status).toLowerCase(), task_id: refreshed.id, output_resource_id: refreshed.resultId ? Number(refreshed.resultId) : null, error_code: refreshed.errorCode, error_message: refreshed.errorMessage, converter: converter.source, reused: false };
}

async function conversionStatus(user, resourceId) {
  const source = await ensureDocumentAccess(user, resourceId);
  const conversion = source.metadata_json?.conversion || null;
  const task = conversion?.taskId ? await prisma.asyncTask.findFirst({ where: { id: Number(conversion.taskId), userId: user.user_id } }) : null;
  return { source_resource_id: source.document_id, processing_state: source.processing_state, conversion, task: task ? asyncTaskService.serialize(task) : null, converter: detectConverter().source };
}

module.exports = { detectConverter, startConversion, conversionStatus };
