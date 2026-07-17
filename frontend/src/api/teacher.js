// 教师端 API 封装
// 所有教师端接口通过此模块调用

import { get, post, patch, put, upload, del, request, BASE_URL } from './request.js'
import { getToken } from '../utils/auth.js'

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

export function getAnalyticsWorkbench(params = {}) { return get('/teacher/analytics/workbench', { params }) }
export function getDialogueInsights(params = {}) { return get('/teacher/analytics/dialogue-insights', { params }) }

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

export function getAcademicSemesters(params = {}) { return get('/teacher/semesters', { params }) }
export function createAcademicSemester(data) { return post('/teacher/semesters', data) }
export function getAdministrativeClasses(params = {}) { return get('/teacher/administrative-classes', { params }) }
export function getAdministrativeClassStudents(classId, params = {}) { return get(`/teacher/administrative-classes/${classId}/students`, { params }) }
export function importAdministrativeClasses(classId, data) { return post(`/teacher/teaching-classes/${classId}/import-administrative-classes`, data) }
export function batchRemoveClassStudents(classId, data) { return post(`/teacher/teaching-classes/${classId}/students/batch-remove`, data) }
export function getCourseOfferings(courseId, params = {}) { return get(`/teacher/courses/${courseId}/offerings`, { params }) }
export function createCourseOffering(courseId, data) { return post(`/teacher/courses/${courseId}/offerings`, data) }

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

export function updateTeacherStudent(studentUserId, data) {
  return put(`/teacher/students/${studentUserId}`, data)
}

export function deleteTeacherStudent(studentUserId) {
  return del(`/teacher/students/${studentUserId}`)
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

export function batchImportStudents(data) {
  return post('/teacher/students/batch-import', data)
}

export function createStudentIntervention(studentUserId, data) { return post(`/teacher/students/${studentUserId}/interventions`, data) }
export function batchNotifyStudents(data) { return post('/teacher/students/batch-notify', data) }

export async function downloadStudentTemplate() {
  // 直接通过 fetch 下载（避免 JSON 解析）
  const { getToken } = await import('../utils/auth.js')
  const token = getToken()
  const BASE_URL = (await import('./request.js')).BASE_URL || 'http://localhost:3000/api'
  const response = await fetch(`${BASE_URL}/teacher/students/template`, {
    headers: { Authorization: token ? `Bearer ${token}` : '' },
    credentials: 'include',
  })
  if (!response.ok) throw new Error('下载模板失败')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'student_import_template.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ========================
// 班级管理
// ========================

export function getAllTeachingClasses(params = {}) {
  return get('/teacher/classes', { params })
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

export function previewTaskComposition(data) { return post('/teacher/tasks/preview-composition', data) }

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

export function batchImportQuestions(data) { return post('/teacher/questions/batch-import', data) }
export function batchUpdateQuestions(data) { return patch('/teacher/questions/batch', data) }
export function batchDeleteQuestions(data) { return request('/teacher/questions/batch', { method: 'DELETE', body: data }) }
export function exportQuestions(params = {}) { return get('/teacher/questions/export', { params }) }

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

export function getTeachingResources(params = {}) { return get('/teacher/resources', { params }) }
export function createExternalResource(data) { return post('/teacher/resources/external', data) }
export function updateTeachingResource(documentId, data) { return put(`/teacher/resources/${documentId}`, data) }
export function deleteTeachingResource(documentId) { return del(`/teacher/resources/${documentId}`) }
export function shareTeachingResource(documentId, data) { return post(`/teacher/resources/${documentId}/share`, data) }
export function getTeachingResourceDistributions(documentId) { return get(`/teacher/resources/${documentId}/distributions`) }
export async function downloadTeachingResource(documentId, fallbackName = 'teaching-resource') {
  const response = await fetch(`${BASE_URL}/teacher/resources/${documentId}/download`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    credentials: 'include',
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.error?.message || result?.message || '资源下载失败')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  let filename = fallbackName
  try { filename = decodeURIComponent(encoded || plain || fallbackName) } catch {}
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove()
  URL.revokeObjectURL(url)
}
export function getKnowledgeBaseApplications(params = {}) { return get('/teacher/knowledge-base-applications', { params }) }
export function reviewKnowledgeBaseApplication(reviewId, data) { return post(`/teacher/knowledge-base-applications/${reviewId}/review`, data) }
export function batchReviewKnowledgeBaseApplications(data) { return post('/teacher/knowledge-base-applications/batch-review', data) }
export function revokeKnowledgeBasePublic(knowledgeBaseId, data = {}) { return post(`/teacher/knowledge-bases/${knowledgeBaseId}/revoke-public`, data) }

// ========================
// 作业管理（独立 homework 模块）
// ========================

export function createHomework(data) {
  return post('/teacher/homework/create', data)
}

export function updateHomework(id, data) {
  return put(`/teacher/homework/${id}`, data)
}

export function publishHomework(id) {
  return put(`/teacher/homework/${id}/publish`)
}

export function closeHomework(id) {
  return put(`/teacher/homework/${id}/close`)
}

export function importHomeworkQuestions(id, data) {
  return post(`/teacher/homework/${id}/import-question`, data)
}

export function getHomeworkList(params = {}) {
  return get('/teacher/homework/list', { params })
}

export function getHomeworkDetail(id) {
  return get(`/teacher/homework/${id}/detail`)
}

export function getHomeworkSubmissions(id, params = {}) {
  return get(`/teacher/homework/${id}/submissions`, { params })
}

export function aiMarkSubmission(subId) {
  return post(`/teacher/homework/submission/${subId}/ai-mark`)
}

export function batchAiMarkHomework(id) {
  return post(`/teacher/homework/${id}/batch-ai-mark`)
}

export function manualMarkSubmission(subId, data) {
  return put(`/teacher/homework/submission/${subId}/manual-mark`, data)
}

export function getHomeworkScoreStat(id) {
  return get(`/teacher/homework/${id}/score-stat`)
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

export function deleteTeacherNotifications(data) { return request('/teacher/notifications', { method: 'DELETE', body: data }) }
export function getSentNotificationStats(params = {}) { return get('/teacher/notifications/sent-stats', { params }) }

// ========================
// AI 题目、摘要、视频检索与学习分析
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

export function createTeacherAiConversation(data = {}) { return post('/teacher/ai/conversations', data) }
export function getTeacherAiContextOptions() { return get('/teacher/ai/context-options') }
export function getTeacherAiConversations(params = {}) { return get('/teacher/ai/conversations', { params }) }
export function getTeacherAiMessages(conversationId) { return get(`/teacher/ai/conversations/${conversationId}/messages`) }
export function sendTeacherAiMessage(conversationId, data = {}) { return post(`/teacher/ai/conversations/${conversationId}/messages`, data) }
export function retrySaveTeacherAiMessage(conversationId, data = {}) { return post(`/teacher/ai/conversations/${conversationId}/messages/retry-save`, data) }
export function renameTeacherAiConversation(conversationId, title) { return patch(`/teacher/ai/conversations/${conversationId}`, { title }) }
export function clearTeacherAiConversation(conversationId) { return del(`/teacher/ai/conversations/${conversationId}/messages`) }
export function deleteTeacherAiConversation(conversationId) { return del(`/teacher/ai/conversations/${conversationId}`) }
export function uploadTeacherAiAttachment(file, conversationId = null) {
  const form = new FormData(); form.append('file', file); if (conversationId) form.append('conversationId', String(conversationId))
  return upload('/teacher/ai/attachments', form)
}

function parseSseBlock(block, onEvent) {
  let eventName = 'message'; const data = []
  block.split('\n').forEach(line => { if (line.startsWith('event:')) eventName = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trimStart()) })
  if (!data.length) return
  let payload; try { payload = JSON.parse(data.join('\n')) } catch { payload = { content: data.join('\n') } }
  onEvent?.(eventName, payload)
}

async function consumeSse(response, onEvent) {
  if (!response.ok) { const result = await response.json().catch(() => null); const error = new Error(result?.error?.message || result?.message || `请求失败（HTTP ${response.status}）`); error.code = result?.error?.code || result?.code; error.requestId = result?.error?.requestId; error.retryable = result?.error?.retryable === true; throw error }
  if (!response.body) throw new Error('当前浏览器不支持流式响应')
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer = ''
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n'); let boundary = buffer.indexOf('\n\n'); while (boundary >= 0) { const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); if (block.trim()) parseSseBlock(block, onEvent); boundary = buffer.indexOf('\n\n') } }
  buffer += decoder.decode(); if (buffer.trim()) parseSseBlock(buffer, onEvent)
}

export async function streamTeacherAiMessage(conversationId, data = {}, options = {}) {
  const response = await fetch(`${BASE_URL}/teacher/ai/conversations/${conversationId}/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) }, credentials: 'include', body: JSON.stringify(data), signal: options.signal })
  return consumeSse(response, options.onEvent)
}

// ========================
// 智能教案生成
// ========================

export function createLessonPlanTask(data) {
  return post('/teacher/lesson-plan/create-task', data)
}

export function getLessonPlanTask(taskId) {
  return get(`/teacher/lesson-plan/task/${taskId}`)
}

export function getLessonPlanKeywords(params = {}) {
  return get('/teacher/lesson-plan/keywords', { params })
}

export function getPreparationPlans(params = {}) { return get('/teacher/preparation/plans', { params }) }
export function createPreparationPlan(data) { return post('/teacher/preparation/plans', data) }
export function getPreparationPlan(id) { return get(`/teacher/preparation/plans/${id}`) }
export function savePreparationPlan(id, data) { return put(`/teacher/preparation/plans/${id}`, data) }
export function generatePreparationPlan(id, data = {}) { return post(`/teacher/preparation/plans/${id}/generate`, data) }
export function refinePreparationStage(id, data = {}) { return post(`/teacher/preparation/plans/${id}/refine-stage`, data) }
export function getPreparationStatus(id) { return get(`/teacher/preparation/plans/${id}/status`) }
export function getPreparationVersions(id) { return get(`/teacher/preparation/plans/${id}/versions`) }
export function comparePreparationVersions(id, from, to) { return get(`/teacher/preparation/plans/${id}/compare`, { params: { from, to } }) }
export function restorePreparationVersion(id, version) { return post(`/teacher/preparation/plans/${id}/versions/${version}/restore`, {}) }
export function publishPreparationPlan(id) { return post(`/teacher/preparation/plans/${id}/publish`, {}) }
export function exportPreparationPlan(id, format, artifactType) { return post(`/teacher/preparation/plans/${id}/export`, { format, ...(artifactType ? { artifact_type: artifactType } : {}) }) }
export async function streamPreparationEvents(id, options = {}) {
  const response = await fetch(`${BASE_URL}/teacher/preparation/plans/${id}/events`, { headers: { Accept: 'text/event-stream', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) }, credentials: 'include', signal: options.signal })
  return consumeSse(response, options.onEvent)
}

export function getEditableTeachingDocuments(params = {}) { return get('/teacher/preparation/documents', { params }) }
export function createEditableTeachingDocument(data) { return post('/teacher/preparation/documents', data) }
export function getEditableTeachingDocument(id) { return get(`/teacher/preparation/documents/${id}`) }
export function saveEditableTeachingDocument(id, data) { return put(`/teacher/preparation/documents/${id}/draft`, data) }
export function createEditableTeachingDocumentVersion(id, data = {}) { return post(`/teacher/preparation/documents/${id}/versions`, data) }
export function getEditableTeachingDocumentVersions(id) { return get(`/teacher/preparation/documents/${id}/versions`) }
export function getEditableTeachingDocumentVersion(id, versionId) { return get(`/teacher/preparation/documents/${id}/versions/${versionId}`) }
export function compareEditableTeachingDocumentVersions(id, from, to) { return get(`/teacher/preparation/documents/${id}/versions/compare`, { params: { from, to } }) }
export function restoreEditableTeachingDocumentVersion(id, versionId) { return post(`/teacher/preparation/documents/${id}/versions/${versionId}/restore`, {}) }
export function importPreparationDocument(file, data = {}) {
  const form = new FormData()
  if (file) form.append('file', file)
  Object.entries(data).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') form.append(key, value) })
  return upload('/teacher/preparation/documents/import', form)
}
export function importPreparationPlatformFile(data) { return post('/teacher/preparation/documents/import', data) }
export function getPreparationSelectableResources(params = {}) { return get('/teacher/preparation/resources/selectable', { params }) }
export function getPreparationResourceConversion(id) { return get(`/teacher/preparation/resources/${id}/conversion`) }
export function retryPreparationResourceConversion(id) { return post(`/teacher/preparation/resources/${id}/conversion/retry`) }
export function getTeacherReminders(params = {}) { return get('/teacher/reminders', { params }) }
export function createTeacherReminder(data) { return post('/teacher/reminders', data) }
export function updateTeacherReminder(id, data) { return put(`/teacher/reminders/${id}`, data) }
export function deleteTeacherReminder(id) { return del(`/teacher/reminders/${id}`) }
export function completeTeacherReminder(id) { return post(`/teacher/reminders/${id}/complete`) }
export function snoozeTeacherReminder(id, minutes = 10) { return post(`/teacher/reminders/${id}/snooze`, { minutes }) }
export function dismissTeacherReminder(id) { return post(`/teacher/reminders/${id}/dismiss`) }
export function checkTeacherRemindersDue() { return post('/teacher/reminders/check-due') }
export function reviseEditableTeachingDocument(id, data) { return post(`/teacher/preparation/documents/${id}/ai-revise`, data) }
export function syncEditableTeachingDocumentStage(id, data) { return post(`/teacher/preparation/documents/${id}/sync-stage`, data) }
export function exportEditableTeachingDocument(id, data) { return post(`/teacher/preparation/documents/${id}/export`, data) }
export function generateEditableStudentMaterial(id, data) { return post(`/teacher/preparation/documents/${id}/generate-student-material`, data) }
export async function fetchPreparationWorkspaceFile(sourceKind, id, options = {}) {
  const params = new URLSearchParams({ source_kind: sourceKind, id: String(id), ...(options.format ? { format: options.format } : {}), ...(options.download ? { download: '1' } : {}) })
  const response = await fetch(`${BASE_URL}/teacher/preparation/files/content?${params}`, { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, credentials: 'include' })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.error?.message || result?.message || '文件读取失败')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  let filename = options.fallbackName || 'workspace-file'
  try { filename = decodeURIComponent(encoded || filename) } catch {}
  return { blob: await response.blob(), filename, mimeType: response.headers.get('content-type') || '' }
}

export function getTeacherProfile() { return get('/teacher/profile') }

export function getTeacherArtifacts(params = {}) { return get('/teacher/artifacts', { params }) }
export function getTeacherArtifactDetail(sourceType, id) { return get(`/teacher/artifacts/${sourceType}/${id}`) }
export function renameTeacherArtifact(sourceType, id, title) { return patch(`/teacher/artifacts/${sourceType}/${id}`, { title }) }
export function batchTeacherArtifacts(action, items, payload = {}) { return post('/teacher/artifacts/batch', { action, items, payload }) }
export function updateTeacherProfile(data) { return patch('/teacher/profile', data) }
