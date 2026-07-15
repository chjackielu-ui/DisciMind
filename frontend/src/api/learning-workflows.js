import { get, post, put, del, BASE_URL } from './request.js';
import { getToken } from '../utils/auth.js';

const BASE = '/learning-workflows';

export const learningWorkflowApi = {
  // 模板
  listTemplates(params = {}) {
    return get(BASE + '/templates', { params });
  },
  getTemplate(id) {
    return get(BASE + '/templates/' + id);
  },
  createTemplate(data) {
    return post(BASE + '/templates', data);
  },
  updateTemplate(id, data) {
    return put(BASE + '/templates/' + id, data);
  },
  deleteTemplate(id) {
    return del(BASE + '/templates/' + id);
  },
  batchDeleteTemplates(templateIds) {
    return post(BASE + '/templates/batch-delete', { templateIds });
  },
  copyTemplate(id) {
    return post(BASE + '/templates/' + id + '/copy', {});
  },
  getVersions(id) {
    return get(BASE + '/templates/' + id + '/versions');
  },
  restoreVersion(id, versionId) {
    return post(BASE + '/templates/' + id + '/restore', { versionId });
  },

  // AI 生成
  generateDraft(data) {
    return post(BASE + '/generate-draft', data);
  },
  getGenerationStatus(jobId) {
    return get(BASE + '/generation/' + jobId);
  },

  // 推荐和一键开始
  recommendTemplate(params) {
    return get(BASE + '/recommend', { params });
  },
  quickStart(data) {
    return post(BASE + '/quick-start', data);
  },
  checkExistingSession(data) {
    return post(BASE + '/quick-start-check', data);
  },

  // 学习准备
  createPreload(data) { return post('/learning-flow-preloads', data); },
  listPreloads(params = {}) { return get('/learning-flow-preloads', { params }); },
  getPreload(id) { return get('/learning-flow-preloads/' + id); },
  retryPreload(id, operationId) { return post('/learning-flow-preloads/' + id + '/retry', { operationId }); },
  getSessionCards(sessionId, nodeId) {
    return get(`/learning-flow-preloads/sessions/${sessionId}/cards`, { params: { nodeId } });
  },
  regenerateSessionCards(sessionId, nodeId) {
    return post(`/learning-flow-preloads/sessions/${sessionId}/cards/regenerate`, { ...(nodeId ? { nodeId } : {}) });
  },
  updateSessionCardState(sessionId, cardId, state, nodeId) {
    return post(`/learning-flow-preloads/sessions/${sessionId}/cards/${encodeURIComponent(cardId)}/state`, { state, ...(nodeId ? { nodeId } : {}) });
  },
  saveSessionCard(sessionId, cardId, nodeId) {
    return post(`/learning-flow-preloads/sessions/${sessionId}/cards/${encodeURIComponent(cardId)}/save`, { ...(nodeId ? { nodeId } : {}) });
  },

  // 会话
  createSession(data) {
    return post(BASE + '/sessions', data);
  },
  getSession(id) {
    return get(BASE + '/sessions/' + id);
  },
  startSession(id) {
    return post(BASE + '/sessions/' + id + '/start');
  },
  pauseSession(id) {
    return post(BASE + '/sessions/' + id + '/pause');
  },
  resumeSession(id) {
    return post(BASE + '/sessions/' + id + '/resume');
  },
  submitAnswer(id, data) {
    return post(BASE + '/sessions/' + id + '/submit', data);
  },
  skipNode(id, data) {
    return post(BASE + '/sessions/' + id + '/skip', data);
  },
  retryNode(id, data) {
    return post(BASE + '/sessions/' + id + '/retry', data);
  },
  getNodeStatus(id, nodeId) {
    return get(BASE + '/sessions/' + id + '/node/' + nodeId + '/status');
  },
  insertNode(id, data) {
    return post(BASE + '/sessions/' + id + '/insert-node', data);
  },
  applyAdjustment(id) {
    return post(BASE + '/sessions/' + id + '/apply-adjustment');
  },
  rejectAdjustment(id) {
    return post(BASE + '/sessions/' + id + '/reject-adjustment');
  },
  completeSession(id) {
    return post(BASE + '/sessions/' + id + '/complete');
  },
  getSummary(id) {
    return get(BASE + '/sessions/' + id + '/summary');
  },

  getAssistantSSEUrl(sessionId) {
    return BASE + '/sessions/' + sessionId + '/assistant/chat';
  },

  // 多模态文件上传
  uploadSessionFiles(sessionId, formData) {
    const token = getToken() || '';
    return fetch(`/api${BASE}/sessions/${sessionId}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }).then((r) => r.json());
  },
};

export async function streamLearningSessionAssistant(sessionId, payload, callbacks = {}, signal) {
  const response = await fetch(`${BASE_URL}/learning-workflows/sessions/${sessionId}/assistant/chat`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken() || ''}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...payload, sessionId: Number(sessionId) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `AI 对话请求失败（HTTP ${response.status}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      let data;
      try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
      callbacks.onEvent?.(eventName || 'message', data);
      eventName = '';
    }
  }
}
