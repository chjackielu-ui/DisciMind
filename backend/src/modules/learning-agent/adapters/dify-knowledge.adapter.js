/**
 * Dify Knowledge API 适配器
 *
 * 基于 axios 封装 Dify 知识库检索接口（仅 Knowledge / Retrieval API）。
 * 不调用 Dify Workflow / Chatflow / Agent API。
 *
 * 环境变量:
 *   DIFY_KNOWLEDGE_BASE_URL  - Dify Knowledge API 基础地址（默认 http://localhost/v1）
 *   DIFY_KNOWLEDGE_API_KEY   - Dify Knowledge API 密钥（必需）
 */

const axios = require('axios');
const fs = require('fs/promises');

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULTS = Object.freeze({
  baseURL: 'http://localhost/v1',
  retrievalTimeout: 10_000,   // 检索调用 10 秒超时
  generalTimeout: 30_000,     // 列表 / 详情等非检索调用 30 秒超时
  topK: 5,
  scoreThreshold: 0.0,
  maxContextChars: 8000,
});

// ---------------------------------------------------------------------------
// 统一错误
// ---------------------------------------------------------------------------

class AppError extends Error {
  constructor(code, message, status = 500, cause = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      cause: this.cause ? this.cause.message : null,
    };
  }
}

function createAppError(code, message, status = 500, cause = null) {
  return new AppError(code, message, status, cause);
}

// ---------------------------------------------------------------------------
// 日志脱敏工具
// ---------------------------------------------------------------------------

/**
 * 从配置对象中移除 API Key 等敏感字段后再写入日志。
 * 不会意外泄露 DIFY_KNOWLEDGE_API_KEY 到日志输出。
 */
function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const cleaned = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('key') ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('password') ||
      lower.includes('authorization')
    ) {
      cleaned[key] = '[REDACTED]';
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// 读取配置
// ---------------------------------------------------------------------------

function getConfig() {
  const baseURL = process.env.DIFY_KNOWLEDGE_BASE_URL || DEFAULTS.baseURL;
  const apiKey = process.env.DIFY_KNOWLEDGE_API_KEY || '';

  if (!apiKey) {
    throw createAppError(
      'DIFY_KNOWLEDGE_NO_API_KEY',
      '未配置 DIFY_KNOWLEDGE_API_KEY 环境变量',
      500,
    );
  }

  return { baseURL, apiKey };
}

// ---------------------------------------------------------------------------
// axios 实例（惰性创建，允许环境变量后设置）
// ---------------------------------------------------------------------------

let _client = null;
let _availabilityCache = null;

function getClient() {
  if (_client) return _client;
  const { baseURL, apiKey } = getConfig();
  _client = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  return _client;
}

/**
 * 重置客户端实例（环境变量变更后调用，主要用于测试）。
 */
function resetClient() {
  _client = null;
  _availabilityCache = null;
}

// ---------------------------------------------------------------------------
// 错误处理包装
// ---------------------------------------------------------------------------

/**
 * 对 axios 错误做统一分类和包装，返回 AppError。
 * 不会在日志 / 错误信息中泄露 API Key。
 */
function wrapAxiosError(error, context = '') {
  // 已经是 AppError 则直接返回
  if (error instanceof AppError) return error;

  const suffix = context ? ` ${context}` : '';

  // 网络 / DNS / 连接拒绝（请求未到达服务端）
  if (
    error.code === 'ECONNREFUSED' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNRESET'
  ) {
    return createAppError(
      'DIFY_KNOWLEDGE_NETWORK_ERROR',
      `Dify 知识库网络连接失败${suffix}`,
      502,
      error,
    );
  }

  // 超时（客户端主动超时或服务端无响应）
  if (
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNABORTED' ||
    (error.message && error.message.toLowerCase().includes('timeout'))
  ) {
    return createAppError(
      'DIFY_KNOWLEDGE_TIMEOUT',
      `Dify 知识库请求超时${suffix}`,
      504,
      error,
    );
  }

  // HTTP 状态码错误
  if (error.response) {
    const status = error.response.status;
    const responseData = error.response.data;

    if (status === 401) {
      return createAppError(
        'DIFY_KNOWLEDGE_AUTH_ERROR',
        'Dify 知识库认证失败，请检查 DIFY_KNOWLEDGE_API_KEY',
        401,
        error,
      );
    }
    if (status === 403) {
      return createAppError(
        'DIFY_KNOWLEDGE_FORBIDDEN',
        'Dify 知识库权限不足',
        403,
        error,
      );
    }
    if (status === 404) {
      return createAppError(
        'DIFY_KNOWLEDGE_NOT_FOUND',
        `Dify 知识库资源不存在: ${responseData?.message || error.message}`,
        404,
        error,
      );
    }
    if (status === 429) {
      return createAppError(
        'DIFY_KNOWLEDGE_RATE_LIMIT',
        'Dify 知识库请求频率过高，请稍后重试',
        429,
        error,
      );
    }
    if (status >= 400 && status < 500) {
      return createAppError(
        'DIFY_KNOWLEDGE_CLIENT_ERROR',
        `Dify 知识库请求错误: ${responseData?.message || error.message}`,
        status,
        error,
      );
    }
    if (status >= 500) {
      return createAppError(
        'DIFY_KNOWLEDGE_SERVER_ERROR',
        `Dify 知识库服务端错误: ${responseData?.message || error.message}`,
        status,
        error,
      );
    }
  }

  // 未知错误
  return createAppError(
    'DIFY_KNOWLEDGE_UNKNOWN_ERROR',
    `Dify 知识库调用异常${suffix}: ${error.message}`,
    500,
    error,
  );
}

// ---------------------------------------------------------------------------
// 核心 API 方法
// ---------------------------------------------------------------------------

/**
 * 获取知识库列表。
 *
 * @returns {Promise<Array<{id: string, name: string, description: string, document_count: number}>>}
 */
async function listDatasets() {
  const client = getClient();
  const { baseURL } = getConfig();

  try {
    console.log('[DifyKnowledge] listing datasets');
    const startTime = Date.now();

    const response = await client.get('/datasets', {
      timeout: DEFAULTS.generalTimeout,
      params: { limit: 100 },
    });

    const elapsed = Date.now() - startTime;

    // 标准化返回字段，同时保留原始数据供高级调用方使用
    const datasets = (response.data?.data || []).map((ds) => ({
      id: ds.id,
      name: ds.name,
      description: ds.description || '',
      document_count: ds.document_count || 0,
    }));

    console.log(
      `[DifyKnowledge] listed ${datasets.length} datasets in ${elapsed}ms`,
    );

    return datasets;
  } catch (error) {
    console.error(
      `[DifyKnowledge] listDatasets failed: ${error.message}`,
      sanitizeConfig({ baseURL }),
    );
    throw wrapAxiosError(error, '(listDatasets)');
  }
}

/**
 * 获取单个知识库详情。
 *
 * @param {string} datasetId - 知识库 ID
 * @returns {Promise<Object>} 知识库完整信息
 */
async function getDataset(datasetId) {
  if (!datasetId) {
    throw createAppError('DIFY_KNOWLEDGE_INVALID_PARAM', 'datasetId 不能为空', 400);
  }

  const client = getClient();
  const { baseURL } = getConfig();

  try {
    console.log(`[DifyKnowledge] getting dataset: ${datasetId}`);
    const startTime = Date.now();

    const response = await client.get(
      `/datasets/${encodeURIComponent(datasetId)}`,
      { timeout: DEFAULTS.generalTimeout },
    );

    const elapsed = Date.now() - startTime;
    const dataset = response.data;

    console.log(
      `[DifyKnowledge] got dataset "${dataset.name || datasetId}" in ${elapsed}ms`,
    );

    return dataset;
  } catch (error) {
    console.error(
      `[DifyKnowledge] getDataset(${datasetId}) failed: ${error.message}`,
      sanitizeConfig({ baseURL }),
    );
    throw wrapAxiosError(error, `(getDataset: ${datasetId})`);
  }
}

async function withLimitedRetry(operation, context, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = Number(error?.response?.status || error?.status || 0);
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw wrapAxiosError(lastError, context);
}

/** Create an empty Dify dataset. Embedding and vector storage remain Dify-managed. */
async function createDataset({ name, description = '' }) {
  if (!name || !String(name).trim()) {
    throw createAppError('DIFY_KNOWLEDGE_INVALID_PARAM', '知识库名称不能为空', 400);
  }
  const client = getClient();
  return withLimitedRetry(async () => {
    const response = await client.post('/datasets', {
      name: String(name).trim(),
      description: String(description || '').trim(),
      permission: 'only_me',
      provider: 'vendor',
      indexing_technique: 'high_quality',
    }, { timeout: DEFAULTS.generalTimeout });
    return { id: response.data?.id, name: response.data?.name || String(name).trim() };
  }, '(createDataset)');
}

/** Upload one document and start Dify's asynchronous indexing pipeline. */
async function uploadDocumentFile(datasetId, { filePath, fileName, mimeType }) {
  if (!datasetId || !filePath) {
    throw createAppError('DIFY_KNOWLEDGE_INVALID_PARAM', 'datasetId 和 filePath 不能为空', 400);
  }
  const { baseURL, apiKey } = getConfig();
  return withLimitedRetry(async () => {
    const buffer = await fs.readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), fileName || 'document');
    form.append('data', JSON.stringify({
      indexing_technique: 'high_quality',
      doc_form: 'text_model',
      process_rule: { mode: 'automatic' },
    }));
    const response = await axios.post(
      `${baseURL}/datasets/${encodeURIComponent(datasetId)}/document/create-by-file`,
      form,
      { timeout: 60_000, headers: { Authorization: `Bearer ${apiKey}` } },
    );
    return {
      documentId: response.data?.document?.id || null,
      batchId: response.data?.batch || null,
      indexingStatus: response.data?.document?.indexing_status || 'indexing',
    };
  }, '(uploadDocumentFile)', 1);
}

async function getDocumentIndexingStatus(datasetId, batchId) {
  if (!datasetId || !batchId) {
    throw createAppError('DIFY_KNOWLEDGE_INVALID_PARAM', 'datasetId 和 batchId 不能为空', 400);
  }
  const client = getClient();
  return withLimitedRetry(async () => {
    const response = await client.get(
      `/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(batchId)}/indexing-status`,
      { timeout: DEFAULTS.generalTimeout },
    );
    const items = response.data?.data || response.data?.documents || [];
    return Array.isArray(items) ? items : [];
  }, '(getDocumentIndexingStatus)');
}

async function deleteDatasetDocument(datasetId, documentId) {
  if (!datasetId || !documentId) return;
  const client = getClient();
  await withLimitedRetry(
    () => client.delete(`/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, { timeout: DEFAULTS.generalTimeout }),
    '(deleteDatasetDocument)',
  );
}

async function deleteDataset(datasetId) {
  if (!datasetId) return;
  const client = getClient();
  await withLimitedRetry(
    () => client.delete(`/datasets/${encodeURIComponent(datasetId)}`, { timeout: DEFAULTS.generalTimeout }),
    '(deleteDataset)',
  );
}

// ---------------------------------------------------------------------------
// 检索方法
// ---------------------------------------------------------------------------

/**
 * 在单个知识库中检索。
 *
 * @param {string}  datasetId                   - 知识库 ID
 * @param {string}  query                       - 检索查询文本
 * @param {Object}  [options]
 * @param {number}  [options.topK=5]            - 返回条数
 * @param {number}  [options.scoreThreshold=0]  - 最低相关性分数（0 ~ 1）
 * @param {Object}  [options.metadataFilter]    - 元数据过滤条件
 * @returns {Promise<{query: string, records: Array<{
 *   segmentId: string, documentId: string, documentName: string,
 *   content: string, score: number, metadata: Object
 * }>}>}
 */
async function retrieveFromDataset(datasetId, query, options = {}) {
  if (!datasetId) {
    throw createAppError('DIFY_KNOWLEDGE_INVALID_PARAM', 'datasetId 不能为空', 400);
  }
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw createAppError('DIFY_KNOWLEDGE_INVALID_PARAM', 'query 不能为空', 400);
  }

  const client = getClient();
  const { baseURL } = getConfig();

  const topK = options.topK ?? DEFAULTS.topK;
  const scoreThreshold = options.scoreThreshold ?? DEFAULTS.scoreThreshold;
  const metadataFilter = options.metadataFilter || null;

  // 构建 Dify retrieval_model 参数
  const retrievalModel = {
    search_method: 'semantic_search',
    reranking_enable: false,
    top_k: topK,
    score_threshold_enabled: scoreThreshold > 0,
    score_threshold: scoreThreshold,
  };

  if (metadataFilter && Object.keys(metadataFilter).length > 0) {
    retrievalModel.metadata_filtering_conditions = metadataFilter;
  }

  const requestBody = {
    query: query.trim(),
    retrieval_model: retrievalModel,
  };

  try {
    const safeQuery =
      query.trim().length > 80 ? query.trim().slice(0, 80) + '...' : query.trim();
    console.log(
      `[DifyKnowledge] retrieving from dataset ${datasetId}: "${safeQuery}" (topK=${topK}, threshold=${scoreThreshold})`,
    );
    const startTime = Date.now();

    const response = await client.post(
      `/datasets/${encodeURIComponent(datasetId)}/retrieve`,
      requestBody,
      { timeout: DEFAULTS.retrievalTimeout },
    );

    const elapsed = Date.now() - startTime;
    const raw = response.data;

    // 标准化返回的记录格式，兼容多种 Dify API 版本
    const records = (raw.records || raw.data || []).map((rec) => ({
      segmentId:
        rec.segment_id || rec.segmentId || rec.segment?.id || rec.id || '',
      documentId:
        rec.document_id ||
        rec.documentId ||
        rec.segment?.document?.id ||
        rec.document?.id ||
        '',
      documentName:
        rec.document_name ||
        rec.documentName ||
        rec.segment?.document?.name ||
        rec.document?.name ||
        '',
      content: rec.segment?.content || rec.content || '',
      score: typeof rec.score === 'number' ? rec.score : 0,
      metadata:
        rec.segment?.metadata || rec.metadata || rec.doc_metadata || null,
    }));

    console.log(
      `[DifyKnowledge] retrieved ${records.length} records from dataset ${datasetId} in ${elapsed}ms`,
    );

    return { query: query.trim(), records };
  } catch (error) {
    const safeQuery =
      query.trim().length > 80 ? query.trim().slice(0, 80) + '...' : query.trim();
    console.error(
      `[DifyKnowledge] retrieveFromDataset(${datasetId}) failed: ${error.message}`,
      sanitizeConfig({ baseURL, query: safeQuery, topK, scoreThreshold }),
    );
    throw wrapAxiosError(error, `(retrieveFromDataset: ${datasetId})`);
  }
}

/**
 * 从多个知识库中检索，合并结果并去重排序。
 *
 * 合并策略:
 *   1. 对每个知识库并行调用 retrieveFromDataset。
 *   2. 按 segment_id 去重（相同 segment 保留分数更高的记录）。
 *   3. 按 score 降序排列。
 *   4. 限制总上下文长度不超过 maxContextChars（默认 8000 字符），
 *      超出部分截断，被截断的最后一条保留内容前缀并添加 "..." 后缀。
 *
 * @param {string[]} datasetIds                - 知识库 ID 列表
 * @param {string}   query                     - 检索查询文本
 * @param {Object}   [options]
 * @param {number}   [options.topK=5]          - 每个知识库返回条数
 * @param {number}   [options.scoreThreshold]  - 最低相关性分数
 * @param {Object}   [options.metadataFilter]  - 元数据过滤条件
 * @param {number}   [options.maxContextChars] - 最大上下文字符数（默认 8000）
 * @returns {Promise<{query: string, records: Array, totalCount: number, truncated: boolean}>}
 */
async function retrieveFromMultipleDatasets(datasetIds, query, options = {}) {
  if (!Array.isArray(datasetIds) || datasetIds.length === 0) {
    throw createAppError(
      'DIFY_KNOWLEDGE_INVALID_PARAM',
      'datasetIds 必须是非空数组',
      400,
    );
  }
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw createAppError('DIFY_KNOWLEDGE_INVALID_PARAM', 'query 不能为空', 400);
  }

  const maxContextChars = options.maxContextChars ?? DEFAULTS.maxContextChars;

  const perDatasetOptions = {
    topK: options.topK ?? DEFAULTS.topK,
    scoreThreshold: options.scoreThreshold ?? DEFAULTS.scoreThreshold,
    metadataFilter: options.metadataFilter || null,
  };

  console.log(
    `[DifyKnowledge] multi-dataset retrieval from ${datasetIds.length} dataset(s): "${query.trim().slice(0, 60)}"`,
  );

  // 1. 对每个知识库发起检索（单个失败不影响其他）
  const perDatasetStart = new Map();
  for (const id of datasetIds) perDatasetStart.set(id, process.hrtime.bigint());
  const results = await Promise.allSettled(
    datasetIds.map((id) => retrieveFromDataset(id, query, perDatasetOptions)),
  );

  const allRecords = [];
  const errors = [];
  const perDatasetTiming = [];

  for (let i = 0; i < results.length; i++) {
    const datasetId = datasetIds[i];
    const start = perDatasetStart.get(datasetId) || process.hrtime.bigint();
    const elapsedMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 100) / 100;
    const result = results[i];
    if (result.status === 'fulfilled') {
      const count = result.value.records.length;
      allRecords.push(...result.value.records.map((record) => ({ ...record, datasetId })));
      perDatasetTiming.push({
        datasetId: String(datasetId).slice(-8),
        elapsedMs,
        recordCount: count,
        timedOut: false,
      });
    } else {
      console.error(
        `[DifyKnowledge] dataset ${datasetId} retrieval failed: ${result.reason.message}`,
      );
      const isTimeout = result.reason?.code === 'DIFY_KNOWLEDGE_TIMEOUT'
        || (result.reason?.message && result.reason.message.toLowerCase().includes('timeout'));
      errors.push({ datasetId, error: result.reason.message });
      perDatasetTiming.push({
        datasetId: String(datasetId).slice(-8),
        elapsedMs,
        recordCount: 0,
        timedOut: isTimeout,
      });
    }
  }

  // 如果所有知识库都失败了，报错
  if (allRecords.length === 0 && errors.length > 0) {
    throw createAppError(
      'DIFY_KNOWLEDGE_ALL_FAILED',
      `所有知识库检索均失败 (${errors.length} 个)`,
      502,
      new Error(errors.map((e) => `${e.datasetId}: ${e.error}`).join('; ')),
    );
  }

  // 2. 按 segment_id 去重，保留分数更高的记录
  const dedupMap = new Map();
  for (const record of allRecords) {
    if (!record.segmentId) {
      // 没有 segment_id 的记录单独保留（不同 API 版本的格式差异）
      dedupMap.set(`__no_seg_id_${dedupMap.size}`, record);
      continue;
    }
    const dedupKey = `${record.datasetId || ''}:${record.segmentId}`;
    const existing = dedupMap.get(dedupKey);
    if (!existing || record.score > existing.score) {
      dedupMap.set(dedupKey, record);
    }
  }

  const dedupedRecords = Array.from(dedupMap.values());

  // 3. 按 score 降序排序
  dedupedRecords.sort((a, b) => b.score - a.score);

  const totalCount = dedupedRecords.length;

  // 4. 限制总上下文长度
  let charCount = 0;
  const finalRecords = [];
  for (const record of dedupedRecords) {
    const contentLen = record.content ? record.content.length : 0;
    if (charCount + contentLen <= maxContextChars) {
      finalRecords.push(record);
      charCount += contentLen;
    } else {
      // 尝试截断最后一条以填满剩余容量
      if (charCount < maxContextChars) {
        const remaining = maxContextChars - charCount;
        if (remaining > 50) {
          finalRecords.push({
            ...record,
            content: record.content.slice(0, remaining) + '...',
          });
          charCount = maxContextChars;
        }
      }
      break;
    }
  }

  const truncated = finalRecords.length < totalCount;

  console.log(
    `[DifyKnowledge] multi-dataset retrieval: ${totalCount} raw (${datasetIds.length} datasets) -> ${dedupedRecords.length} deduped -> ${finalRecords.length} final (${charCount} chars)${truncated ? ' [truncated]' : ''}`,
  );

  return {
    query: query.trim(),
    records: finalRecords,
    totalCount,
    truncated,
    perDatasetTiming,
  };
}

// ---------------------------------------------------------------------------
// 可用性检查
// ---------------------------------------------------------------------------

/**
 * 检查 Dify Knowledge API 是否可用。
 *
 * 发送轻量 GET 请求验证服务可达且认证正确。
 *
 * @returns {Promise<{available: boolean, error?: string}>}
 */
async function checkAvailability() {
  const { baseURL, apiKey } = getConfig();
  const startTime = Date.now();
  const successTtlMs = Math.max(5_000, Number(process.env.DIFY_KNOWLEDGE_AVAILABILITY_TTL_MS || 60_000));
  const failureTtlMs = Math.max(1_000, Number(process.env.DIFY_KNOWLEDGE_FAILURE_TTL_MS || 5_000));
  if (_availabilityCache && _availabilityCache.baseURL === baseURL
      && Date.now() < _availabilityCache.expiresAt) {
    console.log(`[DifyKnowledge] availability cache hit (${_availabilityCache.result.available ? 'available' : 'unavailable'})`);
    return { ..._availabilityCache.result, cached: true };
  }

  try {
    console.log('[DifyKnowledge] checking availability');

    const response = await axios.get(`${baseURL}/datasets`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
      params: { limit: 1 },
    });

    const elapsed = Date.now() - startTime;

    if (response.status >= 200 && response.status < 300) {
      console.log(`[DifyKnowledge] available (${elapsed}ms)`);
      const result = { available: true };
      _availabilityCache = { baseURL, result, expiresAt: Date.now() + successTtlMs };
      return result;
    }

    console.log(`[DifyKnowledge] unexpected status: ${response.status}`);
    const result = {
      available: false,
      error: `Unexpected status code: ${response.status}`,
    };
    _availabilityCache = { baseURL, result, expiresAt: Date.now() + failureTtlMs };
    return result;
  } catch (error) {
    const elapsed = Date.now() - startTime;

    let errorMsg;
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      errorMsg = `无法连接到 Dify Knowledge API (${baseURL})`;
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      errorMsg = 'Dify Knowledge API 连接超时';
    } else if (error.response && error.response.status === 401) {
      errorMsg = 'Dify Knowledge API 认证失败 (401)';
    } else if (error.response && error.response.status === 403) {
      errorMsg = 'Dify Knowledge API 权限不足 (403)';
    } else {
      errorMsg = error.message || 'Unknown error';
    }

    console.error(
      `[DifyKnowledge] availability check failed (${elapsed}ms): ${errorMsg}`,
      sanitizeConfig({ baseURL }),
    );

    const result = { available: false, error: errorMsg };
    _availabilityCache = { baseURL, result, expiresAt: Date.now() + failureTtlMs };
    return result;
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

module.exports = {
  // 核心 API
  listDatasets,
  getDataset,
  createDataset,
  uploadDocumentFile,
  getDocumentIndexingStatus,
  deleteDatasetDocument,
  deleteDataset,
  retrieveFromDataset,
  retrieveFromMultipleDatasets,
  checkAvailability,

  // 工具
  resetClient,

  // 错误类（供上层做 instanceof 判断）
  AppError,
  createAppError,

  // 常量
  DEFAULTS,
};
