import { escapeHtml } from '../utils/format.js'

export const AGENT_ICON_KEYS = Object.freeze([
  'book-open', 'book', 'graduation-cap', 'lecture', 'exam', 'clipboard-check', 'knowledge', 'library',
  'search', 'file-search', 'pen-tool', 'writing', 'code', 'terminal', 'database', 'chart-bar',
  'chart-line', 'analytics', 'calculator', 'flask', 'microscope', 'brain', 'workflow', 'calendar-plan',
  'target', 'lightbulb', 'translate', 'presentation',
])

export const AGENT_ICON_COLORS = Object.freeze([
  ['#2563EB', '#EFF6FF'], ['#0F766E', '#F0FDFA'], ['#7C3AED', '#F5F3FF'], ['#C2410C', '#FFF7ED'],
  ['#BE123C', '#FFF1F2'], ['#0369A1', '#F0F9FF'], ['#4D7C0F', '#F7FEE7'], ['#475569', '#F8FAFC'],
])

const PATHS = Object.freeze({
  'book-open': '<path d="M3.5 5.5c3-1.2 5.7-.7 8.5 1.2v13c-2.8-1.9-5.5-2.4-8.5-1.2z"/><path d="M20.5 5.5c-3-1.2-5.7-.7-8.5 1.2v13c2.8-1.9 5.5-2.4 8.5-1.2z"/>',
  book: '<path d="M5 3.5h12a2 2 0 0 1 2 2v15H7a2 2 0 0 1-2-2z"/><path d="M5 17.5a2.5 2.5 0 0 1 2.5-2.5H19"/>',
  'graduation-cap': '<path d="m2.5 9 9.5-5 9.5 5-9.5 5z"/><path d="M6.5 11.2V16c3.7 2.6 7.3 2.6 11 0v-4.8"/><path d="M21.5 9v6"/>',
  lecture: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 8h10M7 12h6"/>',
  exam: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3.5h6M8.5 9l1.5 1.5 3-3M8.5 15l1.5 1.5 3-3M15.5 9H17M15.5 15H17"/>',
  'clipboard-check': '<path d="M9 4h6l1 3H8z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="m8.5 14 2.2 2.2 4.8-5"/>',
  knowledge: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9a2.8 2.8 0 1 1 4.9 1.9c-1 .9-2.3 1.2-2.3 3M12 18h.01"/>',
  library: '<path d="M3 20h18M5 20V8h4v12M10 20V5h4v15M15 20V9h4v11M3 5h18L12 2z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  'file-search': '<path d="M6 3h8l4 4v14H6zM14 3v5h5"/><circle cx="11" cy="14" r="3"/><path d="m13.2 16.2 2.2 2.2"/>',
  'pen-tool': '<path d="m12 3 4 4-7.5 11.5L4 20l1.5-4.5zM9 6l4 4M4 20h16"/>',
  writing: '<path d="M4 5h10M4 10h8M4 15h6M4 20h8M14 17l5-5 2 2-5 5-3 1z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 16h5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  'chart-bar': '<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20"/>',
  'chart-line': '<path d="M3 20h18M4 17l5-6 4 3 7-9"/><circle cx="9" cy="11" r="1"/><circle cx="13" cy="14" r="1"/><circle cx="20" cy="5" r="1"/>',
  analytics: '<circle cx="12" cy="12" r="9"/><path d="M12 12V3a9 9 0 0 1 8.3 5.5zM12 12l6.5 6.2M12 12l-7.8 4.5"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1M8 19h5M16 19h1"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M7.5 15h9"/>',
  microscope: '<path d="m10 3 5 5-3 3-5-5zM9 9l-3 5a5 5 0 0 0 5 6h7M14 7l2-2 2 2-2 2M4 21h16"/>',
  brain: '<path d="M9 4a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 3.8 13 4 4 0 0 0 9 19V4zM15 4a3 3 0 0 1 5 2.2 3.5 3.5 0 0 1 .2 6.8A4 4 0 0 1 15 19V4zM9 8H7M15 8h2M9 13H6M15 13h3M12 4v16"/>',
  workflow: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><circle cx="18" cy="6.5" r="2.5"/><path d="M9 6.5h6M6 9v6h9M15 17.5H9"/>',
  'calendar-plan': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M7 17h6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="M18.5 5.5 21 3"/>',
  lightbulb: '<path d="M8 15a7 7 0 1 1 8 0c-1 .8-1.5 1.7-1.5 3h-5c0-1.3-.5-2.2-1.5-3zM9.5 21h5M12 2V1"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 8c1 3 3 5 6 6M11 8c-1 3-3 5-7 7M14 21l4-10 4 10M15.5 17h5"/>',
  presentation: '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 13V9M12 13V6M16 13v-2M12 17v4M8 21h8"/>',
})

function safeIcon(icon = {}) {
  const key = AGENT_ICON_KEYS.includes(icon.key || icon.iconKey) ? (icon.key || icon.iconKey) : 'brain'
  const requestedColor = String(icon.color || icon.iconColor || '').toUpperCase()
  const requestedBackground = String(icon.background || icon.iconBackground || '').toUpperCase()
  const pair = AGENT_ICON_COLORS.find(([color]) => color === requestedColor) || AGENT_ICON_COLORS[0]
  return {
    key,
    color: /^#[0-9A-F]{6}$/.test(requestedColor) ? requestedColor : pair[0],
    background: /^#[0-9A-F]{6}$/.test(requestedBackground) ? requestedBackground : pair[1],
    avatarUrl: icon.avatarUrl || null,
  }
}

export function agentIconHTML(agent = {}, options = {}) {
  const icon = safeIcon(agent.icon || agent)
  const size = Math.max(24, Math.min(80, Number(options.size) || 42))
  const className = `agent-icon ${escapeHtml(options.className || '')}`.trim()
  const label = escapeHtml(options.label || agent.version?.name || agent.name || '智能体')
  const style = `--agent-icon-color:${icon.color};--agent-icon-bg:${icon.background};width:${size}px;height:${size}px`
  if (icon.avatarUrl && /^(https?:\/\/|\/)/i.test(icon.avatarUrl) && !/\.svg(?:$|\?)/i.test(icon.avatarUrl)) {
    return `<span class="${className}" style="${style}" role="img" aria-label="${label}"><img src="${escapeHtml(icon.avatarUrl)}" alt="" loading="lazy"></span>`
  }
  return `<span class="${className}" style="${style}" role="img" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${PATHS[icon.key]}</svg></span>`
}

export function agentIconPickerHTML(selection = {}) {
  const icon = safeIcon(selection)
  return `<section class="agent-icon-picker" aria-label="智能体图标设置">
    <div class="agent-icon-preview">${agentIconHTML(icon, { size: 54, label: '图标预览' })}<div><strong>个性化图标</strong><span>选择图标和主题色，所有页面会保持一致。</span></div></div>
    <div class="agent-icon-options" role="listbox" aria-label="选择图标">${AGENT_ICON_KEYS.map((key) => `<button type="button" data-icon-key="${key}" class="${key === icon.key ? 'active' : ''}" aria-label="${key}" aria-selected="${key === icon.key}">${agentIconHTML({ key, color: icon.color, background: icon.background }, { size: 34 })}</button>`).join('')}</div>
    <div class="agent-color-options" aria-label="选择主题色">${AGENT_ICON_COLORS.map(([color, background]) => `<button type="button" data-icon-color="${color}" data-icon-background="${background}" class="${color === icon.color ? 'active' : ''}" style="--swatch:${color};--swatch-bg:${background}" aria-label="主题色 ${color}"></button>`).join('')}</div>
  </section>`
}

export function bindAgentIconPicker(root, selection, onChange = () => {}) {
  const rerenderPreview = () => {
    const preview = root.querySelector('.agent-icon-preview > .agent-icon')
    if (preview) preview.outerHTML = agentIconHTML(selection, { size: 54, label: '图标预览' })
  }
  root.querySelectorAll('[data-icon-key]').forEach((button) => button.addEventListener('click', () => {
    selection.iconKey = button.dataset.iconKey
    root.querySelectorAll('[data-icon-key]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-selected', item === button ? 'true' : 'false') })
    rerenderPreview(); onChange({ ...selection })
  }))
  root.querySelectorAll('[data-icon-color]').forEach((button) => button.addEventListener('click', () => {
    selection.iconColor = button.dataset.iconColor
    selection.iconBackground = button.dataset.iconBackground
    root.querySelectorAll('[data-icon-color]').forEach((item) => item.classList.toggle('active', item === button))
    rerenderPreview(); onChange({ ...selection })
  }))
}
