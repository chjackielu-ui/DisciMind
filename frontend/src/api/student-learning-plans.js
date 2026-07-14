import { get, post } from './request.js'

const BASE = '/student-learning-plans'

export const studentLearningPlanApi = {
  current(repair = true) { return get(`${BASE}/current`, { params: { repair } }) },
  list(params = {}) { return get(BASE, { params }) },
  get(id) { return get(`${BASE}/${id}`) },
  create(data) { return post(BASE, data) },
  rematchCurrent() { return post(`${BASE}/current/rematch`, {}) },
  rematch(id) { return post(`${BASE}/${id}/rematch`, {}) },
  transition(id, status) { return post(`${BASE}/${id}/transition`, { status }) },
  prepare(id, operationId) { return post(`${BASE}/${id}/prepare`, { operationId }) },
  start(id) { return post(`${BASE}/${id}/start`, {}) },
  referenceMaterials(id) { return get(`${BASE}/${id}/reference-materials`) },
}
