// 学生端接口封装
// 所有学生端 API 请求统一从此文件导出

import { get, post, patch, put, upload, del, BASE_URL } from './request.js'
import { getToken, clearAuth, refreshAuthSession } from '../utils/auth.js'

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

export function getStudentSharedResources(params = {}) {
  return get('/student/resources', { params })
}

export function openStudentSharedResource(recipientId) {
  return post(`/student/resources/${recipientId}/open`, {})
}

export function completeStudentSharedResource(recipientId) {
  return post(`/student/resources/${recipientId}/complete`, {})
}

export async function downloadStudentSharedResource(recipientId, fallbackName = '教学资源') {
  const token = getToken()
  const response = await fetch(`${BASE_URL}/student/resources/${recipientId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include', redirect: 'follow',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error?.message || payload.message || '资源下载失败')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)
  const name = matched ? decodeURIComponent(matched[1].replace(/\"/g, '')) : fallbackName
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 获取课程详情
 * @param {number} courseId
 */
export function getStudentCourseDetail(courseId) {
  return get(`/student/courses/${courseId}`)
}

export function getStudentCourseSyllabus(courseId) {
  return get(`/student/courses/${courseId}/syllabus`)
}

export function setStudentCoursePin(courseId, pinned) {
  return post(`/student/courses/${courseId}/pin`, { pinned: Boolean(pinned) })
}

export function activateStudentCourse(courseId) {
  return post(`/student/courses/${courseId}/activate`, {})
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
 * 获取学生知识图谱课程总览
 */
export function getStudentKnowledgeGraph() {
  return get('/student/knowledge-graph')
}

/**
 * 获取单门课程知识图谱（节点、边、掌握度与学习建议）
 * @param {number} courseId
 */
export function getStudentCourseKnowledgeGraph(courseId) {
  return get(`/student/courses/${courseId}/knowledge-graph`)
}

/**
 * 获取课程知识点掌握等级分布
 * @param {number} courseId
 */
export function getCourseMasteryDistribution(courseId) {
  return get(`/student/courses/${courseId}/mastery-distribution`)
}

/**
 * 获取课程能力画像（6维度雷达图数据）
 * @param {number} courseId
 */
export function getCourseAbilityProfile(courseId) {
  return get(`/student/courses/${courseId}/ability-profile`)
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

/**
 * 获取学生画像 PDF 报告聚合数据
 */
export function getStudentPortraitReport() {
  return get('/student/portrait/report')
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

/**
 * 使用统一 attempt 体系开始教师任务答题
 * @param {number} taskId
 */
export function startTaskAttempt(taskId) {
  return post(`/student/tasks/${taskId}/attempt`)
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
    if (/Cannot\s+(GET|POST|PUT|PATCH|DELETE)\s+\/api\/practice/.test(err.message || '')) {
      try {
        return await get(`/student/practice${suffix}`)
      } catch (_fallbackErr) {
        // 两条路径都失败，抛出主路径错误
        throw err
      }
    }
    throw err
  }
}

async function practicePost(path, data = {}, options = {}) {
  try {
    return await post(`/practice${path}`, data, options)
  } catch (err) {
    if (/Cannot\s+(POST|GET|PUT|PATCH|DELETE)\s+\/api\/practice/.test(err.message || '')) {
      try {
        return await post(`/student/practice${path}`, data, options)
      } catch (_fallbackErr) {
        // 两条路径都失败，抛出主路径错误
        throw err
      }
    }
    throw err
  }
}

async function practicePut(path, data = {}, options = {}) {
  try {
    return await put(`/practice${path}`, data, options)
  } catch (err) {
    if (/Cannot\s+PUT\s+\/api\/practice/.test(err.message || '')) {
      return put(`/student/practice${path}`, data, options)
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

export function getActivePracticeAttempt() {
  return practiceGet('/active')
}

export function getPracticeSessions(params = {}) {
  return practiceGet('/sessions', params)
}

export function getPracticeSessionDetail(sessionId) {
  return practiceGet(`/sessions/${sessionId}`)
}

export function abandonPracticeSession(sessionId) {
  return practicePost(`/sessions/${sessionId}/abandon`, {})
}

export function savePracticeItemAnswer(sessionId, itemId, data = {}) {
  return practicePut(`/sessions/${sessionId}/items/${itemId}/answer`, data)
}

export function submitPracticeItem(sessionId, itemId, data = {}) {
  return practicePost(`/sessions/${sessionId}/items/${itemId}/submit`, data)
}

export function submitPracticeSession(sessionId, data = {}) {
  return practicePost(`/sessions/${sessionId}/submit`, data)
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
      credentials: 'include',
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
        credentials: 'include',
      })
    } catch (err2) {
      if (err2.name === 'AbortError') throw err2
      throw new Error('网络请求失败，请检查网络连接或后端服务是否启动')
    }
  }

  if (!response.ok) {
    const result = await response.json().catch(() => null)
    if (result?.code === 40101 || result?.code === 40102) {
      if (!options._retryAuth) {
        await refreshAuthSession()
        return streamPracticeQuestionAi(questionId, data, { ...options, _retryAuth: true })
      }
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
// 错题本升级接口
// ========================

/**
 * 获取错题概览统计
 * @param {object} params - { courseId }
 */
export function getWrongQuestionOverview(params = {}) {
  return practiceGet('/wrong-questions/overview', params)
}

/**
 * 获取错题分类树（课程→章节→知识点）
 * @param {object} params - { courseId }
 */
export function getWrongQuestionTaxonomy(params = {}) {
  return practiceGet('/wrong-questions/taxonomy', params)
}

/**
 * 多条件查询错题列表
 * @param {object} params - { courseId, chapterId, knowledgePointId, wrongReason, reviewStatus, questionType, difficulty, tags, collectionId, sort, page, pageSize, search }
 */
export function queryWrongQuestions(params = {}) {
  return practiceGet('/wrong-questions', params)
}

/**
 * 获取单条错题详情
 * @param {number} wrongQuestionId
 */
export function getWrongQuestionDetail(wrongQuestionId) {
  return practiceGet(`/wrong-questions/${wrongQuestionId}`)
}

/**
 * 更新单条错题
 * @param {number} wrongQuestionId
 * @param {object} data - { wrongReason, wrongReasonSource, reviewStatus, status }
 */
export function updateWrongQuestion(wrongQuestionId, data = {}) {
  return requestPatch(`/practice/wrong-questions/${wrongQuestionId}`, data)
}

/**
 * 批量更新错题
 * @param {object} data - { ids: number[], reviewStatus?, wrongReason? }
 */
export function batchUpdateWrongQuestions(data = {}) {
  return requestPatch('/practice/wrong-questions/batch', data)
}

// --- 标签管理 ---

/**
 * 获取用户标签列表
 */
export function getWrongQuestionTags() {
  return practiceGet('/wrong-questions/tags')
}

/**
 * 创建标签
 * @param {object} data - { name, color }
 */
export function createWrongQuestionTag(data = {}) {
  return practicePost('/wrong-questions/tags', data)
}

/**
 * 更新标签
 * @param {number} tagId
 * @param {object} data - { name, color }
 */
export function updateWrongQuestionTag(tagId, data = {}) {
  return requestPut(`/practice/wrong-questions/tags/${tagId}`, data)
}

/**
 * 删除标签
 * @param {number} tagId
 */
export function deleteWrongQuestionTag(tagId) {
  return requestDel(`/practice/wrong-questions/tags/${tagId}`)
}

/**
 * 给错题添加标签
 * @param {number} wrongQuestionId
 * @param {number} tagId
 */
export function addTagToWrongQuestion(wrongQuestionId, tagId) {
  return practicePost(`/wrong-questions/${wrongQuestionId}/tags`, { tagId })
}

/**
 * 移除错题的标签
 * @param {number} wrongQuestionId
 * @param {number} tagId
 */
export function removeTagFromWrongQuestion(wrongQuestionId, tagId) {
  return requestDel(`/practice/wrong-questions/${wrongQuestionId}/tags/${tagId}`)
}

// --- 错题系列 ---

/**
 * 获取错题系列列表
 */
export function getWrongQuestionCollections() {
  return practiceGet('/wrong-questions/collections')
}

/**
 * 获取错题系列详情
 * @param {number} collectionId
 */
export function getWrongQuestionCollectionDetail(collectionId) {
  return practiceGet(`/wrong-questions/collections/${collectionId}`)
}

/**
 * 创建错题系列
 * @param {object} data - { name, description, wrongQuestionIds }
 */
export function createWrongQuestionCollection(data = {}) {
  return practicePost('/wrong-questions/collections', data)
}

/**
 * 更新错题系列
 * @param {number} collectionId
 * @param {object} data - { name, description }
 */
export function updateWrongQuestionCollection(collectionId, data = {}) {
  return requestPut(`/practice/wrong-questions/collections/${collectionId}`, data)
}

/**
 * 删除错题系列
 * @param {number} collectionId
 */
export function deleteWrongQuestionCollection(collectionId) {
  return requestDel(`/practice/wrong-questions/collections/${collectionId}`)
}

// --- AI 生成任务 ---

/**
 * 创建 AI 生成任务
 * @param {object} data - { mode, sourceQuestions, count, difficulty, sourceType }
 */
export function createAiGenerationJob(data = {}) {
  return practicePost('/wrong-questions/ai-generation', data)
}

/**
 * 查询 AI 生成任务状态
 * @param {number} jobId
 */
export function getAiGenerationJob(jobId) {
  return practiceGet(`/wrong-questions/ai-generation/${jobId}`)
}

/**
 * 重试 AI 生成任务失败部分
 * @param {number} jobId
 */
export function retryAiGenerationJob(jobId) {
  return practicePost(`/wrong-questions/ai-generation/${jobId}/retry`)
}

/**
 * 取消 AI 生成任务
 * @param {number} jobId
 */
export function cancelAiGenerationJob(jobId) {
  return practicePost(`/wrong-questions/ai-generation/${jobId}/cancel`)
}

/**
 * 从错题创建练习（原题顺序/打乱重做）
 * @param {object} data - { wrongQuestionIds, practiceMode: 'ORIGINAL_ORDER'|'ORIGINAL_SHUFFLE', answerMode }
 */
export function startWrongQuestionPractice(data = {}) {
  return practicePost('/wrong-questions/start-practice', data)
}

async function requestPatch(path, data = {}) {
  try {
    return await patch(path, data)
  } catch (err) {
    if (/Cannot\s+PATCH/.test(err.message || '')) {
      return patch(`/student${path.replace('/practice', '')}`, data)
    }
    throw err
  }
}

async function requestPut(path, data = {}) {
  try {
    return await put(path, data)
  } catch (err) {
    if (/Cannot\s+PUT/.test(err.message || '')) {
      return put(`/student${path.replace('/practice', '')}`, data)
    }
    throw err
  }
}

async function requestDel(path, data = {}) {
  try {
    return await del(path, data)
  } catch (err) {
    if (/Cannot\s+DELETE/.test(err.message || '')) {
      return del(`/student${path.replace('/practice', '')}`, data)
    }
    throw err
  }
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
// 学科答疑小助手模块（百炼 qwen3.7-plus 多模态流式对话）
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

export function uploadAiChatAttachment(file, conversationId = null) {
  const form = new FormData()
  form.append('file', file)
  if (conversationId) form.append('conversationId', String(conversationId))
  return upload('/ai-chat/attachments', form)
}

export function renameAiChatConversation(conversationId, title) {
  return patch(`/ai-chat/conversations/${conversationId}`, { title })
}

export function bulkManageAiChatConversations(data = {}) {
  return post('/ai-chat/conversations/bulk', data)
}

export function createSubjectChatRun(conversationId, data = {}) {
  return post('/ai-chat/subject-chat/runs', { ...data, conversationId })
}

export function getSubjectChatRun(runId) {
  return get(`/ai-chat/subject-chat/runs/${encodeURIComponent(runId)}`)
}

export function getLatestSubjectChatRun(conversationId) {
  return get(`/ai-chat/subject-chat/conversations/${conversationId}/runs/latest`)
}

export function getSubjectChatRunEvents(runId, after = 0) {
  return get(`/ai-chat/subject-chat/runs/${encodeURIComponent(runId)}/events?after=${Math.max(0, Number(after) || 0)}`)
}

export function cancelSubjectChatRun(runId) {
  return post(`/ai-chat/subject-chat/runs/${encodeURIComponent(runId)}/cancel`, {})
}

export function retrySubjectChatTask(runId, taskId) {
  return post(`/ai-chat/subject-chat/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/retry`, {})
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
      credentials: 'include',
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('网络请求失败，请检查网络连接或后端服务是否启动')
  }

  if (!response.ok) {
    const result = await response.json().catch(() => null)
    if (result?.code === 40101 || result?.code === 40102) {
      if (!options._retryAuth) {
        await refreshAuthSession()
        return streamAiChatMessage(conversationId, data, { ...options, _retryAuth: true })
      }
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

// 使用 fetch 订阅 GET SSE，以便继续携带现有 JWT；服务端事件均有持久化序号，
// 页面刷新或网络重连时可通过 after 从上次事件继续恢复。
export async function streamSubjectChatRun(runId, options = {}) {
  const token = getToken()
  const after = Math.max(0, Number(options.after) || 0)
  let response
  try {
    response = await fetch(`${BASE_URL}/ai-chat/subject-chat/runs/${encodeURIComponent(runId)}/stream?after=${after}`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: options.signal,
      credentials: 'include',
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('运行事件连接失败，请检查网络连接')
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    if ((result?.code === 40101 || result?.code === 40102) && !options._retryAuth) {
      await refreshAuthSession()
      return streamSubjectChatRun(runId, { ...options, _retryAuth: true })
    }
    const error = new Error(result?.message || `运行事件连接失败（HTTP ${response.status}）`)
    error.code = result?.code
    throw error
  }
  if (!String(response.headers.get('content-type') || '').includes('text/event-stream') || !response.body) {
    throw new Error('运行事件响应格式异常')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (block.trim() && !block.trimStart().startsWith(':')) parseSseBlock(block, options.onEvent)
      boundary = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.trim() && !buffer.trimStart().startsWith(':')) parseSseBlock(buffer, options.onEvent)
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

export async function downloadStudentDocument(documentId, fallbackName = '学习资料') {
  const token = getToken()
  const response = await fetch(`${BASE_URL}/student/documents/${documentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include', redirect: 'follow',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error?.message || payload.message || '文档下载失败')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)
  const name = matched ? decodeURIComponent(matched[1].replace(/\"/g, '')) : fallbackName
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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

// ========================
// 学习PPT与Remotion视频生成
// ========================

export function generateStudentCoursePpt(courseId, data = {}) {
  return post(`/student/courses/${courseId}/ppt/generate`, data)
}

export function getStudentPptTask(taskId) {
  return get(`/student/ppt/tasks/${taskId}`)
}

export function createStudentVideoGenerationTask(data = {}) {
  return post('/student/videos/generation-tasks', data)
}

export function createStudentKnowledgeResourcePackage(courseId, knowledgePointId, data = {}) {
  return post(`/student/courses/${courseId}/knowledge-points/${knowledgePointId}/resource-packages`, data)
}

export function getStudentKnowledgeResourcePackage(taskId) {
  return get(`/student/resource-packages/${taskId}`)
}

export function retryStudentKnowledgeResourcePackage(taskId, data = {}) {
  return post(`/student/resource-packages/${taskId}/retry`, data)
}

export function getStudentVideoGenerationTask(taskId) {
  return get(`/student/videos/generation-tasks/${taskId}`)
}

export async function fetchStudentGeneratedMedia(pathname) {
  const response = await fetch(`${BASE_URL}${pathname.replace(/^\/api/, '')}`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    credentials: 'include',
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.message || `媒体文件读取失败（HTTP ${response.status}）`)
  }
  return response.blob()
}

export function uploadStudentGeneratedVideo(taskId, blob, fileName = 'learning-video.mp4') {
  const form = new FormData()
  form.append('video', blob, fileName)
  return upload(`/student/videos/generation-tasks/${taskId}/complete`, form)
}

export async function downloadStudentPptArtifact(artifactId, fallbackName = '学习课件.pptx') {
  const blob = await fetchStudentGeneratedMedia(`/api/generated-artifacts/${artifactId}/download`)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fallbackName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
