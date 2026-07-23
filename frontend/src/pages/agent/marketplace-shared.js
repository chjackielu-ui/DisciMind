import { getUser } from '../../utils/auth.js'
import { renderDashboardLayout } from '../../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../../utils/student-menu.js'
import { TEACHER_MENU_ITEMS } from '../../utils/teacher-menu.js'
import { escapeHtml } from '../../utils/format.js'
import { safeRandomId } from '../../utils/random-id.js'

export const MARKET_TABS = [
  ['发现智能体', '/agents'], ['我的智能体', '/agents/mine'],
  ['我的知识库', '/agents/knowledge'], ['我的收藏', '/agents/favorites'],
  ['任务中心', '/agent-tasks'], ['产物', '/artifacts'], ['创建智能体', '/agents/create'],
]

export function operationId() {
  return safeRandomId('market')
}

export function marketplaceRoleBase() {
  return ['teacher', 'admin'].includes(String(getUser()?.role || '').toLowerCase()) ? '/teacher' : '/student'
}

export function marketplaceHash(path = '') {
  const clean = String(path).replace(/^#?\/(student|teacher)/, '').replace(/^\//, '')
  return `#${marketplaceRoleBase()}/${clean}`
}

export function marketplaceTabs(active) {
  const activeHash = marketplaceHash(active)
  return `<nav class="agent-market-tabs" aria-label="智能体广场功能导航">${MARKET_TABS.map(([label, path]) => { const hash = marketplaceHash(path); return `<a class="${activeHash === hash ? 'active' : ''}" href="${hash}">${label}</a>` }).join('')}</nav>`
}

let marketplaceRoleLifecycle = null
let marketplaceRoleObserver = null

function teacherMarketplaceHash(value) {
  const hash = String(value || '')
  if (marketplaceRoleBase() !== '/teacher') return hash
  return hash
    .replace(/^#\/student\/agents/, '#/teacher/agents')
    .replace(/^#\/student\/artifacts/, '#/teacher/artifacts')
    .replace(/^#\/student\/agent-tasks/, '#/teacher/agent-tasks')
}

function rewriteMarketplaceLinks(root) {
  if (marketplaceRoleBase() !== '/teacher') return
  root.querySelectorAll?.('a[href^="#/student/agents"],a[href^="#/student/artifacts"],a[href^="#/student/agent-tasks"]').forEach(link => {
    const translated = teacherMarketplaceHash(link.getAttribute('href'))
    if (translated) link.setAttribute('href', translated)
  })
}

function installMarketplaceRoleRouting(app) {
  marketplaceRoleLifecycle?.abort()
  marketplaceRoleObserver?.disconnect()
  rewriteMarketplaceLinks(app)
  if (marketplaceRoleBase() !== '/teacher') return
  marketplaceRoleLifecycle = new AbortController()
  marketplaceRoleObserver = new MutationObserver(() => rewriteMarketplaceLinks(app))
  marketplaceRoleObserver.observe(app, { childList: true, subtree: true })
  window.addEventListener('hashchange', () => {
    const translated = teacherMarketplaceHash(window.location.hash)
    if (translated !== window.location.hash) {
      window.location.hash = translated
      return
    }
    if (!/^#\/teacher\/(?:agents|artifacts|agent-tasks)/.test(window.location.hash)) {
      marketplaceRoleObserver?.disconnect()
      marketplaceRoleLifecycle?.abort()
    }
  }, { signal: marketplaceRoleLifecycle.signal })
}

export function renderMarketplaceLayout(app, contentHTML, active = '#/student/agents') {
  const teacher = marketplaceRoleBase() === '/teacher'
  const roleContent = teacher ? String(contentHTML).replaceAll('#/student/', '#/teacher/') : contentHTML
  renderDashboardLayout(app, { menuItems: teacher ? TEACHER_MENU_ITEMS : STUDENT_MENU_ITEMS, user: getUser(), contentHTML: `<div class="agent-market-shell">${marketplaceTabs(active)}${roleContent}</div>` })
  installMarketplaceRoleRouting(app)
}

export function loadingHTML(text = '正在加载...') {
  return `<div class="agent-market-empty"><span class="agent-spinner"></span><p>${escapeHtml(text)}</p></div>`
}

export function errorHTML(message) {
  return `<div class="agent-market-empty is-error"><p>${escapeHtml(message)}</p><button class="complex-btn-secondary" type="button" data-retry>重试</button></div>`
}

export function statusLabel(status) {
  return ({ PRIVATE: '仅自己可用', PUBLIC_PENDING: '等待审核', PUBLIC: '已公开', REJECTED: '审核未通过', OFFLINE: '已下架', DRAFT: '草稿', EMPTY: '等待上传', UPLOADED: '已上传', UPLOADING: '正在上传', PARSING: '正在解析', PARSED: '解析完成', CHUNKING: '正在分片', CHUNKED: '分片完成', INDEXING: '正在生成索引', PROCESSING: '处理中', PARTIAL: '部分可用', READY: '可以使用', AVAILABLE: '可以使用', CANCELLED: '已取消', FAILED: '处理失败' })[status] || status || '未知'
}

export function setButtonBusy(button, busy, text = '处理中...') {
  if (!button) return
  if (busy) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = text }
  else { button.disabled = false; button.textContent = button.dataset.originalText || button.textContent }
}

export function notify(message, error = false) {
  const toast = document.createElement('div')
  toast.className = `agent-toast${error ? ' is-error' : ''}`
  toast.textContent = message
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 2800)
}
