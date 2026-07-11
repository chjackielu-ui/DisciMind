import {
  deleteGeneratedArtifact,
  downloadGeneratedArtifact,
  exportGeneratedArtifact,
  getGeneratedArtifact,
  listGeneratedArtifacts,
} from '../../api/marketplace.js'
import { escapeHtml } from '../../utils/format.js'
import { errorHTML, loadingHTML, notify, operationId, renderMarketplaceLayout, setButtonBusy } from './marketplace-shared.js'

const ACTIVE_STATUSES = new Set(['DRAFT', 'GENERATING', 'EXPORTING'])
const typeLabel = value => value === 'STUDY_HANDOUT' ? '学习讲义' : '试卷'
const statusLabel = value => ({
  DRAFT: '准备中', GENERATING: '正在生成内容', CONTENT_READY: '内容已完成', EXPORTING: '正在导出 DOCX', READY: '可下载',
  FAILED: '生成失败', EXPIRED: '已过期', DELETING: '正在删除', DELETED: '已删除',
}[value] || value)
const formatDate = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const formatSize = value => value == null ? '—' : value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`

function artifactCard(item) {
  return `<article class="artifact-card"><div class="artifact-card-top"><span class="artifact-type">${typeLabel(item.artifactType)}</span><span class="artifact-status is-${String(item.status).toLowerCase()}">${statusLabel(item.status)}</span></div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description || '由文件生成智能体创建的学习资料')}</p><dl><div><dt>生成时间</dt><dd>${formatDate(item.createdAt)}</dd></div><div><dt>文件大小</dt><dd>${formatSize(item.fileSizeBytes)}</dd></div></dl><a class="complex-btn-secondary" href="#/student/generated-artifacts/${item.id}">查看文件</a></article>`
}

export async function renderGeneratedArtifacts(app) {
  renderMarketplaceLayout(app, `<section class="agent-market-hero artifact-hero"><div><h1>生成文件</h1><p>查看结构化预览、任务状态和已导出的 DOCX。</p></div><a class="complex-btn" href="#/student/agents">使用文件生成器</a></section><div id="artifact-list-root">${loadingHTML('正在读取生成文件...')}</div>`, '#/student/generated-artifacts')
  const root = document.getElementById('artifact-list-root')
  try {
    const result = await listGeneratedArtifacts({ pageSize: 100 })
    const records = result.data.list || []
    root.innerHTML = records.length ? `<div class="artifact-grid">${records.map(artifactCard).join('')}</div>` : '<div class="agent-market-empty"><h2>还没有生成文件</h2><p>从 FILE_GENERATOR 智能体开始创建试卷或学习讲义。</p><a class="complex-btn" href="#/student/agents">发现智能体</a></div>'
  } catch (error) {
    root.innerHTML = errorHTML(error.message)
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderGeneratedArtifacts(app))
  }
}

function metadata(artifact) {
  return `<dl class="artifact-metadata"><div><dt>类型</dt><dd>${typeLabel(artifact.artifactType)}</dd></div><div><dt>状态</dt><dd>${statusLabel(artifact.status)}</dd></div><div><dt>格式</dt><dd>${escapeHtml(artifact.fileFormat || 'DOCX')}</dd></div><div><dt>大小</dt><dd>${formatSize(artifact.fileSizeBytes)}</dd></div><div><dt>生成时间</dt><dd>${formatDate(artifact.createdAt)}</dd></div><div><dt>最近访问</dt><dd>${formatDate(artifact.lastAccessedAt)}</dd></div></dl>`
}

function scheduleRefresh(app, id, status) {
  if (!ACTIVE_STATUSES.has(status)) return
  setTimeout(() => {
    if (window.location.hash === `#/student/generated-artifacts/${id}`) renderGeneratedArtifactDetail(app, { id: String(id) })
  }, 2500)
}

export async function renderGeneratedArtifactDetail(app, params) {
  renderMarketplaceLayout(app, `<div id="artifact-detail-root">${loadingHTML('正在读取文件详情...')}</div>`, '#/student/generated-artifacts')
  const root = document.getElementById('artifact-detail-root')
  try {
    const artifact = (await getGeneratedArtifact(params.id)).data
    const downloadable = artifact.status === 'READY'
    const canExport = ['CONTENT_READY', 'READY', 'FAILED'].includes(artifact.status) && artifact.content
    root.innerHTML = `<section class="artifact-detail"><header><div><a href="#/student/generated-artifacts">← 返回生成文件</a><h1>${escapeHtml(artifact.title)}</h1><p>${typeLabel(artifact.artifactType)} · ${statusLabel(artifact.status)}</p></div><div class="artifact-actions"><button id="artifact-download" class="complex-btn" ${downloadable ? '' : 'disabled'}>下载 DOCX</button><button id="artifact-export" class="complex-btn-secondary" ${canExport ? '' : 'disabled'}>${artifact.status === 'READY' ? '重新导出' : '导出 DOCX'}</button><button id="artifact-delete" class="complex-btn-ghost">删除</button></div></header>${artifact.errorCode ? `<div class="artifact-error">任务未完成：${escapeHtml(artifact.errorCode)}。结构化内容仍会保留，可单独重新导出。</div>` : ''}${metadata(artifact)}<section class="artifact-preview-card"><div><h2>安全预览</h2><span>sandbox iframe</span></div>${artifact.previewHtml ? '<iframe id="artifact-preview" title="生成文件安全预览" sandbox=""></iframe>' : '<div class="agent-market-empty"><p>预览正在生成，请稍候。</p></div>'}</section></section>`
    const iframe = document.getElementById('artifact-preview')
    if (iframe) iframe.srcdoc = artifact.previewHtml
    document.getElementById('artifact-download')?.addEventListener('click', async event => {
      setButtonBusy(event.currentTarget, true, '下载中...')
      try { await downloadGeneratedArtifact(artifact.id, `${artifact.title}.docx`); notify('DOCX 下载已开始') } catch (error) { notify(error.message, true) } finally { setButtonBusy(event.currentTarget, false) }
    })
    document.getElementById('artifact-export')?.addEventListener('click', async event => {
      setButtonBusy(event.currentTarget, true, '创建任务...')
      try { await exportGeneratedArtifact(artifact.id, operationId()); notify('DOCX 导出任务已创建'); scheduleRefresh(app, artifact.id, 'EXPORTING') } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) }
    })
    document.getElementById('artifact-delete')?.addEventListener('click', async event => {
      if (!confirm('删除文件后将无法恢复，确定继续吗？')) return
      setButtonBusy(event.currentTarget, true, '删除中...')
      try { await deleteGeneratedArtifact(artifact.id); notify('文件已删除'); window.location.hash = '#/student/generated-artifacts' } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) }
    })
    scheduleRefresh(app, artifact.id, artifact.status)
  } catch (error) {
    root.innerHTML = errorHTML(error.message)
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderGeneratedArtifactDetail(app, params))
  }
}
