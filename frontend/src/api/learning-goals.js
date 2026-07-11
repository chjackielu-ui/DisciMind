import { get, post, patch } from './request.js';

const BASE = '/learning-goals';

export const learningGoalApi = {
  getConfig() { return get(`${BASE}/config`); },
  resolve(data) { return post(`${BASE}/resolve`, data); },
  list(params = {}) { return get(BASE, { params }); },
  get(goalId) { return get(`${BASE}/${goalId}`); },
  update(goalId, data) { return patch(`${BASE}/${goalId}`, data); },
  confirm(goalId) { return post(`${BASE}/${goalId}/confirm`, {}); },
  workflowPreview(goalId) { return post(`${BASE}/${goalId}/workflow-preview`, {}); },
  start(goalId) { return post(`${BASE}/${goalId}/start`, {}); },
  cancel(goalId) { return post(`${BASE}/${goalId}/cancel`, {}); },
};
