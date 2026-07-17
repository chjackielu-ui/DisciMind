// 管理端 API 封装
// 所有管理端接口调用统一放在此文件

import { get, post, put, del } from './request.js'

// ==================== 仪表盘 ====================
export const ADMIN_DASHBOARD_CONTRACT_VERSION = 'admin-dashboard.v1'

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeDashboardSummary(data) {
  const source = data.summary && typeof data.summary === 'object' ? data.summary : data
  return {
    user_count: finiteOrNull(source.user_count),
    student_count: finiteOrNull(source.student_count),
    teacher_count: finiteOrNull(source.teacher_count),
    admin_count: finiteOrNull(source.admin_count),
    course_count: finiteOrNull(source.course_count),
    admin_class_count: finiteOrNull(source.admin_class_count),
    teaching_class_count: finiteOrNull(source.teaching_class_count),
    class_count: finiteOrNull(source.class_count),
    knowledge_document_count: finiteOrNull(source.knowledge_document_count),
    ai_call_count_today: finiteOrNull(source.ai_call_count_today ?? data.metrics?.today_ai_calls),
    pending_review_document_count: finiteOrNull(source.pending_review_document_count),
    pending_agent_review_count: finiteOrNull(source.pending_agent_review_count),
    pending_agent_report_count: finiteOrNull(source.pending_agent_report_count),
    unread_notification_count: finiteOrNull(source.unread_notification_count),
  }
}

function normalizeServiceHealth(data, legacyContract) {
  const current = data.service_health && typeof data.service_health === 'object' ? data.service_health : {}
  if (Array.isArray(current.services)) {
    return {
      overall: current.overall || data.system_status?.overall || (legacyContract ? 'degraded' : 'unknown'),
      services: current.services,
      providers: Array.isArray(current.providers) ? current.providers : [],
    }
  }

  const services = []
  if (data.system_status?.database) {
    services.push({ key: 'database', name: '数据库', status: data.system_status.database, message: '核心统计查询已完成' })
  }
  if (current.learning_flows) {
    services.push({ key: 'learning_flows', name: '学习流', status: current.learning_flows.status, message: `异常流程 ${finiteOrNull(current.learning_flows.abnormal_count) ?? 0} 个` })
  }
  if (current.knowledge) {
    services.push({ key: 'knowledge', name: '知识库', status: current.knowledge.status, message: `待处理问题 ${finiteOrNull(current.knowledge.issue_count) ?? 0} 个` })
  }
  if (legacyContract) {
    services.push({
      key: 'api_contract',
      name: '管理端接口契约',
      status: 'degraded',
      message: '后端仍在提供旧版驾驶舱结构，请重启或升级后端服务。',
    })
  }
  return {
    overall: data.system_status?.overall || (legacyContract ? 'degraded' : 'unknown'),
    services,
    providers: Array.isArray(current.providers) ? current.providers : [],
  }
}

/**
 * Dashboard responses briefly existed in three shapes during the admin rebuild.
 * Normalize them once at the API boundary and make missing modules explicit;
 * pages never guess between response.data/data.data/result variants.
 */
export function normalizeAdminDashboardData(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('驾驶舱接口返回结构无效，请检查后端服务版本。')
  }
  const legacyContract = !payload.system_status && !payload.summary
  const systemStatus = payload.system_status && typeof payload.system_status === 'object'
    ? { ...payload.system_status }
    : {
        overall: 'degraded',
        database: 'available',
        ai_providers_available: null,
        ai_providers_enabled: null,
        online_agents: null,
        today_risks: null,
        pending_tasks: finiteOrNull(payload.pending_review_document_count),
      }
  if (!systemStatus.overall) systemStatus.overall = 'degraded'
  if (!systemStatus.database) systemStatus.database = 'unknown'

  const moduleErrors = Array.isArray(payload.module_errors) ? [...payload.module_errors] : []
  if (legacyContract) {
    moduleErrors.push({
      module: 'api_contract',
      code: 'LEGACY_DASHBOARD_CONTRACT',
      message: '后端返回旧版驾驶舱结构；基础数据库统计可用，高级状态暂不可用。',
    })
  }

  return {
    ...payload,
    contract_version: payload.contract_version || (legacyContract ? 'legacy' : 'admin-dashboard.compat'),
    generated_at: payload.generated_at || null,
    summary: normalizeDashboardSummary(payload),
    system_status: systemStatus,
    service_health: normalizeServiceHealth(payload, legacyContract),
    recent_events: Array.isArray(payload.recent_events) ? payload.recent_events : [],
    trend: Array.isArray(payload.trend) ? payload.trend : [],
    distributions: payload.distributions && typeof payload.distributions === 'object'
      ? payload.distributions
      : { users: [], classes: [], knowledge_reviews: [] },
    review_flow: payload.review_flow && typeof payload.review_flow === 'object'
      ? payload.review_flow
      : { knowledge_documents: {}, agent_versions: {}, reports: {} },
    todo: payload.todo && typeof payload.todo === 'object' ? payload.todo : {},
    module_errors: moduleErrors,
  }
}

export async function getAdminDashboard() {
  const result = await get('/admin/dashboard')
  return { ...result, data: normalizeAdminDashboardData(result.data) }
}

// ==================== 用户管理 ====================
export function getAdminUsers(params) {
  return get('/admin/users', { params })
}

export function createAdminUser(data) {
  return post('/admin/users', data)
}

export function updateAdminUser(userId, data) {
  return put(`/admin/users/${userId}`, data)
}

export function updateUserStatus(userId, status) {
  return put(`/admin/users/${userId}/status`, { status })
}

export function resetUserPassword(userId, newPassword) {
  return put(`/admin/users/${userId}/password`, { new_password: newPassword })
}

export function deleteUser(userId) {
  return del(`/admin/users/${userId}`)
}

// ==================== 课程管理 ====================
export function getAdminCourses(params) {
  return get('/admin/courses', { params })
}

export function createAdminCourse(data) {
  return post('/admin/courses', data)
}

export function getAdminCourseDetail(courseId) {
  return get(`/admin/courses/${courseId}`)
}

export function updateAdminCourse(courseId, data) {
  return put(`/admin/courses/${courseId}`, data)
}

export function deleteAdminCourse(courseId) {
  return del(`/admin/courses/${courseId}`)
}

export function bindCourseTeacher(courseId, teacherUserId, teacherRole) {
  return post(`/admin/courses/${courseId}/teachers`, {
    teacher_user_id: teacherUserId,
    teacher_role: teacherRole,
  })
}

export function unbindCourseTeacher(courseId, teacherUserId) {
  return del(`/admin/courses/${courseId}/teachers/${teacherUserId}`)
}

// ==================== 章节管理 ====================
export function getCourseChapters(courseId) {
  return get(`/admin/courses/${courseId}/chapters`)
}

export function createChapter(courseId, data) {
  return post(`/admin/courses/${courseId}/chapters`, data)
}

export function updateChapter(chapterId, data) {
  return put(`/admin/chapters/${chapterId}`, data)
}

export function deleteChapter(chapterId) {
  return del(`/admin/chapters/${chapterId}`)
}

// ==================== 知识点管理 ====================
export function getCourseKnowledgePoints(courseId, params) {
  return get(`/admin/courses/${courseId}/knowledge-points`, { params })
}

export function createKnowledgePoint(data) {
  return post('/admin/knowledge-points', data)
}

export function updateKnowledgePoint(kpId, data) {
  return put(`/admin/knowledge-points/${kpId}`, data)
}

export function deleteKnowledgePoint(kpId) {
  return del(`/admin/knowledge-points/${kpId}`)
}

// ==================== 行政班级 ====================
export function getAdminClasses(params) {
  return get('/admin/admin-classes', { params })
}

export function createAdminClass(data) {
  return post('/admin/admin-classes', data)
}

export function updateAdminClass(classId, data) {
  return put(`/admin/admin-classes/${classId}`, data)
}

export function deleteAdminClass(classId) {
  return del(`/admin/admin-classes/${classId}`)
}

export function getAdminClassStudents(classId, params) {
  return get(`/admin/admin-classes/${classId}/students`, { params })
}

export function addAdminClassStudents(classId, studentUserIds) {
  return post(`/admin/admin-classes/${classId}/students`, {
    student_user_ids: studentUserIds,
  })
}

export function removeAdminClassStudent(classId, studentUserId) {
  return del(`/admin/admin-classes/${classId}/students/${studentUserId}`)
}

// ==================== 教学班级 ====================
export function getTeachingClassPage(params) {
  return get('/admin/teaching-classes', { params })
}

export function getTeachingClasses(courseId) {
  return get(`/admin/courses/${courseId}/teaching-classes`)
}

export function createTeachingClass(courseId, data) {
  return post(`/admin/courses/${courseId}/teaching-classes`, data)
}

export function updateTeachingClass(classId, data) {
  return put(`/admin/teaching-classes/${classId}`, data)
}

export function deleteTeachingClass(classId) {
  return del(`/admin/teaching-classes/${classId}`)
}

export function getTeachingClassStudents(classId, params) {
  return get(`/admin/teaching-classes/${classId}/students`, { params })
}

export function addTeachingClassStudents(classId, studentUserIds) {
  return post(`/admin/teaching-classes/${classId}/students`, {
    student_user_ids: studentUserIds,
  })
}

export function removeTeachingClassStudent(classId, studentUserId) {
  return del(`/admin/teaching-classes/${classId}/students/${studentUserId}`)
}

// ==================== 知识库管理 ====================
export function getAdminKnowledgeDocuments(params) {
  return get('/admin/knowledge-documents', { params })
}

export function reviewKnowledgeDocument(documentId, reviewStatus, reviewComment) {
  return put(`/admin/knowledge-documents/${documentId}/review`, {
    review_status: reviewStatus,
    review_comment: reviewComment,
  })
}

// ==================== 操作日志 ====================
export function getOperationLogs(params) {
  return get('/admin/operation-logs', { params })
}

// ==================== 通知管理 ====================
export function getAdminNotifications(params) {
  return get('/admin/notifications', { params })
}

export function createAdminNotification(data) {
  return post('/admin/notifications', data)
}

export function markNotificationRead(notificationId) {
  return put(`/admin/notifications/${notificationId}/read`)
}

export function markAllNotificationsRead(filters = {}) {
  return put('/admin/notifications/read-all', filters)
}

// ==================== 旧版 AI 配置兼容接口 ====================
export function getAiModelConfigs() {
  return get('/admin/ai-model-configs')
}

export function createAiModelConfig() {
  return post('/admin/ai-model-configs', {})
}

export function getAiCallLogs() {
  return get('/admin/ai-call-logs')
}

// ==================== 统一 AI 配置中心 ====================
export const getAiProviders = () => get('/admin/ai/providers')
export const getAiProvider = (id) => get(`/admin/ai/providers/${id}`)
export const createAiProvider = (data) => post('/admin/ai/providers', data)
export const updateAiProvider = (id, data) => put(`/admin/ai/providers/${id}`, data)
export const testAiProvider = (id) => post(`/admin/ai/providers/${id}/test`, {})
export const setAiProviderEnabled = (id, enabled) => post(`/admin/ai/providers/${id}/${enabled ? 'enable' : 'disable'}`, {})
export const replaceAiProviderSecret = (id, data) => post(`/admin/ai/providers/${id}/replace-secret`, data)
export const clearAiProviderSecret = (id) => post(`/admin/ai/providers/${id}/clear-secret`, { confirm: true })

export const getAiModels = (params) => get('/admin/ai/models', { params })
export const getAiModel = (id) => get(`/admin/ai/models/${id}`)
export const createAiModel = (data) => post('/admin/ai/models', data)
export const updateAiModel = (id, data) => put(`/admin/ai/models/${id}`, data)
export const testAiModel = (id) => post(`/admin/ai/models/${id}/test`, {})
export const setAiModelEnabled = (id, enabled) => post(`/admin/ai/models/${id}/${enabled ? 'enable' : 'disable'}`, {})
export const setDefaultAiModel = (id) => post(`/admin/ai/models/${id}/set-default`, {})

export const getAdminAgents = () => get('/admin/agents')
export const getAdminAgent = (id) => get(`/admin/agents/${id}`)
export const createAdminAgent = (data) => post('/admin/agents', data)
export const updateAdminAgent = (id, data) => put(`/admin/agents/${id}`, data)
export const testAdminAgent = (id) => post(`/admin/agents/${id}/test`, {})
export const publishAdminAgent = (id) => post(`/admin/agents/${id}/publish`, {})
export const rollbackAdminAgent = (id, versionId) => post(`/admin/agents/${id}/rollback`, { version_id: versionId })

export const getAdminEnvironmentStatus = () => get('/admin/system/environment-status')

// ==================== 证据链与治理中心 ====================
export const getAdminTraces = (params) => get('/admin/traces', { params })
export const getAdminTrace = (id) => get(`/admin/traces/${id}`)
export const markAdminTraceRisk = (id, data) => post(`/admin/traces/${id}/mark-risk`, data)

export const getGovernanceOverview = (module) => get(`/admin/governance/${module}/overview`)
export const getGovernanceList = (module, params) => get(`/admin/governance/${module}`, { params })
export const runGovernanceAction = (module, action, data = {}) => post(`/admin/governance/${module}/actions/${action}`, data)

// ==================== 管理员角色与权限 ====================
export const getAdminAccess = () => get('/admin/rbac/me')
export const getAdminRbacOverview = () => get('/admin/rbac/overview')
export const updateAdminUserRoles = (userId, data) => put(`/admin/rbac/users/${userId}/roles`, data)
export const updateAdminRolePermissions = (roleCode, data) => put(`/admin/rbac/roles/${roleCode}/permissions`, data)
