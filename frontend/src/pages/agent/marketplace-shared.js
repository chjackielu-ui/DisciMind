import { getUser } from '../../utils/auth.js'
import { renderDashboardLayout } from '../../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../../utils/student-menu.js'
import { escapeHtml } from '../../utils/format.js'

export const MARKET_TABS = [
  ['发现智能体', '#/student/agents'], ['我的智能体', '#/student/agents/mine'],
  ['我的知识库', '#/student/agents/knowledge'], ['我的收藏', '#/student/agents/favorites'],
  ['产物', '#/student/artifacts'], ['创建智能体', '#/student/agents/create'],
]

export function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function marketplaceTabs(active) {
  return `<nav class="agent-market-tabs">${MARKET_TABS.map(([label, hash]) => `<a class="${active === hash ? 'active' : ''}" href="${hash}">${label}</a>`).join('')}</nav>`
}

export function renderMarketplaceLayout(app, contentHTML, active = '#/student/agents') {
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, user: getUser(), contentHTML: `<div class="agent-market-shell">${marketplaceTabs(active)}${contentHTML}</div>` })
}

export function loadingHTML(text = '正在加载...') {
  return `<div class="agent-market-empty"><span class="agent-spinner"></span><p>${escapeHtml(text)}</p></div>`
}

export function errorHTML(message) {
  return `<div class="agent-market-empty is-error"><p>${escapeHtml(message)}</p><button class="complex-btn-secondary" type="button" data-retry>重试</button></div>`
}

export function statusLabel(status) {
  return ({ PRIVATE: '仅自己可用', PUBLIC_PENDING: '等待审核', PUBLIC: '已公开', REJECTED: '审核未通过', OFFLINE: '已下架', DRAFT: '草稿', EMPTY: '等待上传', UPLOADING: '正在上传', PARSING: '正在解析', INDEXING: '正在生成索引', READY: '可以使用', FAILED: '处理失败' })[status] || status || '未知'
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
