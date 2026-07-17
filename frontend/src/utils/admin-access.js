import { getAdminAccess } from '../api/admin.js'
import { configureAdminMenu } from './admin-menu.js'

let cachedUserId = null
let cachedAccess = null
let pendingAccess = null

function normalizeAccess(payload) {
  return {
    role_codes: Array.isArray(payload?.role_codes) ? [...new Set(payload.role_codes.map(String))].sort() : [],
    permissions: Array.isArray(payload?.permissions) ? [...new Set(payload.permissions.map(String))].sort() : [],
  }
}

export async function loadAdminAccess(userId, { force = false } = {}) {
  const normalizedUserId = Number(userId)
  if (!Number.isInteger(normalizedUserId) || normalizedUserId < 1) {
    configureAdminMenu([])
    throw new Error('当前管理员身份无效，请重新登录。')
  }
  if (!force && cachedUserId === normalizedUserId && cachedAccess) return cachedAccess
  if (!force && cachedUserId === normalizedUserId && pendingAccess) return pendingAccess

  cachedUserId = normalizedUserId
  cachedAccess = null
  pendingAccess = getAdminAccess()
    .then((result) => {
      const access = normalizeAccess(result.data)
      cachedAccess = access
      configureAdminMenu(access.permissions)
      return access
    })
    .catch((error) => {
      configureAdminMenu([])
      throw error
    })
    .finally(() => { pendingAccess = null })
  return pendingAccess
}

export function hasAdminPermission(access, permission) {
  return !permission || Boolean(access?.permissions?.includes(permission))
}

export function invalidateAdminAccess() {
  cachedUserId = null
  cachedAccess = null
  pendingAccess = null
  configureAdminMenu([])
}
