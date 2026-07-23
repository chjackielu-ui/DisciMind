const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { loadEnv } = require('../src/config/env');

loadEnv();

const prisma = require('../src/config/prisma');
const knowledgeBaseService = require('../src/modules/knowledge-base/knowledge-base.service');

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

function argument(name, fallback = null) {
  const entry = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
}

function stableId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

async function main() {
  const manifestArg = argument('manifest');
  if (!manifestArg) throw new Error('用法: npm run import:dify-knowledge -- --manifest=/path/to/manifest.json');
  const manifestPath = path.resolve(manifestArg);
  const root = path.dirname(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.knowledgeBases)) throw new Error('manifest.knowledgeBases 必须是数组');
  let imported = 0;
  for (let kbIndex = 0; kbIndex < manifest.knowledgeBases.length; kbIndex += 1) {
    const entry = manifest.knowledgeBases[kbIndex];
    const ownerUserId = Number(entry.ownerUserId);
    if (!Number.isInteger(ownerUserId) || ownerUserId <= 0 || !String(entry.name || '').trim() || !Array.isArray(entry.files)) {
      throw new Error(`knowledgeBases[${kbIndex}] 缺少 ownerUserId/name/files`);
    }
    const sourceId = entry.difyDatasetId || `${kbIndex}:${entry.name}`;
    const historical = entry.difyDatasetId ? await prisma.knowledgeBase.findFirst({
      where: { owner_user_id: ownerUserId, dify_dataset_id: String(entry.difyDatasetId), deleted_at: null },
    }) : null;
    const created = historical ? null : await knowledgeBaseService.createKnowledgeBase(ownerUserId, {
      name: String(entry.name).slice(0, 100),
      description: String(entry.description || '从 Dify 离线导出文件迁移').slice(0, 2000),
      category: null,
      operationId: `dify-import-${stableId(sourceId)}`,
    });
    const knowledgeBaseId = historical?.knowledge_base_id || Number(created.id);
    await prisma.knowledgeBase.update({ where: { knowledge_base_id: knowledgeBaseId }, data: {
      name: String(entry.name).slice(0, 100),
      description: String(entry.description || historical?.description || '从 Dify 离线导出文件迁移').slice(0, 2000),
      dify_dataset_id: entry.difyDatasetId ? String(entry.difyDatasetId).slice(0, 255) : null,
      ownership_mode: 'LOCAL_MANAGED', remote_status: 'MIGRATED', sync_error: null, last_synced_at: new Date(),
    } });
    for (let fileIndex = 0; fileIndex < entry.files.length; fileIndex += 1) {
      const fileEntry = typeof entry.files[fileIndex] === 'string' ? { path: entry.files[fileIndex] } : entry.files[fileIndex];
      const sourcePath = path.resolve(root, String(fileEntry.path || ''));
      if (!sourcePath.startsWith(`${root}${path.sep}`)) throw new Error(`文件路径越界: ${fileEntry.path}`);
      const extension = path.extname(sourcePath).toLowerCase();
      if (!MIME_TYPES[extension]) throw new Error(`不支持的导出文件类型: ${fileEntry.path}`);
      const buffer = await fs.readFile(sourcePath);
      const originalName = String(fileEntry.originalName || path.basename(sourcePath));
      try {
        await knowledgeBaseService.uploadDocument(ownerUserId, knowledgeBaseId, {
          buffer, size: buffer.length, originalname: originalName, mimetype: MIME_TYPES[extension],
        }, `dify-file-${stableId(`${sourceId}:${fileEntry.path}`)}`, originalName);
        imported += 1;
        console.log(`[dify-export] queued ${entry.name}/${originalName}`);
      } catch (error) {
        if (Number(error.code) !== 40901) throw error;
        console.log(`[dify-export] skipped duplicate ${entry.name}/${originalName}`);
      }
    }
  }
  console.log(JSON.stringify({ ok: true, knowledgeBases: manifest.knowledgeBases.length, imported }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || 'DIFY_EXPORT_IMPORT_FAILED', message: error.message }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
