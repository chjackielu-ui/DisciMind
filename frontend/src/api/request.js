// HTTP 请求封装 — 基于原生 fetch
// 自动附加 Authorization 头，统一处理响应格式和认证错误

import { getToken, clearAuth } from '../utils/auth.js'

const BASE_URL = 'http://localhost:3000/api'

export async function request(url, options = {}) {
  const token = getToken()

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers,
    })
  } catch (err) {
    throw new Error('网络请求失败，请检查网络连接或后端服务是否启动')
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('服务器返回数据格式异常')
  }

  // 认证错误：token 缺失 (40101) 或 token 无效/过期 (40102)
  if (result.code === 40101 || result.code === 40102) {
    clearAuth()
    window.location.hash = '#/login'
    throw new Error(result.message || '登录已过期，请重新登录')
  }

  // 业务错误
  if (result.code !== 0) {
    throw new Error(result.message || '请求失败')
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
