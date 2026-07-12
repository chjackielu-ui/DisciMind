const prisma = require('../../config/prisma');
const docx = require('./document-export.service');
const pdf = require('./pdf-export.service');
const tasks = require('../async-task/async-task.service');

async function reconcileArtifactStatus(artifactId) {
  const [artifact, readyCount] = await Promise.all([
    prisma.generatedArtifact.findUnique({ where: { id: Number(artifactId) }, select: { id: true, contentSchemaJson: true, deletedAt: true } }),
    prisma.generatedArtifactExport.count({ where: { artifactId: Number(artifactId), status: 'READY', deletedAt: null } }),
  ]);
  if (!artifact || artifact.deletedAt || !artifact.contentSchemaJson) return;
  await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { status: readyCount > 0 ? 'READY' : 'CONTENT_READY' } });
}

async function exportFormat(artifactId, format, options = {}) {
  const normalized = String(format || 'DOCX').toUpperCase();
  if (!['DOCX', 'PDF'].includes(normalized)) throw Object.assign(new Error('不支持的导出格式'), { code: 'EXPORT_FORMAT_UNSUPPORTED', permanent: true });
  const artifact = await prisma.generatedArtifact.findUnique({ where: { id: Number(artifactId) } });
  if (!artifact || artifact.deletedAt) throw Object.assign(new Error('Artifact 不存在'), { code: 'ARTIFACT_NOT_FOUND', permanent: true, userMessage: '导出失败，产物不存在。' });
  const mimeType = normalized === 'PDF' ? pdf.PDF_MIME : docx.WORD_MIME;
  const record = await prisma.generatedArtifactExport.upsert({
    where: { artifactId_format: { artifactId: artifact.id, format: normalized } },
    create: { artifactId: artifact.id, ownerUserId: artifact.ownerUserId, format: normalized, status: 'EXPORTING', mimeType },
    update: { status: 'EXPORTING', mimeType, errorCode: null, errorMessage: null, deletedAt: null },
  });
  try {
    let updated;
    if (normalized === 'PDF') updated = await pdf.exportPdf(artifact.id, options);
    else {
      const exported = await docx.exportArtifact(artifact.id, options);
      updated = await prisma.generatedArtifactExport.update({
        where: { id: record.id },
        data: { status: 'READY', storagePath: exported.storagePath, fileSizeBytes: exported.fileSizeBytes, mimeType: docx.WORD_MIME, lastAccessedAt: new Date(), errorCode: null, errorMessage: null, deletedAt: null },
      });
    }
    await reconcileArtifactStatus(artifact.id);
    if (options.taskId) await tasks.updateTask(options.taskId, {
      status: 'SUCCEEDED', progress: 100, stage: `${normalized} 已生成`, resultType: 'ARTIFACT',
      resultId: artifact.id, resultUrl: `#/student/artifacts/${artifact.id}?format=${normalized}`,
    });
    return updated;
  } catch (error) {
    const errorCode = String(error.code || `${normalized}_EXPORT_FAILED`).slice(0, 100);
    await prisma.generatedArtifactExport.updateMany({ where: { artifactId: artifact.id, format: normalized }, data: { status: 'FAILED', errorCode, errorMessage: `${normalized} 导出失败，请稍后重试。` } }).catch(() => {});
    await reconcileArtifactStatus(artifact.id).catch(() => {});
    if (options.taskId) await tasks.updateTask(options.taskId, {
      status: 'FAILED', stage: `${normalized} 导出失败`, errorCode, errorMessage: `${normalized} 导出失败，请稍后重试。`,
      resultType: 'ARTIFACT', resultId: artifact.id, resultUrl: `#/student/artifacts/${artifact.id}?format=${normalized}`,
    }).catch(() => {});
    throw error;
  }
}

module.exports = { exportFormat, reconcileArtifactStatus };
