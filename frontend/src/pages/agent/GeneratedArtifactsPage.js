import {
  deleteGeneratedArtifact,
  downloadGeneratedArtifactExport,
  exportGeneratedArtifact,
  getGeneratedArtifact,
  listGeneratedArtifacts,
  bulkDeleteGeneratedArtifacts,
  createLearningFlowResourceLink,
} from '../../api/marketplace.js'
import { learningWorkflowApi } from '../../api/learning-workflows.js'
import { learningGoalApi } from '../../api/learning-goals.js'
import { getStudentCourses, getStudentCourseKnowledgePoints } from '../../api/student.js'
import DOMPurify from 'dompurify'
import { escapeHtml } from '../../utils/format.js'
import { errorHTML, loadingHTML, notify, operationId, renderMarketplaceLayout, setButtonBusy } from './marketplace-shared.js'
import { agentIconHTML } from '../../components/agent-icon.js'

const ACTIVE_STATUSES = new Set(['DRAFT', 'GENERATING', 'EXPORTING'])
const typeLabel = value => value === 'STUDY_HANDOUT' ? '学习讲义' : '试卷'
const statusLabel = value => ({
  DRAFT: '生成中', GENERATING: '生成中', CONTENT_READY: '生成中', EXPORTING: '生成中', READY: '可下载',
  DOWNLOADABLE: '可下载', CANCELLED: '已取消', FAILED: '生成失败', EXPIRED: '已过期', DELETING: '正在删除', DELETED: '已删除',
}[value] || value)
const formatDate = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const formatSize = value => value == null ? '—' : value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
const dataOf = response => response?.data ?? response
const roleLabel = value => ({ PRE_CLASS_HANDOUT: '课前讲义', REFERENCE_MATERIAL: '参考资料', PRACTICE_PAPER: '练习试卷', REVIEW_MATERIAL: '复习资料' }[value] || value)

function safePreviewHtml(value) {
  return DOMPurify.sanitize(String(value || ''), {
    FORBID_TAGS: ['script', 'iframe', 'form', 'button', 'input', 'select', 'textarea', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['src', 'href', 'action', 'formaction', 'download', 'srcdoc'],
    ALLOW_DATA_ATTR: false,
  })
}

async function openLearningFlowSelector(artifact) {
  const overlay = document.createElement('div')
  overlay.className = 'lf-modal-overlay artifact-link-overlay'
  overlay.innerHTML = '<section class="lf-modal"><div class="lf-loading"><i></i>正在加载学习流选项…</div></section>'
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  try {
    const [courseResponse, templateResponse] = await Promise.all([
      getStudentCourses(), learningWorkflowApi.listTemplates({ source: 'ALL', pageSize: 48 }),
    ])
    const courses = dataOf(courseResponse)?.list || []
    const templates = dataOf(templateResponse)?.items || []
    const render = async courseId => {
      const selectedCourseId = Number(courseId || artifact.courseId || courses[0]?.course_id)
      const [pointResponse, goalResponse] = selectedCourseId ? await Promise.all([
        getStudentCourseKnowledgePoints(selectedCourseId), learningGoalApi.list({ courseId: selectedCourseId, pageSize: 50 }),
      ]) : [{ data: { list: [] } }, { data: { items: [] } }]
      const points = dataOf(pointResponse)?.list || []
      const goals = dataOf(goalResponse)?.items || []
      const selectedPointId = (artifact.knowledgePointIds || []).find(id => points.some(point => Number(point.knowledge_point_id) === Number(id))) || points[0]?.knowledge_point_id || ''
      const visibleTemplates = templates.filter(item => !item.course_id || Number(item.course_id) === selectedCourseId)
      const prefill = artifact.requirements?.learningFlowPrefill || {}
      overlay.querySelector('.lf-modal').innerHTML = `<header class="lf-modal-head"><div><span class="lf-wizard-step">加入学习流</span><h2>${escapeHtml(artifact.title)}</h2><p>选择真实课程、知识点和学习目标；重复提交不会创建重复关联。</p></div><button class="lf-icon-button" data-close>×</button></header><form id="artifact-link-form"><div class="lf-modal-body artifact-link-form"><label>课程<select id="artifact-link-course" required>${courses.map(item => `<option value="${item.course_id}" ${Number(item.course_id) === selectedCourseId ? 'selected' : ''}>${escapeHtml(item.course_name)}</option>`).join('')}</select></label><label>知识点<select id="artifact-link-point"><option value="">不限定</option>${points.map(item => `<option value="${item.knowledge_point_id}" ${Number(item.knowledge_point_id) === Number(prefill.knowledgePointId || selectedPointId) ? 'selected' : ''}>${escapeHtml(item.knowledge_point_name)}</option>`).join('')}</select></label><label>学习目标<select id="artifact-link-goal"><option value="">不限定</option>${goals.map(item => `<option value="${item.goalId}" ${Number(item.goalId) === Number(prefill.learningGoalId) ? 'selected' : ''}>${escapeHtml(item.normalizedTitle || item.rawGoal)}</option>`).join('')}</select></label><label>工作流模板<select id="artifact-link-template"><option value="">不限定</option>${visibleTemplates.map(item => `<option value="${item.template_id}" ${Number(item.template_id) === Number(prefill.workflowTemplateId) ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></label><label>资料用途<select id="artifact-link-role">${['PRE_CLASS_HANDOUT','REFERENCE_MATERIAL','PRACTICE_PAPER','REVIEW_MATERIAL'].map(value => `<option value="${value}" ${(prefill.resourceRole || (artifact.artifactType === 'STUDY_HANDOUT' ? 'PRE_CLASS_HANDOUT' : 'PRACTICE_PAPER')) === value ? 'selected' : ''}>${roleLabel(value)}</option>`).join('')}</select></label><div id="artifact-link-result"></div></div><footer class="lf-modal-foot"><button class="lf-button secondary" type="button" data-close>取消</button><button class="lf-button primary" id="artifact-link-submit" type="submit">确认加入</button></footer></form>`
      overlay.querySelectorAll('[data-close]').forEach(button => button.onclick = close)
      overlay.querySelector('#artifact-link-course').onchange = event => render(event.target.value)
      overlay.querySelector('#artifact-link-form').onsubmit = async event => {
        event.preventDefault(); const button = overlay.querySelector('#artifact-link-submit'); setButtonBusy(button, true, '正在加入...')
        const value = id => Number(overlay.querySelector(id).value) || null
        const payload = { courseId: value('#artifact-link-course'), knowledgePointId: value('#artifact-link-point'), learningGoalId: value('#artifact-link-goal'), workflowTemplateId: value('#artifact-link-template'), resourceRole: overlay.querySelector('#artifact-link-role').value }
        try {
          await createLearningFlowResourceLink(artifact.id, payload)
          notify('资料已加入学习流。')
          const query = new URLSearchParams({ courseId: String(payload.courseId), resources: '1' })
          if (payload.knowledgePointId) query.set('knowledgePointId', String(payload.knowledgePointId))
          if (payload.workflowTemplateId) query.set('flowId', String(payload.workflowTemplateId))
          overlay.querySelector('#artifact-link-result').innerHTML = `<div class="artifact-link-success">资料已加入学习流。 <a href="#/student/learning-flows?${query}">前往学习流</a></div>`
          setButtonBusy(button, false)
        } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
      }
    }
    await render(artifact.courseId)
  } catch (error) { overlay.querySelector('.lf-modal').innerHTML = `<div class="lf-empty"><h3>无法加载关联选项</h3><p>${escapeHtml(error.message)}</p><button class="lf-button secondary" data-close>关闭</button></div>`; overlay.querySelector('[data-close]').onclick = close }
}

function artifactCard(item) {
  const byFormat = new Map((item.exports || []).map(entry => [entry.format, entry]))
  const formatState = format => exportStatusLabel(byFormat.get(format)?.status)
  const linked = (item.learningFlowLinks || []).length > 0
  const publicStatus = item.publicStatus || 'GENERATING'
  return `<article class="artifact-card" data-artifact-id="${item.id}"><label class="artifact-select"><input type="checkbox" data-artifact-select value="${item.id}"><span>选择</span></label><div class="artifact-card-top"><span class="artifact-type">${typeLabel(item.artifactType)}</span><span class="artifact-status is-${String(publicStatus).toLowerCase()}">${statusLabel(publicStatus)}</span></div><div class="artifact-card-title">${agentIconHTML(item.sourceAgent || { iconKey: item.artifactType === 'STUDY_HANDOUT' ? 'lecture' : 'exam' }, { size: 38 })}<h2>${escapeHtml(item.title)}</h2></div><p>${escapeHtml(item.description || '由文件生成智能体创建的学习资料')}</p><div class="artifact-card-context"><span>${escapeHtml(item.sourceAgent?.name || '文件生成智能体')}</span><span>${escapeHtml(item.course?.name || '未限定课程')}</span><span>${escapeHtml((item.knowledgePoints || []).map(point => point.name).join('、') || '未限定知识点')}</span></div><dl><div><dt>生成时间</dt><dd>${formatDate(item.createdAt)}</dd></div><div><dt>DOCX</dt><dd class="is-${String(byFormat.get('DOCX')?.status || 'empty').toLowerCase()}">${formatState('DOCX')}</dd></div><div><dt>PDF</dt><dd class="is-${String(byFormat.get('PDF')?.status || 'empty').toLowerCase()}">${formatState('PDF')}</dd></div><div><dt>学习流</dt><dd>${linked ? '已加入' : '未关联'}</dd></div></dl><div class="artifact-card-actions"><a class="complex-btn-secondary" href="#/student/artifacts/${item.id}">预览</a>${['DOCX','PDF'].map(format => byFormat.get(format)?.status === 'READY' && byFormat.get(format)?.downloadAvailable === true ? `<button data-list-download="${format}">下载 ${format}</button>` : byFormat.get(format)?.status === 'FAILED' ? `<button data-list-retry="${format}">重导 ${format}</button>` : '').join('')}<button data-list-link>${linked ? '再次关联' : '加入学习流'}</button>${item.sourceConversation ? `<a href="#/student/agents/${item.agentId}/chat/${item.sourceConversation.id}">来源对话</a>` : ''}<button class="danger" data-list-delete>删除</button></div></article>`
}

export async function renderGeneratedArtifacts(app) {
  renderMarketplaceLayout(app, `<section class="agent-market-hero artifact-hero"><div><h1>我的产物</h1><p>统一管理智能体生成的学习资料和文件。</p></div><a class="complex-btn" href="#/student/agents?agentType=FILE_GENERATOR">使用生成助手</a></section><section class="artifact-list-toolbar"><div class="artifact-filter-tabs" id="artifact-filter-tabs"></div><label class="artifact-search"><input id="artifact-search" placeholder="搜索标题、课程、知识点或来源智能体"></label><select id="artifact-agent-filter"><option value="">全部智能体</option></select><input type="date" id="artifact-date-filter" title="生成日期"><select id="artifact-sort"><option value="recent">最近生成</option><option value="accessed">最近访问</option><option value="size">文件大小</option><option value="title">标题</option></select><button type="button" id="artifact-bulk-delete" disabled>批量删除</button></section><div id="artifact-list-root">${loadingHTML('正在读取产物...')}</div>`, '#/student/artifacts')
  const root = document.getElementById('artifact-list-root')
  try {
    const result = await listGeneratedArtifacts({ pageSize: 100 })
    const records = result.data.list || []
    const params = new URLSearchParams(location.hash.split('?')[1] || '')
    const state = { filter: params.get('filter') || 'all', q: params.get('q') || '', sort: params.get('sort') || 'recent', agentId: params.get('agentId') || '', date: params.get('date') || '', selected: new Set() }
    const tabs = [['all','全部'],['handout','学习讲义'],['exam','考试试卷'],['generating','生成中'],['ready','可下载'],['failed','失败'],['cancelled','已取消'],['linked','已加入学习流']]
    const persist = () => { const query = new URLSearchParams(); if (state.filter !== 'all') query.set('filter', state.filter); if (state.q) query.set('q', state.q); if (state.sort !== 'recent') query.set('sort', state.sort); if (state.agentId) query.set('agentId', state.agentId); if (state.date) query.set('date', state.date); history.replaceState(null, '', `#/student/artifacts${query.toString() ? `?${query}` : ''}`) }
    const renderList = () => {
      document.getElementById('artifact-filter-tabs').innerHTML = tabs.map(([key,label]) => `<button class="${state.filter === key ? 'active' : ''}" data-artifact-filter="${key}">${label}</button>`).join('')
      let visible = records.filter(item => {
        const linked = (item.learningFlowLinks || []).length > 0
        if (state.filter === 'handout' && item.artifactType !== 'STUDY_HANDOUT') return false
        if (state.filter === 'exam' && item.artifactType !== 'EXAM_PAPER') return false
        if (state.filter === 'generating' && item.publicStatus !== 'GENERATING') return false
        if (state.filter === 'ready' && item.publicStatus !== 'DOWNLOADABLE') return false
        if (state.filter === 'failed' && item.publicStatus !== 'FAILED') return false
        if (state.filter === 'cancelled' && item.publicStatus !== 'CANCELLED') return false
        if (state.filter === 'linked' && !linked) return false
        if (state.agentId && Number(item.agentId) !== Number(state.agentId)) return false
        if (state.date && String(item.createdAt || '').slice(0, 10) !== state.date) return false
        const haystack = [item.title, item.course?.name, item.sourceAgent?.name, ...(item.knowledgePoints || []).map(point => point.name)].join(' ').toLowerCase()
        return !state.q || haystack.includes(state.q.toLowerCase())
      })
      const readySize = item => Math.max(0, ...(item.exports || []).map(entry => Number(entry.fileSizeBytes || 0)))
      visible.sort((a,b) => state.sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : state.sort === 'size' ? readySize(b) - readySize(a) : state.sort === 'accessed' ? new Date(b.lastAccessedAt || 0) - new Date(a.lastAccessedAt || 0) : new Date(b.createdAt) - new Date(a.createdAt))
      root.innerHTML = visible.length ? `<div class="artifact-grid">${visible.map(artifactCard).join('')}</div>` : '<div class="agent-market-empty"><h2>没有匹配的产物</h2><p>可以调整筛选，或使用文件生成智能体创建学习讲义和试卷。</p><a class="complex-btn" href="#/student/agents?agentType=FILE_GENERATOR">使用生成助手</a></div>'
      root.querySelectorAll('[data-artifact-select]').forEach(input => { input.checked = state.selected.has(Number(input.value)); input.onchange = () => { input.checked ? state.selected.add(Number(input.value)) : state.selected.delete(Number(input.value)); document.getElementById('artifact-bulk-delete').disabled = !state.selected.size } })
      document.querySelectorAll('[data-artifact-filter]').forEach(button => button.onclick = () => { state.filter = button.dataset.artifactFilter; persist(); renderList() })
      root.querySelectorAll('.artifact-card').forEach(card => {
        const artifact = records.find(item => Number(item.id) === Number(card.dataset.artifactId)); if (!artifact) return
        card.querySelectorAll('[data-list-download]').forEach(button => button.onclick = async () => { setButtonBusy(button, true, '下载中...'); try { await downloadGeneratedArtifactExport(artifact.id, button.dataset.listDownload, `${artifact.title}.${button.dataset.listDownload.toLowerCase()}`) } catch (error) { notify(error.message, true) } finally { setButtonBusy(button, false) } })
        card.querySelectorAll('[data-list-retry]').forEach(button => button.onclick = async () => { setButtonBusy(button, true, '排队中...'); try { await exportGeneratedArtifact(artifact.id, operationId(), [button.dataset.listRetry]); notify(`已重新导出 ${button.dataset.listRetry}`); window.location.hash = `#/student/artifacts/${artifact.id}?format=${button.dataset.listRetry}` } catch (error) { notify(error.message, true); setButtonBusy(button, false) } })
        card.querySelector('[data-list-link]')?.addEventListener('click', () => openLearningFlowSelector(artifact))
        card.querySelector('[data-list-delete]')?.addEventListener('click', async buttonEvent => { if (!confirm('删除产物后将无法恢复，确定继续吗？')) return; setButtonBusy(buttonEvent.currentTarget, true, '删除中...'); try { await deleteGeneratedArtifact(artifact.id); records.splice(records.indexOf(artifact), 1); notify('产物已删除'); renderList() } catch (error) { notify(error.message, true); setButtonBusy(buttonEvent.currentTarget, false) } })
      })
    }
    document.getElementById('artifact-search').value = state.q; document.getElementById('artifact-sort').value = state.sort
    const agentOptions = new Map(records.filter(item => item.agentId).map(item => [item.agentId, item.sourceAgent?.name || `智能体 ${item.agentId}`]))
    const agentFilter = document.getElementById('artifact-agent-filter'); agentFilter.innerHTML += [...agentOptions].map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join(''); agentFilter.value = state.agentId
    document.getElementById('artifact-date-filter').value = state.date
    let timer; document.getElementById('artifact-search').oninput = event => { clearTimeout(timer); timer = setTimeout(() => { state.q = event.target.value.trim(); persist(); renderList() }, 220) }
    document.getElementById('artifact-sort').onchange = event => { state.sort = event.target.value; persist(); renderList() }
    agentFilter.onchange = event => { state.agentId = event.target.value; persist(); renderList() }
    document.getElementById('artifact-date-filter').onchange = event => { state.date = event.target.value; persist(); renderList() }
    document.getElementById('artifact-bulk-delete').onclick = async event => { if (!state.selected.size || !confirm(`确定删除选中的 ${state.selected.size} 个产物吗？`)) return; setButtonBusy(event.currentTarget, true, '删除中...'); try { await bulkDeleteGeneratedArtifacts([...state.selected]); for (let index = records.length - 1; index >= 0; index -= 1) if (state.selected.has(Number(records[index].id))) records.splice(index, 1); state.selected.clear(); notify('已批量删除产物'); renderList() } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) } }
    renderList()
  } catch (error) {
    root.innerHTML = errorHTML(error.message)
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderGeneratedArtifacts(app))
  }
}

function metadata(artifact) {
  const prefill = artifact.requirements?.learningFlowPrefill || {}
  const linkGoal = artifact.learningFlowLinks?.find(item => item.learningGoal)?.learningGoal
  return `<dl class="artifact-metadata"><div><dt>类型</dt><dd>${typeLabel(artifact.artifactType)}</dd></div><div><dt>状态</dt><dd>${statusLabel(artifact.status)}</dd></div><div><dt>来源智能体</dt><dd>${escapeHtml(artifact.sourceAgent?.name || '文件生成智能体')}</dd></div><div><dt>来源会话</dt><dd>${escapeHtml(artifact.sourceConversation?.title || `会话 ${artifact.conversationId}`)}</dd></div><div><dt>课程</dt><dd>${escapeHtml(artifact.course?.name || '未限定')}</dd></div><div><dt>知识点</dt><dd>${escapeHtml((artifact.knowledgePoints || []).map(item => item.name).join('、') || '未限定')}</dd></div><div><dt>学习目标</dt><dd>${escapeHtml(linkGoal?.title || (prefill.learningGoalId ? `目标 ${prefill.learningGoalId}` : '未关联'))}</dd></div><div><dt>学习流关联</dt><dd>${(artifact.learningFlowLinks || []).length ? `已关联 ${artifact.learningFlowLinks.length} 项` : '未关联'}</dd></div><div><dt>生成时间</dt><dd>${formatDate(artifact.createdAt)}</dd></div><div><dt>最近访问</dt><dd>${formatDate(artifact.lastAccessedAt)}</dd></div></dl>`
}

function scheduleRefresh(app, id, status) {
  if (!ACTIVE_STATUSES.has(status)) return
  setTimeout(() => {
    if (window.location.hash.startsWith(`#/student/artifacts/${id}`)) renderGeneratedArtifactDetail(app, { id: String(id) })
  }, 2500)
}

const exportStatusLabel = value => ({ QUEUED: '等待导出', EXPORTING: '正在导出', READY: '可下载', FAILED: '导出失败' }[value] || '尚未导出')
function exportPanel(artifact, highlightFormat = '') {
  const byFormat = new Map((artifact.exports || []).map(item => [item.format, item]))
  return `<section class="artifact-export-panel"><div><h2>导出格式</h2><p>正文只生成一次，格式导出可单独重试。</p></div><div class="artifact-export-options">${['DOCX','PDF'].map(format => { const item = byFormat.get(format); const ready = item?.status === 'READY'; const checked = !ready && (!highlightFormat || highlightFormat === format); return `<article class="${highlightFormat === format ? 'is-highlighted' : ''}"><label><input type="checkbox" name="artifact-format" value="${format}" ${checked ? 'checked' : ''}><strong>${format}</strong></label><span class="artifact-export-state is-${String(item?.status || 'empty').toLowerCase()}">${exportStatusLabel(item?.status)}</span><small>${item?.fileSizeBytes ? formatSize(item.fileSizeBytes) : (item?.errorMessage ? escapeHtml(item.errorMessage) : '从当前结构化内容导出')}</small>${ready ? `<button class="complex-btn-secondary" data-export-download="${format}">下载 ${format}</button>` : ''}</article>` }).join('')}</div><button id="artifact-export" class="complex-btn-secondary" ${artifact.content ? '' : 'disabled'}>导出所选格式</button></section>`
}

export async function renderGeneratedArtifactDetail(app, params) {
  renderMarketplaceLayout(app, `<div id="artifact-detail-root">${loadingHTML('正在读取产物详情...')}</div>`, '#/student/artifacts')
  const root = document.getElementById('artifact-detail-root')
  try {
    const artifact = (await getGeneratedArtifact(params.id)).data
    artifact.status = artifact.publicStatus || artifact.status
    const highlightFormat = new URLSearchParams(location.hash.split('?')[1] || '').get('format') || ''
    const requirements = artifact.requirements || {}
    root.innerHTML = `<section class="artifact-detail"><header><div><a href="#/student/artifacts">← 返回我的产物</a><h1>${escapeHtml(artifact.title)}</h1><p>${typeLabel(artifact.artifactType)} · ${statusLabel(artifact.status)}</p></div><div class="artifact-actions">${artifact.sourceConversation ? `<a class="complex-btn-secondary" href="#/student/agents/${artifact.agentId}/chat/${artifact.sourceConversation.id}">查看来源对话</a>` : ''}<button id="artifact-link" class="complex-btn-secondary" ${artifact.content ? '' : 'disabled'}>加入学习流</button><button id="artifact-delete" class="complex-btn-ghost">删除</button></div></header>${artifact.errorCode ? `<div class="artifact-error">内容任务状态：${escapeHtml(artifact.errorCode)}。已生成的结构化内容会保留，各格式可单独重新导出。</div>` : ''}${metadata(artifact)}<section class="artifact-requirements"><h2>生成要求</h2><p>${escapeHtml(requirements.specialRequirements || requirements.generationStyle || artifact.description || '按当前课程与学习目标生成结构化学习资料。')}</p></section>${exportPanel(artifact, highlightFormat)}<section class="artifact-preview-card"><div><h2>HTML 安全预览</h2><span>sandbox iframe</span></div>${artifact.previewHtml ? '<iframe id="artifact-preview" title="生成文件安全预览" sandbox=""></iframe>' : '<div class="agent-market-empty"><p>预览正在生成，请稍候。</p></div>'}</section><section class="artifact-notices"><div><h3>AI 声明</h3><p>${escapeHtml(artifact.aiNotice || '本产物由 AI 辅助生成，请核对后使用。')}</p></div><div><h3>知识库来源说明</h3><p>${escapeHtml(artifact.knowledgeSourceNotice || '未提供知识库来源说明。')}</p></div></section></section>`
    const iframe = document.getElementById('artifact-preview')
    if (iframe) iframe.srcdoc = safePreviewHtml(artifact.previewHtml)
    document.getElementById('artifact-link')?.addEventListener('click', () => openLearningFlowSelector(artifact))
    root.querySelectorAll('[data-export-download]').forEach(button => button.addEventListener('click', async event => { const format = event.currentTarget.dataset.exportDownload; setButtonBusy(event.currentTarget, true, '下载中...'); try { await downloadGeneratedArtifactExport(artifact.id, format, `${artifact.title}.${format.toLowerCase()}`); notify(`${format} 下载已开始`) } catch (error) { notify(error.message, true) } finally { setButtonBusy(event.currentTarget, false) } }))
    document.getElementById('artifact-export')?.addEventListener('click', async event => {
      setButtonBusy(event.currentTarget, true, '创建任务...')
      const formats = [...root.querySelectorAll('[name="artifact-format"]:checked')].map(input => input.value)
      if (!formats.length) { notify('请至少选择一种导出格式', true); setButtonBusy(event.currentTarget, false); return }
      try { await exportGeneratedArtifact(artifact.id, operationId(), formats); notify(`${formats.join('、')} 导出任务已创建`); setTimeout(() => renderGeneratedArtifactDetail(app, params), 1200) } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) }
    })
    document.getElementById('artifact-delete')?.addEventListener('click', async event => {
      if (!confirm('删除文件后将无法恢复，确定继续吗？')) return
      setButtonBusy(event.currentTarget, true, '删除中...')
      try { await deleteGeneratedArtifact(artifact.id); notify('产物已删除'); window.location.hash = '#/student/artifacts' } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) }
    })
    const exportBusy = (artifact.exports || []).some(item => ['QUEUED', 'EXPORTING'].includes(item.status) && Date.now() - new Date(item.updatedAt || 0).getTime() < 10 * 60 * 1000)
    scheduleRefresh(app, artifact.id, exportBusy ? 'EXPORTING' : artifact.status)
    const autoLink = artifact.requirements?.learningFlowPrefill
    const promptKey = `discimind:auto-link-prompt:${artifact.id}`
    if (autoLink && artifact.content && !sessionStorage.getItem(promptKey)) {
      sessionStorage.setItem(promptKey, 'shown')
      setTimeout(async () => {
        if (!confirm('课前讲义已经生成，是否自动加入当前学习流？')) return
        try { await createLearningFlowResourceLink(artifact.id, autoLink); notify('资料已加入学习流。') } catch (error) { notify(error.message, true) }
      }, 0)
    }
  } catch (error) {
    root.innerHTML = errorHTML(error.message)
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderGeneratedArtifactDetail(app, params))
  }
}
