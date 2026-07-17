import { request, get, post, patch, put, del, upload, BASE_URL } from './request.js'
import { getToken } from '../utils/auth.js'

export const listAgents = params => get('/agents', { params })
export const listMyAgents = params => get('/agents/mine', { params })
export const listFavoriteAgents = params => get('/agents/favorites', { params })
export const listAvailableChatAgents = () => get('/agents/chat/available')
export const listCallableAgents = (params = {}) => get('/agents/callable', { params })
export const getHotAgentRankings = (limit = 10) => get('/agents/rankings/hot', { params: { limit } })
export const getAgent = id => get(`/agents/${id}`)
export const createAgent = data => post('/agents', data)
export const updateAgent = (id, data) => put(`/agents/${id}`, data)
export const deleteAgent = id => del(`/agents/${id}`)
export const applyAgentPublic = (id, operationId) => post(`/agents/${id}/apply-public`, { operationId })
export const copyAgent = (id, operationId) => post(`/agents/${id}/copy`, { operationId })
export const favoriteAgent = id => post(`/agents/${id}/favorite`, {})
export const unfavoriteAgent = id => del(`/agents/${id}/favorite`)
export const rateAgent = (id, rating) => post(`/agents/${id}/rating`, { rating })
export const reportAgent = (id, reason, detail, operationId) => post(`/agents/${id}/report`, { reason, detail, operationId })

export const listKnowledgeBases = scope => get('/knowledge-bases', { params: { scope } })
export const listAccessibleKnowledgeBases = params => get('/knowledge-bases/accessible', { params })
export const getKnowledgeBase = id => get(`/knowledge-bases/${id}`)
export const createKnowledgeBase = data => post('/knowledge-bases', data)
export const updateKnowledgeBase = (id, data) => put(`/knowledge-bases/${id}`, data)
export const deleteKnowledgeBase = id => del(`/knowledge-bases/${id}`)
export const applyKnowledgeBasePublic = (id, operationId) => post(`/knowledge-bases/${id}/apply-public`, { operationId })
export const refreshKnowledgeBaseStatus = id => get(`/knowledge-bases/${id}/status`)
export const listDifyKnowledgeDatasets = () => get('/knowledge-bases/dify/datasets')
export const bindDifyKnowledgeDatasets = datasetIds => post('/knowledge-bases/dify/bind', { datasetIds })
export const syncDifyKnowledgeBase = id => post(`/knowledge-bases/${id}/sync-dify`, {})
export const deleteKnowledgeDocument = (id, documentId) => del(`/knowledge-bases/${id}/documents/${documentId}`)
export const retryKnowledgeDocument = (id, documentId) => post(`/knowledge-bases/${id}/documents/${documentId}/retry`, {})
export const uploadKnowledgeDocument = (id, file, operationId) => {
  const form = new FormData()
  form.append('file', file)
  form.append('originalName', String(file?.name || '').normalize('NFC'))
  form.append('operationId', operationId)
  return upload(`/knowledge-bases/${id}/documents`, form)
}

export const createAgentConversation = (id, data) => post(`/agents/${id}/conversations`, data)
export const listAgentConversations = id => get(`/agents/${id}/conversations`)
export const getAgentConversation = id => get(`/agent-conversations/${id}`)
export const updateAgentConversation = (id, data) => put(`/agent-conversations/${id}`, data)
export const deleteAgentConversation = id => del(`/agent-conversations/${id}`)
export const clearAgentConversationMessages = id => del(`/agent-conversations/${id}/messages`)
export const bulkManageAgentConversations = data => post('/agent-conversations/bulk', data)
export const getFileRequirements = id => get(`/agent-conversations/${id}/file-requirements`)
export const planFileRequirements = (id, input) => post(`/agent-conversations/${id}/file-plan`, typeof input === 'string' ? { message: input } : input)
export const patchFileRequirements = (id, data) => request(`/agent-conversations/${id}/file-requirements`, { method: 'PATCH', body: JSON.stringify(data) })
export const prefillFileRequirements = (id, data) => post(`/agent-conversations/${id}/file-prefill`, data)
export const confirmFileRequirements = (id, operationId) => post(`/agent-conversations/${id}/file-confirm`, { operationId })
export const listGeneratedArtifacts = params => get('/generated-artifacts', { params })
export const getGeneratedArtifact = id => get(`/generated-artifacts/${id}`)
export const exportGeneratedArtifact = (id, operationId, formats = ['DOCX']) => post(`/generated-artifacts/${id}/export`, { operationId, formats })
export const deleteGeneratedArtifact = id => del(`/generated-artifacts/${id}`)
export const renameGeneratedArtifact = (id, title) => patch(`/generated-artifacts/${id}`, { title })
export const bulkDeleteGeneratedArtifacts = (artifactIds) => post('/generated-artifacts/bulk-delete', { artifactIds })
export const createLearningFlowResourceLink = (id, data) => post(`/generated-artifacts/${id}/learning-flow-links`, data)
export const listLearningFlowResources = params => get('/learning-flow-resources', { params })
export const getLearningFlowResource = id => get(`/learning-flow-resources/${id}`)
export const unlinkLearningFlowResource = id => del(`/learning-flow-resource-links/${id}`)
export async function downloadGeneratedArtifact(id, preferredName = '学习资料.docx') {
  const response = await fetch(`${BASE_URL}/generated-artifacts/${id}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    credentials: 'include',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw Object.assign(new Error(payload.message || `下载失败 (${response.status})`), { code: payload.code, status: response.status })
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = String(preferredName || '学习资料.docx').replace(/[\\/:*?"<>|]/g, '_')
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
export async function downloadGeneratedArtifactExport(id, format, preferredName) {
  const normalized = String(format || 'DOCX').toUpperCase()
  const response = await fetch(`${BASE_URL}/generated-artifacts/${id}/exports/${normalized}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` }, credentials: 'include',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw Object.assign(new Error(payload.message || `下载失败 (${response.status})`), { code: payload.code, status: response.status })
  }
  const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement('a')
  anchor.href = objectUrl; anchor.download = String(preferredName || `学习资料.${normalized.toLowerCase()}`).replace(/[\\/:*?"<>|]/g, '_')
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
export const sendAgentMessage = (id, data) => post(`/agent-conversations/${id}/messages`, data)
export const cancelAgentGeneration = (id, generationId) => post(`/agent-conversations/${id}/generations/${generationId}/cancel`, {})
export async function streamAgentConversation(id, data, { signal, onMeta, onDelta, onSource, onRun, onDone } = {}) {
  const response = await fetch(`${BASE_URL}/agent-conversations/${id}/stream`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw Object.assign(new Error(payload.message || `生成失败 (${response.status})`), { status: response.status, code: payload.code })
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let eventName = ''
  while (true) {
    const { value, done } = await reader.read(); if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue }
      if (!line.startsWith('data:')) continue
      const payload = JSON.parse(line.slice(5).trim())
      if (eventName === 'meta') onMeta?.(payload)
      else if (eventName === 'delta') onDelta?.(payload.delta || '')
      else if (eventName === 'source') onSource?.(payload)
      else if (eventName === 'run') onRun?.(payload)
      else if (eventName === 'done') onDone?.(payload)
      else if (eventName === 'error') throw Object.assign(new Error(payload.message || '生成失败'), { code: payload.code })
      eventName = ''
    }
  }
}
export const listAgentMemories = (id, params = {}) => get(`/agents/${id}/memories`, { params })
export const createAgentMemory = (id, data) => post(`/agents/${id}/memories`, data)
export const updateAgentMemory = (id, memoryId, data) => put(`/agents/${id}/memories/${memoryId}`, data)
export const deleteAgentMemory = (id, memoryId) => del(`/agents/${id}/memories/${memoryId}`)
export const clearAgentMemories = id => del(`/agents/${id}/memories`)
export const resolveAgentMemoryCandidate = (id, messageId, action) => post(`/agents/${id}/messages/${messageId}/memory-candidate`, { action })

export const listAdminAgentReviews = () => get('/admin/agent-reviews')
export const approveAdminAgentReview = (id, operationId) => post(`/admin/agent-reviews/${id}/approve`, { operationId })
export const rejectAdminAgentReview = (id, reason, operationId) => post(`/admin/agent-reviews/${id}/reject`, { reason, operationId })
export const listAdminKnowledgeReviews = () => get('/admin/knowledge-base-reviews')
export const approveAdminKnowledgeReview = (id, operationId) => post(`/admin/knowledge-base-reviews/${id}/approve`, { operationId })
export const rejectAdminKnowledgeReview = (id, reason, operationId) => post(`/admin/knowledge-base-reviews/${id}/reject`, { reason, operationId })
export const listAdminAgentReports = () => get('/admin/agent-reports')
export const resolveAdminAgentReport = (id, resolution, offlineAgent, operationId) => post(`/admin/agent-reports/${id}/resolve`, { resolution, offlineAgent, operationId })
