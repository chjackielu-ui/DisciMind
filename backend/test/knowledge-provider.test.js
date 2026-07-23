const test = require('node:test');
const assert = require('node:assert/strict');

const provider = require('../src/modules/knowledge-base/knowledge-provider.service');

test('knowledge provider validates vectors and computes cosine similarity', () => {
  assert.equal(provider.cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(provider.cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(provider.cosineSimilarity([1], [1, 0]), null);
  assert.deepEqual(provider.vectorFromChunk({ metadata_json: { embedding: { vector: ['1', 0] } } }), [1, 0]);
  assert.equal(provider.vectorFromChunk({ metadata_json: { embedding: { vector: ['bad'] } } }), null);
});

test('knowledge provider keeps a bounded lexical fallback', () => {
  assert.equal(provider.lexicalScore('梯度下降用于优化损失函数', '梯度下降'), 0.95);
  assert.ok(provider.lexicalScore('逻辑回归通过 sigmoid 输出概率', '逻辑回归 概率') > 0.5);
  assert.equal(provider.lexicalScore('无关内容', '注意力机制'), 0);
});

test('knowledge provider indexes existing chunks through the configured embedding client', async () => {
  const updates = [];
  const chunks = [
    { chunk_id: 11, chunk_hash: 'hash-1', chunk_text: '片段一', metadata_json: { pageNumber: 1 } },
    { chunk_id: 12, chunk_hash: 'hash-2', chunk_text: '片段二', metadata_json: null },
  ];
  const db = {
    knowledgeDocumentChunk: {
      findMany: async () => chunks,
      update: ({ where, data }) => {
        updates.push({ where, data });
        return Promise.resolve({ ...where, ...data });
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const result = await provider.indexDocument(7, {
    prisma: db,
    client: { embedDocuments: async (texts) => {
      assert.deepEqual(texts, ['片段一', '片段二']);
      return [[1, 0], [0, 1]];
    } },
  });

  assert.equal(result.chunkCount, 2);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].data.vector_store_type, 'DATABASE');
  assert.deepEqual(updates[0].data.metadata_json.embedding.vector, [1, 0]);
  assert.equal(updates[0].data.metadata_json.pageNumber, 1);
  assert.match(updates[0].data.embedding_id, /^[a-f0-9]{64}$/);
});

test('knowledge provider retrieval preserves the existing source contract', async () => {
  const db = {
    knowledgeBase: {
      findMany: async () => [{ knowledge_base_id: 7 }],
    },
    knowledgeDocumentChunk: {
      findMany: async () => [{
        chunk_id: 31,
        document_id: 21,
        chunk_index: 1,
        chunk_text: '逻辑回归使用 sigmoid 函数输出概率。',
        page_number: 3,
        title_path: '第三章 / 逻辑回归',
        metadata_json: { embedding: { vector: [1, 0] } },
        document: {
          document_id: 21,
          knowledge_base_id: 7,
          original_filename: '机器学习讲义.pdf',
          title: '机器学习讲义',
          knowledge_base: { knowledge_base_id: 7, name: '课程知识库', provider: 'BAILIAN' },
        },
      }],
    },
  };
  const result = await provider.retrieveFromMultipleDatasets([7], '逻辑回归', {
    prisma: db,
    client: { embedQuery: async () => [1, 0] },
    topK: 3,
    scoreThreshold: 0.5,
  });

  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    knowledgeBaseId: 7,
    datasetId: '7',
    documentId: '21',
    documentName: '机器学习讲义.pdf',
    segmentId: '31',
    content: '逻辑回归使用 sigmoid 函数输出概率。',
    score: 1,
    metadata: {
      provider: 'BAILIAN',
      page_number: 3,
      title_path: '第三章 / 逻辑回归',
      chunk_index: 1,
    },
  });
});
