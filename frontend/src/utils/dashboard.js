// Dashboard 共享布局 — 悬浮式左侧导航栏 + 主内容区
// v2: 统一 SVG 图标、优化对齐、菜单 hash 导航

import { clearAuth, getUserDisplayName } from './auth.js'
import { iconHome, iconBook, iconAlert, iconStar, iconUser, iconMessage, iconPin, iconPinFilled, iconLogout } from './icons.js'

const ROLE_LABEL = { admin: '管理员', teacher: '教师', student: '学生' }
const API_ORIGIN = 'http://localhost:3000'

// 图标名 → 图标函数映射
const ICON_MAP = { home: iconHome, book: iconBook, alert: iconAlert, star: iconStar, user: iconUser, message: iconMessage }

let sidebarExpanded = true
let sidebarPinned = false
let isHoveringSidebar = false
let collapseTimer = null
let autoCollapseTimer = null

export function renderDashboardLayout(app, config) {
  const { menuItems, contentHTML, user } = config
  const displayName = getUserDisplayName()
  const roleLabel = ROLE_LABEL[user.role] || user.role
  const avatarUrl = getAvatarUrl(user)

  sidebarExpanded = true
  sidebarPinned = false
  isHoveringSidebar = false
  if (collapseTimer) clearTimeout(collapseTimer)
  if (autoCollapseTimer) clearTimeout(autoCollapseTimer)

  // 构建菜单 HTML（使用 SVG 图标）
  const currentHash = window.location.hash.slice(1) || ''
  const menuHTML = menuItems.map((item, index) => {
    const iconFn = ICON_MAP[item.icon] || iconHome
    const iconSVG = typeof iconFn === 'function' ? iconFn() : iconHome()
    // 精确匹配：优先使用 item.matchHash 函数，否则精确比较 hash
    let isActive = false
    if (typeof item.matchHash === 'function') {
      isActive = item.matchHash(currentHash)
    } else if (item.hash) {
      const itemPath = item.hash.startsWith('#') ? item.hash.slice(1) : item.hash
      isActive = currentHash === itemPath
    }
    return `
      <div class="sidebar-menu-item${isActive ? ' active' : ''}" data-hash="${item.hash || ''}">
        <span class="sidebar-menu-icon">${iconSVG}</span>
        <span class="sidebar-menu-text">${item.label}</span>
        <span class="menu-tooltip">${item.label}</span>
      </div>`
  }).join('')

  const roleClass = user?.role === 'teacher' ? ' role-teacher' : user?.role === 'admin' ? ' role-admin' : ''

  app.innerHTML = `
    <div class="student-dashboard-wrapper${roleClass}">
      <nav class="student-sidebar expanded" id="student-sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-brand-mark">
            <img src="/logo.png" alt="DisciMind" />
          </div>
          <div class="sidebar-brand-text">
            <span class="sidebar-brand-cn">学研智擎</span>
            <span class="sidebar-brand-en">DisciMind</span>
          </div>
        </div>

        <div class="sidebar-menu-wrap" id="sidebar-menu-wrap">${menuHTML}</div>

        <div class="sidebar-footer">
          <button class="sidebar-pin-btn" id="sidebar-pin-btn" title="固定展开">
            <span class="pin-icon-svg">${iconPin()}</span>
            <span class="pin-text">固定展开</span>
          </button>
          <div class="sidebar-user-info" id="sidebar-user-info" title="个人主页">
            <div class="sidebar-user-avatar">
              ${avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" />`
                : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>`}
            </div>
            <div class="sidebar-user-detail">
              <span class="sidebar-user-name">${escapeHtml(displayName)}</span>
              <span class="sidebar-user-role">${roleLabel}</span>
            </div>
          </div>
          <button class="sidebar-logout-btn" id="btn-logout" title="退出登录">
            <span class="logout-icon-svg">${iconLogout()}</span>
            <span class="logout-text">退出登录</span>
          </button>
        </div>
      </nav>

      <main class="student-main" id="student-main">${contentHTML}</main>
    </div>
  `

  // 侧边栏交互
  const sidebar = document.getElementById('student-sidebar')
  const pinBtn = document.getElementById('sidebar-pin-btn')

  function expandSidebar() {
    if (!sidebar) return
    sidebar.classList.remove('collapsed'); sidebar.classList.add('expanded')
    sidebarExpanded = true
    updateWrapperState()
  }
  function collapseSidebar() {
    if (!sidebar) return
    if (sidebarPinned || isHoveringSidebar) return
    sidebar.classList.remove('expanded'); sidebar.classList.add('collapsed')
    sidebarExpanded = false
    updateWrapperState()
  }

  // 同步 wrapper 状态类，让主内容区根据侧边栏状态避让
  function updateWrapperState() {
    const wrapper = document.querySelector('.student-dashboard-wrapper')
    if (!wrapper) return
    if (sidebarExpanded || sidebarPinned) {
      wrapper.classList.add('sidebar-expanded')
      wrapper.classList.remove('sidebar-collapsed')
    } else {
      wrapper.classList.add('sidebar-collapsed')
      wrapper.classList.remove('sidebar-expanded')
    }
  }
  // 初始设置
  updateWrapperState()

  if (sidebar) {
    sidebar.addEventListener('mouseenter', () => { isHoveringSidebar = true; if (collapseTimer) clearTimeout(collapseTimer); expandSidebar() })
    sidebar.addEventListener('mouseleave', () => { isHoveringSidebar = false; collapseTimer = setTimeout(collapseSidebar, 600) })
  }

  if (pinBtn) {
    pinBtn.addEventListener('click', () => {
      sidebarPinned = !sidebarPinned
      if (sidebarPinned) { pinBtn.classList.add('pinned'); pinBtn.querySelector('.pin-icon-svg').innerHTML = iconPinFilled(); expandSidebar() }
      else { pinBtn.classList.remove('pinned'); pinBtn.querySelector('.pin-icon-svg').innerHTML = iconPin(); if (!isHoveringSidebar) { clearTimeout(collapseTimer); collapseTimer = setTimeout(collapseSidebar, 400) } }
      updateWrapperState()
    })
  }

  let scrollTicking = false
  window.addEventListener('scroll', () => {
    if (!scrollTicking) { window.requestAnimationFrame(() => { if (!isHoveringSidebar && !sidebarPinned && sidebarExpanded) collapseSidebar(); scrollTicking = false }); scrollTicking = true }
  }, { passive: true })

  window.addEventListener('resize', () => { if (window.innerWidth <= 768 && sidebarExpanded && !sidebarPinned && !isHoveringSidebar) collapseSidebar() }, { passive: true })

  autoCollapseTimer = setTimeout(() => { if (!isHoveringSidebar && !sidebarPinned) collapseSidebar() }, 2500)

  // 退出
  document.getElementById('btn-logout')?.addEventListener('click', () => { clearAuth(); window.location.hash = '#/login' })

  // 用户信息入口
  document.getElementById('sidebar-user-info')?.addEventListener('click', () => {
    if (user.role === 'student') window.location.hash = '#/student/profile'
  })

  // 菜单点击
  document.querySelectorAll('.sidebar-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-menu-item').forEach(i => i.classList.remove('active'))
      item.classList.add('active')
      const hash = item.dataset.hash
      if (hash) window.location.hash = hash
    })
  })
}

function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

function getAvatarUrl(user) {
  const url = user?.profile?.avatar_url || user?.avatar_url
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  return `${API_ORIGIN}${url.startsWith('/') ? url : '/' + url}`
}
