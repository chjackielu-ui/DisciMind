import { get, post } from './request.js'

export const learningCardApi = {
  daily: () => get('/student/learning-cards/daily'),
  refresh: (payload = {}) => post('/student/learning-cards/refresh', payload),
  scene: (params = {}) => get('/student/learning-cards/scene', { params }),
  detail: id => get(`/student/learning-cards/${encodeURIComponent(id)}`),
  action: (id, payload) => post(`/student/learning-cards/${encodeURIComponent(id)}/actions`, payload),
  addToPlan: id => post(`/student/learning-cards/${encodeURIComponent(id)}/add-to-plan`, {}),
  startPractice: (id, payload = {}) => post(`/student/learning-cards/${encodeURIComponent(id)}/start-practice`, payload),
  askAi: (id, payload = {}) => post(`/student/learning-cards/${encodeURIComponent(id)}/ask-ai`, payload),
  courseLibrary: (courseId, params = {}) => get(`/courses/${encodeURIComponent(courseId)}/learning-cards`, { params }),
  repairCard: wrongQuestionId => get(`/wrong-questions/${encodeURIComponent(wrongQuestionId)}/repair-card`),
  generate: payload => post('/ai/cards/generate', payload),
}

export default learningCardApi
