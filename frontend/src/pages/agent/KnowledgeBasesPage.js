import {
  listKnowledgeBases, createKnowledgeBase, getKnowledgeBase, uploadKnowledgeDocument,
  refreshKnowledgeBaseStatus, applyKnowledgeBasePublic, deleteKnowledgeDocument, deleteKnowledgeBase,
} from '../../api/marketplace.js'
import { escapeHtml } from '../../utils/format.js'
import { renderMarketplaceLayout, loadingHTML, errorHTML, statusLabel, operationId, setButtonBusy, notify } from './marketplace-shared.js'

function kbCard(kb, scope) {
  const own = scope === 'mine'
  return `<article class="knowledge-card" data-kb-id="${kb.id}"><div class="knowledge-card-head"><div><h3>${escapeHtml(kb.name)}</h3><p>${escapeHtml(kb.description || '暂无简介')}</p></div><span class="agent-status status-${String(kb.status).toLowerCase()}">${statusLabel(kb.status)}</span></div>
    <div class="knowledge-meta"><span>${kb.documentCount || 0} 个文件</span><span>${Math.round((kb.totalSizeBytes || 0) / 1024)} KB</span><span>${kb.boundAgentCount || 0} 个智能体使用</span>${!own ? `<span>创建者：${escapeHtml(kb.owner?.name || '')}</span>` : ''}</div>
    <div class="agent-card-actions"><button class="complex-btn-secondary" data-kb-action="detail">查看详情</button>${own ? '<label class="complex-btn"><input hidden type="file" accept=".pdf,.docx,.md,.txt" data-kb-file>上传文件</label><button class="complex-btn-ghost" data-kb-action="refresh">刷新状态</button><button class="complex-btn-ghost" data-kb-action="apply">申请公开</button><button class="complex-btn-danger" data-kb-action="delete">删除</button>' : ''}</div>
    <div class="knowledge-documents" hidden></div></article>`
}

async function renderKnowledgeList(root, scope) {
  root.innerHTML = loadingHTML(scope === 'public' ? '正在加载公开知识库...' : '正在加载我的知识库...')
  try {
    const result = await listKnowledgeBases(scope === 'public' ? 'public' : undefined)
    const items = result.data.list || []
    root.innerHTML = items.length ? `<div class="knowledge-grid">${items.map(kb => kbCard(kb, scope)).join('')}</div>` : '<div class="agent-market-empty"><p>这里还没有知识库。</p></div>'
    root.querySelectorAll('.knowledge-card').forEach(card => {
      const id = Number(card.dataset.kbId)
      const item = items.find(kb => kb.id === id)
      card.addEventListener('click', async event => {
        const button = event.target.closest('[data-kb-action]')
        if (!button) return
        try {
          if (button.dataset.kbAction === 'detail') {
            setButtonBusy(button, true, '加载中...'); const detail = await getKnowledgeBase(id); const box = card.querySelector('.knowledge-documents'); box.hidden = false
            box.innerHTML = `<h4>文档列表</h4>${(detail.data.documents || []).map(doc => `<div><span>${escapeHtml(doc.originalName)}</span><span>${statusLabel(doc.status)}</span>${scope === 'mine' ? `<button data-delete-document="${doc.id}">删除</button>` : ''}</div>`).join('') || '<p>尚未上传文件。</p>'}`
            box.querySelectorAll('[data-delete-document]').forEach(docButton => docButton.addEventListener('click', async () => { if (!confirm('确认删除该文档吗？')) return; try { await deleteKnowledgeDocument(id, docButton.dataset.deleteDocument); notify('文档已删除'); await renderKnowledgeList(root, scope) } catch (error) { notify(error.message, true) } }))
            setButtonBusy(button, false)
          }
          if (button.dataset.kbAction === 'refresh') { setButtonBusy(button, true, '正在同步...'); await refreshKnowledgeBaseStatus(id); notify('状态已同步'); await renderKnowledgeList(root, scope) }
          if (button.dataset.kbAction === 'apply') { if (!confirm('知识库公开后，其他学生可只读绑定，但不能下载原文件。继续吗？')) return; setButtonBusy(button, true); await applyKnowledgeBasePublic(id, operationId()); notify('已提交知识库审核'); await renderKnowledgeList(root, scope) }
          if (button.dataset.kbAction === 'delete') { if (!confirm('确认删除知识库及其 Dify 索引和本地文件吗？')) return; setButtonBusy(button, true); await deleteKnowledgeBase(id); notify('知识库已删除'); await renderKnowledgeList(root, scope) }
        } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
      })
      card.querySelector('[data-kb-file]')?.addEventListener('change', async event => {
        const file = event.target.files?.[0]; if (!file) return
        const label = event.target.closest('label'); label.classList.add('is-busy'); event.target.disabled = true
        try { await uploadKnowledgeDocument(id, file, operationId()); notify('文件已上传，正在生成索引'); await renderKnowledgeList(root, scope) }
        catch (error) { notify(error.message, true); label.classList.remove('is-busy'); event.target.disabled = false; event.target.value = '' }
      })
    })
  } catch (error) { root.innerHTML = errorHTML(error.message); root.querySelector('[data-retry]')?.addEventListener('click', () => renderKnowledgeList(root, scope)) }
}

export async function renderKnowledgeBases(app) {
  renderMarketplaceLayout(app, `<section class="agent-market-hero"><div><h1>让知识库变成真正懂你的智能体</h1><p>系统会统一完成解析、切片、向量化与索引，你只需上传资料。</p></div><button id="kb-create-toggle" class="complex-btn">创建知识库</button></section>
    <form id="kb-create-form" class="knowledge-create-form is-hidden"><label>知识库名称<input id="kb-name" maxlength="100" required></label><label>简单简介<textarea id="kb-description" maxlength="1000"></textarea></label><button id="kb-create-submit" class="complex-btn" type="submit">创建</button><button id="kb-create-cancel" class="complex-btn-ghost" type="button">取消</button></form>
    <div class="knowledge-tabs"><button class="active" data-kb-scope="mine">我的知识库</button><button data-kb-scope="public">公开知识库</button><button data-kb-scope="processing">上传与处理任务</button></div><div id="knowledge-list-root">${loadingHTML()}</div>`, '#/student/agents/knowledge')
  const form = document.getElementById('kb-create-form'); const root = document.getElementById('knowledge-list-root')
  document.getElementById('kb-create-toggle').addEventListener('click', () => form.classList.remove('is-hidden'))
  document.getElementById('kb-create-cancel').addEventListener('click', () => form.classList.add('is-hidden'))
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = document.getElementById('kb-create-submit'); setButtonBusy(button, true, '正在连接 Dify...')
    try { await createKnowledgeBase({ name: document.getElementById('kb-name').value.trim(), description: document.getElementById('kb-description').value.trim(), operationId: operationId() }); notify('知识库创建成功'); form.reset(); form.classList.add('is-hidden'); await renderKnowledgeList(root, 'mine') }
    catch (error) { notify(error.message, true); setButtonBusy(button, false) }
  })
  document.querySelectorAll('[data-kb-scope]').forEach(button => button.addEventListener('click', async () => {
    document.querySelectorAll('[data-kb-scope]').forEach(item => item.classList.remove('active')); button.classList.add('active')
    if (button.dataset.kbScope === 'processing') {
      await renderKnowledgeList(root, 'mine'); root.querySelectorAll('.knowledge-card').forEach(card => { if (!/(uploading|parsing|indexing|failed)/.test(card.querySelector('.agent-status')?.className || '')) card.hidden = true })
    } else await renderKnowledgeList(root, button.dataset.kbScope)
  }))
  await renderKnowledgeList(root, 'mine')
}
