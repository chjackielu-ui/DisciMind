// 教师端 API 封装
// 所有教师端接口通过此模块调用

import { get, post, put, del, request } from './request.js'

// ========================
// 看板
// ========================

export function getTeacherDashboard(params = {}) {
  return get('/teacher/dashboard', { params })
}

// ========================
// 学情分析
// ========================

export function getAnalyticsProgress(params = {}) {
  return get('/teacher/analytics/progress', { params })
}

export function getAnalyticsKnowledgeHeatmap(params = {}) {
  return get('/teacher/analytics/knowledge-heatmap', { params })
}

export function getAnalyticsScoreDistribution(params = {}) {
  return get('/teacher/analytics/score-distribution', { params })
}

export function getAnalyticsQuestionFrequency(params = {}) {
  return get('/teacher/analytics/question-frequency', { params })
}

export function getAnalyticsWeakKnowledgePoints(params = {}) {
  return get('/teacher/analytics/weak-knowledge-points', { params })
}

export function getAnalyticsStudentRadar(studentUserId, params = {}) {
  return get(`/teacher/analytics/student-radar/${studentUserId}`, { params })
}

// ========================
// 课程管理
// ========================

export function getTeacherCourses(params = {}) {
  return get('/teacher/courses', { params })
}

export function createTeacherCourse(data) {
  return post('/teacher/courses', data)
}

export function getTeacherCourse(courseId) {
  return get(`/teacher/courses/${courseId}`)
}

export function updateTeacherCourse(courseId, data) {
  return put(`/teacher/courses/${courseId}`, data)
}

export function deleteTeacherCourse(courseId) {
  return del(`/teacher/courses/${courseId}`)
}

// ========================
// 教学班级
// ========================

export function getTeachingClasses(courseId, params = {}) {
  return get(`/teacher/courses/${courseId}/teaching-classes`, { params })
}

export function createTeachingClass(courseId, data) {
  return post(`/teacher/courses/${courseId}/teaching-classes`, data)
}

export function updateTeachingClass(classId, data) {
  return put(`/teacher/teaching-classes/${classId}`, data)
}

export function deleteTeachingClass(classId) {
  return del(`/teacher/teaching-classes/${classId}`)
}

export function getClassStudents(classId, params = {}) {
  return get(`/teacher/teaching-classes/${classId}/students`, { params })
}

export function addClassStudents(classId, data) {
  return post(`/teacher/teaching-classes/${classId}/students`, data)
}

export function removeClassStudent(classId, studentUserId) {
  return del(`/teacher/teaching-classes/${classId}/students/${studentUserId}`)
}

// ========================
// 章节管理
// ========================

export function getChapters(courseId) {
  return get(`/teacher/courses/${courseId}/chapters`)
}

export function createChapter(courseId, data) {
  return post(`/teacher/courses/${courseId}/chapters`, data)
}

export function updateChapter(chapterId, data) {
  return put(`/teacher/chapters/${chapterId}`, data)
}

export function deleteChapter(chapterId) {
  return del(`/teacher/chapters/${chapterId}`)
}

// ========================
// 知识点管理
// ========================

export function getKnowledgePoints(courseId, params = {}) {
  return get(`/teacher/courses/${courseId}/knowledge-points`, { params })
}

export function createKnowledgePoint(chapterId, data) {
  return post(`/teacher/chapters/${chapterId}/knowledge-points`, data)
}

export function updateKnowledgePoint(kpId, data) {
  return put(`/teacher/knowledge-points/${kpId}`, data)
}

export function deleteKnowledgePoint(kpId) {
  return del(`/teacher/knowledge-points/${kpId}`)
}

// ========================
// 学生管理
// ========================

export function getTeacherStudents(params = {}) {
  return get('/teacher/students', { params })
}

export function createTeacherStudent(data) {
  return post('/teacher/students', data)
}

export function getTeacherStudent(studentUserId) {
  return get(`/teacher/students/${studentUserId}`)
}

export function getStudentMastery(studentUserId, params = {}) {
  return get(`/teacher/students/${studentUserId}/mastery`, { params })
}

export function markStudentMastery(studentUserId, kpId, data) {
  return put(`/teacher/students/${studentUserId}/mastery/${kpId}`, data)
}

export function getStudentPortrait(studentUserId, params = {}) {
  return get(`/teacher/students/${studentUserId}/portrait`, { params })
}

export function refreshStudentPortrait(studentUserId, data) {
  return post(`/teacher/students/${studentUserId}/refresh`, data)
}

// ========================
// 任务管理
// ========================

export function getTeacherTasks(params = {}) {
  return get('/teacher/tasks', { params })
}

export function createTeacherTask(data) {
  return post('/teacher/tasks', data)
}

export function getTeacherTask(taskId) {
  return get(`/teacher/tasks/${taskId}`)
}

export function updateTeacherTask(taskId, data) {
  return put(`/teacher/tasks/${taskId}`, data)
}

export function deleteTeacherTask(taskId) {
  return del(`/teacher/tasks/${taskId}`)
}

export function getTaskSubmissions(taskId, params = {}) {
  return get(`/teacher/tasks/${taskId}/submissions`, { params })
}

export function getTaskSubmission(taskId, submissionId) {
  return get(`/teacher/tasks/${taskId}/submissions/${submissionId}`)
}

// ========================
// 题库管理
// ========================

export function getTeacherQuestions(params = {}) {
  return get('/teacher/questions', { params })
}

export function createTeacherQuestion(data) {
  return post('/teacher/questions', data)
}

export function getTeacherQuestion(questionId) {
  return get(`/teacher/questions/${questionId}`)
}

export function updateTeacherQuestion(questionId, data) {
  return put(`/teacher/questions/${questionId}`, data)
}

export function deleteTeacherQuestion(questionId) {
  return del(`/teacher/questions/${questionId}`)
}

// ========================
// 知识库文档管理
// ========================

export function getKnowledgeDocuments(params = {}) {
  return get('/teacher/knowledge-documents', { params })
}

export function getKnowledgeDocument(documentId) {
  return get(`/teacher/knowledge-documents/${documentId}`)
}

export function reviewKnowledgeDocument(documentId, data) {
  return put(`/teacher/knowledge-documents/${documentId}/review`, data)
}

export function uploadKnowledgeDocument(formData) {
  return request('/teacher/knowledge-documents/upload', {
    method: 'POST',
    body: formData,
  })
}

// ========================
// 消息通知
// ========================

export function getNotifications(params = {}) {
  return get('/teacher/notifications', { params })
}

export function markNotificationRead(notificationId) {
  return put(`/teacher/notifications/${notificationId}/read`)
}

export function markAllNotificationsRead() {
  return put('/teacher/notifications/read-all')
}

export function getUnreadNotificationCount() {
  return get('/teacher/notifications/unread-count')
}

// ========================
// AI 功能（占位）
// ========================

export function aiGenerateQuestions(data) {
  return post('/teacher/ai/generate-questions', data)
}

export function aiGenerateSummary(data) {
  return post('/teacher/ai/generate-summary', data)
}

export function aiVideoGeneration(data) {
  return post('/teacher/ai/video-generation', data)
}

export function aiLearningAnalysis(data) {
  return post('/teacher/ai/learning-analysis', data)
}
