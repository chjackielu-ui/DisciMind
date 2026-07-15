import { escapeHtml } from '../../utils/format.js'
import { downloadAiArtifact } from '../../api/ai-assistant.js'
import { initChart, disposeChart } from '../../utils/echarts.js'
import DOMPurify from 'dompurify'
import { learningCardArtifactHtml, bindLearningCardArtifacts } from '../learning-card-platform.js'

const CHART_PALETTE = ['#2f6690', '#3a7ca5', '#81c3d7', '#4caf84', '#e8913a', '#8b6bae']

function normalizeChartSpec(spec) {
  if (spec?.version === '1.0' && spec.chart) return spec
  if (spec?.schemaVersion === '1.0' && spec.kind === 'chart') return {
    version: '1.0',
    chart: { type: spec.chartType, title: spec.title, subtitle: spec.subtitle || null, xAxis: spec.categories || [], series: spec.series || [], unit: spec.metric?.unit || null },
    table: spec.table || { columns: [], rows: [] }, insights: spec.insights || [],
    source: { type: spec.source?.tool || spec.source?.label || 'legacy_chart', range: spec.range?.label || null },
  }
  return null
}

function validChartSpec(value) {
  const spec = normalizeChartSpec(value)
  if (!spec || !['line', 'bar', 'pie', 'radar', 'scatter'].includes(spec.chart?.type) || !Array.isArray(spec.chart?.xAxis) || !Array.isArray(spec.chart?.series)) return false
  return spec.chart.series.length > 0 && spec.chart.series.every(series => Array.isArray(series.data) && series.data.length === spec.chart.xAxis.length)
}

function renderChartArtifact(artifact) {
  const spec = normalizeChartSpec(artifact.content)
  const chartId = `ai-artifact-chart-${String(artifact.id).replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (!validChartSpec(spec)) return `<div class="ai-chart-empty"><strong>图表数据暂不可用</strong><p>结构化数据未通过 ChartSpec 1.0 校验，未使用占位数据。</p></div>`
  const encoded = escapeHtml(encodeURIComponent(JSON.stringify(spec)))
  const source = spec.source || {}; const chart = spec.chart
  const rows = spec.table?.rows || []
  const columns = spec.table?.columns || []
  return `<section class="ai-chart-artifact" data-ai-chart-spec="${encoded}" data-ai-chart-id="${chartId}">
    <header><div><b>${escapeHtml(chart.title)}</b>${chart.subtitle ? `<small>${escapeHtml(chart.subtitle)}</small>` : ''}</div><span>${escapeHtml(chart.series?.[0]?.name || '学习指标')}${chart.unit ? ` · ${escapeHtml(chart.unit)}` : ''}</span></header>
    ${!chart.xAxis.length ? `<div class="ai-chart-empty"><strong>当前范围暂无数据</strong><p>未伪造趋势或填充演示数据。继续学习后可再次查询。</p></div>` : `<div id="${chartId}" class="ai-chart-canvas" role="img" aria-label="${escapeHtml(chart.title)}"></div>`}
    ${spec.insights?.length ? `<ul class="ai-chart-insights">${spec.insights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
    <footer><span>来源：${escapeHtml(source.type || 'student_learning_data')}</span>${source.range ? `<span>${escapeHtml(source.range)}</span>` : ''}</footer>
    <div class="ai-chart-actions"><button type="button" data-ai-chart-table>查看表格</button>${!chart.xAxis.length ? '' : '<button type="button" data-ai-chart-fullscreen>全屏</button><button type="button" data-ai-chart-image>保存图片</button>'}</div>
    <div class="ai-chart-table-wrap" hidden><table><thead><tr>${columns.map(item => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(item => `<td>${escapeHtml(item == null ? '—' : item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  </section>`
}

function chartOption(spec) {
  const chart = spec.chart
  const common = { color: CHART_PALETTE, tooltip: { trigger: chart.type === 'pie' ? 'item' : 'axis' }, animationDuration: 420 }
  if (chart.type === 'pie') return { ...common, legend: { bottom: 0 }, series: [{ name: chart.series[0].name, type: 'pie', radius: ['38%', '66%'], data: chart.xAxis.map((name, index) => ({ name, value: chart.series[0].data[index] })) }] }
  if (chart.type === 'radar') return { ...common, legend: { bottom: 0 }, radar: { indicator: chart.xAxis.map((name, index) => ({ name, max: Math.max(100, ...chart.series.map(series => Number(series.data[index]) || 0)) })) }, series: [{ type: 'radar', data: chart.series.map(series => ({ name: series.name, value: series.data })) }] }
  return {
    ...common,
    grid: { left: 44, right: 18, top: 22, bottom: 46, containLabel: true },
    xAxis: { type: 'category', data: chart.xAxis, boundaryGap: chart.type === 'bar', axisLabel: { interval: 0, rotate: chart.xAxis.length > 7 ? 28 : 0 } },
    yAxis: { type: 'value', name: chart.unit || '', splitLine: { lineStyle: { color: 'rgba(47,102,144,.09)' } } },
    dataZoom: chart.xAxis.length > 12 ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 2 }] : undefined,
    series: chart.series.map(series => ({ ...series, type: chart.type, smooth: chart.type === 'line', symbolSize: 6, areaStyle: chart.type === 'line' ? { opacity: .08 } : undefined, barMaxWidth: 36 })),
  }
}

export function renderArtifacts(artifacts = []) {
  if (!artifacts.length) return ''
  return `<div class="ai-artifact-grid">${artifacts.map(artifact => `<article class="ai-artifact-card">
    <div><span>${escapeHtml(artifact.fileFormat || artifact.artifactType)}</span><b>${escapeHtml(artifact.title || 'AI 成果')}</b><small>${escapeHtml(artifact.status || '')}</small></div>
    ${artifact.artifactType === 'KNOWLEDGE_CARDS' ? learningCardArtifactHtml(artifact) : artifact.artifactType === 'AI_CHART' || artifact.fileFormat === 'ECHARTS' ? renderChartArtifact(artifact) : (artifact.previewHtml ? `<details><summary>预览</summary><div class="ai-artifact-preview">${DOMPurify.sanitize(artifact.previewHtml, { USE_PROFILES: { html: true } })}</div></details>` : '')}
    ${artifact.downloadUrl || ['DOCX', 'XLSX'].includes(artifact.fileFormat) ? `<button type="button" data-ai-unified-artifact-download="${artifact.id}">下载 ${escapeHtml(artifact.fileFormat)}</button>` : ''}
  </article>`).join('')}</div>`
}

export function bindArtifactActions(root, onError) {
  bindLearningCardArtifacts(root, onError)
  root?.querySelectorAll?.('[data-ai-chart-spec]').forEach(container => {
    let spec
    try { spec = JSON.parse(decodeURIComponent(container.dataset.aiChartSpec || '')) } catch { spec = null }
    container.querySelector('[data-ai-chart-table]')?.addEventListener('click', event => {
      const table = container.querySelector('.ai-chart-table-wrap'); table.hidden = !table.hidden
      event.currentTarget.textContent = table.hidden ? '查看表格' : '收起表格'
    })
    spec = normalizeChartSpec(spec)
    if (!validChartSpec(spec) || !spec.chart.xAxis.length) return
    const chartId = container.dataset.aiChartId
    disposeChart(chartId)
    const instance = initChart(chartId)
    if (!instance) return
    instance.setOption(chartOption(spec))
    container.querySelector('[data-ai-chart-fullscreen]')?.addEventListener('click', async () => {
      try { await container.requestFullscreen?.(); window.setTimeout(() => instance.resize(), 120) } catch (error) { onError?.(error) }
    })
    container.querySelector('[data-ai-chart-image]')?.addEventListener('click', () => {
      const link = document.createElement('a')
      link.href = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
      link.download = `${spec.chart.title || '学习数据图表'}.png`; link.click()
    })
  })
  root?.querySelectorAll?.('[data-ai-unified-artifact-download]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true
    try { await downloadAiArtifact(button.dataset.aiUnifiedArtifactDownload) }
    catch (error) { onError?.(error) }
    finally { button.disabled = false }
  }))
}
