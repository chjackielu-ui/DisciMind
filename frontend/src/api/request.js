// HTTP 请求封装 — 基于原生 fetch
// 自动附加 Authorization 头，统一处理响应格式和认证错误

import { getToken, clearAuth } from '../utils/auth.js'

export const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

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

  const { params, ...fetchOptions } = options
  const fullUrl = buildUrl(url, params)

  let response
  try {
    response = await fetch(fullUrl, {
      ...fetchOptions,
      headers,
    })
  } catch (err) {
    throw new Error('网络请求失败，请检查网络连接或后端服务是否启动')
  }

  const contentType = response.headers.get('content-type') || ''
  let result
  if (contentType.includes('application/json')) {
    try {
      result = await response.json()
    } catch {
      throw new Error('服务器返回数据格式异常')
    }
  } else {
    const text = await response.text().catch(() => '')
    const message = text.match(/Cannot\s+\w+\s+[^<\s]+/)?.[0]
    throw new Error(message || `接口请求失败（HTTP ${response.status}）`)
  }

  // 认证错误：token 缺失 (40101) 或 token 无效/过期 (40102)
  if (result.code === 40101 || result.code === 40102) {
    clearAuth()
    window.location.hash = '#/login'
    throw new Error(result.message || '登录已过期，请重新登录')
  }

  // 权限错误：保留在当前页，由页面层展示友好提示
  if (result.code === 40301) {
    const err = new Error(result.message || '无权限访问该资源')
    err.code = result.code
    throw err
  }

  // 业务错误
  if (result.code !== 0) {
    const err = new Error(result.message || '请求失败')
    err.code = result.code
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
