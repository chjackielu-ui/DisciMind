// 前端 Hash 路由 — 支持动态路由匹配
// 包含路由守卫：未登录跳转登录页，已登录访问登录页自动跳转对应首页

import { isLoggedIn, getUser, initializeAuth, getAuthStatus, AUTH_STATUS } from './auth.js'
import { renderLoginPage } from '../pages/login.js'
import { renderRegisterPage } from '../pages/register.js'
import { renderStudentDashboard } from '../pages/student-dashboard.js'
import { renderStudentCourses } from '../pages/student-courses.js'
import { renderStudentCourseDetail } from '../pages/student-course-detail.js'
import { renderStudentWrongQuestions } from '../pages/student-wrong-questions.js'
import { renderStudentRecommendations } from '../pages/student-recommendations.js'
import { renderStudentPortrait } from '../pages/student-portrait.js'
import { renderStudentDiagnostician } from '../pages/student-diagnostician.js'
import { renderStudentProfile } from '../pages/student-profile.js'
import { renderStudentAiChat } from '../pages/student-ai-chat.js'
import { renderStudentPracticeCenter } from '../pages/student-practice-center.js'
import { renderStudentPracticeSession } from '../pages/student-practice-session.js'
import { renderStudentTrainerSession } from '../pages/student-trainer-session.js'
import { renderStudentTaskAnswer } from '../pages/student-task-answer.js'
import { renderStudentSubmissionResult } from '../pages/student-submission-result.js'
import { renderStudentDocuments } from '../pages/student-documents.js'
import { renderStudentVideos } from '../pages/student-videos.js'
import { renderStudentAgentDetail } from '../pages/agent/AgentDetailPage.js'
import { renderAgentMarket, renderMyAgents, renderFavoriteAgents, renderAgentDetail as renderMarketplaceAgentDetail } from '../pages/agent/AgentMarketPage.js'
import { renderAgentCreate, renderAgentEdit } from '../pages/agent/AgentCreatePage.js'
import { renderKnowledgeBases } from '../pages/agent/KnowledgeBasesPage.js'
import { renderAgentChat } from '../pages/agent/AgentChatPage.js'
import { renderGeneratedArtifacts, renderGeneratedArtifactDetail } from '../pages/agent/GeneratedArtifactsPage.js'
import { renderStudentLearningFlows } from '../pages/student-learning-flows.js'
import { renderStudentLearningFlowEditor } from '../pages/student-learning-flow-editor.js'
import { renderStudentLearningSession } from '../pages/student-learning-session.js'
import { renderStudentLearningSummary } from '../pages/student-learning-summary.js'
import { getActivePracticeAttempt } from '../api/student.js'
import { renderTeacherDashboard } from '../pages/teacher-dashboard.js'
import { renderTeacherCourses } from '../pages/teacher-courses.js'
import { renderTeacherCourseDetail } from '../pages/teacher-course-detail.js'
import { renderTeacherStudents } from '../pages/teacher-students.js'
import { renderTeacherStudentDetail } from '../pages/teacher-student-detail.js'
import { renderTeacherTasks } from '../pages/teacher-tasks.js'
import { renderTeacherTaskCreate } from '../pages/teacher-task-create.js'
import { renderTeacherTaskDetail } from '../pages/teacher-task-detail.js'
import { renderTeacherQuestions } from '../pages/teacher-questions.js'
import { renderTeacherQuestionCreate } from '../pages/teacher-question-create.js'
import { renderTeacherKnowledge } from '../pages/teacher-knowledge.js'
import { renderTeacherAnalytics } from '../pages/teacher-analytics.js'
import { renderTeacherProfile } from '../pages/teacher-profile.js'
import { renderAdminDashboard } from '../pages/admin-dashboard.js'
import { renderAdminUsers } from '../pages/admin-users.js'
import { renderAdminCourses } from '../pages/admin-courses.js'
import { renderAdminCourseDetail } from '../pages/admin-course-detail.js'
import { renderAdminClasses } from '../pages/admin-classes.js'
import { renderAdminKnowledge } from '../pages/admin-knowledge.js'
import { renderAdminLogs } from '../pages/admin-logs.js'
import { renderAdminNotifications } from '../pages/admin-notifications.js'
import { renderAdminAiConfig } from '../pages/admin-ai-config.js'
import { renderAdminProfile } from '../pages/admin-profile.js'
import { renderAdminAgentReviews } from '../pages/admin-agent-reviews.js'

// ============================================================
// 教师端页面导入区域（教师端开发者在此添加 import）
// ============================================================

// ============================================================
// 管理端页面导入区域（管理端开发者在此添加 import）
// ============================================================

// ========================
// 路由表定义
// ========================

// 静态路由（精确匹配）
const staticRoutes = {
  '/login': { render: renderLoginPage, auth: false },
  '/register': { render: renderRegisterPage, auth: false },
  '/student/dashboard': { render: renderStudentDashboard, auth: true, roles: ['student'] },
  '/student/courses': { render: renderStudentCourses, auth: true, roles: ['student'] },
  '/student/practice': { render: renderStudentPracticeCenter, auth: true, roles: ['student'] },
  '/student/trainer': { render: renderStudentTrainerSession, auth: true, roles: ['student'] },
  '/student/wrong-questions': { render: renderStudentWrongQuestions, auth: true, roles: ['student'] },
  '/student/recommendations': { render: renderStudentRecommendations, auth: true, roles: ['student'] },
  '/student/portrait': { render: renderStudentPortrait, auth: true, roles: ['student'] },
  '/student/diagnostician': { render: renderStudentDiagnostician, auth: true, roles: ['student'] },
  '/student/profile': { render: renderStudentProfile, auth: true, roles: ['student'] },
  '/student/ai-chat': { render: renderStudentAiChat, auth: true, roles: ['student'] },
  '/student/documents': { render: renderStudentDocuments, auth: true, roles: ['student'] },
  '/student/videos': { render: renderStudentVideos, auth: true, roles: ['student'] },
  '/student/agents/trainer': { render: renderStudentAgentDetail, auth: true, roles: ['student'] },
  '/student/agents': { render: renderAgentMarket, auth: true, roles: ['student'] },
  '/student/agents/mine': { render: renderMyAgents, auth: true, roles: ['student'] },
  '/student/agents/knowledge': { render: renderKnowledgeBases, auth: true, roles: ['student'] },
  '/student/agents/favorites': { render: renderFavoriteAgents, auth: true, roles: ['student'] },
  '/student/agents/create': { render: renderAgentCreate, auth: true, roles: ['student'] },
  '/student/generated-artifacts': { render: renderGeneratedArtifacts, auth: true, roles: ['student'] },
  '/student/learning-flows': { render: renderStudentLearningFlows, auth: true, roles: ['student'] },
  '/teacher/dashboard': { render: renderTeacherDashboard, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/courses': { render: renderTeacherCourses, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/students': { render: renderTeacherStudents, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/tasks': { render: renderTeacherTasks, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/tasks/create': { render: renderTeacherTaskCreate, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/questions': { render: renderTeacherQuestions, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/questions/create': { render: renderTeacherQuestionCreate, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/knowledge': { render: renderTeacherKnowledge, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/analytics': { render: renderTeacherAnalytics, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/profile': { render: renderTeacherProfile, auth: true, roles: ['teacher', 'admin'] },

  // ========== 教师端路由（教师端开发者在此区域添加）==========

  '/admin/dashboard': { render: renderAdminDashboard, auth: true, roles: ['admin'] },
  '/admin/users': { render: renderAdminUsers, auth: true, roles: ['admin'] },
  '/admin/courses': { render: renderAdminCourses, auth: true, roles: ['admin'] },
  '/admin/classes': { render: renderAdminClasses, auth: true, roles: ['admin'] },
  '/admin/knowledge': { render: renderAdminKnowledge, auth: true, roles: ['admin'] },
  '/admin/logs': { render: renderAdminLogs, auth: true, roles: ['admin'] },
  '/admin/notifications': { render: renderAdminNotifications, auth: true, roles: ['admin'] },
  '/admin/ai-config': { render: renderAdminAiConfig, auth: true, roles: ['admin'] },
  '/admin/profile': { render: renderAdminProfile, auth: true, roles: ['admin'] },
  '/admin/agent-reviews': { render: renderAdminAgentReviews, auth: true, roles: ['admin'] },

  // ========== 管理端路由（管理端开发者在此区域添加）==========
}

// 动态路由（正则匹配）
const dynamicRoutes = [
  {
    pattern: /^\/student\/generated-artifacts\/(\d+)$/,
    render: renderGeneratedArtifactDetail,
    auth: true,
    roles: ['student'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/detail$/,
    render: renderMarketplaceAgentDetail,
    auth: true,
    roles: ['student'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/edit$/,
    render: renderAgentEdit,
    auth: true,
    roles: ['student'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/chat\/(\d+)$/,
    render: renderAgentChat,
    auth: true,
    roles: ['student'],
    paramNames: ['id', 'conversationId'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/chat$/,
    render: renderAgentChat,
    auth: true,
    roles: ['student'],
    paramNames: ['id'],
  },
  {
    // #/student/practice/sessions/:practice_session_id
    pattern: /^\/student\/practice\/sessions\/(\d+)$/,
    render: renderStudentPracticeSession,
    auth: true,
    roles: ['student'],
    paramNames: ['practice_session_id'],
  },
  {
    // #/student/trainer/sessions/:session_id
    pattern: /^\/student\/trainer\/sessions\/(\d+)$/,
    render: renderStudentTrainerSession,
    auth: true,
    roles: ['student'],
    paramNames: ['session_id'],
  },
  {
    // #/student/courses/:course_id
    pattern: /^\/student\/courses\/(\d+)$/,
    render: renderStudentCourseDetail,
    auth: true,
    roles: ['student'],
    paramNames: ['course_id'],
  },
  {
    // #/student/tasks/:task_id/answer
    pattern: /^\/student\/tasks\/(\d+)\/answer$/,
    render: renderStudentTaskAnswer,
    auth: true,
    roles: ['student'],
    paramNames: ['task_id'],
  },
  {
    // #/student/submissions/:submission_id/result
    pattern: /^\/student\/submissions\/(\d+)\/result$/,
    render: renderStudentSubmissionResult,
    auth: true,
    roles: ['student'],
    paramNames: ['submission_id'],
  },
  {
    // #/student/knowledge-points/:kp_id (预留)
    pattern: /^\/student\/knowledge-points\/(\d+)$/,
    render: () => {
      // 暂未实现独立知识点详情页，跳转到课程列表
      window.location.hash = '#/student/courses'
    },
    auth: true,
    roles: ['student'],
    paramNames: ['kp_id'],
  },
  {
    // #/student/learning-flow/editor/:workflowId
    pattern: /^\/student\/learning-flow\/editor\/(.+)$/,
    render: renderStudentLearningFlowEditor,
    auth: true,
    roles: ['student'],
    paramNames: ['workflowId'],
  },
  {
    // #/student/learning/session/:sessionId
    pattern: /^\/student\/learning\/session\/(\d+)$/,
    render: renderStudentLearningSession,
    auth: true,
    roles: ['student'],
    paramNames: ['sessionId'],
  },
  {
    // #/student/learning/session/:sessionId/summary
    pattern: /^\/student\/learning\/session\/(\d+)\/summary$/,
    render: renderStudentLearningSummary,
    auth: true,
    roles: ['student'],
    paramNames: ['sessionId'],
  },
  // ========== 教师端动态路由 ==========
  {
    // #/teacher/courses/:course_id
    pattern: /^\/teacher\/courses\/(\d+)$/,
    render: renderTeacherCourseDetail,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['course_id'],
  },
  {
    // #/teacher/students/:student_user_id
    pattern: /^\/teacher\/students\/(\d+)$/,
    render: renderTeacherStudentDetail,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['student_user_id'],
  },
  {
    // #/teacher/tasks/:task_id
    pattern: /^\/teacher\/tasks\/(\d+)$/,
    render: renderTeacherTaskDetail,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['task_id'],
  },
  {
    // #/teacher/tasks/:task_id/edit
    pattern: /^\/teacher\/tasks\/(\d+)\/edit$/,
    render: renderTeacherTaskCreate,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['task_id'],
  },
  {
    // #/teacher/questions/:question_id
    pattern: /^\/teacher\/questions\/(\d+)$/,
    render: renderTeacherQuestionCreate,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['question_id'],
  },
  // ========== 管理端动态路由 ==========
  {
    // #/admin/courses/:course_id
    pattern: /^\/admin\/courses\/(\d+)$/,
    render: renderAdminCourseDetail,
    auth: true,
    roles: ['admin'],
    paramNames: ['course_id'],
  },
]

// 角色 → 默认首页路由
const ROLE_HOME = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

function getCurrentPath() {
  const raw = window.location.hash.slice(1) || '/login'
  return raw.split('?')[0] || '/login'
}

function isPracticeSessionPath(path, attemptId) {
  const expected = `/student/practice/sessions/${attemptId}`
  return path === expected
}

async function guardActiveExam(path, user) {
  if (user?.role !== 'student') return false
  if (!path.startsWith('/student/')) return false
  try {
    const result = await getActivePracticeAttempt()
    const data = result.data || {}
    if (!data.hasActiveAttempt) return false

    // 只有 forceResume 为 true 时才强制重定向
    // 普通练习不强制恢复
    if (data.forceResume !== true) return false

    const attemptId = data.attemptId || data.attempt?.practice_session_id || data.session?.practice_session_id
    if (!attemptId) return false
    if (isPracticeSessionPath(path, attemptId)) return false

    // 同时匹配任务答题路由
    if (isTaskAnswerPath(path)) return false

    window.location.hash = `#/student/practice/sessions/${attemptId}`
    return true
  } catch {
    return false
  }
}

function isTaskAnswerPath(path) {
  return /^\/student\/tasks\/\d+\/answer$/.test(path)
}

function matchRoute(path) {
  // 先尝试精确匹配
  if (staticRoutes[path]) {
    return { route: staticRoutes[path], params: {} }
  }

  // 再尝试动态匹配
  for (const dr of dynamicRoutes) {
    const match = path.match(dr.pattern)
    if (match) {
      const params = {}
      const names = dr.paramNames || ['id']
      names.forEach((name, idx) => { params[name] = match[idx + 1] })
      return { route: dr, params }
    }
  }

  return null
}

let renderSeq = 0

function buildAuthCheckingHTML() {
  return `
    <div class="complex-shell">
      <div class="complex-loading">
        <div class="complex-spinner"></div>
        <p>正在检查登录状态...</p>
      </div>
    </div>`
}

async function render() {
  const seq = ++renderSeq
  const app = document.getElementById('app')
  if (!app) return

  if (getAuthStatus() === AUTH_STATUS.INITIALIZING) {
    app.innerHTML = buildAuthCheckingHTML()
    await initializeAuth()
    if (seq !== renderSeq) return
  }

  const path = getCurrentPath()
  const matched = matchRoute(path)

  // 路由不存在 → 跳转到合适的默认页
  if (!matched) {
    if (isLoggedIn()) {
      const user = getUser()
      const home = ROLE_HOME[user?.role] || '/login'
      window.location.hash = `#${home}`
    } else {
      window.location.hash = '#/login'
    }
    return
  }

  const { route, params } = matched

  // 需要登录但未登录 → 跳转登录页
  if (route.auth && !isLoggedIn()) {
    window.location.hash = '#/login'
    return
  }

  // 已登录但访问登录/注册页 → 跳转对应首页
  if (!route.auth && isLoggedIn()) {
    const user = getUser()
    const home = ROLE_HOME[user?.role]
    if (home) {
      window.location.hash = `#${home}`
      return
    }
  }

  // 角色权限检查
  if (route.roles && isLoggedIn()) {
    const user = getUser()
    if (!route.roles.includes(user?.role)) {
      const home = ROLE_HOME[user?.role] || '/login'
      window.location.hash = `#${home}`
      return
    }
  }

  if (route.auth && isLoggedIn()) {
    const redirected = await guardActiveExam(path, getUser())
    if (redirected) return
  }

  // 渲染页面
  app.innerHTML = ''
  route.render(app, params)
}

export function initRouter() {
  window.addEventListener('hashchange', render)
  render()
}

export function navigateTo(hash) {
  window.location.hash = hash
}
