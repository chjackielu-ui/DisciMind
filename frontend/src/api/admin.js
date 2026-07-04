// 管理端 API 封装
// 所有管理端接口调用统一放在此文件

import { get, post, put, del } from './request.js'

// ==================== 仪表盘 ====================
export function getAdminDashboard() {
  return get('/admin/dashboard')
}

// ==================== 用户管理 ====================
export function getAdminUsers(params) {
  return get('/admin/users', { params })
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

// ==================== 教学班级 ====================
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

export function markAllNotificationsRead(userId) {
  return put('/admin/notifications/read-all', { user_id: userId })
}

// ==================== AI 配置（占位） ====================
export function getAiModelConfigs() {
  return get('/admin/ai-model-configs')
}

export function createAiModelConfig() {
  return post('/admin/ai-model-configs', {})
}

export function getAiCallLogs() {
  return get('/admin/ai-call-logs')
}
