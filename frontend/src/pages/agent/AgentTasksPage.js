import { cancelTask, listTasks, retryTask, streamTasks, bulkCancelTasks, bulkDismissTasks, bulkDeleteTasks } from '../../api/tasks.js'
import { escapeHtml } from '../../utils/format.js'
import { agentIconHTML } from '../../components/agent-icon.js'
import { downloadGeneratedArtifactExport } from '../../api/marketplace.js'
import { errorHTML, loadingHTML, notify, renderMarketplaceLayout, setButtonBusy } from './marketplace-shared.js'

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'])
const STATUS_LABEL = { QUEUED: '等待开始', RUNNING: '生成中', WAITING_EXTERNAL: '等待外部服务', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消' }
const TYPE_LABEL = { FILE_GENERATION: '文件生成', DOCUMENT_EXPORT: '文件导出', KNOWLEDGE_INDEXING: '知识库索引', LEARNING_FLOW_PRELOAD: '学习流准备', VOICE_PRELOAD: '语音准备', ARTIFACT_CLEANUP: '产物清理', LESSON_PLAN_GENERATION: '教案生成' }

function safeReturnTo(value) {
  const target = String(value || '').trim()
  return /^#\/student\/(?!agent-tasks(?:\?|$))[a-z0-9/_-]+(?:\?[^#]*)?$/i.test(target) ? target : ''
}

function dateText(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function taskRow(task) {
  const progress = Number.isFinite(Number(task.progress)) ? Math.max(0, Math.min(100, Number(task.progress))) : null
  const sourceUrl = task.agentId && task.conversationId ? `#/student/agents/${task.agentId}/chat/${task.conversationId}` : null
  return `<article class="agent-task-row is-${String(task.status).toLowerCase()}" data-task-id="${task.id}">
    <label class="agent-task-select"><input type="checkbox" data-task-select value="${task.id}" aria-label="选择 ${escapeHtml(task.title || '任务')}"></label>
    <div class="agent-task-identity">${agentIconHTML(task.sourceAgent || { iconKey: task.taskType === 'DOCUMENT_EXPORT' ? 'file-search' : 'workflow' }, { size: 40 })}<div><strong>${escapeHtml(task.title || '后台任务')}</strong><span>${escapeHtml(task.sourceAgent?.name || TYPE_LABEL[task.taskType] || task.taskType)}</span></div></div>
    <div class="agent-task-progress"><div><span>${escapeHtml(task.stage || STATUS_LABEL[task.status] || task.status)}</span><b>${progress == null ? '' : `${Math.round(progress)}%`}</b></div>${progress == null ? '<i class="indeterminate"></i>' : `<i><em style="width:${progress}%"></em></i>`}${task.errorMessage ? `<p>${escapeHtml(task.errorMessage)}</p>` : ''}</div>
    <div class="agent-task-meta"><span>${escapeHtml(TYPE_LABEL[task.taskType] || task.taskType)}</span><time>${dateText(task.createdAt)}</time><small>尝试 ${task.attemptCount || 0}/${task.maxAttempts || 1}</small></div>
    <div class="agent-task-state"><span>${escapeHtml(STATUS_LABEL[task.status] || task.status)}</span><div>${ACTIVE.has(task.status) && task.cancellable ? '<button data-task-cancel>取消</button>' : ''}${['FAILED','CANCELLED'].includes(task.status) ? '<button data-task-retry>重试</button>' : ''}${sourceUrl ? `<a href="${sourceUrl}">查看对话</a>` : ''}${task.resultUrl ? `<a href="${escapeHtml(task.resultUrl)}">${task.resultType === 'ARTIFACT' ? '查看产物' : '查看结果'}</a>` : ''}${(task.artifactDownloads || []).map(item => `<button data-task-download="${item.format}" data-artifact-id="${item.artifactId}">下载 ${item.format}</button>`).join('')}</div></div>
  </article>`
}

export async function renderAgentTasks(app) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const returnTo = safeReturnTo(params.get('returnTo'))
  renderMarketplaceLayout(app, `<section class="agent-market-hero"><div><h1>任务中心</h1><p>任务状态来自后端持久化执行器，刷新页面不会丢失。</p></div><div class="agent-task-hero-actions">${returnTo ? `<a class="complex-btn" href="${escapeHtml(returnTo)}">← 返回生成页面</a>` : ''}<a class="complex-btn" href="#/student/agents/mine">选择智能体</a></div></section>
    <section class="agent-task-toolbar"><input id="agent-task-search" placeholder="搜索任务、步骤或来源智能体"><select id="agent-task-status"><option value="">全部状态</option><option value="active">生成中</option><option value="SUCCEEDED">已完成</option><option value="FAILED">失败</option><option value="CANCELLED">已取消</option></select><select id="agent-task-type"><option value="">全部类型</option>${Object.entries(TYPE_LABEL).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><input type="date" id="agent-task-date" title="创建日期"></section><div id="agent-task-root">${loadingHTML('正在同步任务...')}</div>`, '#/student/agent-tasks')
  const root = document.getElementById('agent-task-root')
  let records = []
  const selected = new Set()
  const controller = new AbortController()
  const state = { q: params.get('q') || '', status: params.get('status') || '', taskType: params.get('taskType') || '', date: params.get('date') || '' }
  const controls = {
    q: document.getElementById('agent-task-search'), status: document.getElementById('agent-task-status'),
    taskType: document.getElementById('agent-task-type'), date: document.getElementById('agent-task-date'),
  }
  Object.entries(controls).forEach(([key, control]) => { control.value = state[key] || '' })

  const persist = () => {
    const query = new URLSearchParams()
    if (returnTo) query.set('returnTo', returnTo)
    Object.entries(state).forEach(([key, value]) => value && query.set(key, value))
    history.replaceState(null, '', `#/student/agent-tasks${query.toString() ? `?${query}` : ''}`)
  }
  const render = () => {
    const visible = records.filter(task => {
      if (state.status === 'active' && !ACTIVE.has(task.status)) return false
      if (state.status && state.status !== 'active' && task.status !== state.status) return false
      if (state.taskType && task.taskType !== state.taskType) return false
      if (state.date && String(task.createdAt || '').slice(0, 10) !== state.date) return false
      const haystack = `${task.title || ''} ${task.stage || ''} ${task.sourceAgent?.name || ''}`.toLowerCase()
      return !state.q || haystack.includes(state.q.toLowerCase())
    })
    const selectedTasks = records.filter(task => selected.has(String(task.id)))
    const cancellableIds = selectedTasks.filter(task => ACTIVE.has(task.status) && task.cancellable).map(task => Number(task.id))
    const terminalIds = selectedTasks.filter(task => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)).map(task => Number(task.id))
    root.innerHTML = visible.length ? `<div class="agent-task-bulk"><label><input type="checkbox" data-task-select-all> 全选当前结果</label><span>已选 ${selected.size} 项</span><button data-task-bulk-cancel ${cancellableIds.length ? '' : 'disabled'} title="${cancellableIds.length ? `取消 ${cancellableIds.length} 个可取消任务` : '所选任务均已结束或不支持取消'}">批量取消${cancellableIds.length ? ` (${cancellableIds.length})` : ''}</button><button data-task-bulk-dismiss ${terminalIds.length ? '' : 'disabled'}>批量关闭${terminalIds.length ? ` (${terminalIds.length})` : ''}</button><button data-task-bulk-delete ${terminalIds.length ? '' : 'disabled'}>批量删除记录${terminalIds.length ? ` (${terminalIds.length})` : ''}</button></div><div class="agent-task-list">${visible.map(taskRow).join('')}</div>` : '<div class="agent-market-empty"><h2>没有匹配的任务</h2><p>文件生成、导出和知识库处理任务会自动出现在这里。</p></div>'
    root.querySelectorAll('[data-task-select]').forEach(input => {
      input.checked = selected.has(String(input.value))
      input.onchange = () => { input.checked ? selected.add(String(input.value)) : selected.delete(String(input.value)); render() }
    })
    const selectAll = root.querySelector('[data-task-select-all]')
    if (selectAll) {
      selectAll.checked = visible.length > 0 && visible.every(task => selected.has(String(task.id)))
      selectAll.onchange = () => { visible.forEach(task => selectAll.checked ? selected.add(String(task.id)) : selected.delete(String(task.id))); render() }
    }
    const runBulk = async (button, action, ids, confirmation) => {
      if (!ids.length || !confirm(confirmation)) return
      setButtonBusy(button, true, '处理中...')
      try {
        const response = await action(ids)
        const data = response.data || response
        const failed = (data.results || []).filter(item => !item.ok)
        const preserved = Number(data.artifactsPreserved || 0)
        notify(`${data.affected || 0} 项处理成功${failed.length ? `，${failed.length} 项因状态或权限未处理` : ''}${preserved ? `；${preserved} 个关联产物已保留` : ''}`, Boolean(failed.length))
        const succeeded = new Set((data.results || []).filter(item => item.ok).map(item => String(item.id)))
        if (succeeded.size) succeeded.forEach(id => selected.delete(id))
        else if (!failed.length) ids.forEach(id => selected.delete(String(id)))
        await load()
      }
      catch (error) { notify(error.message, true); setButtonBusy(button, false) }
    }
    root.querySelector('[data-task-bulk-cancel]')?.addEventListener('click', event => runBulk(event.currentTarget, bulkCancelTasks, cancellableIds, `取消所选的 ${cancellableIds.length} 个可取消任务？`))
    root.querySelector('[data-task-bulk-dismiss]')?.addEventListener('click', event => runBulk(event.currentTarget, bulkDismissTasks, terminalIds, `关闭所选的 ${terminalIds.length} 个已结束任务？`))
    root.querySelector('[data-task-bulk-delete]')?.addEventListener('click', event => runBulk(event.currentTarget, bulkDeleteTasks, terminalIds, `永久删除所选的 ${terminalIds.length} 个已结束任务记录？关联产物会保留，此操作不可撤销。`))
    root.querySelectorAll('[data-task-cancel]').forEach(button => button.onclick = async () => {
      const id = button.closest('[data-task-id]').dataset.taskId
      if (!confirm('确定取消这个任务吗？已生成的部分内容会按后端状态保留。')) return
      setButtonBusy(button, true, '取消中...')
      try { await cancelTask(id); await load() } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
    })
    root.querySelectorAll('[data-task-retry]').forEach(button => button.onclick = async () => {
      const id = button.closest('[data-task-id]').dataset.taskId
      setButtonBusy(button, true, '排队中...')
      try { await retryTask(id); notify('任务已重新进入队列'); await load() } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
    })
    root.querySelectorAll('[data-task-download]').forEach(button => button.onclick = async () => {
      setButtonBusy(button, true, '下载中...')
      try { await downloadGeneratedArtifactExport(button.dataset.artifactId, button.dataset.taskDownload) }
      catch (error) { notify(error.message, true) }
      finally { setButtonBusy(button, false) }
    })
  }
  const load = async () => {
    try { const response = await listTasks({ pageSize: 50 }); records = response.data?.list || []; const existingIds = new Set(records.map(task => String(task.id))); for (const id of selected) if (!existingIds.has(id)) selected.delete(id); render() }
    catch (error) { root.innerHTML = errorHTML(error.message); root.querySelector('[data-retry]')?.addEventListener('click', load) }
  }
  Object.entries(controls).forEach(([key, control]) => control.addEventListener(key === 'q' ? 'input' : 'change', event => { state[key] = event.target.value.trim(); persist(); render() }))
  window.addEventListener('hashchange', () => controller.abort(), { once: true })
  await load()
  void streamTasks({ signal: controller.signal, onTasks: payload => { records = payload.list || []; render() }, onError: payload => notify(payload.message || '任务状态同步失败', true) }).catch(error => { if (error.name !== 'AbortError') console.warn('[agent-task-stream]', error.message) })
}
