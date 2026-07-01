// 认证接口封装

import { post, get, patch, upload } from './request.js'

export function login(data) {
  return post('/auth/login', data)
}

export function register(data) {
  return post('/auth/register', data)
}

export function getMe() {
  return get('/auth/me')
}

export function updateMe(data) {
  return patch('/auth/me', data)
}

export function uploadAvatar(file) {
  const formData = new FormData()
  formData.append('avatar', file)
  return upload('/auth/me/avatar', formData)
}

export function changePassword(data) {
  return post('/auth/me/password', data)
}
