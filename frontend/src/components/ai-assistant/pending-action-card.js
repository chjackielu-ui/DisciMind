import { escapeHtml } from '../../utils/format.js'
import { downloadGeneratedArtifactExport } from '../../api/marketplace.js'

const STATUS_LABELS = {
  WAITING_EXTERNAL: '等待确认', QUEUED: '已进入生成队列', RUNNING: '正在生成',
  COMPLETED: '已完成', SUCCEEDED: '已完成', FAILED: '生成失败', CANCELLED: '已取消',
}

function value(summary, key, fallback = '—') {
  const current = summary?.[key]
  if (Array.isArray(current)) return current.length ? current.join('、') : fallback
  return current === undefined || current === null || current === '' ? fallback : current
}

export function renderPendingActionCard(pendingAction) {
  if (!pendingAction?.id) return ''
  const summary = pendingAction.summary || {}
  const waiting = pendingAction.status === 'WAITING_EXTERNAL' && pendingAction.requiresUserAction !== false
  const knowledgePoints = summary.knowledgePointNames || summary.knowledgePoints || []
  const formats = summary.outputFormats || (summary.outputFormat ? [summary.outputFormat] : [])
  const artifact = pendingAction.artifact
  const downloadable = (artifact?.formats || []).filter(item => item.downloadAvailable)
  return `<section class="ai-pending-action-card status-${escapeHtml(String(pendingAction.status || '').toLowerCase())}" data-ai-pending-action="${escapeHtml(pendingAction.id)}" aria-label="文件生成确认">
    <header><div><span>文件生成确认</span><h4>${escapeHtml(value(summary, 'title', '待生成教育文件'))}</h4></div><b>${escapeHtml(STATUS_LABELS[pendingAction.status] || pendingAction.status || '等待确认')}</b></header>
    <dl>
      <div><dt>课程</dt><dd>${escapeHtml(value(summary, 'courseName'))}</dd></div>
      <div><dt>知识范围</dt><dd>${escapeHtml(knowledgePoints.length ? knowledgePoints.join('、') : '全课程')}</dd></div>
      ${summary.artifactType === 'EXAM_PAPER' ? `<div><dt>题量 / 总分</dt><dd>${escapeHtml(value(summary, 'questionCount'))} 题 / ${escapeHtml(value(summary, 'totalScore'))} 分</dd></div><div><dt>建议时长</dt><dd>${escapeHtml(value(summary, 'duration'))} 分钟</dd></div>` : ''}
      <div><dt>输出格式</dt><dd>${escapeHtml(formats.length ? formats.join('、') : 'DOCX')}</dd></div>
    </dl>
    ${waiting ? `<div class="ai-pending-actions"><button type="button" class="primary" data-pending-command="generate">确认生成</button><button type="button" data-pending-command="preview">仅在对话中预览</button><button type="button" data-pending-command="modify">修改要求</button><button type="button" class="danger" data-pending-command="cancel">取消</button></div>
    <form class="ai-pending-modify-form" data-pending-modify-form hidden>
      <label>标题<input name="title" maxlength="150" value="${escapeHtml(value(summary, 'title', ''))}"></label>
      ${summary.artifactType === 'EXAM_PAPER' ? `<label>题量<input name="questionCount" type="number" min="1" max="50" value="${escapeHtml(value(summary, 'questionCount', 20))}"></label><label>总分<input name="totalScore" type="number" min="1" max="1000" value="${escapeHtml(value(summary, 'totalScore', 100))}"></label><label>时长（分钟）<input name="duration" type="number" min="1" max="600" value="${escapeHtml(value(summary, 'duration', 90))}"></label>` : ''}
      <fieldset><legend>输出格式</legend><label><input type="checkbox" name="outputFormats" value="DOCX" ${!formats.length || formats.includes('DOCX') ? 'checked' : ''}> DOCX</label><label><input type="checkbox" name="outputFormats" value="PDF" ${formats.includes('PDF') ? 'checked' : ''}> PDF</label></fieldset>
      <div><button type="submit" class="primary">保存修改</button><button type="button" data-pending-modify-close>收起</button></div>
    </form>` : `<div class="ai-pending-action-result"><p>${pendingAction.status === 'CANCELLED' ? '本次生成已取消。原对话与需求记录仍然保留。' : pendingAction.status === 'SUCCEEDED' ? '文件已生成并保存到成果中心。' : pendingAction.status === 'FAILED' ? '文件生成未完成，可前往任务中心查看失败原因并重试。' : '确认操作已提交，可在右上角“任务与消息”查看实时进度。'}</p>${artifact ? `<div><a href="${escapeHtml(artifact.previewUrl)}">预览成果</a>${downloadable.map(item => `<button type="button" data-pending-artifact="${artifact.id}" data-pending-format="${escapeHtml(item.format)}">下载 ${escapeHtml(item.format)}</button>`).join('')}</div>` : ''}</div>`}
    <details class="ai-pending-preview" data-pending-preview hidden><summary>需求预览</summary><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre></details>
  </section>`
}

export function bindPendingActionCard(root, handlers = {}) {
  root?.querySelectorAll?.('[data-ai-pending-action]').forEach(card => {
    const id = Number(card.dataset.aiPendingAction)
    const form = card.querySelector('[data-pending-modify-form]')
    const preview = card.querySelector('[data-pending-preview]')
    card.querySelector('[data-pending-command="modify"]')?.addEventListener('click', () => {
      form.hidden = !form.hidden
      if (!form.hidden) form.querySelector('input')?.focus()
    })
    card.querySelector('[data-pending-modify-close]')?.addEventListener('click', () => { form.hidden = true })
    card.querySelector('[data-pending-command="preview"]')?.addEventListener('click', async button => {
      button.currentTarget.disabled = true
      try {
        const result = await handlers.onAction?.(id, 'preview')
        if (result?.preview) preview.querySelector('pre').textContent = JSON.stringify(result.preview, null, 2)
        preview.hidden = false; preview.open = true
      } finally { button.currentTarget.disabled = false }
    })
    card.querySelector('[data-pending-command="generate"]')?.addEventListener('click', event => handlers.onAction?.(id, 'generate', undefined, event.currentTarget))
    card.querySelector('[data-pending-command="cancel"]')?.addEventListener('click', event => handlers.onAction?.(id, 'cancel', undefined, event.currentTarget))
    form?.addEventListener('submit', event => {
      event.preventDefault()
      const data = new FormData(form)
      const formats = data.getAll('outputFormats')
      if (!formats.length) return handlers.onError?.(new Error('请至少选择一种输出格式'))
      const patch = { title: String(data.get('title') || '').trim(), outputFormats: formats }
      for (const key of ['questionCount', 'totalScore', 'duration']) if (data.get(key)) patch[key] = Number(data.get(key))
      handlers.onAction?.(id, 'modify', patch, form.querySelector('[type="submit"]'))
    })
    card.querySelectorAll('[data-pending-artifact]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true
      try { await downloadGeneratedArtifactExport(button.dataset.pendingArtifact, button.dataset.pendingFormat) }
      catch (error) { handlers.onError?.(error) }
      finally { button.disabled = false }
    }))
  })
}
