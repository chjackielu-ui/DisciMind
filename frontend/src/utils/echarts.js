// ECharts 图表工具 v2
// 统一初始化、销毁、resize；支持空状态渲染；数据校验

import * as echarts from 'echarts'

const chartInstances = new Map()

export const CHART_COLORS = {
  deep: '#16425B',
  primary: '#2F6690',
  secondary: '#3A7CA5',
  light: '#81C3D7',
  bg: '#D9DCD6',
  white: '#FFFFFF',
  warm: '#E8913A',
  softRed: '#E0576E',
  softGreen: '#4CAF84',
  softYellow: '#F0B85E',
  softPurple: '#8B6BAE',
}

const DEFAULT_PALETTE = [
  CHART_COLORS.primary, CHART_COLORS.secondary, CHART_COLORS.light,
  CHART_COLORS.deep, CHART_COLORS.softGreen, CHART_COLORS.warm,
  CHART_COLORS.softPurple, CHART_COLORS.softRed,
]

// ========================
// 核心生命周期
// ========================

/**
 * 在容器中渲染空状态 HTML（替代空图表）
 */
export function renderEmptyPanel(domId, title = '暂无可视化数据', desc = '继续学习后系统将生成更完整的数据分析。') {
  const dom = document.getElementById(domId)
  if (!dom) return
  dom.innerHTML = `
    <div class="empty-panel">
      <div class="empty-panel-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(22,66,91,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </div>
      <div class="empty-panel-title">${title}</div>
      <div class="empty-panel-desc">${desc}</div>
    </div>
  `
}

/**
 * 渲染学习建议卡片（图表数据不足时补位）
 */
export function renderInsightPanel(domId, title, items) {
  const dom = document.getElementById(domId)
  if (!dom) return
  const listItems = (items || []).map(i => `<li>${i}</li>`).join('')
  dom.innerHTML = `
    <div class="insight-panel">
      <div class="insight-panel-title">💡 ${title || '学习建议'}</div>
      <ul class="insight-panel-list">${listItems}</ul>
    </div>
  `
}

/**
 * 初始化图表（带数据校验）
 * @returns {echarts.ECharts | null} 无数据或无容器时返回 null
 */
export function initChart(domId, data = null) {
  disposeChart(domId)
  const dom = document.getElementById(domId)
  if (!dom) return null
  if (dom.clientWidth === 0 || dom.clientHeight === 0) return null
  const instance = echarts.init(dom)
  chartInstances.set(domId, instance)
  return instance
}

export function disposeChart(domId) {
  const inst = chartInstances.get(domId)
  if (inst) {
    try { inst.dispose() } catch (e) { /* ignore */ }
    chartInstances.delete(domId)
  }
}

export function disposeAllCharts() {
  chartInstances.forEach((inst) => {
    try { inst.dispose() } catch (e) { /* ignore */ }
  })
  chartInstances.clear()
}

export function defaultTooltip() {
  return {
    backgroundColor: 'rgba(22, 66, 91, 0.94)',
    borderColor: 'rgba(129, 195, 215, 0.3)',
    borderWidth: 1,
    textStyle: { color: '#fff', fontSize: 13 },
    extraCssText: 'border-radius: 10px; padding: 10px 14px; box-shadow: 0 8px 24px rgba(22,66,91,0.2);',
  }
}

let resizeBound = false
export function bindResize() {
  if (resizeBound) return
  resizeBound = true
  window.addEventListener('resize', () => {
    chartInstances.forEach((inst) => {
      try { inst.resize() } catch (e) { /* ignore */ }
    })
  })
}

// ========================
// 快捷图表
// ========================

export function renderRingChart(domId, data, title = '', extra = {}) {
  if (!data || data.length === 0 || data.every(d => d.value === 0)) {
    renderEmptyPanel(domId, '暂无分布数据', '继续学习后将展示知识点掌握分布。')
    return null
  }
  const inst = initChart(domId, data)
  if (!inst) return null

  inst.setOption({
    title: title ? { text: title, left: 'center', top: 10, textStyle: { fontSize: 15, fontWeight: 600, color: CHART_COLORS.deep } } : undefined,
    tooltip: defaultTooltip(),
    legend: { bottom: 0, textStyle: { color: '#627D98', fontSize: 12 }, itemWidth: 10, itemHeight: 10, itemGap: 16 },
    series: [{
      type: 'pie', radius: ['55%', '78%'], center: ['50%', '48%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 3 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' }, scaleSize: 8 },
      data,
    }],
    color: DEFAULT_PALETTE, ...extra,
  })
  return inst
}

export function renderHorizontalBarChart(domId, categories, values, title = '', extra = {}) {
  if (!categories || categories.length === 0) {
    renderEmptyPanel(domId, '暂无排行数据', '积累更多学习数据后将生成排行分析。')
    return null
  }
  const inst = initChart(domId)
  if (!inst) return null

  inst.setOption({
    title: title ? { text: title, left: 'left', top: 0, textStyle: { fontSize: 14, fontWeight: 600, color: CHART_COLORS.deep } } : undefined,
    tooltip: defaultTooltip(),
    grid: { left: '3%', right: '10%', top: title ? 40 : 20, bottom: 10, containLabel: true },
    xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: 'rgba(22,66,91,0.06)' } } },
    yAxis: { type: 'category', data: categories, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#627D98', fontSize: 12 }, inverse: true },
    series: [{
      type: 'bar',
      data: values.map(v => ({ value: v, itemStyle: { borderRadius: [0, 8, 8, 0], color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: CHART_COLORS.primary }, { offset: 1, color: CHART_COLORS.light }]) } })),
      barWidth: 18,
      label: { show: true, position: 'right', color: '#627D98', fontSize: 12 },
    }],
    ...extra,
  })
  return inst
}

export function renderBarChart(domId, categories, seriesData, title = '', extra = {}) {
  if (!categories || categories.length === 0) {
    renderEmptyPanel(domId, '暂无对比数据', '加入更多课程后将生成对比分析。')
    return null
  }
  const inst = initChart(domId)
  if (!inst) return null

  inst.setOption({
    title: title ? { text: title, left: 'left', top: 0, textStyle: { fontSize: 14, fontWeight: 600, color: CHART_COLORS.deep } } : undefined,
    tooltip: defaultTooltip(),
    grid: { left: '3%', right: '4%', top: title ? 40 : 20, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: categories, axisLabel: { color: '#627D98', fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: 'rgba(22,66,91,0.1)' } } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: 'rgba(22,66,91,0.06)' } } },
    series: Array.isArray(seriesData) ? seriesData.map(s => ({ type: 'bar', barWidth: 28, itemStyle: { borderRadius: [8, 8, 0, 0] }, ...s }))
      : [{ type: 'bar', data: seriesData, barWidth: 28, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: CHART_COLORS.light }, { offset: 1, color: CHART_COLORS.primary }]) } }],
    color: DEFAULT_PALETTE, ...extra,
  })
  return inst
}

export function renderLineChart(domId, categories, seriesData, title = '', extra = {}) {
  if (!categories || categories.length === 0) {
    renderEmptyPanel(domId, '暂无趋势数据', '持续学习后将生成学习趋势分析。')
    return null
  }
  const inst = initChart(domId)
  if (!inst) return null

  inst.setOption({
    title: title ? { text: title, left: 'left', top: 0, textStyle: { fontSize: 14, fontWeight: 600, color: CHART_COLORS.deep } } : undefined,
    tooltip: defaultTooltip(),
    grid: { left: '3%', right: '4%', top: title ? 40 : 20, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: categories, boundaryGap: false, axisLabel: { color: '#627D98', fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: 'rgba(22,66,91,0.1)' } } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: 'rgba(22,66,91,0.06)' } } },
    series: Array.isArray(seriesData) ? seriesData.map(s => ({ type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 3 }, ...s }))
      : [{ type: 'line', data: seriesData, smooth: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 3, color: CHART_COLORS.primary }, itemStyle: { color: CHART_COLORS.primary }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(47,102,144,0.15)' }, { offset: 1, color: 'rgba(129,195,215,0.02)' }]) } }],
    color: DEFAULT_PALETTE, ...extra,
  })
  return inst
}

export function renderRadarChart(domId, indicators, values, title = '', extra = {}) {
  if (!indicators || indicators.length === 0 || !values || values.length === 0) {
    renderEmptyPanel(domId, '暂无能力维度数据', '继续学习后将生成更完整的能力雷达图。')
    return null
  }
  const inst = initChart(domId)
  if (!inst) return null

  inst.setOption({
    title: title ? { text: title, left: 'center', top: 4, textStyle: { fontSize: 14, fontWeight: 600, color: CHART_COLORS.deep } } : undefined,
    tooltip: defaultTooltip(),
    radar: {
      center: ['50%', '54%'],
      radius: '66%',
      indicator: indicators.map((name) => ({ name, max: 100 })),
      splitNumber: 4,
      axisName: { color: '#476579', fontSize: 12 },
      axisLine: { lineStyle: { color: 'rgba(47,102,144,0.16)' } },
      splitLine: { lineStyle: { color: 'rgba(47,102,144,0.12)' } },
      splitArea: {
        areaStyle: {
          color: ['rgba(129,195,215,0.08)', 'rgba(76,175,132,0.05)'],
        },
      },
    },
    series: [{
      type: 'radar',
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { width: 3, color: CHART_COLORS.primary },
      itemStyle: { color: CHART_COLORS.primary },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
          { offset: 0, color: 'rgba(47,102,144,0.30)' },
          { offset: 1, color: 'rgba(129,195,215,0.12)' },
        ]),
      },
      data: [{ value: values, name: title || '能力维度' }],
    }],
    ...extra,
  })
  return inst
}

export function renderGaugeChart(domId, value, title = '', max = 100, extra = {}) {
  if (value == null) {
    renderEmptyPanel(domId, '暂无进度数据', '开始学习后将展示学习进度。')
    return null
  }
  const inst = initChart(domId)
  if (!inst) return null

  inst.setOption({
    title: title ? { text: title, left: 'center', bottom: 5, textStyle: { fontSize: 13, fontWeight: 500, color: CHART_COLORS.deep } } : undefined,
    series: [{
      type: 'gauge', startAngle: 210, endAngle: -30, center: ['50%', '55%'], radius: '85%', min: 0, max,
      splitNumber: 10,
      axisLine: { show: true, lineStyle: { width: 18, color: [[0.3, CHART_COLORS.softRed], [0.6, CHART_COLORS.warm], [0.8, CHART_COLORS.light], [1, CHART_COLORS.softGreen]] } },
      pointer: { icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z', length: '70%', width: 8, itemStyle: { color: CHART_COLORS.deep } },
      axisTick: { distance: -18, length: 6, lineStyle: { width: 1, color: '#999' } },
      splitLine: { distance: -22, length: 16, lineStyle: { width: 3, color: '#999' } },
      axisLabel: { color: '#627D98', distance: 30, fontSize: 11 },
      detail: { valueAnimation: true, formatter: '{value}%', color: CHART_COLORS.deep, fontSize: 24, fontWeight: 'bold', offsetCenter: [0, '70%'] },
      data: [{ value }],
    }],
    ...extra,
  })
  return inst
}
