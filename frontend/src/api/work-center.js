import { get, post } from './request.js'

export const getWorkCenterSummary = () => get('/work-center/summary')
export const getWorkCenterFeed = (params = {}) => get('/work-center/feed', { params })
export const getWorkCenterMessages = (params = {}) => get('/work-center/messages', { params })
export const getWorkCenterMessage = (id) => get(`/work-center/messages/${id}`)
export const getWorkCenterTasks = (params = {}) => get('/work-center/tasks', { params })
export const readWorkCenterMessage = (id) => post(`/work-center/messages/${id}/read`, {})
export const readAllWorkCenterMessages = () => post('/work-center/messages/read-all', {})
