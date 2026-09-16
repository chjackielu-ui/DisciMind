export function resolvePublicRegistrationRole(requestedRole, teacherRegistrationEnabled) {
  if (requestedRole === 'teacher' && teacherRegistrationEnabled) return 'teacher'
  return 'student'
}
