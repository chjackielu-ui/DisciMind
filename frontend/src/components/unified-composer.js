import { escapeHtml } from '../utils/format.js'
import { agentIconHTML } from './agent-icon.js'

const LATEX_COMMANDS = new Set([
  'frac', 'dfrac', 'tfrac', 'sum', 'prod', 'int', 'lim', 'sqrt', 'sin', 'cos', 'tan', 'log', 'ln',
  'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'sigma', 'omega', 'begin', 'end',
  'left', 'right', 'text', 'mathrm', 'mathbf', 'mathbb', 'overline', 'underline', 'vec', 'partial', 'infty',
])

function isEscaped(text, index) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

export function isProtectedComposerPosition(text, position) {
  let fenced = false
  let inlineCode = false
  let inlineMath = false
  let blockMath = false
  for (let index = 0; index < position; index += 1) {
    if (!inlineCode && !inlineMath && !blockMath && text.startsWith('```', index) && !isEscaped(text, index)) {
      fenced = !fenced; index += 2; continue
    }
    if (fenced) continue
    if (!inlineMath && !blockMath && text[index] === '`' && !isEscaped(text, index)) {
      inlineCode = !inlineCode; continue
    }
    if (inlineCode) continue
    if (!inlineMath && text.startsWith('$$', index) && !isEscaped(text, index)) {
      blockMath = !blockMath; index += 1; continue
    }
    if (!blockMath && text[index] === '$' && !isEscaped(text, index)) inlineMath = !inlineMath
  }
  return fenced || inlineCode || inlineMath || blockMath
}

export function activeComposerMention(text, position) {
  const before = String(text || '').slice(0, position)
  const match = before.match(/(^|\s)([@\\])([^\s@\\]*)$/u)
  if (!match) return null
  const marker = match[2]
  const query = match[3] || ''
  const start = before.length - marker.length - query.length
  if (isEscaped(before, start) || isProtectedComposerPosition(before, start)) return null
  if (marker === '\\') {
    const normalizedQuery = query.toLowerCase()
    const commandPrefix = normalizedQuery.match(/^[a-z]+/)?.[0] || ''
    if (commandPrefix && [...LATEX_COMMANDS].some(command => command === commandPrefix || command.startsWith(commandPrefix))) return null
  }
  return { type: marker === '@' ? 'knowledge' : 'agent', query, start, end: position }
}

function contextTags(state) {
  const knowledge = state.knowledgeBaseRefs.map((item) => `<button type="button" data-remove-kb="${item.knowledgeBaseId}" title="移除知识库">@ ${escapeHtml(item.name)}<span>×</span></button>`).join('')
  const agents = state.agentRefs.map((item) => `<button type="button" data-remove-agent="${item.agentId}" title="移除智能体">${agentIconHTML(item, { size: 20 })}<span>${escapeHtml(item.name)}</span><i>×</i></button>`).join('')
  return knowledge || agents ? `<div class="composer-context-tags">${knowledge}${agents}</div>` : ''
}

export function appendUniqueKnowledgeBaseRef(refs, item) {
  const next = Array.isArray(refs) ? [...refs] : []
  const knowledgeBaseId = Number(item?.knowledgeBaseId ?? item?.id)
  if (!Number.isInteger(knowledgeBaseId) || knowledgeBaseId <= 0) return next
  if (!next.some((entry) => Number(entry.knowledgeBaseId) === knowledgeBaseId)) {
    next.push({ knowledgeBaseId, name: String(item?.name || `知识库 #${knowledgeBaseId}`) })
  }
  return next
}

function menuItems(state) {
  const mention = state.mention
  if (!mention) return []
  const query = mention.query.toLowerCase()
  const source = mention.type === 'knowledge' ? state.knowledgeBases : state.agents
  return source.filter((item) => item.available !== false).filter((item) => {
    const name = item.name || item.version?.name || ''
    const description = item.description || item.version?.shortDescription || ''
    return !query || `${name} ${description}`.toLowerCase().includes(query)
  }).slice(0, 12)
}

function menuHTML(state) {
  const items = menuItems(state)
  if (!state.mention) return ''
  const title = state.mention.type === 'knowledge' ? '选择有权访问的知识库' : '按顺序调用智能体'
  const source = state.mention.type === 'knowledge' ? state.knowledgeBases : state.agents
  const emptyText = source.length
    ? '没有匹配且可用的项目'
    : (state.mention.type === 'knowledge' ? '暂无可访问的知识库，请先创建或申请访问' : '暂无可调用的智能体')
  return `<div class="composer-mention-menu" role="listbox"><header><strong>${title}</strong><kbd>↑↓</kbd><kbd>Enter / Tab</kbd><kbd>Esc</kbd></header>${items.length ? items.map((item, index) => {
    if (state.mention.type === 'knowledge') return `<button type="button" role="option" data-mention-index="${index}" class="${index === state.activeIndex ? 'active' : ''}"><span class="mention-kind">KB</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || `${item.documentCount || 0} 个文档`)}</small></span><em>${item.available === false ? '暂不可检索' : '可用'}</em></button>`
    const name = item.version?.name || item.name || '智能体'
    return `<button type="button" role="option" data-mention-index="${index}" class="${index === state.activeIndex ? 'active' : ''}">${agentIconHTML(item, { size: 34 })}<span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(item.version?.shortDescription || item.description || '')}</small></span><em>可用 · ${item.agentType === 'FILE_GENERATOR' ? '文件生成' : item.version?.runtimeProvider?.replace('DIFY_', '') || '对话'}</em></button>`
  }).join('') : `<p class="composer-mention-empty">${emptyText}</p>`}</div>`
}

function pendingAttachmentsHTML(attachments) {
  if (!attachments.length) return ''
  return `<div class="composer-images">${attachments.map((item, index) => `<figure>${item.mimeType?.startsWith('image/') && item.displayUrl ? `<img src="${item.displayUrl}" alt="">` : '<span class="composer-file-icon">文件</span>'}<button type="button" data-remove-attachment="${index}" aria-label="移除附件">×</button><figcaption>${escapeHtml(item.name)}</figcaption></figure>`).join('')}</div>`
}

export function createUnifiedComposer(options) {
  const root = options.root
  const state = {
    value: options.initialValue || '',
    knowledgeBases: Array.isArray(options.knowledgeBases) ? options.knowledgeBases : [],
    agents: Array.isArray(options.agents) ? options.agents : [],
    knowledgeBaseRefs: [...(options.knowledgeBaseRefs || [])],
    agentRefs: [...(options.agentRefs || [])],
    attachments: [...(options.attachments || [])], mention: null, activeIndex: 0, busy: false, uploading: false, composing: false,
  }
  const maxLength = Number(options.maxLength || 4000)

  const render = (keepFocus = false) => {
    const selectionStart = root.querySelector('textarea')?.selectionStart ?? state.value.length
    root.innerHTML = `<form class="unified-composer" autocomplete="off">${contextTags(state)}${pendingAttachmentsHTML(state.attachments)}<div class="composer-input-row"><textarea maxlength="${maxLength}" placeholder="${escapeHtml(options.placeholder || '输入问题，使用 @ 引用知识库，使用 \\ 调用智能体')}">${escapeHtml(state.value)}</textarea><button class="composer-send" type="submit" ${state.busy || state.uploading ? 'disabled' : ''}>${state.uploading ? '上传中' : '发送'}</button></div><div class="composer-toolbar"><div><button type="button" data-composer-kb title="引用知识库">@ 知识库</button><button type="button" data-composer-agent title="调用智能体">\\ 智能体</button>${options.allowImages === false ? '' : '<button type="button" data-composer-image>图片/文件</button>'}${options.allowVoice === false ? '' : '<button type="button" data-composer-voice>语音</button>'}</div><div><span data-composer-count>${state.value.length}/${maxLength}</span><button type="button" data-composer-stop ${state.busy ? '' : 'hidden'}>停止生成</button></div></div><div data-composer-menu-host>${menuHTML(state)}</div><input type="file" data-composer-file accept="image/jpeg,image/png,image/webp,.pdf,.docx,.txt,.md,.csv" multiple hidden></form>`
    bind()
    if (keepFocus) {
      const textarea = root.querySelector('textarea')
      textarea.focus(); textarea.setSelectionRange(Math.min(selectionStart, textarea.value.length), Math.min(selectionStart, textarea.value.length))
    }
  }

  const renderMenu = () => {
    const host = root.querySelector('[data-composer-menu-host]')
    if (!host) return
    host.innerHTML = menuHTML(state)
    host.querySelectorAll('[data-mention-index]').forEach((button) => button.addEventListener('mousedown', event => event.preventDefault()))
    host.querySelectorAll('[data-mention-index]').forEach((button) => button.addEventListener('click', () => chooseMention(Number(button.dataset.mentionIndex))))
    host.querySelector('[data-mention-index].active')?.scrollIntoView({ block: 'nearest' })
  }

  const detectMention = (textarea) => {
    let mention = activeComposerMention(textarea.value, textarea.selectionStart)
    if (mention?.type === 'knowledge' && options.allowKnowledge === false) mention = null
    if (mention?.type === 'agent' && options.allowAgents === false) mention = null
    return mention
  }

  const updateMention = (textarea) => {
    state.value = textarea.value
    options.onDraftChange?.(api.getPayload())
    const count = root.querySelector('[data-composer-count]')
    if (count) count.textContent = `${state.value.length}/${maxLength}`
    if (state.composing) return
    const previous = state.mention
    const next = detectMention(textarea)
    const queryChanged = previous?.type !== next?.type || previous?.query !== next?.query || previous?.start !== next?.start
    state.mention = next
    if (queryChanged) state.activeIndex = 0
    renderMenu()
  }

  const chooseMention = (index) => {
    const item = menuItems(state)[index]
    if (!item || !state.mention) return
    if (state.mention.type === 'knowledge') {
      state.knowledgeBaseRefs = appendUniqueKnowledgeBaseRef(state.knowledgeBaseRefs, item)
    } else {
      if (!state.agentRefs.some((entry) => Number(entry.agentId) === Number(item.id))) {
        state.agentRefs.push({ agentId: Number(item.id), name: item.version?.name || item.name, icon: item.icon, agentType: item.agentType })
      }
    }
    state.value = `${state.value.slice(0, state.mention.start)}${state.value.slice(state.mention.end)}`
    state.mention = null; state.activeIndex = 0; render(true); options.onContextChange?.(api.getPayload())
  }

  const handleFiles = async (files) => {
    const selected = [...files].slice(0, Math.max(0, 8 - state.attachments.length))
    if (!selected.length || state.uploading) return
    state.uploading = true; render(false)
    try {
      for (const file of selected) {
        const uploaded = await options.onUpload?.(file)
        if (!uploaded?.id) continue
        state.attachments.push({ ...uploaded, displayUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })
      }
      options.onDraftChange?.(api.getPayload())
    } catch (error) { options.onNotice?.(error.message || '附件上传失败') }
    finally { state.uploading = false; render(true) }
  }

  const startVoice = () => {
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
    if (!Recognition) return options.onNotice?.('当前浏览器不支持语音输入')
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'; recognition.interimResults = false
    recognition.onresult = (event) => { state.value = `${state.value}${state.value && !/\s$/.test(state.value) ? ' ' : ''}${event.results[0][0].transcript}`.slice(0, maxLength); render(true); options.onDraftChange?.(api.getPayload()) }
    recognition.onerror = () => options.onNotice?.('语音识别失败，请重试')
    recognition.start()
  }

  const bind = () => {
    const form = root.querySelector('form')
    const textarea = root.querySelector('textarea')
    textarea.addEventListener('input', () => updateMention(textarea))
    textarea.addEventListener('compositionstart', () => { state.composing = true })
    textarea.addEventListener('compositionend', () => { state.composing = false; updateMention(textarea) })
    textarea.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.items || [])].filter(item => item.type?.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean)
      if (files.length) { event.preventDefault(); void handleFiles(files) }
    })
    textarea.addEventListener('dragover', event => event.preventDefault())
    textarea.addEventListener('drop', event => { event.preventDefault(); void handleFiles(event.dataTransfer?.files || []) })
    textarea.addEventListener('click', () => { const next = detectMention(textarea); if (JSON.stringify(next) !== JSON.stringify(state.mention)) { state.mention = next; state.activeIndex = 0; renderMenu() } })
    textarea.addEventListener('keydown', (event) => {
      if (event.isComposing || state.composing) return
      const items = menuItems(state)
      if (state.mention && ['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) {
        event.preventDefault()
        if (event.key === 'Escape') { state.mention = null; renderMenu(); return }
        state.activeIndex = (state.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, items.length)) % Math.max(1, items.length)
        renderMenu(); return
      }
      if (state.mention && items.length && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) { event.preventDefault(); chooseMention(state.activeIndex); return }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit() }
    })
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); state.value = textarea.value
      if (state.busy || state.uploading || (!state.value.trim() && !state.attachments.length)) return
      await options.onSubmit?.(api.getPayload())
    })
    root.querySelector('[data-composer-kb]')?.addEventListener('click', () => { state.value += `${state.value && !/\s$/.test(state.value) ? ' ' : ''}@`; state.mention = activeComposerMention(state.value, state.value.length); render(true) })
    root.querySelector('[data-composer-agent]')?.addEventListener('click', () => { state.value += `${state.value && !/\s$/.test(state.value) ? ' ' : ''}\\`; state.mention = activeComposerMention(state.value, state.value.length); render(true) })
    root.querySelector('[data-composer-image]')?.addEventListener('click', () => root.querySelector('[data-composer-file]').click())
    root.querySelector('[data-composer-file]')?.addEventListener('change', (event) => void handleFiles(event.target.files))
    root.querySelector('[data-composer-voice]')?.addEventListener('click', startVoice)
    root.querySelector('[data-composer-stop]')?.addEventListener('click', () => options.onStop?.())
    root.querySelectorAll('[data-remove-kb]').forEach((button) => button.addEventListener('click', () => { state.knowledgeBaseRefs = state.knowledgeBaseRefs.filter((item) => Number(item.knowledgeBaseId) !== Number(button.dataset.removeKb)); render(true); options.onContextChange?.(api.getPayload()) }))
    root.querySelectorAll('[data-remove-agent]').forEach((button) => button.addEventListener('click', () => { state.agentRefs = state.agentRefs.filter((item) => Number(item.agentId) !== Number(button.dataset.removeAgent)); render(true); options.onContextChange?.(api.getPayload()) }))
    root.querySelectorAll('[data-remove-attachment]').forEach((button) => button.addEventListener('click', () => { const [removed] = state.attachments.splice(Number(button.dataset.removeAttachment), 1); if (removed?.displayUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.displayUrl); render(true); options.onDraftChange?.(api.getPayload()) }))
    root.querySelectorAll('[data-mention-index]').forEach((button) => button.addEventListener('mousedown', event => event.preventDefault()))
    root.querySelectorAll('[data-mention-index]').forEach((button) => button.addEventListener('click', () => chooseMention(Number(button.dataset.mentionIndex))))
  }

  const api = {
    getPayload: () => ({ content: state.value.trim(), knowledgeBaseRefs: [...state.knowledgeBaseRefs], agentRefs: state.agentRefs.map(({ agentId, name }) => ({ agentId, name })), attachments: [...state.attachments] }),
    setValue: (value) => { state.value = String(value || '').slice(0, maxLength); render(true); options.onDraftChange?.(api.getPayload()) },
    setPayload: (payload = {}) => {
      state.value = String(payload.content || '').slice(0, maxLength)
      state.knowledgeBaseRefs = [...(payload.knowledgeBaseRefs || [])]
      state.agentRefs = [...(payload.agentRefs || [])]
      state.attachments = [...(payload.attachments || payload.images || [])]
      state.mention = null; render(true)
    },
    clear: () => { state.value = ''; state.attachments = []; state.knowledgeBaseRefs = []; state.agentRefs = []; state.mention = null; render(true) },
    setBusy: (busy) => { state.busy = Boolean(busy); render(false) },
    setSources: ({ knowledgeBases, agents }) => { if (Array.isArray(knowledgeBases)) state.knowledgeBases = knowledgeBases; if (Array.isArray(agents)) state.agents = agents; renderMenu() },
    focus: () => root.querySelector('textarea')?.focus(),
    destroy: () => { root.innerHTML = '' },
  }
  render(false)
  return api
}
