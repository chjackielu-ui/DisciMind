// Dashboard 共享布局 — 为三端首页提供统一的顶部导航 + 侧边栏 + 主内容区布局

import { clearAuth, getUserDisplayName } from './auth.js'

// 角色中文映射
const ROLE_LABEL = {
  admin: '管理员',
  teacher: '教师',
  student: '学生',
}

/**
 * 渲染统一的 Dashboard 布局
 * @param {HTMLElement} app - 挂载容器
 * @param {object} config
 * @param {string} config.title - 页面标题（如"学生学习中心"）
 * @param {Array<{label: string, icon?: string}>} config.menuItems - 侧边栏菜单项
 * @param {string} config.contentHTML - 主内容区 HTML
 * @param {object} config.user - 当前用户对象
 */
export function renderDashboardLayout(app, config) {
  const { title, menuItems, contentHTML, user } = config

  const displayName = getUserDisplayName()
  const roleLabel = ROLE_LABEL[user.role] || user.role

  // 构建侧边栏菜单 HTML
  const menuHTML = menuItems
    .map(
      (item, index) =>
        `<li class="menu-item${index === 0 ? ' active' : ''}" data-index="${index}">
          ${item.icon ? `<span class="menu-icon">${item.icon}</span>` : ''}
          <span>${item.label}</span>
        </li>`
    )
    .join('')

  app.innerHTML = `
    <div class="dashboard-layout">
      <!-- 顶部导航栏 -->
      <header class="topbar">
        <div class="topbar-left">
          <span class="topbar-logo">📚 学研智擎 DisciMind</span>
        </div>
        <div class="topbar-center">
          <span class="topbar-title">${title}</span>
        </div>
        <div class="topbar-right">
          <span class="user-display-name">👤 ${displayName}</span>
          <span class="user-role-tag">${roleLabel}</span>
          <button class="btn-logout" id="btn-logout">退出登录</button>
        </div>
      </header>

      <!-- 左侧侧边栏 -->
      <aside class="sidebar">
        <nav class="sidebar-nav">
          <ul class="sidebar-menu">
            ${menuHTML}
          </ul>
        </nav>
      </aside>

      <!-- 主内容区 -->
      <main class="main-content">
        ${contentHTML}
      </main>
    </div>
  `

  // 绑定退出登录
  document.getElementById('btn-logout').addEventListener('click', () => {
    clearAuth()
    window.location.hash = '#/login'
  })

  // 绑定侧边栏菜单点击（切换高亮）
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach((i) => i.classList.remove('active'))
      item.classList.add('active')
    })
  })
}
