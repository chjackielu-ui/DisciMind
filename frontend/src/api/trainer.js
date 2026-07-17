import { get, post } from './request.js'

export const TRAINER_WORKFLOW_MODES = Object.freeze({
  DIAGNOSTIC_PRE_TEST: 'diagnostic_pre_test',
  ADAPTIVE_TRAINING: 'adaptive_training',
  DEEP_EVALUATION: 'deep_evaluation',
})

export function runTrainerWorkflow({
  mode,
  payload,
  requestId,
  request_id,
  locale = 'zh-CN',
  debug = false,
} = {}) {
  return post('/ai/trainer/run', {
    mode,
    request_id: request_id ?? requestId,
    payload,
    locale,
    debug,
  })
}

export function getTrainerContext(params = {}) {
  return get('/agent/trainer/context', { params })
}

export function createTrainerSession(data = {}) {
  return post('/agent/trainer/sessions', data)
}

export function getTrainerSessions(params = {}) {
  return get('/agent/trainer/sessions', { params })
}

export function getTrainerSession(sessionId) {
  return get(`/agent/trainer/sessions/${encodeURIComponent(sessionId)}`)
}

export function submitTrainerAnswer(sessionId, data = {}) {
  return post(`/agent/trainer/sessions/${encodeURIComponent(sessionId)}/answers`, data)
}

export function completeTrainerSession(sessionId) {
  return post(`/agent/trainer/sessions/${encodeURIComponent(sessionId)}/complete`, {})
}

export function abandonTrainerSession(sessionId) {
  return post(`/agent/trainer/sessions/${encodeURIComponent(sessionId)}/abandon`, {})
}

export function getTrainerReport(sessionId) {
  return get(`/agent/trainer/sessions/${encodeURIComponent(sessionId)}/report`)
}

export function getTrainerEvents(sessionId) {
  return get(`/agent/trainer/sessions/${encodeURIComponent(sessionId)}/events`)
}
