const test = require('node:test');
const assert = require('node:assert/strict');

const provider = require('../src/modules/knowledge-base/knowledge-provider.service');
const agentContext = require('../src/modules/agent-chat/agent-context.service');

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

test('remote Bailian knowledge bases can be available without a local document count', () => {
  assert.equal(agentContext.isKnowledgeBaseAvailable({
    provider: 'BAILIAN_KNOWLEDGE',
    marketplace_status: 'READY',
    remote_status: 'READY',
    documents: [],
  }), true);
  assert.equal(agentContext.isKnowledgeBaseAvailable({
    provider: 'BAILIAN_KNOWLEDGE',
    marketplace_status: 'READY',
    remote_status: 'FAILED',
    documents: [],
  }), false);
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

test('knowledge provider merges remote Bailian records with local retrieval contract', async () => {
  const db = {
    knowledgeBase: {
      findMany: async () => [{ knowledge_base_id: 8, provider: 'BAILIAN_KNOWLEDGE', dify_dataset_id: 'aid-demo' }],
    },
  };
  let requestedUrl = '';
  let requestedBody = null;
  const result = await provider.retrieveFromDataset(8, '假设空间', {
    prisma: db,
    baseURL: 'https://ws-demo.cn-beijing.maas.aliyuncs.com',
    apiKey: 'unit-test-key',
    fetch: async (url, request) => {
      requestedUrl = url;
      requestedBody = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
        success: true,
        data: {
          total: 1,
          nodes: [{
            score: 0.42,
            metadata: {
              doc_name: '周志华-机器学习',
              doc_id: 'remote-doc-1',
              _id: 'chunk-1',
              title: '假设空间',
              hier_title: '第1章绪论 > 1.3假设空间',
              content: '假设空间是学习过程中所有可能假设的集合。',
              page_number: [4],
              workspace_id: 'ws-demo',
            },
          }],
        },
        }),
      };
    },
  });

  assert.equal(requestedUrl, 'https://ws-demo.cn-beijing.maas.aliyuncs.com/api/v1/indices/knowledge/search');
  assert.deepEqual(requestedBody, { query: '假设空间', agent_id: 'aid-demo' });
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    knowledgeBaseId: 8,
    datasetId: '8',
    documentId: 'remote-doc-1',
    documentName: '周志华-机器学习',
    segmentId: 'chunk-1',
    content: '假设空间是学习过程中所有可能假设的集合。',
    score: 0.42,
    metadata: {
      provider: 'BAILIAN_KNOWLEDGE',
      remoteKnowledgeBaseId: 'aid-demo',
      remoteDocId: 'remote-doc-1',
      page_number: 4,
      title_path: '第1章绪论 > 1.3假设空间',
      title: '假设空间',
      workspace_id: 'ws-demo',
      url: null,
    },
  });
});

test('remote Bailian aid search service maps app doc references into records', async () => {
  const db = {
    knowledgeBase: {
      findMany: async () => [{ knowledge_base_id: 9, provider: 'BAILIAN_KNOWLEDGE', dify_dataset_id: 'aid-demoapp' }],
    },
  };
  let requestedUrl = '';
  let requestedBody = null;
  const result = await provider.retrieveFromDataset(9, '假设空间', {
    prisma: db,
    apiKey: 'unit-test-key',
    idMode: 'app',
    workspaceId: '',
    appBaseURL: 'https://dashscope.aliyuncs.com',
    fetch: async (url, request) => {
      requestedUrl = url;
      requestedBody = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
          output: {
            text: '根据资料，假设空间是所有可能假设组成的集合。',
            doc_references: [{
              doc_name: '周志华-机器学习',
              doc_id: 'remote-doc-2',
              title: '假设空间',
              text: '假设空间是学习过程中所有可能假设的集合。',
              page_number: [4],
              score: 0.88,
            }],
          },
        }),
      };
    },
  });

  assert.equal(requestedUrl, 'https://dashscope.aliyuncs.com/api/v1/apps/aid-demoapp/completion');
  assert.equal(requestedBody.input.prompt, '假设空间');
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    knowledgeBaseId: 9,
    datasetId: '9',
    documentId: 'remote-doc-2',
    documentName: '周志华-机器学习',
    segmentId: 'remote-doc-2',
    content: '假设空间是学习过程中所有可能假设的集合。',
    score: 0.88,
    metadata: {
      provider: 'BAILIAN_KNOWLEDGE',
      remoteKnowledgeBaseId: 'aid-demoapp',
      remoteDocId: 'remote-doc-2',
      page_number: 4,
      title_path: '假设空间',
      title: '假设空间',
      workspace_id: null,
      url: null,
    },
  });
});
