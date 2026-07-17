let portal = null
let trigger = null
let actions = []

function close() {
  portal?.remove(); portal = null; trigger = null; actions = []
}

function place() {
  if (!portal || !trigger?.isConnected) return close()
  const rect = trigger.getBoundingClientRect(); const width = Math.min(220, innerWidth - 24)
  portal.style.width = `${width}px`
  const height = portal.offsetHeight || 180
  const left = Math.max(12, Math.min(innerWidth - width - 12, rect.right - width))
  const top = rect.bottom + height + 12 <= innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)
  portal.style.left = `${left}px`; portal.style.top = `${top}px`
}

export function openAgentCardMenu(button, items, onAction) {
  close(); trigger = button; actions = items
  portal = document.createElement('div'); portal.className = 'agent-card-menu-portal'; portal.setAttribute('role', 'menu')
  portal.innerHTML = items.map(item => `<button type="button" role="menuitem" data-menu-action="${item.action}" class="${item.danger ? 'is-danger' : ''}" ${item.disabled ? 'disabled' : ''}>${item.label}</button>`).join('')
  document.body.appendChild(portal); place()
  portal.onclick = event => { const action = event.target.closest('[data-menu-action]')?.dataset.menuAction; if (!action) return; close(); onAction(action) }
}

document.addEventListener('pointerdown', event => { if (portal && !portal.contains(event.target) && event.target !== trigger) close() }, true)
document.addEventListener('keydown', event => { if (event.key === 'Escape') close() })
window.addEventListener('scroll', close, { passive: true, capture: true })
window.addEventListener('resize', close, { passive: true })
window.addEventListener('hashchange', close)

export { close as closeAgentCardMenu }
