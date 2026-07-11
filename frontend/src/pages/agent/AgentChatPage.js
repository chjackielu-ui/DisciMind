import {
  getAgent, listAgentConversations, createAgentConversation, getAgentConversation, updateAgentConversation,
  deleteAgentConversation, streamAgentConversation, cancelAgentGeneration, listAgentMemories, createAgentMemory, deleteAgentMemory, clearAgentMemories,
} from '../../api/marketplace.js'
import { getUser } from '../../utils/auth.js'
import { escapeHtml } from '../../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../../utils/markdown.js'
import { renderMarketplaceLayout, loadingHTML, operationId, setButtonBusy, notify } from './marketplace-shared.js'
import { renderFileGeneratorChat } from './FileGeneratorChat.js'

let activeAgentGeneration = null

function sourceHTML(sources) {
  if (!sources?.length) return ''
  return `<details class="agent-sources"><summary>参考来源（${sources.length}）</summary>${sources.map(source => `<article><strong>${escapeHtml(source.documentName)}</strong><span>${escapeHtml(source.knowledgeBaseName)} · ${source.pageNumber ? `第 ${source.pageNumber} 页` : `分段 ${escapeHtml(source.segmentId || '未知')}`}</span><blockquote>${escapeHtml(source.quote || '')}</blockquote></article>`).join('')}</details>`
}

function messagesHTML(messages) {
  return messages.filter(message => message.generationStatus !== 'SUPERSEDED').map(message => `<article class="agent-chat-message ${message.role === 'USER' ? 'is-user' : 'is-assistant'}"><div class="agent-message-role">${message.role === 'USER' ? '你' : '智能体'}${message.role !== 'USER' && message.generationStatus && message.generationStatus !== 'COMPLETED' ? ` · ${escapeHtml(message.generationStatus)}` : ''}</div><div class="message-markdown">${renderMarkdownToHtml(message.content)}</div>${sourceHTML(message.sources)}${message.role === 'ASSISTANT' && message.content ? '<button class="agent-copy-answer complex-btn-ghost" type="button">复制回答</button>' : ''}</article>`).join('')
}

function draftKey(conversationId) {
  const user = getUser()
  return `discimind:agent-chat:draft:${user?.user_id || user?.id || 'current'}:${conversationId}`
}

function bindAnswerCopies(root) {
  root.querySelectorAll('.agent-copy-answer').forEach(button => button.addEventListener('click', async () => {
    const content = button.closest('.agent-chat-message')?.querySelector('.message-markdown')?.innerText || ''
    try { await navigator.clipboard.writeText(content); notify('回答已复制') } catch { notify('复制失败，请手动选择文本', true) }
  }))
}

async function renderMemoryPanel(agentId, root) {
  try {
    const result = await listAgentMemories(agentId); const items = result.data.list || []
    root.innerHTML = `<div class="memory-head"><h3>这个智能体记住了什么</h3><button id="memory-add" type="button">添加</button></div>${items.map(item => `<div class="memory-item"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.content)}</p></div><button data-memory-delete="${item.id}">删除</button></div>`).join('') || '<p class="muted">暂无已确认的长期记忆。</p>'}<button id="memory-clear" class="complex-btn-ghost" ${items.length ? '' : 'disabled'}>全部清空</button>`
    document.getElementById('memory-add').addEventListener('click', async () => {
      const content = prompt('输入希望智能体记住的稳定学习偏好或背景（不要填写密码、联系方式等敏感信息）')?.trim(); if (!content) return
      try { await createAgentMemory(agentId, { type: 'USER_REQUEST', title: '手动添加', content }); notify('记忆已保存'); await renderMemoryPanel(agentId, root) } catch (error) { notify(error.message, true) }
    })
    root.querySelectorAll('[data-memory-delete]').forEach(button => button.addEventListener('click', async () => { try { await deleteAgentMemory(agentId, button.dataset.memoryDelete); await renderMemoryPanel(agentId, root) } catch (error) { notify(error.message, true) } }))
    document.getElementById('memory-clear')?.addEventListener('click', async () => { if (!confirm('确认清空这个智能体的全部长期记忆吗？')) return; try { await clearAgentMemories(agentId); await renderMemoryPanel(agentId, root) } catch (error) { notify(error.message, true) } })
  } catch (error) { root.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>` }
}

export async function renderAgentChat(app, params) {
  const agentId = Number(params.id); let conversationId = Number(params.conversationId)
  renderMarketplaceLayout(app, `<div id="agent-chat-root">${loadingHTML('正在打开对话...')}</div>`)
  try {
    const [agentResult, conversationsResult] = await Promise.all([getAgent(agentId), listAgentConversations(agentId)])
    const agent = agentResult.data; const conversations = conversationsResult.data.list || []
    if (!conversationId) {
      if (conversations.length) conversationId = conversations[0].id
      else { const created = await createAgentConversation(agentId, { title: '新对话', operationId: operationId() }); conversationId = created.data.id }
      window.location.hash = `#/student/agents/${agentId}/chat/${conversationId}`; return
    }
    if (agent.agentType === 'FILE_GENERATOR') return renderFileGeneratorChat(app, { agent, conversationId, conversations })
    const conversationResult = await getAgentConversation(conversationId); let conversation = conversationResult.data
    const root = document.getElementById('agent-chat-root')
    root.innerHTML = `<div class="agent-chat-layout"><aside class="agent-chat-history"><button id="new-agent-chat" class="complex-btn">新建对话</button>${conversations.map(item => `<a class="${item.id === conversationId ? 'active' : ''}" href="#/student/agents/${agentId}/chat/${item.id}">${escapeHtml(item.title)}</a>`).join('')}</aside>
      <section class="agent-chat-main"><header><div><h1>${escapeHtml(agent.version?.name || '智能体')}</h1><p>${escapeHtml(agent.version?.shortDescription || '')}</p></div><div class="agent-chat-header-actions"><button id="rename-agent-chat" class="complex-btn-ghost" type="button">重命名</button><button id="delete-agent-chat" class="complex-btn-ghost" type="button">删除会话</button><label class="agent-switch"><input id="conversation-memory" type="checkbox" ${conversation.memoryEnabled ? 'checked' : ''}> 长期记忆</label></div></header>
        <div id="agent-messages" class="agent-messages">${messagesHTML(conversation.messages || []) || `<div class="agent-chat-welcome"><h2>${escapeHtml(agent.version?.welcomeMessage || '你好，我们开始吧。')}</h2><div>${(agent.version?.suggestedQuestions || []).map(q => `<button data-suggested="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div></div>`}</div>
        <form id="agent-message-form" class="agent-message-form"><textarea id="agent-message-input" maxlength="4000" placeholder="输入你的问题..." required>${escapeHtml(localStorage.getItem(draftKey(conversationId)) || '')}</textarea><div><span id="agent-message-state">IDLE</span><button id="agent-regenerate" class="complex-btn-ghost" type="button" ${(conversation.messages || []).some(item => item.role === 'USER') ? '' : 'disabled'}>重新生成</button><button id="agent-stop" class="complex-btn-ghost" type="button" hidden>停止生成</button><button id="agent-send" class="complex-btn" type="submit">发送</button></div></form></section>
      <aside id="agent-memory-panel" class="agent-memory-panel">${loadingHTML('正在加载记忆...')}</aside></div>`
    renderMathInMarkdownElements(root)
    const scrollMessages = () => { const box = document.getElementById('agent-messages'); box.scrollTop = box.scrollHeight }
    scrollMessages(); bindAnswerCopies(root); await renderMemoryPanel(agentId, document.getElementById('agent-memory-panel'))
    document.getElementById('new-agent-chat').addEventListener('click', async event => { setButtonBusy(event.currentTarget, true); try { const created = await createAgentConversation(agentId, { title: '新对话', operationId: operationId() }); window.location.hash = `#/student/agents/${agentId}/chat/${created.data.id}` } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) } })
    document.getElementById('conversation-memory').addEventListener('change', async event => { try { await updateAgentConversation(conversationId, { memoryEnabled: event.target.checked }); conversation.memoryEnabled = event.target.checked; notify(event.target.checked ? '已开启长期记忆' : '已关闭长期记忆') } catch (error) { event.target.checked = !event.target.checked; notify(error.message, true) } })
    document.getElementById('rename-agent-chat').addEventListener('click', async () => {
      const title = prompt('输入新的会话名称', conversation.title)?.trim(); if (!title) return
      try { await updateAgentConversation(conversationId, { title }); notify('会话已重命名'); window.location.hash = `#/student/agents/${agentId}/chat/${conversationId}`; await renderAgentChat(app, params) } catch (error) { notify(error.message, true) }
    })
    document.getElementById('delete-agent-chat').addEventListener('click', async () => {
      if (!confirm('确认删除当前会话吗？此操作不会删除智能体。')) return
      try { await deleteAgentConversation(conversationId); localStorage.removeItem(draftKey(conversationId)); notify('会话已删除'); window.location.hash = `#/student/agents/${agentId}/chat` } catch (error) { notify(error.message, true) }
    })
    root.querySelectorAll('[data-suggested]').forEach(button => button.addEventListener('click', () => { document.getElementById('agent-message-input').value = button.dataset.suggested; document.getElementById('agent-message-input').focus() }))
    document.getElementById('agent-message-input').addEventListener('input', event => localStorage.setItem(draftKey(conversationId), event.target.value))
    document.getElementById('agent-stop').addEventListener('click', async () => {
      const running = activeAgentGeneration; if (!running || running.conversationId !== conversationId) return
      if (running.generationId) await cancelAgentGeneration(conversationId, running.generationId).catch(() => null)
      running.controller.abort()
    })
    const generate = async (regenerate = false) => {
      const input = document.getElementById('agent-message-input'); const content = input.value.trim(); if (!regenerate && !content) return
      if (activeAgentGeneration) return
      const button = document.getElementById('agent-send'); const stop = document.getElementById('agent-stop'); const state = document.getElementById('agent-message-state'); setButtonBusy(button, true, '回答中...'); stop.hidden = false; state.textContent = 'GENERATING'
      const controller = new AbortController(); const running = { controller, conversationId, generationId: null }; activeAgentGeneration = running
      const abortOnRouteChange = () => controller.abort(); window.addEventListener('hashchange', abortOnRouteChange, { once: true })
      const box = document.getElementById('agent-messages'); if (!regenerate) input.value = ''
      box.insertAdjacentHTML('beforeend', messagesHTML([...(regenerate ? [] : [{ role: 'USER', content }]), { role: 'ASSISTANT', content: '', generationStatus: 'GENERATING' }]))
      const assistantNode = box.lastElementChild?.querySelector('.message-markdown'); scrollMessages()
      try {
        let generated = ''
        await streamAgentConversation(conversationId, { ...(regenerate ? { regenerate: true } : { content }), operationId: operationId() }, {
          signal: controller.signal,
          onMeta: payload => { running.generationId = payload.generationId },
          onDelta: delta => { generated += delta; if (assistantNode) assistantNode.innerHTML = renderMarkdownToHtml(generated); scrollMessages() },
          onDone: payload => { state.textContent = payload.generationStatus || 'COMPLETED' },
        })
        localStorage.removeItem(draftKey(conversationId))
        if (conversation.memoryEnabled && !regenerate && /(请记住|记住我的|帮我记住)/.test(content)) await renderMemoryPanel(agentId, document.getElementById('agent-memory-panel'))
      } catch (error) { if (error.name !== 'AbortError') { state.textContent = 'FAILED'; if (!regenerate) { input.value = content; localStorage.setItem(draftKey(conversationId), content) }; notify(error.message, true) } }
      finally { window.removeEventListener('hashchange', abortOnRouteChange); activeAgentGeneration = null; stop.hidden = true; setButtonBusy(button, false) }
      conversation = (await getAgentConversation(conversationId)).data
      document.getElementById('agent-messages').innerHTML = messagesHTML(conversation.messages || [])
      bindAnswerCopies(document.getElementById('agent-messages')); renderMathInMarkdownElements(document.getElementById('agent-messages')); scrollMessages()
    }
    document.getElementById('agent-message-form').addEventListener('submit', event => { event.preventDefault(); generate(false) })
    document.getElementById('agent-regenerate').addEventListener('click', () => generate(true))
  } catch (error) { renderMarketplaceLayout(app, `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>`) }
}
