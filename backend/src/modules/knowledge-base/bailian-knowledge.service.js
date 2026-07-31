const DEFAULT_SEARCH_PATH = '/api/v1/indices/knowledge/search';
const DEFAULT_APP_BASE_URL = 'https://dashscope.aliyuncs.com';
const DEFAULT_APP_COMPLETION_PATH_TEMPLATE = '/api/v1/apps/{app_id}/completion';
const DEFAULT_TIMEOUT_MS = 90_000;

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeBaseURL(value, workspaceId) {
  const explicit = String(value || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const workspace = String(workspaceId || '').trim();
  return workspace ? `https://${workspace}.cn-beijing.maas.aliyuncs.com` : '';
}

function config(overrides = {}) {
  const workspaceId = overrides.workspaceId ?? process.env.BAILIAN_WORKSPACE_ID ?? '';
  return {
    provider: 'BAILIAN_KNOWLEDGE',
    apiKey: overrides.apiKey ?? process.env.BAILIAN_KNOWLEDGE_API_KEY ?? process.env.BAILIAN_API_KEY ?? '',
    workspaceId,
    appId: overrides.appId ?? process.env.BAILIAN_APP_ID ?? '',
    baseURL: normalizeBaseURL(overrides.baseURL ?? process.env.BAILIAN_KNOWLEDGE_BASE_URL, workspaceId),
    searchPath: String(overrides.searchPath ?? process.env.BAILIAN_KNOWLEDGE_SEARCH_PATH ?? DEFAULT_SEARCH_PATH).trim() || DEFAULT_SEARCH_PATH,
    appBaseURL: String(overrides.appBaseURL ?? process.env.BAILIAN_KNOWLEDGE_APP_BASE_URL ?? process.env.DASHSCOPE_NATIVE_BASE_URL ?? DEFAULT_APP_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_APP_BASE_URL,
    appCompletionPathTemplate: String(overrides.appCompletionPathTemplate ?? process.env.BAILIAN_KNOWLEDGE_APP_COMPLETION_PATH_TEMPLATE ?? DEFAULT_APP_COMPLETION_PATH_TEMPLATE).trim() || DEFAULT_APP_COMPLETION_PATH_TEMPLATE,
    idMode: String(overrides.idMode ?? process.env.BAILIAN_KNOWLEDGE_ID_MODE ?? 'knowledge').trim().toLowerCase(),
    queryField: String(overrides.queryField ?? process.env.BAILIAN_KNOWLEDGE_QUERY_FIELD ?? 'query').trim() || 'query',
    idField: String(overrides.idField ?? process.env.BAILIAN_KNOWLEDGE_ID_FIELD ?? 'agent_id').trim() || 'agent_id',
    idValueMode: String(overrides.idValueMode ?? process.env.BAILIAN_KNOWLEDGE_ID_VALUE_MODE ?? 'scalar').trim().toLowerCase(),
    topKField: String(overrides.topKField ?? process.env.BAILIAN_KNOWLEDGE_TOPK_FIELD ?? '').trim(),
    scoreThresholdField: String(overrides.scoreThresholdField ?? process.env.BAILIAN_KNOWLEDGE_SCORE_THRESHOLD_FIELD ?? '').trim(),
    includeAppId: enabled(overrides.includeAppId ?? process.env.BAILIAN_KNOWLEDGE_INCLUDE_APP_ID),
    includeWorkspaceId: enabled(overrides.includeWorkspaceId ?? process.env.BAILIAN_KNOWLEDGE_INCLUDE_WORKSPACE_ID),
    timeoutMs: Math.max(5_000, Number(overrides.timeoutMs ?? process.env.BAILIAN_KNOWLEDGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)),
  };
}

function serviceError(code, message, status = 502, cause = null, retryable = true) {
  return Object.assign(new Error(message), { code, status, cause, retryable });
}

function remoteKnowledgeId(kb) {
  return String(
    kb?.remote_index_id
    || kb?.bailian_knowledge_base_id
    || kb?.dify_dataset_id
    || kb?.metadata_json?.bailianKnowledgeBaseId
    || kb?.metadata_json?.indexId
    || process.env.BAILIAN_KNOWLEDGE_BASE_ID
    || '',
  ).trim();
}

function isAppSearchServiceId(value) {
  return /^aid-[a-z0-9]+$/i.test(String(value || '').trim());
}

function shouldUseAppCompletion(remoteId, current) {
  if (current.idMode === 'app' || current.idMode === 'application') return true;
  return false;
}

function createSearchBody(kb, query, options = {}) {
  const current = config(options);
  const remoteId = remoteKnowledgeId(kb);
  if (!remoteId) {
    throw serviceError('BAILIAN_KNOWLEDGE_ID_MISSING', '百炼知识库 ID 未配置，请先绑定远程知识库。', 409, null, false);
  }
  const body = {
    [current.queryField]: String(query || '').slice(0, 8000),
    [current.idField]: current.idValueMode === 'array' ? [remoteId] : remoteId,
  };
  const topK = Math.max(1, Math.min(20, Number(options.topK || 5)));
  if (current.topKField) body[current.topKField] = topK;
  if (current.scoreThresholdField && options.scoreThreshold != null) {
    body[current.scoreThresholdField] = Math.max(0, Math.min(1, Number(options.scoreThreshold)));
  }
  if (current.includeAppId && current.appId) body.app_id = current.appId;
  if (current.includeWorkspaceId && current.workspaceId) body.workspace_id = current.workspaceId;
  return body;
}

function createAppCompletionBody(kb, query, options = {}) {
  void kb;
  const topK = Math.max(1, Math.min(20, Number(options.topK || 5)));
  const body = {
    input: {
      prompt: String(query || '').slice(0, 8000),
    },
    parameters: {
      top_k: topK,
    },
  };
  if (options.scoreThreshold != null) {
    body.parameters.score_threshold = Math.max(0, Math.min(1, Number(options.scoreThreshold)));
  }
  return body;
}

function firstNumber(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function sourceUrl(metadata = {}) {
  const value = metadata.page_snapshot?.[0] || metadata.doc_url || metadata.url || '';
  return /^https?:\/\//i.test(String(value)) ? String(value) : null;
}

function nodeText(node) {
  const metadata = node?.metadata || {};
  return String(metadata.content || node?.content || node?.text || '').replace(/^【文档名】:[\s\S]*?【正文】:\s*/u, '').trim();
}

function normalizeNodes(payload) {
  if (Array.isArray(payload?.data?.nodes)) return payload.data.nodes;
  if (Array.isArray(payload?.nodes)) return payload.nodes;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data?.result?.nodes)) return payload.data.result.nodes;
  if (Array.isArray(payload?.output?.doc_references)) return payload.output.doc_references;
  if (Array.isArray(payload?.output?.references)) return payload.output.references;
  if (Array.isArray(payload?.output?.search_results)) return payload.output.search_results;
  return [];
}

function normalizeNode(node, kb, index = 0) {
  const metadata = node?.metadata || {};
  const content = nodeText(node) || String(node?.text || node?.content || '').trim();
  const segmentId = String(metadata._id || metadata.nid || metadata.chunk_id || node?.id || node?.index_id || node?.doc_id || `${remoteKnowledgeId(kb)}:${index + 1}`);
  const remoteDocId = String(metadata.doc_id || metadata.document_id || node?.document_id || node?.doc_id || node?.index_id || '');
  return {
    score: Number(node?.score ?? metadata._score_with_weight ?? metadata._score ?? 0),
    content,
    record: {
      knowledgeBaseId: kb.knowledge_base_id,
      datasetId: String(kb.knowledge_base_id),
      documentId: remoteDocId || null,
      documentName: String(metadata.doc_name || metadata.document_name || node?.doc_name || node?.documentName || kb.name || '百炼知识库文档'),
      segmentId,
      metadata: {
        provider: 'BAILIAN_KNOWLEDGE',
        remoteKnowledgeBaseId: remoteKnowledgeId(kb),
        remoteDocId: remoteDocId || null,
        page_number: firstNumber(metadata.page_number || node?.page_number),
        title_path: metadata.hier_title || metadata.title || node?.title || null,
        title: metadata.title || node?.title || null,
        workspace_id: metadata.workspace_id || kb.workspace_id || null,
        url: sourceUrl(metadata),
      },
    },
  };
}

function buildAppCompletionUrl(current, appId) {
  const path = current.appCompletionPathTemplate
    .replace('{app_id}', encodeURIComponent(appId))
    .replace('{appId}', encodeURIComponent(appId));
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${current.appBaseURL}${normalizedPath}`;
}

async function retrieveViaAppCompletion(kb, query, options = {}) {
  const current = config(options);
  const appId = remoteKnowledgeId(kb) || current.appId;
  if (!appId) {
    throw serviceError('BAILIAN_KNOWLEDGE_ID_MISSING', '百炼知识检索服务 ID 未配置，请先绑定 aid 应用 ID。', 409, null, false);
  }
  const url = buildAppCompletionUrl(current, appId);
  const body = createAppCompletionBody(kb, query, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), current.timeoutMs);
  try {
    const response = await (options.fetch || fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${current.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(current.includeWorkspaceId && current.workspaceId ? { 'X-DashScope-WorkSpace': current.workspaceId } : {}),
      },
      body: JSON.stringify(body),
      signal: options.signal || controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false || (payload.status && String(payload.status).toUpperCase() === 'FAILED')) {
      throw serviceError('BAILIAN_KNOWLEDGE_SEARCH_FAILED', payload.message || `百炼知识检索服务调用失败 (${response.status})`, response.status || 502, payload);
    }
    return {
      records: normalizeNodes(payload).map((node, index) => normalizeNode(node, kb, index)).filter((item) => item.content),
      raw: payload,
    };
  } catch (error) {
    if (error.name === 'AbortError') throw serviceError('BAILIAN_KNOWLEDGE_TIMEOUT', '百炼知识检索服务调用超时。', 504, error);
    if (error.code) throw error;
    throw serviceError('BAILIAN_KNOWLEDGE_SEARCH_FAILED', '百炼知识检索服务暂时不可用。', 502, error);
  } finally {
    clearTimeout(timeout);
  }
}

async function retrieveKnowledgeBase(kb, query, options = {}) {
  const current = config(options);
  if (!current.apiKey) throw serviceError('BAILIAN_KNOWLEDGE_NOT_CONFIGURED', '百炼知识库 API Key 未配置。', 500, null, false);
  const remoteId = remoteKnowledgeId(kb);
  if (shouldUseAppCompletion(remoteId, current)) {
    return retrieveViaAppCompletion(kb, query, options);
  }
  if (!current.baseURL) throw serviceError('BAILIAN_KNOWLEDGE_BASE_URL_MISSING', '百炼知识库 Base URL 未配置。', 500, null, false);
  const path = current.searchPath.startsWith('/') ? current.searchPath : `/${current.searchPath}`;
  const url = `${current.baseURL}${path}`;
  const body = createSearchBody(kb, query, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), current.timeoutMs);
  try {
    const response = await (options.fetch || fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${current.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal || controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false || (payload.status && String(payload.status).toUpperCase() === 'FAILED')) {
      throw serviceError('BAILIAN_KNOWLEDGE_SEARCH_FAILED', payload.message || `百炼知识库检索失败 (${response.status})`, response.status || 502, payload);
    }
    return {
      records: normalizeNodes(payload).map((node, index) => normalizeNode(node, kb, index)).filter((item) => item.content),
      raw: payload,
    };
  } catch (error) {
    if (error.name === 'AbortError') throw serviceError('BAILIAN_KNOWLEDGE_TIMEOUT', '百炼知识库检索超时。', 504, error);
    if (error.code) throw error;
    throw serviceError('BAILIAN_KNOWLEDGE_SEARCH_FAILED', '百炼知识库检索服务暂时不可用。', 502, error);
  } finally {
    clearTimeout(timeout);
  }
}

async function retrieveKnowledgeBases(knowledgeBases, query, options = {}) {
  const settled = await Promise.allSettled(knowledgeBases.map((kb) => retrieveKnowledgeBase(kb, query, options)));
  const records = settled.flatMap((result) => result.status === 'fulfilled' ? result.value.records : []);
  const failed = settled.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (failed.length === settled.length && failed[0]) throw failed[0];
  return { records, failed };
}

module.exports = {
  config,
  remoteKnowledgeId,
  isAppSearchServiceId,
  createSearchBody,
  createAppCompletionBody,
  normalizeNodes,
  normalizeNode,
  retrieveViaAppCompletion,
  retrieveKnowledgeBase,
  retrieveKnowledgeBases,
};
