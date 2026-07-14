const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = require('docx');
const mammoth = require('mammoth');
const prisma = require('../src/config/prisma');
const service = require('../src/services/teacher-preparation-document.service');

const cleanup = { documentId: null, resourceId: null, filePath: null, artifactId: null, taskId: null };

async function waitForExport(artifactId) {
  for (let count = 0; count < 240; count += 1) {
    const artifact = await prisma.generatedArtifact.findUnique({ where: { id: artifactId }, include: { task: true, exports: true } });
    const exported = artifact?.exports.find((item) => item.status === 'READY' && item.format === 'DOCX');
    if (artifact?.task?.status === 'SUCCEEDED' && exported?.storagePath) return exported;
    if (artifact?.task?.status === 'FAILED') throw new Error(artifact.task.errorMessage || 'DOCX export failed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('DOCX export timed out');
}

test('DOCX import, optimistic autosave, published-version protection and real export form a closed loop', async () => {
  const teacher = await prisma.user.findUnique({ where: { username: 'teacher_demo' } });
  assert.ok(teacher);
  const user = { user_id: teacher.user_id, role: 'teacher' };
  const unique = crypto.randomUUID();
  const source = new Document({ sections: [{ children: [
    new Paragraph({ text: `Immersive lesson ${unique}`, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: 'Bold concept', bold: true }), new TextRun({ text: ' and editable body.' })] }),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Header')] }), new TableCell({ children: [new Paragraph('Value')] })] })] }),
  ] }] });
  const buffer = await Packer.toBuffer(source);
  const imported = await service.importDocument(user, {
    originalname: `immersive-${unique}.docx`,
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer,
  }, {});
  cleanup.documentId = imported.document.id;
  cleanup.resourceId = imported.source_resource.id;
  const resource = await prisma.knowledgeDocument.findUnique({ where: { document_id: cleanup.resourceId } });
  cleanup.filePath = path.resolve(__dirname, '../../storage', String(resource.file_url).replace(/^\/+/, ''));
  assert.equal(imported.kind, 'editable');
  assert.match(imported.document.current_version.plain_text, /Bold concept/);
  assert.match(imported.document.current_version.sanitized_html, /<table/i);
  assert.match(imported.format_notice, /SmartArt/);

  const duplicate = await service.importDocument(user, {
    originalname: `immersive-${unique}.docx`,
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer,
  }, {});
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.document.id, cleanup.documentId);

  await assert.rejects(() => service.saveDraft(user, cleanup.documentId, {
    revision: imported.document.revision - 1,
    operation_id: crypto.randomUUID(),
    sanitized_html: imported.document.current_version.sanitized_html,
  }), (error) => error.code === 40901);

  const saved = await service.saveDraft(user, cleanup.documentId, {
    revision: imported.document.revision,
    operation_id: crypto.randomUUID(),
    revision_type: 'teacher_manual',
    sanitized_html: `${imported.document.current_version.sanitized_html}<h2>Autosave verification</h2><p><strong>Persisted edit</strong></p>`,
  });
  assert.equal(saved.revision, imported.document.revision + 1);
  assert.match(saved.current_version.plain_text, /Persisted edit/);

  const published = await service.createVersion(user, cleanup.documentId, { publish: true, change_summary: 'Publish integration version' });
  assert.ok(published.published_at);
  const publishedDocument = await service.getDocument(user, cleanup.documentId);
  const postPublish = await service.saveDraft(user, cleanup.documentId, {
    revision: publishedDocument.revision,
    operation_id: crypto.randomUUID(),
    revision_type: 'ai_insert',
    instruction: 'Confirmed AI insertion',
    sanitized_html: `${publishedDocument.current_version.sanitized_html}<p><em>New draft after publish</em></p>`,
  });
  assert.notEqual(postPublish.current_version.id, published.id);
  assert.equal(postPublish.current_version.parent_version_id, published.id);

  const listed = await service.listSelectableResources(user, {});
  assert.ok(listed.list.some((item) => item.source_kind === 'resource' && item.id === cleanup.resourceId));
  assert.ok(listed.list.some((item) => item.source_kind === 'editable' && item.id === cleanup.documentId));

  const queued = await service.exportDocument(user, cleanup.documentId, { format: 'DOCX' });
  cleanup.artifactId = queued.artifact_id;
  cleanup.taskId = queued.task_id;
  const exported = await waitForExport(cleanup.artifactId);
  const exportedPath = path.resolve(__dirname, '../storage/generated-artifacts', exported.storagePath);
  const bytes = await fs.readFile(exportedPath);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const extracted = await mammoth.extractRawText({ buffer: bytes });
  assert.match(extracted.value, /Persisted edit/);
  assert.match(extracted.value, /New draft after publish/);
});

test.after(async () => {
  if (cleanup.artifactId) {
    const exports = await prisma.generatedArtifactExport.findMany({ where: { artifactId: cleanup.artifactId }, select: { storagePath: true } });
    for (const item of exports) if (item.storagePath) await fs.unlink(path.resolve(__dirname, '../storage/generated-artifacts', item.storagePath)).catch(() => {});
    await prisma.notification.deleteMany({ where: { target_type: 'generated_artifact', target_id: cleanup.artifactId } });
    await prisma.generatedArtifactExport.deleteMany({ where: { artifactId: cleanup.artifactId } });
    await prisma.generatedArtifact.deleteMany({ where: { id: cleanup.artifactId } });
  }
  if (cleanup.taskId) await prisma.asyncTask.deleteMany({ where: { id: cleanup.taskId } });
  if (cleanup.documentId) await prisma.editableTeachingDocument.deleteMany({ where: { id: cleanup.documentId } });
  if (cleanup.resourceId) await prisma.knowledgeDocument.deleteMany({ where: { document_id: cleanup.resourceId } });
  if (cleanup.filePath) await fs.unlink(cleanup.filePath).catch(() => {});
  await prisma.$disconnect();
});
