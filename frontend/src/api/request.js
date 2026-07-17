// HTTP 请求封装 — 基于原生 fetch
// 自动附加 Authorization 头，统一处理响应格式和认证错误
// 401 时先尝试通过 sessionStorage 刷新，失败后使用 Cookie 刷新

import { getToken, clearAuth, refreshSessionViaStorage, refreshAuthSession, canRefreshCurrentSession } from '../utils/auth.js'

export const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'
const DEFAULT_REQUEST_TIMEOUT_MS = 30000
const DEFAULT_UPLOAD_TIMEOUT_MS = 120000

let refreshLock = null // 防止并发刷新

function buildUrl(url, params) {
  if (!params) return `${BASE_URL}${url}`
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value)
    }
  }
  const qs = searchParams.toString()
  return qs ? `${BASE_URL}${url}?${qs}` : `${BASE_URL}${url}`
}

function shouldTryRefresh(url, options) {
  if (options._retry || options._skipAuthRefresh) return false
  if (url.startsWith('/auth/login') || url.startsWith('/auth/refresh') || url.startsWith('/auth/logout') || url.startsWith('/auth/session/refresh')) return false
  return true
}

function createRequestSignal(sourceSignal, timeoutMs) {
  const controller = new AbortController()
  let timedOut = false
  const relayAbort = () => controller.abort(sourceSignal?.reason)
  if (sourceSignal?.aborted) relayAbort()
  else sourceSignal?.addEventListener?.('abort', relayAbort, { once: true })
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Request timed out', 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      window.clearTimeout(timer)
      sourceSignal?.removeEventListener?.('abort', relayAbort)
    },
  }
}

async function fetchJson(fullUrl, fetchOptions, options, headers, timeoutMs) {
  const requestSignal = createRequestSignal(fetchOptions.signal, timeoutMs)
  try {
    const response = await fetch(fullUrl, { ...fetchOptions, signal: requestSignal.signal, headers, credentials: 'include' })
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      try { return { response, result: await response.json() } } catch { throw new Error('服务器返回数据格式异常') }
    }
    const bodyText = await response.text().catch(() => '')
    const message = bodyText.match(/Cannot\s+\w+\s+[^<\s]+/)?.[0]
    console.error('[request] 非 JSON 错误响应', {
      method: (options.method || 'GET').toUpperCase(), url: fullUrl,
      status: response.status, contentType, excerpt: bodyText.slice(0, 200),
    })
    throw new Error(message || `接口请求失败（HTTP ${response.status}）`)
  } catch (error) {
    if (requestSignal.didTimeout()) {
      const timeoutError = new Error('请求超时，请稍后重试')
      timeoutError.code = 'REQUEST_TIMEOUT'
      timeoutError.retryable = true
      throw timeoutError
    }
    if (fetchOptions.signal?.aborted || error?.name === 'AbortError') {
      const abortError = new Error('请求已取消')
      abortError.code = 'REQUEST_CANCELLED'
      abortError.retryable = false
      throw abortError
    }
    if (error?.code || error?.message === '服务器返回数据格式异常' || /HTTP \d+/.test(error?.message || '')) throw error
    throw new Error('网络请求失败，请检查网络连接或后端服务是否启动')
  } finally {
    requestSignal.cleanup()
  }
}

/**
 * 执行会话刷新：先检查当前会话是否可刷新，再尝试
 */
async function doRefresh() {
  // 如果当前标签页没有有效会话标记，拒绝刷新
  if (!canRefreshCurrentSession()) {
    throw new Error('会话已过期')
  }
  if (refreshLock) return refreshLock
  refreshLock = (async () => {
    // 先尝试 sessionStorage 刷新
    try {
      return await refreshSessionViaStorage()
    } catch {
      // sessionStorage 刷新失败，尝试 Cookie 刷新
      try {
        return await refreshAuthSession()
      } catch {
        throw new Error('会话已过期')
      }
    }
  })()
  try {
    return await refreshLock
  } finally {
    refreshLock = null
  }
}

export async function request(url, options = {}) {
  const token = getToken()
  const isFormData = options.body instanceof FormData

  const headers = { ...(options.headers || {}) }

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const { params, _retry, _skipAuthRefresh, timeoutMs, ...fetchOptions } = options
  const fullUrl = buildUrl(url, params)
  const effectiveTimeout = Math.max(1000, Math.min(300000, Number(timeoutMs) || (isFormData ? DEFAULT_UPLOAD_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS)))
  const { response, result } = await fetchJson(fullUrl, fetchOptions, options, headers, effectiveTimeout)

  // 认证错误：token 缺失 (40101) 或 token 无效/过期 (40102)
  if (result.code === 40101 || result.code === 40102) {
    if (shouldTryRefresh(url, options)) {
      try {
        await doRefresh()
        // 刷新成功，用新 token 重试
        const newToken = getToken()
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`
        }
        return request(url, { ...options, _retry: true })
      } catch {
        clearAuth()
        window.location.hash = '#/login'
        throw new Error(result.message || '登录已过期，请重新登录')
      }
    }
    clearAuth()
    if (!url.startsWith('/auth/refresh') && !url.startsWith('/auth/session/refresh')) {
      window.location.hash = '#/login'
    }
    throw new Error(result.message || '登录已过期，请重新登录')
  }

  // 权限错误：保留在当前页，由页面层展示友好提示
  if (result.code === 40301) {
    const err = new Error(result.message || '无权限访问该资源')
    err.code = result.code
    err.publicCode = result.error?.code || 'FORBIDDEN'
    err.details = result.error?.details || result.data || null
    err.requestId = result.error?.requestId || null
    err.httpStatus = response.status
    throw err
  }

  // 业务错误
  if (result.code !== 0) {
    const err = new Error(result.message || '请求失败')
    err.code = result.code
    err.publicCode = result.error?.code || null
    err.details = result.error?.details || result.data || null
    err.requestId = result.error?.requestId || null
    err.retryable = Boolean(result.error?.retryable)
    err.httpStatus = response.status
    throw err
  }

  return result
}

export function get(url, options = {}) {
  return request(url, { ...options, method: 'GET' })
}

export function post(url, data, options = {}) {
  return request(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function patch(url, data, options = {}) {
  return request(url, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function put(url, data, options = {}) {
  return request(url, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function upload(url, formData, options = {}) {
  return request(url, {
    ...options,
    method: 'POST',
    body: formData,
  })
}

export function del(url, options = {}) {
  return request(url, { ...options, method: 'DELETE' })
}
