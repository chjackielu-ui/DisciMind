// 认证工具
// Access Token 保存在 sessionStorage（页面刷新后仍存在，关闭标签页后清除）
// 会话刷新通过 session/refresh 接口（要求有效的 sessionId）
// 不再通过 HttpOnly Cookie 自动恢复已关闭标签页的登录状态

const TOKEN_KEY = 'discimind_access_token'
const USER_KEY = 'discimind_user'
const SESSION_ID_KEY = 'discimind_session_id'
const LAST_ACTIVITY_KEY = 'discimind_last_activity_at'
const SESSION_AUTHENTICATED_KEY = 'discimind_session_authenticated'
const LEGACY_USER_KEY = 'user'
const LEGACY_TOKEN_KEY = 'token'
const LOGOUT_EVENT_KEY = 'discimind.auth.logout'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const AUTH_STATUS = {
  INITIALIZING: 'INITIALIZING',
  AUTHENTICATED: 'AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 分钟
const ACTIVITY_THROTTLE_MS = 30000 // 活动更新节流 30 秒

let authStatus = AUTH_STATUS.INITIALIZING
let initPromise = null
let refreshPromise = null
let authChannel = null
let idleCheckInterval = null
let lastActivityUpdate = 0

// ---------- 存储读写 ----------

function ssGet(key) {
  try { return sessionStorage.getItem(key) } catch { return null }
}
function ssSet(key, value) {
  try { sessionStorage.setItem(key, value) } catch {}
}
function ssRemove(key) {
  try { sessionStorage.removeItem(key) } catch {}
}

function getStoredToken() {
  return ssGet(TOKEN_KEY) || ''
}

function getStoredUser() {
  try {
    const raw = ssGet(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function getStoredSessionId() {
  const v = ssGet(SESSION_ID_KEY)
  return v ? Number(v) : null
}

function persistToken(token) {
  if (token) ssSet(TOKEN_KEY, String(token))
  else ssRemove(TOKEN_KEY)
}

function persistUser(user) {
  if (user) ssSet(USER_KEY, JSON.stringify(user))
  else ssRemove(USER_KEY)
}

function persistSessionId(sessionId) {
  if (sessionId != null) ssSet(SESSION_ID_KEY, String(sessionId))
  else ssRemove(SESSION_ID_KEY)
}

function normalizeSessionId(sessionId) {
  if (sessionId === undefined) return undefined
  if (sessionId == null || sessionId === '') return null
  const normalized = Number(sessionId)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null
}

function cleanLegacyStorage() {
  // 清理旧 localStorage 残留
  try { localStorage.removeItem(LEGACY_USER_KEY) } catch {}
  try { localStorage.removeItem(LEGACY_TOKEN_KEY) } catch {}
}

// ---------- 事件通知 ----------

function notifyAuthChanged() {
  window.dispatchEvent(new CustomEvent('discimind-auth-changed', {
    detail: { status: authStatus, user: getUser() },
  }))
}

function setStatus(status) {
  authStatus = status
  notifyAuthChanged()
}

function markAuthenticatedIfUser() {
  const user = getStoredUser()
  if (user && getStoredToken()) setStatus(AUTH_STATUS.AUTHENTICATED)
  return user
}

// ---------- 跨标签页协调 ----------

function getBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!authChannel) {
    try {
      authChannel = new BroadcastChannel('discimind-auth')
      authChannel.onmessage = (event) => {
        if (event.data?.type === 'logout') {
          clearAuth({ broadcast: false })
          if (window.location.hash !== '#/login') window.location.hash = '#/login'
        }
      }
    } catch {
      authChannel = null
    }
  }
  return authChannel
}

// ---------- 公开 API ----------

export function getAuthStatus() {
  return authStatus
}

export function getToken() {
  return getStoredToken()
}

export function getUser() {
  return getStoredUser()
}

export function setAuth(token, user, sessionId) {
  if (token != null && String(token).trim()) {
    persistToken(String(token))
  }
  if (user) {
    persistUser(user)
    const hasSessionArg = arguments.length >= 3 && sessionId !== undefined
    const nextSessionId = normalizeSessionId(hasSessionArg ? sessionId : (user.sessionId ?? user.session_id))
    if (hasSessionArg || nextSessionId !== undefined) persistSessionId(nextSessionId)
    ssSet(SESSION_AUTHENTICATED_KEY, 'true')
  } else {
    persistUser(null)
    persistSessionId(null)
    ssRemove(SESSION_AUTHENTICATED_KEY)
  }
  // 登录/刷新成功后更新活动时间
  if (user && token) {
    recordActivityNow()
  }
  setStatus(user ? AUTH_STATUS.AUTHENTICATED : AUTH_STATUS.UNAUTHENTICATED)
}

export function clearAuth(options = {}) {
  persistToken(null)
  persistUser(null)
  persistSessionId(null)
  ssRemove(LAST_ACTIVITY_KEY)
  ssRemove(SESSION_AUTHENTICATED_KEY)
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith('discimind:task-island:intro:')) sessionStorage.removeItem(key)
    }
  } catch {}
  cleanLegacyStorage()
  stopIdleCheck()
  setStatus(AUTH_STATUS.UNAUTHENTICATED)
  if (options.broadcast !== false) {
    try { getBroadcastChannel()?.postMessage({ type: 'logout' }) } catch {}
    try { localStorage.setItem(LOGOUT_EVENT_KEY, String(Date.now())) } catch {}
  }
}

export function isLoggedIn() {
  return !!getStoredToken() && !!getStoredUser()
}

/**
 * 判断当前标签页是否存在有效的可刷新会话。
 * 只有以下条件全部满足时才允许刷新：
 * - sessionStorage 中有 accessToken
 * - sessionStorage 中有 sessionId
 * - sessionStorage 中有会话已认证标记
 * - lastActivityAt 未超过 30 分钟空闲
 */
export function canRefreshCurrentSession() {
  const token = getStoredToken()
  const sessionId = getStoredSessionId()
  const authenticated = ssGet(SESSION_AUTHENTICATED_KEY) === 'true'
  const lastActivity = Number(ssGet(LAST_ACTIVITY_KEY) || 0)

  if (!token || !sessionId || !authenticated) return false
  if (lastActivity && Date.now() - lastActivity >= IDLE_TIMEOUT_MS) return false
  return true
}

// ---------- 活动跟踪 ----------

function recordActivityNow() {
  const now = Date.now()
  ssSet(LAST_ACTIVITY_KEY, String(now))
  lastActivityUpdate = now
}

/**
 * 记录用户活动（节流：最多每 30 秒更新一次 sessionStorage）
 */
export function recordActivity() {
  const now = Date.now()
  if (now - lastActivityUpdate < ACTIVITY_THROTTLE_MS) return
  lastActivityUpdate = now
  ssSet(LAST_ACTIVITY_KEY, String(now))
}

function setupActivityListeners() {
  const handler = () => recordActivity()
  const opts = { passive: true }
  document.addEventListener('pointerdown', handler, opts)
  document.addEventListener('keydown', handler, opts)
  document.addEventListener('touchstart', handler, opts)
  document.addEventListener('scroll', handler, opts)
  window.addEventListener('hashchange', handler)
}

// ---------- 空闲检测 ----------

function startIdleCheck() {
  if (idleCheckInterval) return
  idleCheckInterval = setInterval(() => {
    if (!isLoggedIn()) return
    const lastActivity = Number(ssGet(LAST_ACTIVITY_KEY) || 0)
    if (!lastActivity) return
    if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
      stopIdleCheck()
      logoutSession().catch(() => {}).finally(() => {
        window.location.hash = '#/login?reason=idle_timeout'
      })
    }
  }, 30000) // 每 30 秒检查一次
  if (idleCheckInterval.unref) idleCheckInterval.unref()
}

function stopIdleCheck() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval)
    idleCheckInterval = null
  }
}

// ---------- HTTP 请求 ----------

async function rawAuthPost(path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })
  const result = await response.json().catch(() => null)
  if (!result) throw new Error(`接口请求失败（HTTP ${response.status}）`)
  if (result.code !== 0) {
    const err = new Error(result.message || '请求失败')
    err.code = result.code
    throw err
  }
  return result
}

// ---------- 会话刷新 ----------

/**
 * 通过 HttpOnly Cookie 刷新（页面初始化时优先使用）
 */
export async function refreshAuthSession() {
  if (refreshPromise) return refreshPromise
  refreshPromise = rawAuthPost('/auth/refresh')
    .then((result) => {
      const data = result.data || {}
      setAuth(data.accessToken || data.token, data.user, data.sessionId)
      return data
    })
    .catch((err) => {
      // Cookie 刷新失败不立即清理，可能还有 sessionStorage token
      throw err
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

/**
 * 通过 sessionStorage 中的 sessionId 发起兼容刷新；服务端仍强制校验 HttpOnly Cookie。
 */
export async function refreshSessionViaStorage() {
  const sessionId = getStoredSessionId()
  if (!sessionId) throw new Error('无可用会话')

  if (refreshPromise) return refreshPromise
  refreshPromise = rawAuthPost('/auth/session/refresh', {
    token: getStoredToken(),
    body: { sessionId },
  })
    .then((result) => {
      const data = result.data || {}
      if (data.accessToken) {
        persistToken(data.accessToken)
        recordActivityNow()
      }
      return data
    })
    .catch((err) => {
      clearAuth({ broadcast: false })
      throw err
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

// ---------- 初始化 ----------

export async function initializeAuth() {
  if (authStatus !== AUTH_STATUS.INITIALIZING) return getUser()
  if (initPromise) return initPromise

  getBroadcastChannel()
  setupActivityListeners()
  cleanLegacyStorage()

  // 监听其他标签页的登出事件
  window.addEventListener('storage', (event) => {
    if (event.key === LOGOUT_EVENT_KEY && event.newValue) {
      clearAuth({ broadcast: false })
      if (window.location.hash !== '#/login') window.location.hash = '#/login'
    }
  })

  initPromise = (async () => {
    // 1. 检查当前标签页是否有有效会话
    if (!canRefreshCurrentSession()) {
      clearAuth({ broadcast: false })
      return null
    }

    // 2. 检查是否已空闲超时
    const lastActivity = Number(ssGet(LAST_ACTIVITY_KEY) || 0)
    if (lastActivity && Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
      clearAuth({ broadcast: false })
      return null
    }

    // 3. 通过兼容端点尝试续期；sessionId 仅用于恢复页面状态，不作为认证凭证
    try {
      await refreshSessionViaStorage()
      startIdleCheck()
      return markAuthenticatedIfUser()
    } catch {
      // session/refresh 失败，尝试 Cookie 刷新作为辅助续期
      try {
        const data = await refreshAuthSession()
        if (data.user && getStoredSessionId()) {
          startIdleCheck()
          setStatus(AUTH_STATUS.AUTHENTICATED)
          return data.user
        }
      } catch {
        // Cookie 刷新也失败
      }
      // 刷新失败但 sessionStorage token 可能仍有效，保持当前状态
      startIdleCheck()
      return markAuthenticatedIfUser()
    }
  })()
    .catch(() => {
      clearAuth({ broadcast: false })
      return null
    })
    .finally(() => {
      initPromise = null
    })

  return initPromise
}

// ---------- 登出 ----------

export async function logoutSession() {
  stopIdleCheck()
  try {
    // 尝试调用后端撤销
    const sessionId = getStoredSessionId()
    const token = getStoredToken()
    await rawAuthPost('/auth/logout', { token, body: sessionId ? { sessionId } : undefined })
  } catch {
    // 即使服务端退出失败，也必须清理本地状态
  } finally {
    clearAuth()
  }
}

// ---------- 工具函数 ----------

export function getUserDisplayName() {
  const user = getUser()
  if (!user) return ''
  return user.profile?.real_name || user.username || ''
}
