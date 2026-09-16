import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REMEMBERED_DEMO_ROLE_KEY,
  clearRememberedDemoRole,
  normalizeDemoRole,
  readRememberedDemoRole,
  rememberDemoRole,
} from '../src/utils/demo-login.js'

function createStorage(initialValue = null) {
  const values = new Map()
  if (initialValue !== null) values.set(REMEMBERED_DEMO_ROLE_KEY, initialValue)
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('demo roles are normalized and restricted to known accounts', () => {
  assert.equal(normalizeDemoRole(' Teacher '), 'teacher')
  assert.equal(normalizeDemoRole('student'), 'student')
  assert.equal(normalizeDemoRole('unknown'), null)
})

test('remembered demo role can be saved, read and cleared', () => {
  const storage = createStorage()
  assert.equal(rememberDemoRole(storage, 'admin'), true)
  assert.equal(readRememberedDemoRole(storage), 'admin')
  assert.equal(clearRememberedDemoRole(storage), true)
  assert.equal(readRememberedDemoRole(storage), null)
})

test('invalid or unavailable storage never breaks the login page', () => {
  const storage = createStorage('not-a-role')
  assert.equal(readRememberedDemoRole(storage), null)
  assert.equal(storage.getItem(REMEMBERED_DEMO_ROLE_KEY), null)

  const blockedStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  }
  assert.equal(readRememberedDemoRole(blockedStorage), null)
  assert.equal(rememberDemoRole(blockedStorage, 'student'), false)
  assert.equal(clearRememberedDemoRole(blockedStorage), false)
  assert.equal(rememberDemoRole(null, 'student'), false)
  assert.equal(clearRememberedDemoRole(null), false)
})
