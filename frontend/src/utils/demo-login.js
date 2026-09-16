export const DEMO_CREDENTIALS_BY_ROLE = Object.freeze({
  student: Object.freeze({ account: 'student_demo', password: '123456' }),
  teacher: Object.freeze({ account: 'teacher_demo', password: '123456' }),
  admin: Object.freeze({ account: 'admin_demo', password: '123456' }),
})

export const REMEMBERED_DEMO_ROLE_KEY = 'discimind:remembered-demo-role:v1'

export function normalizeDemoRole(role) {
  const normalized = String(role || '').trim().toLowerCase()
  return Object.hasOwn(DEMO_CREDENTIALS_BY_ROLE, normalized) ? normalized : null
}

export function readRememberedDemoRole(storage) {
  try {
    const storedRole = storage?.getItem(REMEMBERED_DEMO_ROLE_KEY)
    const role = normalizeDemoRole(storedRole)
    if (storedRole && !role) storage.removeItem(REMEMBERED_DEMO_ROLE_KEY)
    return role
  } catch {
    return null
  }
}

export function rememberDemoRole(storage, role) {
  const normalized = normalizeDemoRole(role)
  if (!storage || !normalized) return false

  try {
    storage?.setItem(REMEMBERED_DEMO_ROLE_KEY, normalized)
    return true
  } catch {
    return false
  }
}

export function clearRememberedDemoRole(storage) {
  if (!storage) return false

  try {
    storage?.removeItem(REMEMBERED_DEMO_ROLE_KEY)
    return true
  } catch {
    return false
  }
}
