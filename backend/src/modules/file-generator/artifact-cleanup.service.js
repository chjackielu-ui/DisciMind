const fs = require('fs/promises');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const { resolveStoredPath } = require('./document-export.service');

const DEFAULT_RETENTION_DAYS = 90;
const NON_CLEANABLE_STATUSES = ['DRAFT', 'GENERATING', 'EXPORTING', 'DELETING', 'DELETED', 'EXPIRED'];
const ACTIVE_TASK_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];

function cutoffDate(now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

async function findCandidates({ now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS, limit = 100 } = {}) {
  const cutoff = cutoffDate(now, retentionDays);
  return prisma.generatedArtifact.findMany({
    where: {
      deletedAt: null,
      status: { notIn: NON_CLEANABLE_STATUSES },
      OR: [
        { lastAccessedAt: { lt: cutoff } },
        { lastAccessedAt: null, createdAt: { lt: cutoff } },
      ],
      resourceLinks: { none: { deletedAt: null } },
      NOT: {
        task: { is: { status: { in: ACTIVE_TASK_STATUSES } } },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(500, Math.max(1, Number(limit) || 100)),
    include: { exports: { where: { deletedAt: null } } },
  });
}

async function expireArtifact(artifact) {
  const originalStatus = artifact.status;
  try {
    const paths = [...new Set([artifact.storagePath, ...(artifact.exports || []).map(item => item.storagePath)].filter(Boolean))];
    for (const storedPath of paths) {
      await fs.unlink(resolveStoredPath(storedPath)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await prisma.generatedArtifactExport.updateMany({ where: { artifactId: artifact.id, deletedAt: null }, data: { status: 'DELETED', storagePath: null, fileSizeBytes: null, deletedAt: new Date() } });
    await prisma.generatedArtifact.update({
      where: { id: artifact.id },
      data: { status: 'EXPIRED', storagePath: null, fileSizeBytes: null, previewHtml: null, errorCode: null },
    });
    return { id: artifact.id, expired: true };
  } catch (error) {
    await prisma.generatedArtifact.update({
      where: { id: artifact.id },
      data: { status: originalStatus, errorCode: 'CLEANUP_FILE_DELETE_FAILED' },
    }).catch(() => {});
    return { id: artifact.id, expired: false, error: 'CLEANUP_FILE_DELETE_FAILED' };
  }
}

async function runCleanup({ taskId, now = new Date(), retentionDays, limit } = {}) {
  const candidates = await findCandidates({ now, retentionDays, limit });
  const results = [];
  for (let index = 0; index < candidates.length; index += 1) {
    results.push(await expireArtifact(candidates[index]));
    if (taskId) await tasks.updateTask(taskId, {
      status: 'RUNNING', stage: '正在清理过期学习资料', progress: Math.round(((index + 1) / Math.max(1, candidates.length)) * 90),
    });
  }
  const summary = { scanned: candidates.length, expired: results.filter((item) => item.expired).length, failed: results.filter((item) => !item.expired).length };
  if (taskId) await tasks.updateTask(taskId, { status: 'SUCCEEDED', stage: '过期资料清理完成', progress: 100, metadataJson: summary });
  return summary;
}

async function scheduleCleanup(now = new Date()) {
  const owner = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { user_id: true } });
  if (!owner) return null;
  const day = now.toISOString().slice(0, 10);
  return tasks.createTask(owner.user_id, {
    operationId: `artifact-cleanup-${day}`,
    taskType: 'ARTIFACT_CLEANUP',
    title: '学习资料定期清理',
    description: '清理未被学习流使用且超过保留期的生成资料',
    status: 'QUEUED', stage: '等待检查过期资料', progressMode: 'DETERMINATE', progress: 0,
    relatedResourceType: 'GENERATED_ARTIFACT_RETENTION', relatedResourceId: day,
    cancellable: false, maxAttempts: 3,
  });
}

module.exports = { DEFAULT_RETENTION_DAYS, NON_CLEANABLE_STATUSES, cutoffDate, findCandidates, expireArtifact, runCleanup, scheduleCleanup };
