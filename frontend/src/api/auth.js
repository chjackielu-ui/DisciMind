// 认证接口封装

import { post, get } from './request.js'

export function login(data) {
  return post('/auth/login', data)
}

export function register(data) {
  return post('/auth/register', data)
}

export function getMe() {
  return get('/auth/me')
}
