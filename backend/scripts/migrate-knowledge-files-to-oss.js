const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { loadEnv } = require('../src/config/env');

loadEnv();

const prisma = require('../src/config/prisma');
const storage = require('../src/modules/knowledge-base/knowledge-storage.service');

function argument(name, fallback = null) {
  const entry = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
}

async function readCheckpoint(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return { lastDocumentId: 0 }; }
}

async function writeCheckpoint(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  if (storage.config().driver !== 'oss') throw new Error('请先设置 KNOWLEDGE_STORAGE_DRIVER=oss 和完整 OSS 配置');
  const checkpointFile = path.resolve(argument('checkpoint', 'storage/migrations/knowledge-files-to-oss.json'));
  const checkpoint = await readCheckpoint(checkpointFile);
  const after = Math.max(Number(argument('after', 0)), Number(checkpoint.lastDocumentId || 0));
  const limit = Math.max(1, Math.min(10_000, Number(argument('limit', 1000))));
  const deleteLocal = process.argv.includes('--delete-local');
  const documents = await prisma.knowledgeDocument.findMany({
    where: { document_id: { gt: after }, knowledge_base_id: { not: null }, storage_type: 'LOCAL', deleted_at: null },
    orderBy: { document_id: 'asc' },
    take: limit,
  });
  let migrated = 0;
  let skipped = 0;
  for (const document of documents) {
    let materialized;
    try {
      materialized = await storage.materializeDocument(document);
    } catch (error) {
      skipped += 1;
      checkpoint.lastDocumentId = document.document_id;
      checkpoint.updatedAt = new Date().toISOString();
      await writeCheckpoint(checkpointFile, checkpoint);
      console.warn(`[knowledge-files] skipped document ${document.document_id}: ${error.code || error.message}`);
      continue;
    }
    try {
      const buffer = await fs.readFile(materialized.absolutePath);
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      if (document.file_checksum && checksum !== document.file_checksum) {
        throw new Error(`文档 ${document.document_id} 校验和不匹配，已停止迁移`);
      }
      const stored = await storage.storeUpload({
        userId: document.owner_user_id,
        knowledgeBaseId: document.knowledge_base_id,
        buffer,
        extension: document.file_ext,
        mimeType: document.mime_type,
        id: `document-${document.document_id}`,
      });
      const remote = await storage.headDocumentObject({
        ...document,
        storage_type: stored.storageType,
        file_url: stored.fileUrl,
        storage_key: stored.storageKey,
        storage_bucket: stored.storageBucket,
      });
      if (!remote.exists || (remote.size && remote.size !== buffer.length)) {
        await storage.deleteDocumentObject({ ...document, storage_type: 'OSS', file_url: stored.fileUrl, storage_key: stored.storageKey, storage_bucket: stored.storageBucket }).catch(() => {});
        throw new Error(`文档 ${document.document_id} 的 OSS 上传校验失败`);
      }
      await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: {
        storage_type: 'OSS', file_url: stored.fileUrl, storage_key: stored.storageKey,
        storage_bucket: stored.storageBucket, storage_etag: remote.etag || stored.storageEtag,
        storage_version_id: remote.versionId || stored.storageVersionId,
      } });
      if (deleteLocal) await fs.unlink(materialized.absolutePath).catch(() => {});
      migrated += 1;
      checkpoint.lastDocumentId = document.document_id;
      checkpoint.updatedAt = new Date().toISOString();
      await writeCheckpoint(checkpointFile, checkpoint);
      console.log(`[knowledge-files] migrated document ${document.document_id}`);
    } finally {
      await materialized.cleanup();
    }
  }
  console.log(JSON.stringify({ ok: true, scanned: documents.length, migrated, skipped, lastDocumentId: checkpoint.lastDocumentId || after, deleteLocal }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || 'KNOWLEDGE_FILE_MIGRATION_FAILED', message: error.message }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
