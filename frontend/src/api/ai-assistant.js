import { get, post } from './request.js'
import { getToken } from '../utils/auth.js'

export function getAiAssistantCapabilities() {
  return get('/ai-assistant/capabilities')
}

export function getAiConversationPendingAction(conversationId) {
  return get(`/ai-assistant/conversations/${encodeURIComponent(conversationId)}/pending-action`)
}

export function getAiPendingAction(pendingActionId) {
  return get(`/ai-assistant/pending-actions/${encodeURIComponent(pendingActionId)}`)
}

export function actOnAiPendingAction(pendingActionId, action, patch = undefined) {
  return post(`/ai-assistant/pending-actions/${encodeURIComponent(pendingActionId)}/actions`, {
    action,
    ...(patch ? { patch } : {}),
  })
}

export function aiArtifactDownloadUrl(artifactId) {
  const base = import.meta.env.VITE_API_BASE_URL || '/api'
  return `${base}/ai-assistant/artifacts/${encodeURIComponent(artifactId)}/download`
}

export async function downloadAiArtifact(artifactId) {
  const response = await fetch(aiArtifactDownloadUrl(artifactId), {
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    credentials: 'include',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message || '成果下载失败')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const fileName = encoded ? decodeURIComponent(encoded) : `ai-artifact-${artifactId}`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
