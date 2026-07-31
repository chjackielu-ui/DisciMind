import { get, post } from './request.js'

export const runCCompiler = (payload) => post('/compiler/run', payload, { timeoutMs: 30000 })
export const judgeCCompiler = (payload) => post('/compiler/judge', payload, { timeoutMs: 90000 })
export const getCompilerHistory = (params = {}) => get('/compiler/history', { params })
export const getCompilerTopic = (topicId) => get(`/compiler/topics/${encodeURIComponent(topicId)}`)
