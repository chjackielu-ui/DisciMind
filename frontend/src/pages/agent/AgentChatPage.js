import {
  getAgent, listAgentConversations, createAgentConversation, getAgentConversation, updateAgentConversation,
  deleteAgentConversation, clearAgentConversationMessages, bulkManageAgentConversations,
  streamAgentConversation, cancelAgentGeneration, listAgentMemories, createAgentMemory, updateAgentMemory,
  deleteAgentMemory, clearAgentMemories, resolveAgentMemoryCandidate, listAccessibleKnowledgeBases, listAvailableChatAgents,
} from '../../api/marketplace.js'
import { getUser, getToken } from '../../utils/auth.js'
import { escapeHtml } from '../../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../../utils/markdown.js'
import { agentIconHTML } from '../../components/agent-icon.js'
import { createUnifiedComposer } from '../../components/unified-composer.js'
import { renderMarketplaceLayout, loadingHTML, operationId, notify } from './marketplace-shared.js'
import { renderFileGeneratorChat } from './FileGeneratorChat.js'

let activeAgentGeneration = null

function safeUrl(value) {
  return /^https?:\/\//i.test(String(value || '')) ? String(value) : ''
}

function sourceHTML(sources) {
  if (!sources?.length) return ''
  return `<details class="agent-sources"><summary>知识库来源 <span>${sources.length}</span></summary><div>${sources.map(source => `<article><div><strong>${escapeHtml(source.documentName)}</strong><span>${escapeHtml(source.knowledgeBaseName)}${source.pageNumber ? ` · 第 ${source.pageNumber} 页` : ''}${source.score == null ? '' : ` · 相关度 ${Number(source.score).toFixed(3)}`}</span></div><blockquote>${escapeHtml(source.quote || '')}</blockquote>${safeUrl(source.externalUrl) ? `<a href="${escapeHtml(source.externalUrl)}" target="_blank" rel="noopener noreferrer">查看外部资料</a>` : ''}</article>`).join('')}</div></details>`
}

function invocationHTML(invocations) {
  if (!invocations?.length) return ''
  return `<section class="agent-run-list"><h4>智能体调用</h4>${invocations.map(item => `<article class="agent-run-card is-${String(item.status || '').toLowerCase()}">${agentIconHTML(item.agent || {}, { size: 30 })}<div><strong>${escapeHtml(item.agentName || '智能体')}</strong><span>${escapeHtml(item.status || 'QUEUED')}${item.durationMs ? ` · ${item.durationMs}ms` : ''}</span>${item.errorMessage ? `<p>${escapeHtml(item.errorMessage)}</p>` : ''}</div>${item.taskIds?.length ? '<a href="#/student/agent-tasks">任务中心</a>' : ''}</article>`).join('')}</section>`
}

function contextHTML(message) {
  const kbs = (message.knowledgeBaseRefs || []).map(item => `<span>@ ${escapeHtml(item.name)}</span>`).join('')
  const agents = (message.agentRefs || []).map(item => `<span>\\ ${escapeHtml(item.name)}</span>`).join('')
  return kbs || agents ? `<div class="agent-message-context">${kbs}${agents}</div>` : ''
}

function attachmentHTML(attachments) {
  if (!attachments?.length) return ''
  return `<div class="agent-message-images">${attachments.map(item => item.displayUrl ? `<img src="${item.displayUrl}" alt="${escapeHtml(item.name || '对话图片')}">` : '').join('')}</div>`
}

function memoryCandidateHTML(message) {
  const candidate = message.metadata?.memoryCandidate
  if (!candidate) return ''
  return `<section class="memory-candidate" data-memory-candidate="${message.id}"><strong>待保存的长期记忆</strong><p>${escapeHtml(candidate.content)}</p><div><button type="button" data-confirm-memory>确认保存</button><button type="button" data-cancel-memory>取消</button></div></section>`
}

function messagesHTML(messages) {
  return messages.filter(message => message.generationStatus !== 'SUPERSEDED').map(message => {
    const assistant = message.role === 'ASSISTANT'
    return `<article class="agent-chat-message ${assistant ? 'is-assistant' : 'is-user'}" data-message-id="${message.id || ''}"><div class="agent-message-role">${assistant ? '智能体' : '你'}${assistant && message.generationStatus && message.generationStatus !== 'COMPLETED' ? `<span>${escapeHtml(message.generationStatus)}</span>` : ''}</div>${contextHTML(message)}${attachmentHTML(message.attachments)}<div class="message-markdown">${renderMarkdownToHtml(message.content || '')}</div>${sourceHTML(message.sources)}${invocationHTML(message.invocations)}${memoryCandidateHTML(message)}<div class="agent-message-actions">${message.content ? '<button type="button" data-copy-message>复制</button><button type="button" data-save-memory>保存为长期记忆</button>' : ''}</div></article>`
  }).join('')
}

function artifactHTML(artifacts) {
  if (!artifacts?.length) return ''
  return `<section class="conversation-artifacts"><h3>本会话产物</h3>${artifacts.map(item => {
    const status = item.publicStatus || (item.status === 'READY' ? 'DOWNLOADABLE' : item.status === 'FAILED' ? 'FAILED' : 'GENERATING')
    const statusText = status === 'DOWNLOADABLE' ? '可下载' : status === 'FAILED' ? '生成失败' : status === 'CANCELLED' ? '已取消' : '生成中'
    return `<article>${agentIconHTML({ iconKey: item.artifactType === 'EXAM_PAPER' ? 'exam' : 'lecture', iconColor: '#2563EB', iconBackground: '#EFF6FF' }, { size: 36 })}<div><strong>${escapeHtml(item.title)}</strong><span>${statusText}</span></div><a href="#/student/artifacts/${item.id}">${status === 'DOWNLOADABLE' ? '查看与下载' : '查看进度'}</a></article>`
  }).join('')}</section>`
}

function draftKey(conversationId) {
  const user = getUser()
  return `discimind:agent-chat:draft:${user?.user_id || user?.id || 'current'}:${conversationId}`
}

function loadDraft(conversationId) {
  const raw = localStorage.getItem(draftKey(conversationId))
  if (!raw) return { content: '', knowledgeBaseRefs: [], agentRefs: [] }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return {
      content: String(parsed.content || ''), knowledgeBaseRefs: Array.isArray(parsed.knowledgeBaseRefs) ? parsed.knowledgeBaseRefs : [],
      agentRefs: Array.isArray(parsed.agentRefs) ? parsed.agentRefs : [],
    }
  } catch {}
  return { content: raw, knowledgeBaseRefs: [], agentRefs: [] }
}

function saveDraft(conversationId, payload) {
  localStorage.setItem(draftKey(conversationId), JSON.stringify({
    content: payload.content || '', knowledgeBaseRefs: payload.knowledgeBaseRefs || [], agentRefs: payload.agentRefs || [],
  }))
}

async function hydrateAttachments(messages) {
  await Promise.all((messages || []).flatMap(message => (message.attachments || []).map(async attachment => {
    if (attachment.displayUrl) return
    try {
      const response = await fetch(attachment.url, { headers: { Authorization: `Bearer ${getToken()}` }, credentials: 'include' })
      if (!response.ok) return
      attachment.displayUrl = URL.createObjectURL(await response.blob())
    } catch { /* 单张图片失败不影响会话恢复 */ }
  })))
}

function revokeAttachments(messages) {
  ;(messages || []).flatMap(message => message.attachments || []).forEach(item => { if (item.displayUrl?.startsWith('blob:')) URL.revokeObjectURL(item.displayUrl) })
}

async function renderMemoryDrawer(agentId, root, onClose = null) {
  const state = { q: '', items: [] }
  const load = async () => {
    state.items = (await listAgentMemories(agentId, state.q ? { q: state.q } : {})).data.list || []
    draw()
  }
  const draw = () => {
    root.innerHTML = `<header><div><h3>长期记忆</h3><span>仅注入已确认且启用的记忆</span></div><button type="button" data-close-memory aria-label="关闭">×</button></header><form data-memory-search><input value="${escapeHtml(state.q)}" placeholder="搜索记忆"><button>搜索</button></form><form data-memory-add><input name="title" maxlength="100" placeholder="标题" value="学习偏好"><textarea name="content" maxlength="1000" placeholder="手动添加稳定的学习偏好或背景" required></textarea><button>添加记忆</button></form><div class="memory-list">${state.items.map(item => `<article data-memory-id="${item.id}"><label><input type="checkbox" data-memory-enabled ${item.enabled ? 'checked' : ''}>启用</label><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.content)}</p><small>${item.sourceConversation ? `来源：${escapeHtml(item.sourceConversation.title)}` : '手动添加'} · ${new Date(item.createdAt).toLocaleString()}</small><div><button type="button" data-memory-edit>编辑</button><button type="button" data-memory-delete>删除</button></div></article>`).join('') || '<p class="muted">暂无已确认的长期记忆。</p>'}</div><button type="button" data-memory-clear ${state.items.length ? '' : 'disabled'}>全部清空</button>`
    root.querySelector('[data-close-memory]').onclick = () => {
      if (onClose) onClose()
      else {
        root.closest('.agent-memory-drawer')?.classList.remove('open')
        const backdrop = root.closest('.agent-chat-shell')?.querySelector('.agent-memory-backdrop'); if (backdrop) backdrop.hidden = true
      }
    }
    root.querySelector('[data-memory-search]').onsubmit = event => { event.preventDefault(); state.q = event.currentTarget.querySelector('input').value.trim(); void load() }
    root.querySelector('[data-memory-add]').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { await createAgentMemory(agentId, { type: 'USER_REQUEST', title: form.title.value.trim(), content: form.content.value.trim(), enabled: true }); form.reset(); notify('记忆已保存'); await load() } catch (error) { notify(error.message, true) } }
    root.querySelectorAll('[data-memory-id]').forEach(card => {
      const item = state.items.find(entry => Number(entry.id) === Number(card.dataset.memoryId))
      card.querySelector('[data-memory-enabled]').onchange = async event => { try { await updateAgentMemory(agentId, item.id, { enabled: event.target.checked }); item.enabled = event.target.checked } catch (error) { event.target.checked = !event.target.checked; notify(error.message, true) } }
      card.querySelector('[data-memory-edit]').onclick = async () => { const content = prompt('编辑长期记忆', item.content)?.trim(); if (!content) return; try { await updateAgentMemory(agentId, item.id, { content }); await load() } catch (error) { notify(error.message, true) } }
      card.querySelector('[data-memory-delete]').onclick = async () => { if (!confirm('确认删除这条记忆吗？')) return; try { await deleteAgentMemory(agentId, item.id); await load() } catch (error) { notify(error.message, true) } }
    })
    root.querySelector('[data-memory-clear]').onclick = async () => { if (!confirm('确认清空这个智能体的全部长期记忆吗？')) return; try { await clearAgentMemories(agentId); await load() } catch (error) { notify(error.message, true) } }
  }
  try { await load() } catch (error) { root.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>` }
}

export async function renderAgentChat(app, params) {
  const agentId = Number(params.id)
  let conversationId = Number(params.conversationId)
  renderMarketplaceLayout(app, `<div id="agent-chat-root">${loadingHTML('正在打开对话...')}</div>`, '#/student/agents/mine')
  try {
    const [agentResult, conversationsResult, knowledgeResult, agentsResult] = await Promise.all([
      getAgent(agentId), listAgentConversations(agentId), listAccessibleKnowledgeBases(), listAvailableChatAgents(),
    ])
    const agent = agentResult.data
    const conversations = conversationsResult.data.list || []
    if (!conversationId) {
      if (conversations.length) conversationId = conversations[0].id
      else conversationId = (await createAgentConversation(agentId, { title: '新对话', operationId: operationId() })).data.id
      window.location.hash = `#/student/agents/${agentId}/chat/${conversationId}`
      return
    }
    if (agent.agentType === 'FILE_GENERATOR') return renderFileGeneratorChat(app, { agent, conversationId, conversations })
    let conversation = (await getAgentConversation(conversationId)).data
    await hydrateAttachments(conversation.messages)
    const root = document.getElementById('agent-chat-root')
    root.innerHTML = `<div class="agent-chat-shell"><header class="agent-chat-topbar"><a href="#/student/agents/mine">← 返回我的智能体</a>${agentIconHTML(agent, { size: 44 })}<div class="agent-chat-title"><h1>${escapeHtml(agent.version?.name || '智能体')}</h1><p>${escapeHtml(agent.version?.shortDescription || '')}</p></div><span class="agent-runtime-badge">${escapeHtml(agent.version?.runtimeProvider?.replace('DIFY_', '') || 'MODEL')}</span><div class="agent-chat-header-actions"><button type="button" id="rename-agent-chat">重命名</button><button type="button" id="clear-agent-chat">清空消息</button><button type="button" id="delete-agent-chat">删除会话</button><button type="button" id="open-memory">长期记忆</button></div></header><div class="agent-chat-layout"><aside class="agent-chat-history"><div class="history-heading"><button id="toggle-history" aria-label="收起历史">‹</button><strong>历史会话</strong><button id="new-agent-chat">新建</button></div><input id="history-search" placeholder="搜索会话"><div id="history-list"></div><div id="history-bulk-actions"><button type="button" data-history-multi>多选</button></div></aside><main class="agent-chat-main"><div id="agent-messages" class="agent-messages">${messagesHTML(conversation.messages || []) || `<div class="agent-chat-welcome">${agentIconHTML(agent, { size: 56 })}<h2>${escapeHtml(agent.version?.welcomeMessage || '你好，我们开始吧。')}</h2><div>${(agent.version?.suggestedQuestions || []).map(q => `<button data-suggested="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div></div>`}${artifactHTML(conversation.artifacts)}</div><div id="agent-composer-root"></div></main></div><button type="button" class="agent-memory-backdrop" hidden aria-label="关闭长期记忆"></button><aside class="agent-memory-drawer" aria-label="长期记忆"><div id="agent-memory-panel">${loadingHTML('正在读取记忆...')}</div></aside></div>`
    renderMathInMarkdownElements(root)

    const messageBox = root.querySelector('#agent-messages')
    const scrollMessages = () => { messageBox.scrollTop = messageBox.scrollHeight }
    const historyState = { q: '', multi: false, selected: new Set() }
    const renderHistory = () => {
      const visible = conversations.filter(item => !historyState.q || item.title.toLowerCase().includes(historyState.q.toLowerCase()))
      root.querySelector('#history-list').innerHTML = visible.map(item => `<div class="history-row ${item.id === conversationId ? 'active' : ''}">${historyState.multi ? `<input type="checkbox" data-history-select="${item.id}" ${historyState.selected.has(item.id) ? 'checked' : ''}>` : ''}<a href="#/student/agents/${agentId}/chat/${item.id}"><strong>${escapeHtml(item.title)}</strong><span>${new Date(item.updatedAt).toLocaleDateString()}</span></a></div>`).join('') || '<p class="muted">没有匹配会话</p>'
      root.querySelector('#history-bulk-actions').innerHTML = historyState.multi ? '<button type="button" data-history-all>全选结果</button><button type="button" data-history-clear>批量清空</button><button type="button" data-history-delete>批量删除</button><button type="button" data-history-cancel>取消</button>' : '<button type="button" data-history-multi>多选</button>'
      root.querySelectorAll('[data-history-select]').forEach(box => box.onchange = () => { const id = Number(box.dataset.historySelect); box.checked ? historyState.selected.add(id) : historyState.selected.delete(id) })
      root.querySelector('[data-history-multi]')?.addEventListener('click', () => { historyState.multi = true; renderHistory() })
      root.querySelector('[data-history-cancel]')?.addEventListener('click', () => { historyState.multi = false; historyState.selected.clear(); renderHistory() })
      root.querySelector('[data-history-all]')?.addEventListener('click', () => { visible.forEach(item => historyState.selected.add(item.id)); renderHistory() })
      root.querySelector('[data-history-clear]')?.addEventListener('click', async () => { if (!historyState.selected.size || !confirm('确认清空所选会话消息吗？')) return; try { await bulkManageAgentConversations({ conversationIds: [...historyState.selected], action: 'CLEAR_MESSAGES', deleteArtifacts: false }); notify('所选会话已清空'); await renderAgentChat(app, { id: agentId, conversationId }) } catch (error) { notify(error.message, true) } })
      root.querySelector('[data-history-delete]')?.addEventListener('click', async () => { if (!historyState.selected.size || !confirm('确认删除所选会话吗？关联产物将保留。')) return; try { await bulkManageAgentConversations({ conversationIds: [...historyState.selected], action: 'DELETE', deleteArtifacts: false }); notify('所选会话已删除'); window.location.hash = `#/student/agents/${agentId}/chat` } catch (error) { notify(error.message, true) } })
    }
    renderHistory()
    root.querySelector('#history-search').oninput = event => { historyState.q = event.target.value; renderHistory() }
    root.querySelector('#toggle-history').onclick = () => root.querySelector('.agent-chat-layout').classList.toggle('history-collapsed')

    const bindMessageActions = () => {
      root.querySelectorAll('[data-copy-code]').forEach(button => button.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(decodeURIComponent(button.dataset.copyCode || '')); notify('代码已复制') }
        catch { notify('复制失败，请手动选择代码', true) }
      }))
      root.querySelectorAll('.agent-chat-message').forEach(node => {
        const id = Number(node.dataset.messageId)
        const message = (conversation.messages || []).find(item => Number(item.id) === id)
        node.querySelector('[data-copy-message]')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(message?.content || ''); notify('内容已复制') } catch { notify('复制失败', true) } })
        node.querySelector('[data-save-memory]')?.addEventListener('click', async () => { const content = (message?.content || '').trim().slice(0, 1000); if (!content) return; try { await createAgentMemory(agentId, { type: 'USER_REQUEST', title: '来自对话', content, sourceMessageId: id, enabled: true }); notify('已保存为长期记忆'); await renderMemoryDrawer(agentId, root.querySelector('#agent-memory-panel')) } catch (error) { notify(error.message, true) } })
        node.querySelector('[data-confirm-memory]')?.addEventListener('click', async () => { const candidate = message?.metadata?.memoryCandidate; if (!candidate) return; try { await resolveAgentMemoryCandidate(agentId, id, 'SAVE'); delete message.metadata.memoryCandidate; node.querySelector('.memory-candidate').remove(); notify('长期记忆已确认保存'); await renderMemoryDrawer(agentId, root.querySelector('#agent-memory-panel')) } catch (error) { notify(error.message, true) } })
        node.querySelector('[data-cancel-memory]')?.addEventListener('click', async () => { try { await resolveAgentMemoryCandidate(agentId, id, 'DISCARD'); delete message.metadata.memoryCandidate; node.querySelector('.memory-candidate')?.remove(); notify('已取消保存') } catch (error) { notify(error.message, true) } })
      })
    }
    bindMessageActions(); scrollMessages()
    const setMemoryOpen = open => {
      root.querySelector('.agent-memory-drawer').classList.toggle('open', open)
      root.querySelector('.agent-memory-backdrop').hidden = !open
      root.querySelector('#open-memory').setAttribute('aria-expanded', String(open))
    }
    await renderMemoryDrawer(agentId, root.querySelector('#agent-memory-panel'), () => setMemoryOpen(false))
    root.querySelector('#open-memory').setAttribute('aria-expanded', 'false')
    root.querySelector('#open-memory').onclick = () => setMemoryOpen(true)
    root.querySelector('.agent-memory-backdrop').onclick = () => setMemoryOpen(false)
    const closeMemoryOnEscape = event => { if (!root.isConnected) document.removeEventListener('keydown', closeMemoryOnEscape); else if (event.key === 'Escape') setMemoryOpen(false) }
    document.addEventListener('keydown', closeMemoryOnEscape)
    window.addEventListener('hashchange', () => document.removeEventListener('keydown', closeMemoryOnEscape), { once: true })

    root.querySelector('#new-agent-chat').onclick = async () => { try { const created = await createAgentConversation(agentId, { title: '新对话', operationId: operationId() }); window.location.hash = `#/student/agents/${agentId}/chat/${created.data.id}` } catch (error) { notify(error.message, true) } }
    root.querySelector('#rename-agent-chat').onclick = async () => { const title = prompt('输入新的会话名称', conversation.title)?.trim(); if (!title) return; try { await updateAgentConversation(conversationId, { title }); notify('会话已重命名'); await renderAgentChat(app, params) } catch (error) { notify(error.message, true) } }
    root.querySelector('#clear-agent-chat').onclick = async () => { if (!confirm('确认清空当前会话消息吗？产物会保留。')) return; try { await clearAgentConversationMessages(conversationId); notify('消息已清空'); await renderAgentChat(app, params) } catch (error) { notify(error.message, true) } }
    root.querySelector('#delete-agent-chat').onclick = async () => { if (!confirm('确认删除当前会话吗？关联产物会保留。')) return; try { await deleteAgentConversation(conversationId); localStorage.removeItem(draftKey(conversationId)); notify('会话已删除'); window.location.hash = `#/student/agents/${agentId}/chat` } catch (error) { notify(error.message, true) } }
    root.querySelectorAll('[data-suggested]').forEach(button => button.onclick = () => composer.setValue(button.dataset.suggested))

    const savedDraft = loadDraft(conversationId)
    const composer = createUnifiedComposer({
      root: root.querySelector('#agent-composer-root'),
      initialValue: savedDraft.content,
      knowledgeBaseRefs: savedDraft.knowledgeBaseRefs,
      agentRefs: savedDraft.agentRefs,
      maxLength: 4000,
      knowledgeBases: knowledgeResult.data?.list || [],
      agents: agentsResult.data.list || [],
      allowImages: true,
      allowVoice: true,
      onNotice: message => notify(message, true),
      onDraftChange: payload => saveDraft(conversationId, payload),
      onContextChange: payload => saveDraft(conversationId, payload),
      onStop: async () => {
        const running = activeAgentGeneration
        if (!running || running.conversationId !== conversationId) return
        running.stopRequested = true
        if (running.generationId) {
          await cancelAgentGeneration(conversationId, running.generationId).catch(() => null)
          running.controller.abort()
        } else {
          running.stopTimer = setTimeout(() => running.controller.abort(), 1000)
        }
      },
      onSubmit: payload => generate(payload, false),
    })

    async function generate(payload, regenerate = false) {
      if (activeAgentGeneration) return
      const controller = new AbortController()
      const running = { controller, conversationId, generationId: null, stopRequested: false, stopTimer: null }
      activeAgentGeneration = running; composer.setBusy(true)
      const abortOnRouteChange = () => controller.abort()
      window.addEventListener('hashchange', abortOnRouteChange, { once: true })
      if (!regenerate) {
        const localImages = payload.images.map(item => ({ ...item, displayUrl: item.dataUrl }))
        messageBox.insertAdjacentHTML('beforeend', messagesHTML([{ role: 'USER', content: payload.content, knowledgeBaseRefs: payload.knowledgeBaseRefs, agentRefs: payload.agentRefs, attachments: localImages }]))
        composer.clear()
      }
      messageBox.insertAdjacentHTML('beforeend', '<article class="agent-chat-message is-assistant is-streaming"><div class="agent-message-role">智能体<span>GENERATING</span></div><pre class="agent-stream-text"></pre><div class="agent-live-runs"></div><div class="agent-live-sources"></div></article>')
      const assistantNode = messageBox.lastElementChild
      const streamText = assistantNode.querySelector('.agent-stream-text')
      scrollMessages()
      try {
        await streamAgentConversation(conversationId, {
          ...(regenerate ? { regenerate: true } : {
            content: payload.content,
            knowledgeBaseRefs: payload.knowledgeBaseRefs,
            agentRefs: payload.agentRefs,
            images: payload.images.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl })),
          }),
          operationId: operationId(),
        }, {
          signal: controller.signal,
          onMeta: data => {
            running.generationId = data.generationId
            if (running.stopRequested) void cancelAgentGeneration(conversationId, running.generationId).catch(() => null).finally(() => running.controller.abort())
          },
          onDelta: delta => { streamText.append(document.createTextNode(delta)); scrollMessages() },
          onSource: data => { assistantNode.querySelector('.agent-live-sources').innerHTML = data.sources?.length ? `<span>已检索 ${data.sources.length} 条真实来源</span>` : `<span>${data.status === 'UNAVAILABLE' ? '知识库暂不可用' : '未检索到直接来源'}</span>` },
          onRun: data => { const box = assistantNode.querySelector('.agent-live-runs'); let card = box.querySelector(`[data-live-run="${data.invocationId}"]`); if (!card) { box.insertAdjacentHTML('beforeend', `<article data-live-run="${data.invocationId}"><strong>${escapeHtml(data.agentName || '智能体')}</strong><span></span></article>`); card = box.lastElementChild } card.querySelector('span').textContent = data.status },
        })
        localStorage.removeItem(draftKey(conversationId))
      } catch (error) {
        if (error.name !== 'AbortError') { composer.setPayload(payload); saveDraft(conversationId, payload); notify(error.message, true) }
      } finally {
        clearTimeout(running.stopTimer)
        window.removeEventListener('hashchange', abortOnRouteChange)
        activeAgentGeneration = null; composer.setBusy(false)
      }
      const previous = conversation.messages
      conversation = (await getAgentConversation(conversationId)).data
      revokeAttachments(previous); await hydrateAttachments(conversation.messages)
      messageBox.innerHTML = `${messagesHTML(conversation.messages || [])}${artifactHTML(conversation.artifacts)}`
      bindMessageActions(); renderMathInMarkdownElements(messageBox); scrollMessages()
    }

    const hasUserMessage = (conversation.messages || []).some(item => item.role === 'USER')
    if (hasUserMessage) {
      const regenerateButton = document.createElement('button')
      regenerateButton.type = 'button'; regenerateButton.className = 'agent-floating-regenerate'; regenerateButton.textContent = '重新生成'
      regenerateButton.onclick = () => generate({ content: '', knowledgeBaseRefs: [], agentRefs: [], images: [] }, true)
      root.querySelector('.agent-chat-main').append(regenerateButton)
    }
  } catch (error) {
    renderMarketplaceLayout(app, `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>`, '#/student/agents/mine')
  }
}
