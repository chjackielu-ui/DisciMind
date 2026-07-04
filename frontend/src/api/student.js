// 学生端接口封装
// 所有学生端 API 请求统一从此文件导出

import { get, post, patch, put, upload, del, BASE_URL } from './request.js'
import { getToken, clearAuth } from '../utils/auth.js'

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

export function startStudentTask(taskId, data = {}) {
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

export function saveStudentAnswers(submissionId, data = {}) {
  return put(`/student/task-submissions/${submissionId}/answers`, data)
}

/**
 * 提交答案并自动批改
 * @param {number} taskId
 * @param {object} data - { submission_id, answers }
 */
export function submitTask(taskId, data) {
  return post(`/student/tasks/${taskId}/submit`, data)
}

export function submitStudentTask(taskId, data) {
  return post(`/student/tasks/${taskId}/submit`, data)
}

/**
 * 查看提交详情
 * @param {number} submissionId
 */
export function getSubmission(submissionId) {
  return get(`/student/task-submissions/${submissionId}`)
}

export function getStudentSubmission(submissionId) {
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

async function practiceGet(path, params = {}) {
  const query = new URLSearchParams(params).toString()
  const suffix = `${path}${query ? '?' + query : ''}`
  try {
    return await get(`/practice${suffix}`)
  } catch (err) {
    if (/Cannot\s+GET\s+\/api\/practice/.test(err.message || '')) {
      return get(`/student/practice${suffix}`)
    }
    throw err
  }
}

async function practicePost(path, data = {}, options = {}) {
  try {
    return await post(`/practice${path}`, data, options)
  } catch (err) {
    if (/Cannot\s+POST\s+\/api\/practice/.test(err.message || '')) {
      return post(`/student/practice${path}`, data, options)
    }
    throw err
  }
}

// ========================
// 智能练习中心模块
// ========================

/**
 * 开始学生自主练习
 * @param {object} data - { subjectId, questionTypes, difficulty, questionCount, practiceMode, answerMode }
 * @param {object} options - { signal } AbortController signal for timeout
 */
export function startPractice(data = {}, options = {}) {
  const { signal, ...restData } = data
  return practicePost('/start', restData, signal ? { signal } : {})
}

/**
 * 提交学生自主练习
 * @param {object} data - { sessionId, answers, mode }
 */
export function submitPractice(data = {}) {
  return practicePost('/submit', data)
}

/**
 * 针对练习题目追问 AI
 * @param {number} questionId
 * @param {object} data - { sessionId, question }
 */
export function askPracticeQuestionAi(questionId, data = {}) {
  return practicePost(`/question/${questionId}/ask-ai`, data)
}

/**
 * 针对练习题目追问 AI — 流式返回
 * @param {number} questionId
 * @param {object} data - { sessionId, question }
 * @param {object} options - { signal, onDelta, onDone, onError, onMeta }
 */
export async function streamPracticeQuestionAi(questionId, data = {}, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${BASE_URL}/practice/question/${questionId}/ask-ai/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: options.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    // try fallback prefix
    try {
      response = await fetch(`${BASE_URL}/student/practice/question/${questionId}/ask-ai/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: options.signal,
      })
    } catch (err2) {
      if (err2.name === 'AbortError') throw err2
      throw new Error('网络请求失败，请检查网络连接或后端服务是否启动')
    }
  }

  if (!response.ok) {
    const result = await response.json().catch(() => null)
    if (result?.code === 40101 || result?.code === 40102) {
      clearAuth()
      window.location.hash = '#/login'
    }
    throw new Error(result?.message || `接口请求失败（HTTP ${response.status}）`)
  }

  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    buffer = buffer.replace(/\r\n/g, '\n')

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (block.trim()) {
        const lines = block.split('\n')
        let eventName = 'message'
        const dataLines = []
        lines.forEach(line => {
          if (line.startsWith('event:')) eventName = line.slice(6).trim() || 'message'
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        })
        if (dataLines.length) {
          const raw = dataLines.join('\n')
          let payload = raw
          try { payload = JSON.parse(raw) } catch { payload = { content: raw } }
          if (eventName === 'delta') options.onDelta?.(payload)
          else if (eventName === 'done') options.onDone?.(payload)
          else if (eventName === 'error') options.onError?.(payload)
          else if (eventName === 'meta') options.onMeta?.(payload)
          else if (eventName === 'status') { /* thinking status */ }
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}

/**
 * AI 生成题目解析
 * @param {number} questionId
 * @param {object} data - { sessionId }
 */
export function generatePracticeAnalysis(questionId, data = {}) {
  return practicePost(`/question/${questionId}/generate-analysis`, data)
}

/**
 * 获取自主练习错题本
 * @param {object} params - { page, page_size, subjectId, status }
 */
export function getPracticeWrongQuestions(params = {}) {
  return practiceGet('/wrong-questions', params)
}

/**
 * 标记自主练习错题为已掌握
 * @param {number} wrongQuestionId
 */
export function markPracticeWrongQuestionMastered(wrongQuestionId) {
  return practicePost(`/wrong-questions/${wrongQuestionId}/master`, {})
}

/**
 * 从错题生成相似题练习
 * @param {number} wrongQuestionId
 * @param {object} data - { questionCount, classId }
 */
export function startSimilarPractice(wrongQuestionId, data = {}) {
  return practicePost(`/wrong-questions/${wrongQuestionId}/similar`, data)
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

export function createChatConversation(data) {
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

export function getChatConversations(params = {}) {
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

export function sendChatMessage(conversationId, data) {
  return post(`/student/chat/conversations/${conversationId}/messages`, data)
}

/**
 * 获取会话消息列表
 * @param {number} conversationId
 */
export function getMessages(conversationId) {
  return get(`/student/chat/conversations/${conversationId}/messages`)
}

export function getChatMessages(conversationId) {
  return get(`/student/chat/conversations/${conversationId}/messages`)
}

/**
 * 删除会话
 * @param {number} conversationId
 */
export function deleteConversation(conversationId) {
  return del(`/student/chat/conversations/${conversationId}`)
}

export function deleteChatConversation(conversationId) {
  return del(`/student/chat/conversations/${conversationId}`)
}

// ========================
// 学科答疑小助手模块（DeepSeek 流式对话）
// ========================

export function createAiChatConversation(data = {}) {
  return post('/ai-chat/conversations', data)
}

export function getAiChatConversations(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/ai-chat/conversations${query ? '?' + query : ''}`)
}

export function getAiChatStarterQuestions(params = {}) {
  const query = new URLSearchParams(params).toString()
  return get(`/ai-chat/starter-questions${query ? '?' + query : ''}`)
}

export function getAiChatMessages(conversationId) {
  return get(`/ai-chat/conversations/${conversationId}/messages`)
}

export function sendAiChatMessage(conversationId, data = {}) {
  return post(`/ai-chat/conversations/${conversationId}/messages`, data)
}

export function clearAiChatMessages(conversationId) {
  return del(`/ai-chat/conversations/${conversationId}/messages`)
}

export function deleteAiChatConversation(conversationId) {
  return del(`/ai-chat/conversations/${conversationId}`)
}

function parseSseBlock(block, onEvent) {
  const lines = block.split('\n')
  let eventName = 'message'
  const dataLines = []

  lines.forEach((line) => {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message'
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  })

  if (!dataLines.length) return

  const raw = dataLines.join('\n')
  let payload = raw
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = { content: raw }
  }
  onEvent?.(eventName, payload)
}

export async function streamAiChatMessage(conversationId, data = {}, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${BASE_URL}/ai-chat/conversations/${conversationId}/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: options.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('网络请求失败，请检查网络连接或后端服务是否启动')
  }

  if (!response.ok) {
    const result = await response.json().catch(() => null)
    if (result?.code === 40101 || result?.code === 40102) {
      clearAuth()
      window.location.hash = '#/login'
    }
    const error = new Error(result?.message || `接口请求失败（HTTP ${response.status}）`)
    error.code = result?.code
    throw error
  }

  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    buffer = buffer.replace(/\r\n/g, '\n')

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (block.trim()) parseSseBlock(block, options.onEvent)
      boundary = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) parseSseBlock(buffer, options.onEvent)
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

export function uploadStudentDocument(formData) {
  return upload('/student/documents/upload', formData)
}

/**
 * 解析文档
 * @param {number} documentId
 */
export function parseDocument(documentId) {
  return post(`/student/documents/${documentId}/parse`)
}

export function parseStudentDocument(documentId) {
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

export function getStudentDocuments(params = {}) {
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

export function getStudentDocumentDetail(documentId) {
  return get(`/student/documents/${documentId}`)
}

/**
 * 删除文档
 * @param {number} documentId
 */
export function deleteDocument(documentId) {
  return del(`/student/documents/${documentId}`)
}

export function deleteStudentDocument(documentId) {
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

export function getStudentVideoRecommendations(params = {}) {
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

export function createVideoWatchRecord(videoId, data) {
  return post(`/student/videos/${videoId}/watch-record`, data)
}

/**
 * 搜索视频（按关键词检索，返回带 embed_url 的结果）
 * @param {object} data - { keyword, course_id, knowledge_point_id, limit }
 */
export function searchVideos(data = {}) {
  return post('/student/videos/search', data)
}
