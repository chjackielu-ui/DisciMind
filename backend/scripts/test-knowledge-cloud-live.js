const crypto = require('crypto');
const fs = require('fs/promises');
const { loadEnv } = require('../src/config/env');

loadEnv();

const storage = require('../src/modules/knowledge-base/knowledge-storage.service');
const vectorStore = require('../src/modules/knowledge-base/knowledge-vector-store.service');
const provider = require('../src/modules/knowledge-base/knowledge-provider.service');

async function main() {
  if (String(process.env.KNOWLEDGE_CLOUD_LIVE_ACCEPTANCE || '').toLowerCase() !== 'true') {
    throw new Error('真实云验收默认关闭；确认使用测试资源后设置 KNOWLEDGE_CLOUD_LIVE_ACCEPTANCE=true');
  }
  if (storage.config().driver !== 'oss' || !vectorStore.isEnabled()) {
    throw new Error('真实云验收要求 KNOWLEDGE_STORAGE_DRIVER=oss 且 KNOWLEDGE_VECTOR_STORE=qdrant');
  }
  const id = Date.now();
  const content = Buffer.from(`DisciMind knowledge cloud acceptance ${id}`, 'utf8');
  const stored = await storage.storeUpload({ userId: 0, knowledgeBaseId: 0, buffer: content, extension: '.txt', mimeType: 'text/plain', id: `acceptance-${id}` });
  const document = { document_id: id, knowledge_base_id: 0, original_filename: 'acceptance.txt', file_ext: '.txt', ...{
    storage_type: stored.storageType, file_url: stored.fileUrl, storage_key: stored.storageKey,
    storage_bucket: stored.storageBucket, storage_version_id: stored.storageVersionId,
  } };
  try {
    const materialized = await storage.materializeDocument(document);
    try {
      const downloaded = await fs.readFile(materialized.absolutePath);
      if (crypto.createHash('sha256').update(downloaded).digest('hex') !== crypto.createHash('sha256').update(content).digest('hex')) {
        throw new Error('OSS 下载内容校验失败');
      }
    } finally {
      await materialized.cleanup();
    }
    const embeddings = provider.createEmbeddingClient();
    const vector = await embeddings.embedQuery(content.toString('utf8'));
    await vectorStore.upsertChunks({
      knowledgeBaseId: 0,
      document,
      chunks: [{ chunk_id: id, chunk_index: 1, chunk_text: content.toString('utf8'), page_number: null, title_path: null }],
      vectors: [vector],
    });
    const matches = await vectorStore.search([0], vector, { limit: 1, scoreThreshold: 0.8 });
    if (!matches.some((match) => String(match.id) === String(id))) throw new Error('Qdrant 写入后未检索到验收向量');
    console.log(JSON.stringify({ ok: true, oss: true, qdrant: true, embeddingDimensions: vector.length }));
  } finally {
    await vectorStore.deleteDocument(id).catch(() => {});
    await storage.deleteDocumentObject(document).catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || 'KNOWLEDGE_CLOUD_LIVE_FAILED', message: error.message }));
  process.exitCode = 1;
});
