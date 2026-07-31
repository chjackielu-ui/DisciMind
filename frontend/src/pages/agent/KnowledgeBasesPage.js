import {
  listKnowledgeBases, createKnowledgeBase, getKnowledgeBase, uploadKnowledgeDocument,
  refreshKnowledgeBaseStatus, applyKnowledgeBasePublic, deleteKnowledgeDocument, deleteKnowledgeBase, updateKnowledgeBase,
  listDifyKnowledgeDatasets, bindDifyKnowledgeDatasets, bindBailianKnowledgeBase, syncDifyKnowledgeBase, retryKnowledgeDocument,
} from '../../api/marketplace.js'
import { BASE_URL } from '../../api/request.js'
import { getToken } from '../../utils/auth.js'
import { escapeHtml } from '../../utils/format.js'
import { renderMarketplaceLayout, loadingHTML, errorHTML, statusLabel, operationId, setButtonBusy, notify } from './marketplace-shared.js'
import { openAgentCardMenu } from './agent-card-menu.js'

const ACTIVE_STATUSES = new Set(['UPLOADING', 'UPLOADED', 'PARSING', 'PARSED', 'CHUNKING', 'CHUNKED', 'INDEXING', 'PROCESSING'])
const STAGES = ['uploaded', 'validation', 'parsing', 'chunking', 'indexing', 'available']
const STAGE_LABEL = { uploaded: '上传', validation: '校验', parsing: '解析', chunking: '分片', indexing: '索引', available: '可用', cancelled: '取消' }

function formatDate(value, compact = false) {
  if (!value) return '尚未同步'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未同步'
  return compact ? date.toLocaleDateString('zh-CN') : date.toLocaleString('zh-CN')
}

function displayName(kb) {
  return kb.nameRepairRequired ? '名称异常，请编辑' : `${kb.name}${kb.duplicateName ? ` #${kb.id}` : ''}`
}

function visibilityLabel(kb) {
  if (kb.visibility === 'PUBLIC') return '公开'
  if (kb.status === 'REVIEWING') return '审核中'
  return '私有'
}

function statusGroup(kb) {
  if (['READY', 'PUBLIC'].includes(kb.status)) return 'ready'
  if (ACTIVE_STATUSES.has(kb.status)) return 'processing'
  if (kb.status === 'PARTIAL') return 'partial'
  if (kb.status === 'FAILED') return 'failed'
  return 'disabled'
}

function sourceInfo(kb) {
  const source = String(kb.source || kb.provider || 'LOCAL').toUpperCase()
  if (source === 'BAILIAN_KNOWLEDGE') return { key: 'BAILIAN_KNOWLEDGE', label: '百炼', mark: 'B', fact: '百炼托管' }
  if (source === 'DIFY') return { key: 'DIFY', label: 'Dify', mark: 'D', fact: 'Dify 绑定' }
  return { key: 'LOCAL', label: '本地', mark: 'L', fact: '本地上传' }
}

function prepareItems(rawItems) {
  const nameCounts = rawItems.reduce((counts, item) => {
    const key = String(item.name || '').trim().toLocaleLowerCase()
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
    return counts
  }, new Map())
  return rawItems.map(item => ({
    ...item,
    duplicateName: !item.nameRepairRequired && (nameCounts.get(String(item.name || '').trim().toLocaleLowerCase()) || 0) > 1,
  }))
}

function summaryHtml(items) {
  const summary = items.reduce((result, item) => {
    result.total += 1
    result.documents += Number(item.documentCount || item.remoteDocumentCount || 0)
    const group = statusGroup(item)
    if (group === 'ready') result.ready += 1
    if (group === 'processing') result.processing += 1
    if (group === 'partial' || group === 'failed') result.partial += 1
    return result
  }, { total: 0, ready: 0, processing: 0, partial: 0, documents: 0 })
  return [
    ['知识库总数', summary.total], ['可用', summary.ready], ['处理中', summary.processing],
    ['部分失败', summary.partial], ['总文档数', summary.documents],
  ].map(([label, value]) => `<article><span>${label}</span><b>${value}</b></article>`).join('')
}

function kbCard(kb, scope, index) {
  const own = scope === 'mine'
  const allowUpload = own && kb.ownershipMode !== 'REMOTE_BOUND'
  const source = sourceInfo(kb)
  const group = statusGroup(kb)
  return `<article class="knowledge-card status-${group}" data-kb-id="${kb.id}" style="--kb-index:${Math.min(index, 8)}">
    <header class="knowledge-card-head">
      <span class="knowledge-source source-${source.key.toLowerCase()}" aria-label="${source.label}来源">${source.mark}</span>
      <div><h3>${escapeHtml(displayName(kb))}</h3><span>${source.label}知识库</span></div>
      <span class="agent-status status-${String(kb.status).toLowerCase()}">${statusLabel(kb.status)}</span>
    </header>
    ${kb.nameRepairRequired ? '<button type="button" class="knowledge-integrity-warning" data-kb-action="edit">名称异常，请立即编辑</button>' : ''}
    <p class="knowledge-card-description">${escapeHtml(kb.description || '暂无简介')}</p>
    <dl class="knowledge-card-stats">
      <div><dt>文档</dt><dd>${kb.documentCount || kb.remoteDocumentCount || 0}</dd></div><div><dt>可用</dt><dd>${kb.availableDocumentCount || (source.key === 'BAILIAN_KNOWLEDGE' && ['READY', 'PUBLIC'].includes(kb.status) ? kb.remoteDocumentCount || 1 : 0)}</dd></div>
      <div class="${Number(kb.failedDocumentCount) ? 'has-error' : ''}"><dt>失败</dt><dd>${kb.failedDocumentCount || 0}</dd></div><div><dt>智能体</dt><dd>${kb.boundAgentCount || 0}</dd></div>
    </dl>
    <div class="knowledge-card-facts"><span>${escapeHtml(formatDate(kb.updatedAt || kb.lastSyncedAt, true))}</span><span>${source.fact}</span><span>${visibilityLabel(kb)}</span></div>
    <footer class="knowledge-card-actions">
      <button type="button" class="complex-btn knowledge-open" data-kb-action="detail">打开知识库</button>
      ${allowUpload ? '<label class="knowledge-upload"><input hidden type="file" accept=".pdf,.docx,.md,.txt" multiple data-kb-file><span>上传文件</span></label>' : ''}
      ${own ? `<button type="button" class="knowledge-sync" data-kb-action="refresh" title="${source.key === 'DIFY' ? '同步 Dify' : '刷新处理状态'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6 6.5L4 11m16 2-2 4.5A7 7 0 0 1 5.5 15"/></svg><span>同步</span></button>` : ''}
      ${own && Number(kb.failedDocumentCount) > 0 ? '<button type="button" class="knowledge-retry" data-kb-action="retry-failed">重试失败</button>' : ''}
      ${own ? '<button type="button" class="knowledge-more-trigger" data-kb-action="more" aria-label="更多操作" aria-haspopup="menu">•••</button>' : ''}
    </footer>
  </article>`
}

function documentPipeline(doc) {
  const status = String(doc.status || '').toUpperCase()
  const terminalState = ['READY', 'AVAILABLE'].includes(status)
    ? 'available'
    : (['FAILED', 'CANCELLED'].includes(status) ? 'failed' : '')
  const current = String(terminalState || doc.processingState || ({
    UPLOADING: 'uploaded', UPLOADED: 'validation', PARSING: 'parsing', PARSED: 'chunking',
    CHUNKING: 'chunking', CHUNKED: 'indexing', INDEXING: 'indexing', PROCESSING: 'indexing',
  }[status] || '')).toLowerCase()
  const failedStage = String(doc.errorStage || '').toLowerCase()
  const activeIndex = STAGES.indexOf(current)
  return `<div class="knowledge-pipeline" aria-label="文档处理进度">${STAGES.map((stage, index) => {
    let className = ''
    if (current === 'failed') {
      if (stage === failedStage) className = 'failed'
      else if (index < Math.max(0, STAGES.indexOf(failedStage))) className = 'done'
    } else if (current === 'available' || index < activeIndex) className = 'done'
    else if (stage === current) className = 'active'
    return `<span class="${className}">${STAGE_LABEL[stage]}</span>`
  }).join('<i>→</i>')}</div>`
}

function renderDocumentDetail(detail, own) {
  const localRows = (detail.documents || []).map(doc => `<article class="knowledge-document-row status-${String(doc.status || '').toLowerCase()}">
    <header><div><b>${escapeHtml(doc.originalName)}</b><span>${statusLabel(doc.status)}</span></div><small>${doc.pageCount ? `${doc.pageCount} 页 · ` : ''}${doc.chunkCount != null ? `${doc.chunkCount} 个分片` : '分片数待更新'}</small></header>
    ${documentPipeline(doc)}
    ${doc.errorMessage ? `<p class="knowledge-document-error"><strong>${escapeHtml(STAGE_LABEL[String(doc.errorStage || '').toLowerCase()] || doc.errorStage || '处理')}失败：</strong>${escapeHtml(doc.errorMessage)}${doc.errorCode ? ` <small>${escapeHtml(doc.errorCode)}</small>` : ''}</p>` : ''}
    <footer>${doc.mimeType === 'application/pdf' ? `<button type="button" data-preview-document="${doc.id}" data-preview-name="${escapeHtml(doc.originalName)}">PDF 预览</button>` : ''}${own && ['FAILED', 'CANCELLED'].includes(doc.status) && doc.retryable !== false ? `<button type="button" data-retry-document="${doc.id}">重试</button>` : ''}${own ? `<button type="button" class="danger" data-delete-document="${doc.id}">删除</button>` : ''}</footer>
  </article>`).join('')
  const remoteRows = (detail.remoteDocuments || []).map(doc => `<article class="knowledge-document-row remote"><header><div><b>${escapeHtml(doc.name)}</b><span>${statusLabel(String(doc.status || '').toUpperCase())}</span></div><small>${doc.wordCount ? `${doc.wordCount} 词` : '远程文档'}</small></header></article>`).join('')
  return localRows || remoteRows || '<div class="knowledge-drawer-empty">尚未上传或同步文档。</div>'
}

function detailDrawerHtml(detail, item, own) {
  const source = sourceInfo(item)
  const datasetStatus = item.ownershipMode === 'REMOTE_BOUND' ? `${item.remoteDatasetId || item.difyDatasetId || '已绑定'} · ${statusLabel(item.status)}` : '由系统维护本地索引'
  return `<button type="button" class="knowledge-drawer-backdrop" data-close-kb-drawer aria-label="关闭知识库详情"></button>
    <aside class="knowledge-detail-drawer" aria-label="知识库详情">
      <header><div><span>${source.label}${item.ownershipMode === 'REMOTE_BOUND' ? '绑定' : '知识库'}</span><h2>${escapeHtml(displayName(item))}</h2><p>${escapeHtml(item.description || '暂无简介')}</p></div><button type="button" data-close-kb-drawer aria-label="关闭">×</button></header>
      ${item.nameRepairRequired ? `<div class="knowledge-drawer-warning"><b>名称异常，请编辑</b><span>原损坏名称：${escapeHtml(item.name || '空名称')}</span><button type="button" data-drawer-edit>立即编辑</button></div>` : ''}
      <section class="knowledge-detail-overview"><article><span>${source.label}数据集</span><b>${escapeHtml(datasetStatus)}</b></article><article><span>文档</span><b>${detail.documents?.length || item.documentCount || item.remoteDocumentCount || 0}</b></article><article><span>可用</span><b>${item.availableDocumentCount || (source.key === 'BAILIAN_KNOWLEDGE' && ['READY', 'PUBLIC'].includes(item.status) ? item.remoteDocumentCount || 1 : 0)}</b></article><article><span>最近更新</span><b>${escapeHtml(formatDate(item.updatedAt || item.lastSyncedAt, true))}</b></article></section>
      <section class="knowledge-detail-documents"><div class="knowledge-detail-title"><div><h3>文档与处理流水线</h3><p>上传 → 校验 → 解析 → 分片 → 索引 → 可用</p></div>${own && item.ownershipMode !== 'REMOTE_BOUND' ? '<label class="knowledge-upload"><input hidden type="file" accept=".pdf,.docx,.md,.txt" multiple data-drawer-file><span>上传文件</span></label>' : ''}</div><div class="knowledge-document-list">${renderDocumentDetail(detail, own)}</div></section>
    </aside>`
}

function filteredItems(state) {
  const query = state.search.trim().toLocaleLowerCase()
  const result = state.items.filter(item => {
    if (query && !`${displayName(item)} ${item.name || ''} ${item.description || ''}`.toLocaleLowerCase().includes(query)) return false
    if (state.source !== 'all' && String(item.source || 'LOCAL').toUpperCase() !== state.source) return false
    if (state.status !== 'all' && statusGroup(item) !== state.status) return false
    if (state.visibility !== 'all' && (state.visibility === 'public') !== (item.visibility === 'PUBLIC')) return false
    return true
  })
  return result.sort((a, b) => {
    if (state.sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    if (state.sort === 'documents') return Number(b.documentCount || 0) - Number(a.documentCount || 0)
    return new Date(b.updatedAt || b.lastSyncedAt || 0) - new Date(a.updatedAt || a.lastSyncedAt || 0)
  })
}

function renderKnowledgeGrid(root, state) {
  const items = filteredItems(state)
  state.byId = new Map(state.items.map(item => [Number(item.id), item]))
  root.classList.add('is-filtering')
  root.innerHTML = items.length
    ? `<div class="knowledge-grid ${state.view === 'list' ? 'is-list' : ''}">${items.map((item, index) => kbCard(item, state.scope, index)).join('')}</div>`
    : '<div class="agent-market-empty knowledge-empty"><p>当前条件下没有知识库。</p><span>可以调整筛选条件或创建新的知识库。</span></div>'
  requestAnimationFrame(() => root.classList.remove('is-filtering'))
}

async function uploadFiles(id, files, refresh, busyElement) {
  const list = [...(files || [])]
  if (!list.length) return
  busyElement?.classList.add('is-busy')
  let succeeded = 0
  for (const file of list) {
    try { await uploadKnowledgeDocument(id, file, operationId()); succeeded += 1 } catch (error) { notify(`${file.name}：${error.message}`, true) }
  }
  if (succeeded) notify(`${succeeded} 个文件已进入处理队列`)
  await refresh()
}

async function openPdfPreview(host, kbId, documentId, name) {
  host.querySelector('.knowledge-preview-modal')?.remove()
  const modal = document.createElement('div')
  modal.className = 'knowledge-preview-modal'
  modal.innerHTML = `<div><header><b>${escapeHtml(name || 'PDF 预览')}</b><button type="button" aria-label="关闭预览">×</button></header><div class="knowledge-preview-loading">正在读取 PDF…</div></div>`
  host.appendChild(modal)
  let objectUrl = ''
  const close = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); modal.remove() }
  modal.addEventListener('click', event => { if (event.target === modal || event.target.closest('header button')) close() })
  try {
    const response = await fetch(`${BASE_URL}/knowledge-bases/${kbId}/documents/${documentId}/preview`, { headers: { Authorization: `Bearer ${getToken()}` }, credentials: 'include' })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'PDF 预览失败')
    objectUrl = URL.createObjectURL(await response.blob())
    modal.querySelector('.knowledge-preview-loading').outerHTML = `<iframe title="${escapeHtml(name || 'PDF 预览')}" src="${objectUrl}"></iframe>`
  } catch (error) {
    modal.querySelector('.knowledge-preview-loading').textContent = error.message
  }
}

async function openDifyImport(panel, refresh) {
  panel.hidden = false
  panel.innerHTML = loadingHTML('正在读取 Dify Dataset...')
  try {
    const datasets = (await listDifyKnowledgeDatasets()).data.list || []
    panel.innerHTML = `<header><div><h3>从 Dify 导入</h3><p>仅绑定 Dataset 与文档元数据，不复制原文件或重复索引。</p></div><button type="button" data-close-dify>×</button></header><form id="kb-dify-form"><div class="knowledge-dify-list">${datasets.map(item => `<label class="${item.bound ? 'is-bound' : ''}"><input type="checkbox" value="${escapeHtml(item.id)}" ${item.bound ? 'disabled' : ''}><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || '暂无描述')}</small></span><em>${item.documentCount} 个文档 · ${item.bound ? '已绑定' : statusLabel(item.status)}</em></label>`).join('') || '<p>当前配置下没有可访问的 Dataset。</p>'}</div><button class="complex-btn" type="submit">绑定所选 Dataset</button></form>`
    panel.querySelector('[data-close-dify]').onclick = () => { panel.hidden = true }
    panel.querySelector('form').onsubmit = async event => {
      event.preventDefault()
      const ids = [...panel.querySelectorAll('input:checked')].map(input => input.value)
      if (!ids.length) return notify('请选择至少一个 Dataset', true)
      setButtonBusy(event.submitter, true, '正在绑定...')
      try { await bindDifyKnowledgeDatasets(ids); notify('Dify 知识库已绑定'); panel.hidden = true; await refresh() } catch (error) { notify(error.message, true); setButtonBusy(event.submitter, false) }
    }
  } catch (error) {
    panel.innerHTML = errorHTML(error.message)
    panel.querySelector('[data-retry]')?.addEventListener('click', () => openDifyImport(panel, refresh))
  }
}

async function openBailianBinding(panel, refresh) {
  panel.hidden = false
  panel.innerHTML = loadingHTML('正在准备百炼知识库绑定...')
  try {
    panel.innerHTML = `<header><div><h3>绑定百炼知识库</h3><p>把百炼“知识检索”页里的服务 ID（aid-...）绑定到 DisciMind，这样智能体即可调用百炼完成检索。</p></div><button type="button" data-close-bailian>×</button></header>
      <form id="kb-bailian-form" class="knowledge-create-form">
        <label>知识库名称<input id="bailian-name" maxlength="100" required placeholder="例如：周志华-机器学习"></label>
        <label>知识检索服务 ID<input id="bailian-id" maxlength="255" required placeholder="例如：aid-b78133e4f2c84d11b4b77e0a962d17ec"></label>
        <p class="knowledge-form-hint">截图中“知识检索”卡片下面的 aid 服务 ID 就是这里要填写的值，后端会通过 agent_id 调用检索服务。</p>
        <label>简单简介<textarea id="bailian-description" maxlength="1000" placeholder="可选：知识库用途说明"></textarea></label>
        <label>文档数<input id="bailian-count" type="number" min="0" step="1" value="0"></label>
        <button class="complex-btn" type="submit">绑定</button>
      </form>`
    panel.querySelector('[data-close-bailian]').onclick = () => { panel.hidden = true }
    panel.querySelector('form').onsubmit = async event => {
      event.preventDefault()
      setButtonBusy(event.submitter, true, '正在绑定...')
      try {
        await bindBailianKnowledgeBase({
          name: document.getElementById('bailian-name').value.trim(),
          knowledgeBaseId: document.getElementById('bailian-id').value.trim(),
          description: document.getElementById('bailian-description').value.trim(),
          remoteDocumentCount: Number(document.getElementById('bailian-count').value || 0),
          operationId: operationId(),
        })
        notify('百炼知识库已绑定')
        panel.hidden = true
        await refresh()
      } catch (error) {
        notify(error.message, true)
        setButtonBusy(event.submitter, false)
      }
    }
  } catch (error) {
    panel.innerHTML = errorHTML(error.message)
  }
}

export async function renderKnowledgeBases(app) {
  renderMarketplaceLayout(app, `<div class="knowledge-page">
    <section class="knowledge-console-head"><div><span>知识资产管理</span><h1>我的知识库</h1><p>管理本地文档、Dify Dataset 与百炼知识库的解析、分片和索引状态。</p></div><div><button id="kb-bailian-toggle" class="complex-btn-secondary">绑定百炼知识库</button><button id="kb-dify-toggle" class="complex-btn-secondary">从 Dify 导入</button><button id="kb-create-toggle" class="complex-btn">创建知识库</button></div></section>
    <form id="kb-create-form" class="knowledge-create-form is-hidden"><label>知识库名称<input id="kb-name" maxlength="100" required></label><label>简单简介<textarea id="kb-description" maxlength="1000"></textarea></label><button id="kb-create-submit" class="complex-btn" type="submit">创建</button><button id="kb-create-cancel" class="complex-btn-ghost" type="button">取消</button></form>
    <section class="knowledge-dify-panel" id="kb-dify-panel" hidden></section>
    <section class="knowledge-dify-panel" id="kb-bailian-panel" hidden></section>
    <section class="knowledge-summary" id="knowledge-summary" aria-label="知识库数据摘要"></section>
    <section class="knowledge-toolbar">
      <div class="knowledge-tabs"><button class="active" data-kb-scope="mine">我的知识库</button><button data-kb-scope="public">公开知识库</button></div>
      <label class="knowledge-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg><input id="kb-search" type="search" placeholder="搜索名称或描述"></label>
      <select id="kb-source" aria-label="来源"><option value="all">全部来源</option><option value="LOCAL">本地</option><option value="DIFY">Dify</option></select>
      <select id="kb-status" aria-label="状态"><option value="all">全部状态</option><option value="ready">可用</option><option value="processing">处理中</option><option value="partial">部分失败</option><option value="failed">失败</option></select>
      <select id="kb-visibility" aria-label="公开状态"><option value="all">全部权限</option><option value="private">私有</option><option value="public">公开</option></select>
      <select id="kb-sort" aria-label="排序"><option value="updated">最近更新</option><option value="name">名称</option><option value="documents">文档数</option></select>
      <div class="knowledge-view-toggle"><button class="active" data-kb-view="cards" aria-label="卡片视图">▦</button><button data-kb-view="list" aria-label="列表视图">☷</button></div>
    </section>
    <div id="knowledge-list-root">${loadingHTML()}</div><div id="knowledge-overlay-root"></div>
  </div>`, '#/student/agents/knowledge')

  const page = document.querySelector('.knowledge-page')
  const root = document.getElementById('knowledge-list-root')
  const overlayRoot = document.getElementById('knowledge-overlay-root')
  const summary = document.getElementById('knowledge-summary')
  const form = document.getElementById('kb-create-form')
  const difyPanel = document.getElementById('kb-dify-panel')
  const bailianPanel = document.getElementById('kb-bailian-panel')
  const state = { scope: 'mine', search: '', source: 'all', status: 'all', visibility: 'all', sort: 'updated', view: 'cards', items: [], byId: new Map(), refreshTimer: null }

  const scheduleRefresh = () => {
    clearTimeout(state.refreshTimer)
    if (state.scope === 'mine' && state.items.some(item => ACTIVE_STATUSES.has(item.status))) {
      state.refreshTimer = setTimeout(() => { if (page?.isConnected) loadItems({ silent: true }) }, 8000)
    }
  }
  const loadItems = async ({ silent = false } = {}) => {
    if (!silent) root.innerHTML = loadingHTML(state.scope === 'public' ? '正在加载公开知识库...' : '正在加载我的知识库...')
    try {
      const response = await listKnowledgeBases(state.scope === 'public' ? 'public' : undefined)
      state.items = prepareItems(response.data.list || [])
      summary.innerHTML = summaryHtml(state.items)
      renderKnowledgeGrid(root, state)
      scheduleRefresh()
    } catch (error) {
      root.innerHTML = errorHTML(error.message)
      root.querySelector('[data-retry]')?.addEventListener('click', () => loadItems())
    }
  }
  const closeDrawer = () => { overlayRoot.innerHTML = '' }
  const openDrawer = async id => {
    state.activeId = Number(id)
    const item = state.byId.get(Number(id))
    if (!item) return
    overlayRoot.innerHTML = '<button class="knowledge-drawer-backdrop"></button><aside class="knowledge-detail-drawer is-loading">正在加载知识库详情…</aside>'
    try {
      const detail = (await getKnowledgeBase(id)).data
      overlayRoot.innerHTML = detailDrawerHtml(detail, item, state.scope === 'mine')
    } catch (error) { overlayRoot.innerHTML = `<button class="knowledge-drawer-backdrop" data-close-kb-drawer></button><aside class="knowledge-detail-drawer">${errorHTML(error.message)}</aside>` }
  }
  const editItem = async item => {
    const name = prompt('知识库名称', item.nameRepairRequired ? '' : item.name)?.trim()
    if (!name) return
    const description = prompt('知识库简介', item.description || '')
    await updateKnowledgeBase(item.id, { name, description: description == null ? item.description || '' : description.trim() })
    notify('知识库信息已更新')
    closeDrawer()
    await loadItems({ silent: true })
  }

  root.addEventListener('click', async event => {
    const card = event.target.closest('[data-kb-id]')
    const button = event.target.closest('[data-kb-action]')
    if (!card || !button) return
    const id = Number(card.dataset.kbId)
    const item = state.byId.get(id)
    try {
      if (button.dataset.kbAction === 'more') {
        const items = [
          { action: 'edit', label: '编辑' },
          item.ownershipMode !== 'REMOTE_BOUND'
            ? { action: 'apply', label: '申请公开' }
            : { action: 'detail', label: '查看远端信息' },
          { action: 'delete', label: '删除', danger: true },
        ]
        return openAgentCardMenu(button, items, menuAction => {
          const proxy = document.createElement('button')
          proxy.type = 'button'
          proxy.dataset.kbAction = menuAction
          card.appendChild(proxy)
          proxy.click()
          proxy.remove()
        })
      }
      if (button.dataset.kbAction === 'detail') await openDrawer(id)
      if (button.dataset.kbAction === 'refresh') {
        setButtonBusy(button, true, '同步中')
        if (item.source === 'DIFY') await syncDifyKnowledgeBase(id)
        else await refreshKnowledgeBaseStatus(id)
        notify('状态已同步')
        await loadItems({ silent: true })
      }
      if (button.dataset.kbAction === 'retry-failed') {
        setButtonBusy(button, true, '排队中')
        const detail = (await getKnowledgeBase(id)).data
        const failed = (detail.documents || []).filter(doc => ['FAILED', 'CANCELLED'].includes(doc.status) && doc.retryable !== false)
        for (const doc of failed) await retryKnowledgeDocument(id, doc.id)
        notify(`${failed.length} 个失败文档已重新排队`)
        await loadItems({ silent: true })
      }
      if (button.dataset.kbAction === 'edit') await editItem(item)
      if (button.dataset.kbAction === 'apply') { if (!confirm('知识库公开后，其他学生可只读使用。继续吗？')) return; await applyKnowledgeBasePublic(id, operationId()); notify('已提交知识库审核'); await loadItems({ silent: true }) }
      if (button.dataset.kbAction === 'delete') { if (!confirm(item.ownershipMode === 'REMOTE_BOUND' ? '仅删除本地绑定，不会删除远程平台知识库。确定继续吗？' : '确认删除知识库、远端索引和本地文件吗？')) return; await deleteKnowledgeBase(id); notify('知识库已删除'); await loadItems({ silent: true }) }
    } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
  })
  root.addEventListener('change', async event => {
    const input = event.target.closest('[data-kb-file]')
    if (!input) return
    const card = input.closest('[data-kb-id]')
    await uploadFiles(Number(card.dataset.kbId), input.files, () => loadItems({ silent: true }), input.closest('label'))
  })
  root.addEventListener('click', event => {
    const card = event.target.closest('[data-kb-id]')
    if (card && !event.target.closest('button,label,summary,details,input')) openDrawer(Number(card.dataset.kbId))
  })
  overlayRoot.addEventListener('click', async event => {
    if (event.target.closest('[data-close-kb-drawer]')) return closeDrawer()
    const drawer = event.target.closest('.knowledge-detail-drawer')
    const backdrop = event.target.closest('.knowledge-drawer-backdrop')
    if (backdrop && !drawer) return closeDrawer()
    const item = state.byId.get(Number(drawer?.closest('[data-kb-id]')?.dataset.kbId)) || state.byId.get(Number(state.activeId))
    if (event.target.closest('[data-drawer-edit]') && item) return editItem(item)
    const preview = event.target.closest('[data-preview-document]')
    if (preview) return openPdfPreview(page, state.activeId, preview.dataset.previewDocument, preview.dataset.previewName)
    const retry = event.target.closest('[data-retry-document]')
    if (retry) { try { setButtonBusy(retry, true, '排队中'); await retryKnowledgeDocument(state.activeId, retry.dataset.retryDocument); notify('文档已重新排队'); await openDrawer(state.activeId); await loadItems({ silent: true }) } catch (error) { notify(error.message, true); setButtonBusy(retry, false) } }
    const remove = event.target.closest('[data-delete-document]')
    if (remove && confirm('确认删除该文档及其远端索引吗？')) { try { await deleteKnowledgeDocument(state.activeId, remove.dataset.deleteDocument); notify('文档已删除'); await openDrawer(state.activeId); await loadItems({ silent: true }) } catch (error) { notify(error.message, true) } }
  })
  overlayRoot.addEventListener('change', event => {
    const input = event.target.closest('[data-drawer-file]')
    if (input) uploadFiles(state.activeId, input.files, async () => { await loadItems({ silent: true }); await openDrawer(state.activeId) }, input.closest('label'))
  })
  document.getElementById('kb-create-toggle').addEventListener('click', () => form.classList.remove('is-hidden'))
  document.getElementById('kb-create-cancel').addEventListener('click', () => form.classList.add('is-hidden'))
  document.getElementById('kb-dify-toggle').addEventListener('click', () => openDifyImport(difyPanel, () => loadItems({ silent: true })))
  document.getElementById('kb-bailian-toggle').addEventListener('click', () => openBailianBinding(bailianPanel, () => loadItems({ silent: true })))
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const button = document.getElementById('kb-create-submit')
    setButtonBusy(button, true, '正在创建...')
    try { await createKnowledgeBase({ name: document.getElementById('kb-name').value.trim(), description: document.getElementById('kb-description').value.trim(), operationId: operationId() }); notify('知识库创建成功'); form.reset(); form.classList.add('is-hidden'); await loadItems() } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
  })
  document.querySelectorAll('[data-kb-scope]').forEach(button => button.addEventListener('click', async () => {
    document.querySelectorAll('[data-kb-scope]').forEach(item => item.classList.toggle('active', item === button))
    state.scope = button.dataset.kbScope
    await loadItems()
  }))
  const bindFilter = (id, key, eventName = 'change') => document.getElementById(id).addEventListener(eventName, event => { state[key] = event.target.value; renderKnowledgeGrid(root, state) })
  bindFilter('kb-search', 'search', 'input'); bindFilter('kb-source', 'source'); bindFilter('kb-status', 'status'); bindFilter('kb-visibility', 'visibility'); bindFilter('kb-sort', 'sort')
  document.querySelectorAll('[data-kb-view]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-kb-view]').forEach(item => item.classList.toggle('active', item === button)); state.view = button.dataset.kbView; renderKnowledgeGrid(root, state) }))

  await loadItems()
}
