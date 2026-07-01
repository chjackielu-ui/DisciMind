// 学生端接口封装
// 所有学生端 API 请求统一从此文件导出

import { get, post, patch, put, upload, del } from './request.js'

/**
 * 获取学生首页仪表盘综合数据
 */
export function getStudentDashboard() {
  return get('/student/dashboard')
}

/**
 * 获取学生已加入的课程列表
 */
export function getStudentCourses() {
  return get('/student/courses')
}

/**
 * 获取课程详情
 * @param {number} courseId
 */
export function getStudentCourseDetail(courseId) {
  return get(`/student/courses/${courseId}`)
}

/**
 * 获取课程章节列表
 * @param {number} courseId
 */
export function getStudentCourseChapters(courseId) {
  return get(`/student/courses/${courseId}/chapters`)
}

/**
 * 获取课程知识点列表（含学生掌握度）
 * @param {number} courseId
 */
export function getStudentCourseKnowledgePoints(courseId) {
  return get(`/student/courses/${courseId}/knowledge-points`)
}

/**
 * 获取知识点详情
 * @param {number} knowledgePointId
 */
export function getKnowledgePointDetail(knowledgePointId) {
  return get(`/student/knowledge-points/${knowledgePointId}`)
}

/**
 * 获取学习任务列表
 * @param {object} params - { page, page_size, task_type, status, course_id }
 */
export function getStudentTasks(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/student/tasks${query ? '?' + query : ''}`)
}

/**
 * 获取学习任务详情
 * @param {number} taskId
 */
export function getStudentTaskDetail(taskId) {
  return get(`/student/tasks/${taskId}`)
}

/**
 * 获取错题本列表
 * @param {object} params - { page, page_size, course_id, knowledge_point_id, status }
 */
export function getStudentWrongQuestions(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/student/wrong-questions${query ? '?' + query : ''}`)
}

/**
 * 更新错题状态
 * @param {number} wrongQuestionId
 * @param {string} status - unresolved / mastered / removed
 */
export function updateWrongQuestionStatus(wrongQuestionId, status) {
  return patch(`/student/wrong-questions/${wrongQuestionId}/status`, { status })
}

/**
 * 获取推荐内容列表
 * @param {object} params - { page, page_size, recommend_type }
 */
export function getStudentRecommendations(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/student/recommendations${query ? '?' + query : ''}`)
}

/**
 * 获取学习记录列表
 * @param {object} params - { page, page_size, course_id, knowledge_point_id, action_type }
 */
export function getStudentStudyRecords(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/student/study-records${query ? '?' + query : ''}`)
}

/**
 * 新增学习记录
 * @param {object} data - { course_id, knowledge_point_id, action_type, duration_seconds }
 */
export function createStudyRecord(data) {
  return post('/student/study-records', data)
}

/**
 * 获取学生画像
 */
export function getStudentPortrait() {
  return get('/student/portrait')
}

// ========================
// 在线答题模块
// ========================

/**
 * 开始答题
 * @param {number} taskId
 * @param {object} data - { mode }
 */
export function startQuiz(taskId, data = {}) {
  return post(`/student/tasks/${taskId}/start`, data)
}

/**
 * 保存答案草稿
 * @param {number} submissionId
 * @param {Array} answers - [{ question_id, answer_content }]
 */
export function saveAnswers(submissionId, answers) {
  return put(`/student/task-submissions/${submissionId}/answers`, { answers })
}

/**
 * 提交答案并自动批改
 * @param {number} taskId
 * @param {object} data - { submission_id, answers }
 */
export function submitTask(taskId, data) {
  return post(`/student/tasks/${taskId}/submit`, data)
}

/**
 * 查看提交详情
 * @param {number} submissionId
 */
export function getSubmission(submissionId) {
  return get(`/student/task-submissions/${submissionId}`)
}

/**
 * 查看题目解析
 * @param {number} questionId
 * @param {number} submissionId - 可选
 */
export function getQuestionAnalysis(questionId, submissionId) {
  const query = submissionId ? `?submission_id=${submissionId}` : ''
  return get(`/student/questions/${questionId}/analysis${query}`)
}

// ========================
// AI 问答模块
// ========================

/**
 * 创建 AI 会话
 * @param {object} data - { course_id, title, agent_type }
 */
export function createConversation(data) {
  return post('/student/chat/conversations', data)
}

/**
 * 获取 AI 会话列表
 * @param {object} params - { page, page_size, course_id }
 */
export function listConversations(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/student/chat/conversations${query ? '?' + query : ''}`)
}

/**
 * 发送消息并获取 AI 回答
 * @param {number} conversationId
 * @param {object} data - { content, knowledge_point_id }
 */
export function sendMessage(conversationId, data) {
  return post(`/student/chat/conversations/${conversationId}/messages`, data)
}

/**
 * 获取会话消息列表
 * @param {number} conversationId
 */
export function getMessages(conversationId) {
  return get(`/student/chat/conversations/${conversationId}/messages`)
}

/**
 * 删除会话
 * @param {number} conversationId
 */
export function deleteConversation(conversationId) {
  return del(`/student/chat/conversations/${conversationId}`)
}

// ========================
// 知识库文档模块
// ========================

/**
 * 上传文档
 * @param {FormData} formData - 包含 file, course_id, knowledge_point_id, visibility, title
 */
export function uploadDocument(formData) {
  return upload('/student/documents/upload', formData)
}

/**
 * 解析文档
 * @param {number} documentId
 */
export function parseDocument(documentId) {
  return post(`/student/documents/${documentId}/parse`)
}

/**
 * 获取文档列表
 * @param {object} params - { page, page_size, course_id, review_status, parse_status }
 */
export function listDocuments(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/student/documents${query ? '?' + query : ''}`)
}

/**
 * 获取文档详情
 * @param {number} documentId
 */
export function getDocument(documentId) {
  return get(`/student/documents/${documentId}`)
}

/**
 * 删除文档
 * @param {number} documentId
 */
export function deleteDocument(documentId) {
  return del(`/student/documents/${documentId}`)
}

// ========================
// 视频推荐模块
// ========================

/**
 * 获取视频推荐
 * @param {object} params - { course_id, knowledge_point_id }
 */
export function getVideoRecommendations(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/student/videos/recommendations${query ? '?' + query : ''}`)
}

/**
 * 获取知识点视频
 * @param {number} knowledgePointId
 */
export function getKnowledgePointVideos(knowledgePointId) {
  return get(`/student/knowledge-points/${knowledgePointId}/videos`)
}

/**
 * 记录视频学习行为
 * @param {number} videoId
 * @param {object} data - { course_id, knowledge_point_id, watch_duration_seconds, is_finished }
 */
export function recordWatch(videoId, data) {
  return post(`/student/videos/${videoId}/watch-record`, data)
}
