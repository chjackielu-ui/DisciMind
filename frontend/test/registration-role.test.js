import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePublicRegistrationRole } from '../src/utils/registration-role.js'

test('production registration falls back to student when public teacher registration is disabled', () => {
  assert.equal(resolvePublicRegistrationRole('teacher', false), 'student')
  assert.equal(resolvePublicRegistrationRole('admin', false), 'student')
  assert.equal(resolvePublicRegistrationRole('student', false), 'student')
})

test('teacher remains selectable only when public teacher registration is enabled', () => {
  assert.equal(resolvePublicRegistrationRole('teacher', true), 'teacher')
  assert.equal(resolvePublicRegistrationRole('student', true), 'student')
})
