import { get, post, BASE_URL } from './request.js';

export const learningNarrationApi = {
  settings: () => get('/learning-narration/settings'),
  createJob: (data) => post('/learning-narration/jobs', data),
  getJob: (jobId) => get(`/learning-narration/jobs/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId) => post(`/learning-narration/jobs/${encodeURIComponent(jobId)}/cancel`, {}),
};

export function narrationWebSocketUrl(wsPath, ticket) {
  const api = new URL(BASE_URL, window.location.origin);
  const protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${api.host}${wsPath}?ticket=${encodeURIComponent(ticket)}`;
}
