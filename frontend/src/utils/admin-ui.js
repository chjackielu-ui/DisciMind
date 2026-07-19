import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getToken } from './auth.js'
import { renderDashboardLayout } from './dashboard.js'
import { ADMIN_MENU_ITEMS } from './admin-menu.js'
import { escapeHtml } from './format.js'
import { getIcon } from './icons.js'
import { showToast } from './toast.js'

export async function requireAdminUser() {
  let user = getUser()
  try {
    const result = await getMe(); user = result.data.user; setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return null }
  }
  return user
}

export function renderAdminPage(app, { user, title, contentHTML }) {
  renderDashboardLayout(app, { user, title, menuItems: ADMIN_MENU_ITEMS, contentHTML })
}

export function notifyAdmin(message, error = false) {
  showToast(message, error ? 'error' : 'success', 3600)
}

export function setBusy(button, busy, label = '处理中') {
  if (!button) return
  if (!button.dataset.label) button.dataset.label = button.textContent
  button.disabled = busy; button.classList.toggle('is-loading', busy); button.textContent = busy ? label : button.dataset.label
}

export function formatMetric(value, kind) {
  if (value == null) return '数据不足'
  if (kind === 'percent') return `${(Number(value) * 100).toFixed(1)}%`
  if (kind === 'score') return Number(value).toFixed(1)
  if (kind === 'duration') return `${Math.round(Number(value))} 秒`
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : escapeHtml(value)
}

export function statusBadge(status) {
  const value = String(status || 'unknown').toLowerCase()
  const success = ['active', 'available', 'success', 'completed', 'published', 'approved', 'operational', 'resolved', 'enabled'].includes(value)
  const danger = ['failed', 'unavailable', 'critical', 'disabled', 'rejected', 'error'].includes(value)
  const warning = ['pending', 'draft', 'warning', 'degraded', 'running', 'open', 'unchecked'].includes(value)
  return `<span class="admin-badge ${success ? 'is-success' : danger ? 'is-danger' : warning ? 'is-warning' : 'is-info'}">${escapeHtml(status || '未知')}</span>`
}

function dialogRoot(className, body) {
  const root = document.createElement('div'); root.className = className; root.innerHTML = body; document.body.appendChild(root)
  const close = () => root.remove(); root.addEventListener('click', (event) => { if (event.target === root) close() })
  root.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', close))
  return { root, close }
}

export function openAdminDrawer({ title, content, onSubmit, submitLabel = '保存' }) {
  const dialog = dialogRoot('admin-drawer-backdrop', `<aside class="admin-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header class="admin-drawer-header"><div><h3>${escapeHtml(title)}</h3></div><button class="admin-icon-button" type="button" data-dialog-close aria-label="关闭">${getIcon('alert')}</button></header><form id="admin-dialog-form">${content}<footer class="admin-dialog-footer"><button class="admin-button is-secondary" type="button" data-dialog-close>取消</button><button class="admin-button" type="submit">${escapeHtml(submitLabel)}</button></footer></form></aside>`)
  const form = dialog.root.querySelector('form'); form.addEventListener('submit', async (event) => { event.preventDefault(); const button = form.querySelector('[type="submit"]'); setBusy(button, true); try { const shouldClose = await onSubmit(new FormData(form), form); if (shouldClose !== false) dialog.close() } catch (error) { notifyAdmin(error.message, true); setBusy(button, false) } })
  form.querySelector('input,select,textarea')?.focus(); return dialog
}

export function confirmAdmin({ title = '确认操作', message, confirmLabel = '确认', danger = false }) {
  return new Promise((resolve) => {
    const dialog = dialogRoot('admin-modal-backdrop', `<div class="admin-modal" role="alertdialog" aria-modal="true"><header class="admin-modal-header"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div></header><footer class="admin-dialog-footer"><button class="admin-button is-secondary" type="button" data-dialog-close>取消</button><button class="admin-button${danger ? ' is-danger' : ''}" type="button" data-confirm>${escapeHtml(confirmLabel)}</button></footer></div>`)
    let settled = false
    dialog.root.querySelector('[data-confirm]').addEventListener('click', () => { settled = true; dialog.close(); resolve(true) })
    dialog.root.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => { if (!settled) resolve(false) }))
    dialog.root.addEventListener('click', (event) => { if (event.target === dialog.root && !settled) resolve(false) })
  })
}

export function promptAdmin({ title = '填写信息', label, placeholder = '', required = true, multiline = true, submitLabel = '确认' }) {
  return new Promise((resolve) => {
    const control = multiline
      ? `<textarea class="admin-textarea" name="value" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}></textarea>`
      : `<input class="admin-input" name="value" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}>`
    const dialog = dialogRoot('admin-modal-backdrop', `<div class="admin-modal" role="dialog" aria-modal="true"><header class="admin-modal-header"><div><h3>${escapeHtml(title)}</h3></div></header><form><div class="admin-field"><label>${escapeHtml(label)}</label>${control}</div><footer class="admin-dialog-footer"><button class="admin-button is-secondary" type="button" data-dialog-close>取消</button><button class="admin-button" type="submit">${escapeHtml(submitLabel)}</button></footer></form></div>`)
    let settled = false
    const finish = (value) => { if (settled) return; settled = true; dialog.close(); resolve(value) }
    dialog.root.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get('value') || '').trim(); if (required && !value) return; finish(value) })
    dialog.root.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => finish(null)))
    dialog.root.addEventListener('click', (event) => { if (event.target === dialog.root) finish(null) })
    dialog.root.querySelector('[name="value"]')?.focus()
  })
}

export function parseJsonField(value, label = 'JSON') {
  const text = String(value || '').trim(); if (!text) return {}
  try { const parsed = JSON.parse(text); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed } catch { throw new Error(`${label} 必须是合法的 JSON 对象`) }
}

export function emptyHTML(title = '暂无数据', description = '当前筛选条件下没有可展示的真实记录。') {
  return `<div class="admin-empty">${getIcon('document')}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div></div>`
}

export { escapeHtml, getIcon }
