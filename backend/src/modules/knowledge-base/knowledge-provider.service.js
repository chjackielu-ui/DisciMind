const crypto = require('crypto');
const { OpenAIEmbeddings } = require('@langchain/openai');
const prisma = require('../../config/prisma');
const vectorStore = require('./knowledge-vector-store.service');
const bailianKnowledge = require('./bailian-knowledge.service');

const VECTOR_STORE_TYPE = 'DATABASE';
const QDRANT_VECTOR_STORE_TYPE = 'QDRANT';
const BAILIAN_KNOWLEDGE_PROVIDER = 'BAILIAN_KNOWLEDGE';
const DEFAULT_MODEL = 'text-embedding-v4';
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_MAX_CANDIDATES = 2000;

let cachedClient = null;
let cachedClientKey = null;

function providerError(code, message, status = 502, cause = null, retryable = true) {
  return Object.assign(new Error(message), { code, status, cause, retryable });
}

function config() {
  const apiKey = process.env.KNOWLEDGE_EMBEDDING_API_KEY || process.env.BAILIAN_API_KEY || '';
  const baseURL = process.env.KNOWLEDGE_EMBEDDING_BASE_URL
    || process.env.BAILIAN_BASE_URL
    || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  return {
    provider: String(process.env.KNOWLEDGE_EMBEDDING_PROVIDER || 'BAILIAN').toUpperCase(),
    apiKey,
    baseURL,
    model: process.env.KNOWLEDGE_EMBEDDING_MODEL || DEFAULT_MODEL,
    timeout: Math.max(10_000, Number(process.env.KNOWLEDGE_EMBEDDING_TIMEOUT_MS || 120_000)),
    batchSize: Math.max(1, Math.min(64, Number(process.env.KNOWLEDGE_EMBEDDING_BATCH_SIZE || DEFAULT_BATCH_SIZE))),
  };
}

function createEmbeddingClient(options = {}) {
  const current = { ...config(), ...options };
  if (!current.apiKey) {
    throw providerError('KNOWLEDGE_EMBEDDING_NOT_CONFIGURED', '知识库向量模型未配置，请联系管理员。', 500, null, false);
  }
  const key = JSON.stringify({
    apiKeyFingerprint: crypto.createHash('sha256').update(current.apiKey).digest('hex'),
    baseURL: current.baseURL,
    model: current.model,
    timeout: current.timeout,
    batchSize: current.batchSize,
  });
  if (!options.client && cachedClient && cachedClientKey === key) return cachedClient;
  const client = options.client || new OpenAIEmbeddings({
    apiKey: current.apiKey,
    model: current.model,
    batchSize: current.batchSize,
    timeout: current.timeout,
    maxRetries: Math.max(0, Math.min(3, Number(process.env.KNOWLEDGE_EMBEDDING_MAX_RETRIES || 1))),
    configuration: { baseURL: current.baseURL },
  });
  if (!options.client) {
    cachedClient = client;
    cachedClientKey = key;
  }
  return client;
}

function embeddingMetadata(metadata, vector, current, includeVector = true) {
  const original = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return {
    ...original,
    embedding: {
      provider: current.provider,
      model: current.model,
      dimensions: vector.length,
      ...(includeVector ? { vector } : {}),
    },
  };
}

function vectorFromChunk(chunk) {
  const vector = chunk?.metadata_json?.embedding?.vector;
  if (!Array.isArray(vector) || !vector.length) return null;
  const normalized = vector.map(Number);
  return normalized.every(Number.isFinite) ? normalized : null;
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function lexicalScore(text, query) {
  const content = String(text || '').toLowerCase();
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!content || !normalizedQuery) return 0;
  if (content.includes(normalizedQuery)) return 0.95;
  const terms = [...new Set(normalizedQuery.split(/[\s，。！？、；：,.!?;:()（）\[\]{}]+/u).filter((item) => item.length >= 2))].slice(0, 12);
  if (!terms.length) return 0;
  const matches = terms.filter((term) => content.includes(term)).length;
  return matches ? 0.35 + (0.6 * matches / terms.length) : 0;
}

async function indexDocument(documentId, options = {}) {
  const current = config();
  const client = options.client || createEmbeddingClient();
  const db = options.prisma || prisma;
  const vectorOptions = { client: options.vectorClient, ...(options.vectorStore ? { driver: options.vectorStore } : {}) };
  const useQdrant = vectorStore.isEnabled(vectorOptions);
  const chunks = await db.knowledgeDocumentChunk.findMany({
    where: { document_id: Number(documentId) },
    orderBy: { chunk_index: 'asc' },
  });
  if (!chunks.length) throw providerError('KNOWLEDGE_CHUNKS_MISSING', '文档没有可索引的分片。', 409, null, false);
  const document = useQdrant ? await db.knowledgeDocument.findUnique({ where: { document_id: Number(documentId) } }) : null;
  if (useQdrant && (!document || !document.knowledge_base_id)) {
    throw providerError('KNOWLEDGE_DOCUMENT_MISSING', '文档不存在或未绑定知识库。', 409, null, false);
  }

  for (let offset = 0; offset < chunks.length; offset += current.batchSize) {
    if (options.signal?.aborted) throw Object.assign(new Error('知识库处理已取消。'), { name: 'AbortError', code: 'KNOWLEDGE_TASK_CANCELLED' });
    const batch = chunks.slice(offset, offset + current.batchSize);
    let vectors;
    try {
      vectors = await client.embedDocuments(batch.map((item) => item.chunk_text));
    } catch (error) {
      throw providerError('KNOWLEDGE_EMBEDDING_FAILED', '知识库向量索引服务暂时不可用。', 502, error);
    }
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw providerError('KNOWLEDGE_EMBEDDING_INVALID', '知识库向量模型返回结果不完整。');
    }
    const normalizedVectors = vectors.map((vector) => vector?.map(Number));
    if (normalizedVectors.some((vector) => !Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite))) {
      throw providerError('KNOWLEDGE_EMBEDDING_INVALID', '知识库向量模型返回了无效向量。');
    }
    let embeddingIds = null;
    if (useQdrant) {
      embeddingIds = await vectorStore.upsertChunks({
        knowledgeBaseId: document.knowledge_base_id,
        document,
        chunks: batch,
        vectors: normalizedVectors,
      }, vectorOptions);
    }
    await db.$transaction(batch.map((chunk, index) => {
      const vector = normalizedVectors[index];
      return db.knowledgeDocumentChunk.update({
        where: { chunk_id: chunk.chunk_id },
        data: {
          embedding_id: embeddingIds?.[index] || crypto.createHash('sha256').update(`${current.model}:${chunk.chunk_hash || chunk.chunk_id}`).digest('hex'),
          vector_store_type: useQdrant ? QDRANT_VECTOR_STORE_TYPE : VECTOR_STORE_TYPE,
          metadata_json: embeddingMetadata(chunk.metadata_json, vector, current, !useQdrant),
          status: 'ready',
        },
      });
    }));
  }
  return { provider: current.provider, model: current.model, vectorStore: useQdrant ? QDRANT_VECTOR_STORE_TYPE : VECTOR_STORE_TYPE, chunkCount: chunks.length };
}

async function resolveKnowledgeBaseIds(values = [], options = {}) {
  const db = options.prisma || prisma;
  const raw = [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
  if (!raw.length) return [];
  const numericIds = raw.map(Number).filter((item) => Number.isInteger(item) && item > 0);
  const records = await db.knowledgeBase.findMany({
    where: {
      deleted_at: null,
      OR: [
        ...(numericIds.length ? [{ knowledge_base_id: { in: numericIds } }] : []),
        { dify_dataset_id: { in: raw } },
      ],
    },
    select: { knowledge_base_id: true },
  });
  return [...new Set(records.map((item) => item.knowledge_base_id))];
}

function boundedRecords(items, ids, query, options, startedAt) {
  const threshold = Math.max(0, Math.min(1, Number(options.scoreThreshold ?? 0.55)));
  const topK = Math.max(1, Math.min(20, Number(options.topK || 5)));
  const maxContextChars = Math.max(1000, Math.min(30_000, Number(options.maxContextChars || 8000)));
  let usedChars = 0;
  const records = items.filter((item) => {
    const itemThreshold = Number.isFinite(Number(item.scoreThreshold)) ? Number(item.scoreThreshold) : threshold;
    return Number.isFinite(item.score) && item.score >= itemThreshold;
  })
    .sort((left, right) => right.score - left.score)
    .slice(0, topK)
    .flatMap((item) => {
      const content = String(item.content || '');
      if (!content || usedChars >= maxContextChars) return [];
      const allowed = content.slice(0, maxContextChars - usedChars);
      usedChars += allowed.length;
      return [{ ...item.record, content: allowed, score: item.score }];
    });
  return {
    records,
    perDatasetTiming: ids.map((id) => ({ datasetId: String(id), elapsedMs: Date.now() - startedAt })),
  };
}

async function retrieveFromDatabase(ids, query, options, startedAt) {
  const db = options.prisma || prisma;
  const candidates = await db.knowledgeDocumentChunk.findMany({
    where: {
      status: 'ready',
      document: {
        knowledge_base_id: { in: ids },
        deleted_at: null,
        parse_status: 'EMBEDDED',
      },
    },
    include: { document: { include: { knowledge_base: true } } },
    orderBy: { created_at: 'desc' },
    take: Math.max(50, Math.min(5000, Number(options.maxCandidates || process.env.KNOWLEDGE_RETRIEVAL_MAX_CANDIDATES || DEFAULT_MAX_CANDIDATES))),
  });
  if (!candidates.length) return { records: [], perDatasetTiming: [] };

  const hasVectors = candidates.some((item) => vectorFromChunk(item));
  let queryVector = null;
  if (hasVectors) {
    try {
      const client = options.client || createEmbeddingClient();
      queryVector = (await client.embedQuery(String(query).slice(0, 8000))).map(Number);
    } catch (error) {
      if (options.requireVector === true) throw providerError('KNOWLEDGE_RETRIEVAL_EMBEDDING_FAILED', '知识库检索模型暂时不可用。', 502, error);
    }
  }

  const items = candidates.map((chunk) => {
    const vectorScore = queryVector ? cosineSimilarity(queryVector, vectorFromChunk(chunk)) : null;
    const score = vectorScore == null ? lexicalScore(chunk.chunk_text, query) : vectorScore;
    const kb = chunk.document.knowledge_base;
    return {
      score,
      content: chunk.chunk_text,
      record: {
        knowledgeBaseId: kb?.knowledge_base_id || chunk.document.knowledge_base_id,
        datasetId: String(kb?.knowledge_base_id || chunk.document.knowledge_base_id),
        documentId: String(chunk.document_id),
        documentName: chunk.document.original_filename || chunk.document.title,
        segmentId: String(chunk.chunk_id),
        metadata: {
          provider: kb?.provider || config().provider,
          page_number: chunk.page_number,
          title_path: chunk.title_path,
          chunk_index: chunk.chunk_index,
        },
      },
    };
  });
  return boundedRecords(items, ids, query, options, startedAt);
}

async function retrieveFromLocalKnowledgeBases(ids, query, options, startedAt) {
  if (!ids.length) return { records: [], perDatasetTiming: [] };
  const vectorOptions = { client: options.vectorClient, ...(options.vectorStore ? { driver: options.vectorStore } : {}) };
  if (vectorStore.isEnabled(vectorOptions)) {
    try {
      const client = options.client || createEmbeddingClient();
      const queryVector = (await client.embedQuery(String(query).slice(0, 8000))).map(Number);
      if (!queryVector.length || !queryVector.every(Number.isFinite)) throw new Error('invalid query vector');
      const matches = await vectorStore.search(ids, queryVector, {
        ...vectorOptions,
        limit: options.topK || 5,
        scoreThreshold: options.scoreThreshold ?? 0.55,
      });
      const items = matches.map((match) => {
        const payload = match.payload || {};
        const knowledgeBaseId = Number(payload.knowledgeBaseId);
        return {
          score: Number(match.score),
          content: payload.content,
          record: {
            knowledgeBaseId,
            datasetId: String(knowledgeBaseId),
            documentId: String(payload.documentId),
            documentName: payload.documentName,
            segmentId: String(match.id),
            metadata: {
              provider: config().provider,
              page_number: payload.pageNumber ?? null,
              title_path: payload.titlePath ?? null,
              chunk_index: payload.chunkIndex,
            },
          },
        };
      });
      return boundedRecords(items, ids, query, options, startedAt);
    } catch (error) {
      if (options.requireVector === true) {
        if (error.code) throw error;
        throw providerError('KNOWLEDGE_RETRIEVAL_EMBEDDING_FAILED', '知识库检索模型暂时不可用。', 502, error);
      }
    }
  }
  return retrieveFromDatabase(ids, query, options, startedAt);
}

function isBailianKnowledgeBase(kb) {
  return String(kb?.provider || '').trim().toUpperCase() === BAILIAN_KNOWLEDGE_PROVIDER;
}

async function retrieveFromKnowledgeBases(knowledgeBaseIds, query, options = {}) {
  const db = options.prisma || prisma;
  const ids = await resolveKnowledgeBaseIds(knowledgeBaseIds, { prisma: db });
  if (!ids.length || !String(query || '').trim()) return { records: [], perDatasetTiming: [] };
  const startedAt = Date.now();
  const knowledgeBases = await db.knowledgeBase.findMany({
    where: { knowledge_base_id: { in: ids }, deleted_at: null },
    select: {
      knowledge_base_id: true,
      name: true,
      provider: true,
      dify_dataset_id: true,
      remote_status: true,
      marketplace_status: true,
      remote_documents_json: true,
    },
  });
  const byId = new Map(knowledgeBases.map((item) => [item.knowledge_base_id, item]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const remoteBases = ordered.filter(isBailianKnowledgeBase);
  const localIds = ordered.filter((kb) => !isBailianKnowledgeBase(kb)).map((kb) => kb.knowledge_base_id);
  const localResult = await retrieveFromLocalKnowledgeBases(localIds, query, options, startedAt);
  let remoteItems = [];
  let remoteFailures = [];
  if (remoteBases.length) {
    try {
      const remoteResult = await bailianKnowledge.retrieveKnowledgeBases(remoteBases, query, {
        ...options,
        topK: options.remoteTopK || options.topK || 5,
      });
      const remoteScoreThreshold = Math.max(0, Math.min(1, Number(options.remoteScoreThreshold ?? 0)));
      remoteItems = remoteResult.records.map((item) => ({ ...item, scoreThreshold: remoteScoreThreshold }));
      remoteFailures = remoteResult.failed || [];
    } catch (error) {
      if (!localIds.length) throw error;
      remoteFailures = [error];
    }
  }
  const localItems = localResult.records.map((record) => ({ score: record.score, content: record.content, record }));
  const merged = boundedRecords([...localItems, ...remoteItems], ids, query, options, startedAt);
  return {
    ...merged,
    perDatasetTiming: ids.map((id) => ({ datasetId: String(id), elapsedMs: Date.now() - startedAt })),
    partialFailure: remoteFailures.length > 0 || Boolean(localResult.partialFailure),
  };
}

async function retrieveFromDataset(identifier, query, options = {}) {
  return retrieveFromKnowledgeBases([identifier], query, options);
}

async function retrieveFromMultipleDatasets(identifiers, query, options = {}) {
  return retrieveFromKnowledgeBases(identifiers, query, options);
}

async function checkAvailability() {
  const current = config();
  const store = await vectorStore.checkAvailability();
  return {
    available: Boolean(current.apiKey) && store.available,
    provider: current.provider,
    model: current.model,
    vectorStore: store.driver,
    error: !current.apiKey ? '知识库向量模型未配置' : store.error,
  };
}

async function deleteDocumentVectors(documentId, options = {}) {
  return vectorStore.deleteDocument(documentId, { client: options.vectorClient, ...(options.vectorStore ? { driver: options.vectorStore } : {}) });
}

async function deleteKnowledgeBaseVectors(knowledgeBaseId, options = {}) {
  return vectorStore.deleteKnowledgeBase(knowledgeBaseId, { client: options.vectorClient, ...(options.vectorStore ? { driver: options.vectorStore } : {}) });
}

module.exports = {
  VECTOR_STORE_TYPE,
  QDRANT_VECTOR_STORE_TYPE,
  BAILIAN_KNOWLEDGE_PROVIDER,
  config,
  createEmbeddingClient,
  isBailianKnowledgeBase,
  vectorFromChunk,
  cosineSimilarity,
  lexicalScore,
  indexDocument,
  resolveKnowledgeBaseIds,
  retrieveFromKnowledgeBases,
  retrieveFromDataset,
  retrieveFromMultipleDatasets,
  checkAvailability,
  deleteDocumentVectors,
  deleteKnowledgeBaseVectors,
};
