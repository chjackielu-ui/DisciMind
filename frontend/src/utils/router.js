// 前端 Hash 路由 — 支持动态路由匹配
// 包含路由守卫：未登录跳转登录页，已登录访问登录页自动跳转对应首页

import { isLoggedIn, getUser } from './auth.js'
import { renderLoginPage } from '../pages/login.js'
import { renderRegisterPage } from '../pages/register.js'
import { renderStudentDashboard } from '../pages/student-dashboard.js'
import { renderStudentCourses } from '../pages/student-courses.js'
import { renderStudentCourseDetail } from '../pages/student-course-detail.js'
import { renderStudentWrongQuestions } from '../pages/student-wrong-questions.js'
import { renderStudentRecommendations } from '../pages/student-recommendations.js'
import { renderStudentPortrait } from '../pages/student-portrait.js'
import { renderStudentProfile } from '../pages/student-profile.js'
import { renderStudentAiChat } from '../pages/student-ai-chat.js'
import { renderStudentPracticeCenter } from '../pages/student-practice-center.js'
import { renderStudentPracticeSession } from '../pages/student-practice-session.js'
import { renderStudentTaskAnswer } from '../pages/student-task-answer.js'
import { renderStudentSubmissionResult } from '../pages/student-submission-result.js'
import { renderStudentDocuments } from '../pages/student-documents.js'
import { renderStudentVideos } from '../pages/student-videos.js'
import { renderTeacherDashboard } from '../pages/teacher-dashboard.js'
import { renderAdminDashboard } from '../pages/admin-dashboard.js'

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
  '/student/wrong-questions': { render: renderStudentWrongQuestions, auth: true, roles: ['student'] },
  '/student/recommendations': { render: renderStudentRecommendations, auth: true, roles: ['student'] },
  '/student/portrait': { render: renderStudentPortrait, auth: true, roles: ['student'] },
  '/student/profile': { render: renderStudentProfile, auth: true, roles: ['student'] },
  '/student/ai-chat': { render: renderStudentAiChat, auth: true, roles: ['student'] },
  '/student/documents': { render: renderStudentDocuments, auth: true, roles: ['student'] },
  '/student/videos': { render: renderStudentVideos, auth: true, roles: ['student'] },
  '/teacher/dashboard': { render: renderTeacherDashboard, auth: true, roles: ['teacher'] },

  // ========== 教师端路由（教师端开发者在此区域添加）==========

  '/admin/dashboard': { render: renderAdminDashboard, auth: true, roles: ['admin'] },

  // ========== 管理端路由（管理端开发者在此区域添加）==========
}

// 动态路由（正则匹配）
const dynamicRoutes = [
  {
    // #/student/practice/sessions/:practice_session_id
    pattern: /^\/student\/practice\/sessions\/(\d+)$/,
    render: renderStudentPracticeSession,
    auth: true,
    roles: ['student'],
    paramNames: ['practice_session_id'],
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
]

// 角色 → 默认首页路由
const ROLE_HOME = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

function getCurrentPath() {
  return window.location.hash.slice(1) || '/login'
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

function render() {
  const app = document.getElementById('app')
  if (!app) return

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
