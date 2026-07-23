const { QdrantClient } = require('@qdrant/js-client-rest');

let cachedClient = null;
let cachedClientKey = null;
let ensuredCollection = null;

function vectorError(code, message, status = 502, cause = null, retryable = true) {
  return Object.assign(new Error(message), { code, status, cause, retryable });
}

function config(overrides = {}) {
  return {
    driver: String(overrides.driver || process.env.KNOWLEDGE_VECTOR_STORE || 'database').trim().toLowerCase(),
    url: overrides.url ?? process.env.QDRANT_URL ?? '',
    collection: overrides.collection ?? process.env.QDRANT_COLLECTION ?? 'discimind_knowledge',
    apiKey: overrides.apiKey ?? process.env.QDRANT_API_KEY ?? '',
    timeout: Math.max(1000, Number(overrides.timeout ?? process.env.QDRANT_TIMEOUT_MS ?? 30_000)),
  };
}

function isEnabled(options = {}) {
  return config(options).driver === 'qdrant';
}

function createClient(options = {}) {
  if (options.client) return options.client;
  const current = config(options);
  if (!isEnabled(current)) throw vectorError('KNOWLEDGE_QDRANT_NOT_ENABLED', 'Qdrant 向量存储未启用。', 500, null, false);
  if (!current.url || !current.collection) {
    throw vectorError('KNOWLEDGE_QDRANT_NOT_CONFIGURED', 'Qdrant 向量存储配置不完整。', 500, null, false);
  }
  const key = JSON.stringify({ url: current.url, collection: current.collection, apiKey: current.apiKey, timeout: current.timeout });
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient = new QdrantClient({ url: current.url, ...(current.apiKey ? { apiKey: current.apiKey } : {}), timeout: current.timeout });
  cachedClientKey = key;
  ensuredCollection = null;
  return cachedClient;
}

function notFound(error) {
  return Number(error?.status || error?.statusCode) === 404
    || /not found|doesn(?:'|’)t exist/i.test(String(error?.message || ''));
}

async function ensureCollection(dimensions, options = {}) {
  const current = config(options);
  const size = Number(dimensions);
  if (!Number.isInteger(size) || size <= 0) throw vectorError('KNOWLEDGE_VECTOR_DIMENSIONS_INVALID', '知识库向量维度无效。');
  if (ensuredCollection === `${current.collection}:${size}` && !options.client) return;
  const client = createClient(options);
  try {
    const existing = await client.getCollection(current.collection);
    const configuredSize = Number(existing?.config?.params?.vectors?.size);
    if (configuredSize && configuredSize !== size) {
      throw vectorError('KNOWLEDGE_QDRANT_DIMENSIONS_MISMATCH', `Qdrant collection 向量维度为 ${configuredSize}，当前模型返回 ${size}。`, 409, null, false);
    }
  } catch (error) {
    if (!notFound(error)) throw error;
    try {
      await client.createCollection(current.collection, { vectors: { size, distance: 'Cosine' } });
    } catch (createError) {
      if (!/already exists/i.test(String(createError?.message || ''))) {
        throw vectorError('KNOWLEDGE_QDRANT_COLLECTION_FAILED', 'Qdrant collection 初始化失败。', 502, createError);
      }
    }
  }
  if (!options.client) ensuredCollection = `${current.collection}:${size}`;
}

async function upsertChunks(input, options = {}) {
  const vectors = input.vectors || [];
  const chunks = input.chunks || [];
  if (!chunks.length || chunks.length !== vectors.length) {
    throw vectorError('KNOWLEDGE_QDRANT_POINTS_INVALID', 'Qdrant 分片向量数量不匹配。');
  }
  await ensureCollection(vectors[0].length, options);
  const current = config(options);
  const points = chunks.map((chunk, index) => ({
    id: Number(chunk.chunk_id),
    vector: vectors[index],
    payload: {
      knowledgeBaseId: Number(input.knowledgeBaseId),
      documentId: Number(input.document.document_id),
      documentName: input.document.original_filename || input.document.title,
      chunkIndex: Number(chunk.chunk_index),
      pageNumber: chunk.page_number == null ? null : Number(chunk.page_number),
      titlePath: chunk.title_path || null,
      content: chunk.chunk_text,
    },
  }));
  try {
    await createClient(options).upsert(current.collection, { wait: true, points });
  } catch (error) {
    throw vectorError('KNOWLEDGE_QDRANT_UPSERT_FAILED', '知识库向量写入 Qdrant 失败。', 502, error);
  }
  return points.map((point) => String(point.id));
}

async function search(knowledgeBaseIds, queryVector, options = {}) {
  const current = config(options);
  const ids = [...new Set((knowledgeBaseIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  try {
    return await createClient(options).search(current.collection, {
      vector: queryVector,
      filter: { must: [{ key: 'knowledgeBaseId', match: { any: ids } }] },
      limit: Math.max(1, Math.min(100, Number(options.limit || 5))),
      score_threshold: Math.max(0, Math.min(1, Number(options.scoreThreshold ?? 0.55))),
      with_payload: true,
      with_vector: false,
    });
  } catch (error) {
    if (notFound(error)) return [];
    throw vectorError('KNOWLEDGE_QDRANT_SEARCH_FAILED', '知识库向量检索服务暂时不可用。', 502, error);
  }
}

async function deleteByFilter(filter, options = {}) {
  const current = config(options);
  try {
    await createClient(options).delete(current.collection, { wait: true, filter });
  } catch (error) {
    if (!notFound(error)) throw vectorError('KNOWLEDGE_QDRANT_DELETE_FAILED', '知识库向量删除失败。', 502, error);
  }
}

async function deleteDocument(documentId, options = {}) {
  if (!isEnabled(options)) return;
  return deleteByFilter({ must: [{ key: 'documentId', match: { value: Number(documentId) } }] }, options);
}

async function deleteKnowledgeBase(knowledgeBaseId, options = {}) {
  if (!isEnabled(options)) return;
  return deleteByFilter({ must: [{ key: 'knowledgeBaseId', match: { value: Number(knowledgeBaseId) } }] }, options);
}

async function checkAvailability(options = {}) {
  const current = config(options);
  if (current.driver === 'database') return { available: true, driver: 'database', collection: null, error: null };
  try {
    await createClient(options).getCollections();
    return { available: true, driver: 'qdrant', collection: current.collection, error: null };
  } catch (error) {
    return { available: false, driver: 'qdrant', collection: current.collection, error: error.message };
  }
}

module.exports = {
  config,
  isEnabled,
  createClient,
  ensureCollection,
  upsertChunks,
  search,
  deleteDocument,
  deleteKnowledgeBase,
  checkAvailability,
};
