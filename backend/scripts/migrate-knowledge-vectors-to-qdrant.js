const fs = require('fs/promises');
const path = require('path');
const { loadEnv } = require('../src/config/env');

loadEnv();

const prisma = require('../src/config/prisma');
const vectorStore = require('../src/modules/knowledge-base/knowledge-vector-store.service');

function argument(name, fallback = null) {
  const entry = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
}

async function readCheckpoint(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return { lastChunkId: 0 }; }
}

async function writeCheckpoint(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function withoutVector(metadata) {
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const embedding = source.embedding && typeof source.embedding === 'object' ? source.embedding : {};
  const { vector, ...embeddingMetadata } = embedding;
  void vector;
  return { ...source, embedding: embeddingMetadata };
}

async function main() {
  if (!vectorStore.isEnabled()) throw new Error('请先设置 KNOWLEDGE_VECTOR_STORE=qdrant 和 QDRANT_URL');
  const checkpointFile = path.resolve(argument('checkpoint', 'storage/migrations/knowledge-vectors-to-qdrant.json'));
  const checkpoint = await readCheckpoint(checkpointFile);
  const after = Math.max(Number(argument('after', 0)), Number(checkpoint.lastChunkId || 0));
  const limit = Math.max(1, Math.min(100_000, Number(argument('limit', 5000))));
  const chunks = await prisma.knowledgeDocumentChunk.findMany({
    where: { chunk_id: { gt: after }, vector_store_type: { not: 'QDRANT' }, document: { deleted_at: null, knowledge_base_id: { not: null } } },
    include: { document: true },
    orderBy: { chunk_id: 'asc' },
    take: limit,
  });
  let migrated = 0;
  let skipped = 0;
  for (const chunk of chunks) {
    const vector = chunk.metadata_json?.embedding?.vector?.map(Number);
    if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) {
      skipped += 1;
    } else {
      await vectorStore.upsertChunks({
        knowledgeBaseId: chunk.document.knowledge_base_id,
        document: chunk.document,
        chunks: [chunk],
        vectors: [vector],
      });
      await prisma.knowledgeDocumentChunk.update({ where: { chunk_id: chunk.chunk_id }, data: {
        embedding_id: String(chunk.chunk_id),
        vector_store_type: 'QDRANT',
        metadata_json: withoutVector(chunk.metadata_json),
      } });
      migrated += 1;
      console.log(`[knowledge-vectors] migrated chunk ${chunk.chunk_id}`);
    }
    checkpoint.lastChunkId = chunk.chunk_id;
    checkpoint.updatedAt = new Date().toISOString();
    await writeCheckpoint(checkpointFile, checkpoint);
  }
  console.log(JSON.stringify({ ok: true, scanned: chunks.length, migrated, skipped, lastChunkId: checkpoint.lastChunkId || after }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || 'KNOWLEDGE_VECTOR_MIGRATION_FAILED', message: error.message }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
