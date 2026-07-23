const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');

const storage = require('../src/modules/knowledge-base/knowledge-storage.service');
const vectorStore = require('../src/modules/knowledge-base/knowledge-vector-store.service');
const provider = require('../src/modules/knowledge-base/knowledge-provider.service');

test('OSS storage keeps cloud coordinates in backend document metadata', async () => {
  const calls = [];
  const result = await storage.storeUpload({
    userId: 8,
    knowledgeBaseId: 9,
    buffer: Buffer.from('knowledge'),
    extension: '.txt',
    mimeType: 'text/plain',
    id: 'fixed-id',
  }, {
    driver: 'oss',
    bucket: 'private-bucket',
    prefix: 'agent-knowledge',
    client: {
      put: async (...args) => {
        calls.push(args);
        return { res: { headers: { etag: '"etag-1"', 'x-oss-version-id': 'version-1' } } };
      },
    },
  });

  assert.equal(calls[0][0], 'agent-knowledge/8/9/fixed-id.txt');
  assert.deepEqual(result, {
    storageType: 'OSS',
    fileUrl: 'oss://private-bucket/agent-knowledge/8/9/fixed-id.txt',
    storageKey: 'agent-knowledge/8/9/fixed-id.txt',
    storageBucket: 'private-bucket',
    storageEtag: 'etag-1',
    storageVersionId: 'version-1',
  });
});

test('OSS documents are materialized temporarily and cleaned after backend use', async () => {
  const document = {
    storage_type: 'OSS', storage_key: 'agent-knowledge/8/9/source.txt', storage_bucket: 'private-bucket',
    file_url: 'oss://private-bucket/agent-knowledge/8/9/source.txt', file_ext: '.txt',
  };
  const materialized = await storage.materializeDocument(document, {
    client: { get: async (_key, destination) => fs.writeFile(destination, 'cloud text') },
  });
  assert.equal(await fs.readFile(materialized.absolutePath, 'utf8'), 'cloud text');
  await materialized.cleanup();
  await assert.rejects(fs.access(materialized.absolutePath));
});

test('Qdrant adapter creates a cosine collection and writes backend-owned payloads', async () => {
  const calls = [];
  const client = {
    getCollection: async () => { throw Object.assign(new Error('not found'), { status: 404 }); },
    createCollection: async (...args) => calls.push(['create', ...args]),
    upsert: async (...args) => calls.push(['upsert', ...args]),
  };
  const ids = await vectorStore.upsertChunks({
    knowledgeBaseId: 4,
    document: { document_id: 5, original_filename: 'source.txt' },
    chunks: [{ chunk_id: 6, chunk_index: 1, chunk_text: 'content', page_number: null, title_path: 'title' }],
    vectors: [[1, 0]],
  }, { driver: 'qdrant', url: 'http://qdrant.test', collection: 'kb', client });

  assert.deepEqual(ids, ['6']);
  assert.deepEqual(calls[0], ['create', 'kb', { vectors: { size: 2, distance: 'Cosine' } }]);
  assert.equal(calls[1][0], 'upsert');
  assert.equal(calls[1][2].points[0].payload.knowledgeBaseId, 4);
  assert.equal(calls[1][2].points[0].payload.content, 'content');
});

test('Qdrant indexing stores only embedding metadata in MySQL', async () => {
  const updates = [];
  const db = {
    knowledgeDocument: { findUnique: async () => ({ document_id: 5, knowledge_base_id: 4, original_filename: 'source.txt' }) },
    knowledgeDocumentChunk: {
      findMany: async () => [{ chunk_id: 6, chunk_index: 1, chunk_text: 'content', chunk_hash: 'hash', metadata_json: { pageNumber: 1 } }],
      update: ({ data }) => { updates.push(data); return Promise.resolve(data); },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const vectorClient = {
    getCollection: async () => ({ config: { params: { vectors: { size: 2 } } } }),
    upsert: async () => ({}),
  };
  const result = await provider.indexDocument(5, {
    prisma: db,
    vectorStore: 'qdrant',
    vectorClient,
    client: { embedDocuments: async () => [[1, 0]] },
  });

  assert.equal(result.vectorStore, 'QDRANT');
  assert.equal(updates[0].vector_store_type, 'QDRANT');
  assert.equal(updates[0].embedding_id, '6');
  assert.equal(updates[0].metadata_json.embedding.dimensions, 2);
  assert.equal(updates[0].metadata_json.embedding.vector, undefined);
});

test('Qdrant retrieval preserves the existing knowledge record contract', async () => {
  const result = await provider.retrieveFromDataset(4, 'query', {
    prisma: { knowledgeBase: { findMany: async () => [{ knowledge_base_id: 4 }] } },
    vectorStore: 'qdrant',
    client: { embedQuery: async () => [1, 0] },
    vectorClient: { search: async () => [{
      id: 6,
      score: 0.9,
      payload: {
        knowledgeBaseId: 4, documentId: 5, documentName: 'source.txt', chunkIndex: 1,
        pageNumber: 2, titlePath: 'title', content: 'matched content',
      },
    }] },
  });

  assert.deepEqual(result.records[0], {
    knowledgeBaseId: 4,
    datasetId: '4',
    documentId: '5',
    documentName: 'source.txt',
    segmentId: '6',
    content: 'matched content',
    score: 0.9,
    metadata: { provider: 'BAILIAN', page_number: 2, title_path: 'title', chunk_index: 1 },
  });
});
