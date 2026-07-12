import { get, put, del } from './request.js'
const BASE = '/student-learning-context'
export const studentLearningContextApi = {
  get(refresh = false) { return get(BASE, { params: refresh ? { refresh: true } : {} }) },
  update(data) { return put(BASE, data) },
  clear() { return del(BASE) },
}
