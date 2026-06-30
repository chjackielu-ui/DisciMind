// 前端 Hash 路由 — 根据 location.hash 渲染不同页面
// 包含路由守卫：未登录跳转登录页，已登录访问登录页自动跳转对应首页

import { isLoggedIn, getUser } from './auth.js'
import { renderLoginPage } from '../pages/login.js'
import { renderRegisterPage } from '../pages/register.js'
import { renderStudentDashboard } from '../pages/student-dashboard.js'
import { renderTeacherDashboard } from '../pages/teacher-dashboard.js'
import { renderAdminDashboard } from '../pages/admin-dashboard.js'

// 路由表：路径 → { render, auth, roles }
const routes = {
  '/login': { render: renderLoginPage, auth: false },
  '/register': { render: renderRegisterPage, auth: false },
  '/student/dashboard': { render: renderStudentDashboard, auth: true, roles: ['student'] },
  '/teacher/dashboard': { render: renderTeacherDashboard, auth: true, roles: ['teacher'] },
  '/admin/dashboard': { render: renderAdminDashboard, auth: true, roles: ['admin'] },
}

// 角色 → 默认首页路由
const ROLE_HOME = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

function getCurrentPath() {
  return window.location.hash.slice(1) || '/login'
}

function render() {
  const app = document.getElementById('app')
  if (!app) return

  const path = getCurrentPath()
  const route = routes[path]

  // 路由不存在 → 跳转到合适的默认页
  if (!route) {
    if (isLoggedIn()) {
      const user = getUser()
      const home = ROLE_HOME[user?.role] || '/login'
      window.location.hash = `#${home}`
    } else {
      window.location.hash = '#/login'
    }
    return
  }

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

  // 角色权限检查：登录用户访问了不属于自己角色的 dashboard
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
  route.render(app)
}

export function initRouter() {
  window.addEventListener('hashchange', render)
  render()
}

export function navigateTo(hash) {
  window.location.hash = hash
}
