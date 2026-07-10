import { get, post, put, del } from './request.js';

const BASE = '/learning-workflows';

export const learningWorkflowApi = {
  // 模板
  listTemplates(params = {}) {
    return get(BASE + '/templates', params);
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
    return get(BASE + '/recommend', params);
  },
  quickStart(data) {
    return post(BASE + '/quick-start', data);
  },
  checkExistingSession(data) {
    return post(BASE + '/quick-start-check', data);
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
};
