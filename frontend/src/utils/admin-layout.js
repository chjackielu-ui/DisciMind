import { getUserDisplayName, logoutSession } from './auth.js'
import { getIcon, iconLogout } from './icons.js'

const COLLAPSED_KEY = 'discimind.admin.sidebar.collapsed'
const GROUPS_KEY = 'discimind.admin.sidebar.groups'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function pathOf(hash) { return String(hash || '').replace(/^#/, '').split('?')[0] }

function loadGroups() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}') } catch { return {} }
}

export function renderAdminLayout(app, config) {
  document.body.classList.remove('admin-mobile-nav-lock')
  const { menuItems = [], contentHTML = '', user = {}, title = '管理中枢' } = config
  const current = pathOf(window.location.hash)
  const collapsed = localStorage.getItem(COLLAPSED_KEY) === '1'
  const groupState = loadGroups()
  const activeGroup = menuItems.find((group) => group.children?.some((item) => item.match ? item.match.test(current) : pathOf(item.hash) === current))?.id

  const groupsHtml = menuItems.map((group) => {
    const open = groupState[group.id] !== false || group.id === activeGroup
    return `<section class="admin-nav-group${open ? ' is-open' : ''}" data-admin-group="${escapeHtml(group.id)}">
      <button type="button" class="admin-nav-group-toggle" aria-expanded="${open}">
        <span class="admin-nav-icon">${getIcon(group.icon)}</span><span class="admin-nav-group-label">${escapeHtml(group.label)}</span>
        <svg class="admin-nav-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="admin-nav-tooltip">${escapeHtml(group.label)}</span>
      </button>
      <div class="admin-nav-children">${(group.children || []).map((item) => {
        const active = item.match ? item.match.test(current) : pathOf(item.hash) === current
        return `<a class="admin-nav-link${active ? ' is-active' : ''}" href="${escapeHtml(item.hash)}" title="${escapeHtml(item.label)}">
          <span class="admin-nav-icon">${getIcon(item.icon || group.icon)}</span><span class="admin-nav-link-label">${escapeHtml(item.label)}</span><span class="admin-nav-tooltip">${escapeHtml(item.label)}</span>
        </a>`
      }).join('')}</div>
    </section>`
  }).join('')

  app.innerHTML = `<div class="admin-app${collapsed ? ' is-sidebar-collapsed' : ''}">
    <aside class="admin-sidebar" id="admin-sidebar" aria-label="管理端主导航">
      <div class="admin-brand"><img src="/logo.png" alt="DisciMind"/><div><strong>学研智擎</strong><span>DisciMind Console</span></div></div>
      <nav class="admin-nav">${groupsHtml}</nav>
      <div class="admin-sidebar-footer">
        <a class="admin-account" href="#/admin/profile"><span class="admin-avatar">${getIcon('user')}</span><span><strong>${escapeHtml(getUserDisplayName())}</strong><small>平台管理员</small></span></a>
        <button type="button" class="admin-logout" id="admin-logout">${iconLogout()}<span>退出登录</span></button>
      </div>
    </aside>
    <div class="admin-workspace">
      <header class="admin-topbar">
        <div class="admin-topbar-left"><button type="button" class="admin-icon-button admin-mobile-menu" id="admin-mobile-menu" aria-label="打开导航">${getIcon('layout')}</button><button type="button" class="admin-icon-button admin-collapse-button" id="admin-collapse" aria-label="切换侧栏">${getIcon('layout')}</button><div><span class="admin-topbar-kicker">DisciMind 管理中枢</span><h1>${escapeHtml(title)}</h1></div></div>
        <div class="admin-topbar-actions"><span class="admin-system-indicator"><i></i>真实数据模式</span><button type="button" class="admin-icon-button" id="admin-refresh-page" aria-label="刷新页面">${getIcon('refresh')}</button></div>
      </header>
      <main class="admin-main" id="admin-main">${contentHTML}</main>
    </div>
    <button type="button" class="admin-sidebar-scrim" id="admin-sidebar-scrim" aria-label="关闭导航"></button>
    <div class="admin-toast-region" id="admin-toast-container" aria-live="polite"></div>
  </div>`

  const root = app.querySelector('.admin-app')
  const setMobileNav = (open) => {
    root.classList.toggle('is-mobile-nav-open', open)
    document.body.classList.toggle('admin-mobile-nav-lock', open)
  }
  app.querySelector('#admin-collapse')?.addEventListener('click', () => {
    root.classList.toggle('is-sidebar-collapsed')
    localStorage.setItem(COLLAPSED_KEY, root.classList.contains('is-sidebar-collapsed') ? '1' : '0')
    window.dispatchEvent(new Event('resize'))
  })
  app.querySelector('#admin-mobile-menu')?.addEventListener('click', () => setMobileNav(true))
  app.querySelector('#admin-sidebar-scrim')?.addEventListener('click', () => setMobileNav(false))
  app.querySelectorAll('.admin-nav-link').forEach((link) => link.addEventListener('click', () => setMobileNav(false)))
  app.querySelectorAll('[data-admin-group]').forEach((section) => section.querySelector('.admin-nav-group-toggle')?.addEventListener('click', () => {
    section.classList.toggle('is-open')
    section.querySelector('.admin-nav-group-toggle').setAttribute('aria-expanded', String(section.classList.contains('is-open')))
    const state = loadGroups(); state[section.dataset.adminGroup] = section.classList.contains('is-open'); localStorage.setItem(GROUPS_KEY, JSON.stringify(state))
  }))
  app.querySelector('#admin-refresh-page')?.addEventListener('click', () => window.dispatchEvent(new HashChangeEvent('hashchange')))
  app.querySelector('#admin-logout')?.addEventListener('click', async () => { await logoutSession(); window.location.hash = '#/login' })
}
