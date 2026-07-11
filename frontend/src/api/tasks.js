import { get, post } from './request.js'

export const listTasks = (params = {}) => get('/tasks', { params })
export const listActiveTasks = () => get('/tasks/active')
export const getTask = id => get(`/tasks/${id}`)
export const cancelTask = (id) => post(`/tasks/${id}/cancel`, {})
export const dismissTaskRecord = (id) => post(`/tasks/${id}/dismiss`, {})
