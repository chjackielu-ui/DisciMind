// 学生画像 PDF 报告 — ECharts 图表配置
// 用于离屏报告渲染，统一管理所有报告图表

import * as echarts from 'echarts'

const CHART_COLORS = {
  blue: '#2563EB',
  purple: '#7C3AED',
  amber: '#F59E0B',
  green: '#10B981',
  blueLight: 'rgba(37,99,235,0.10)',
  purpleLight: 'rgba(124,58,237,0.10)',
  amberLight: 'rgba(245,158,11,0.10)',
  gridBlue: 'rgba(37,99,235,0.06)',
  axisText: '#94A3B8',
  axisLine: '#E2E8F0',
}

const CHART_BASE = { animation: false, backgroundColor: 'transparent' }

/**
 * 渲染图表到容器并返回 base64 PNG
 */
async function chartToImage(domId, option, width, height) {
  const dom = document.getElementById(domId)
  if (!dom) return null
  dom.style.width = width + 'px'
  dom.style.height = height + 'px'
  dom.innerHTML = ''

  const inst = echarts.init(dom)
  inst.setOption({ ...CHART_BASE, ...option })

  // 等待渲染完成
  await new Promise(resolve => {
    inst.on('finished', resolve)
    setTimeout(resolve, 300)
  })

  const dataUrl = inst.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: '#FFFFFF',
  })

  inst.dispose()
  dom.innerHTML = ''
  return dataUrl
}

// ========================
// 综合能力雷达图（三类能力）
// ========================

export function buildReportRadarOption(learningDims, researchDims, competitionDims) {
  const indicators = [
    ...learningDims.map(d => ({ name: `[学]${d.name}`, max: 100 })),
    ...researchDims.map(d => ({ name: `[科]${d.name}`, max: 100 })),
    ...competitionDims.map(d => ({ name: `[赛]${d.name}`, max: 100 })),
  ]

  return {
    tooltip: { show: false },
    legend: {
      bottom: 0,
      textStyle: { color: '#64748B', fontSize: 10 },
      itemWidth: 10,
      itemHeight: 8,
      itemGap: 12,
      data: ['学习能力', '科研能力', '竞赛能力'],
    },
    radar: {
      center: ['50%', '48%'],
      radius: '60%',
      indicator: indicators,
      splitNumber: 3,
      axisName: { color: '#64748B', fontSize: 9, fontWeight: 500 },
      axisLine: { lineStyle: { color: 'rgba(37,99,235,0.10)' } },
      splitLine: { lineStyle: { color: 'rgba(37,99,235,0.05)' } },
      splitArea: { areaStyle: { color: ['rgba(37,99,235,0.02)', '#FFFFFF'] } },
    },
    series: [
      {
        type: 'radar',
        symbol: 'circle',
        symbolSize: 3,
        name: '学习能力',
        lineStyle: { width: 2, color: CHART_COLORS.blue },
        itemStyle: { color: CHART_COLORS.blue },
        areaStyle: { color: 'rgba(37,99,235,0.08)' },
        data: [{ value: learningDims.map(d => d.value), name: '学习能力' }],
      },
      {
        type: 'radar',
        symbol: 'circle',
        symbolSize: 3,
        name: '科研能力',
        lineStyle: { width: 2, color: CHART_COLORS.purple },
        itemStyle: { color: CHART_COLORS.purple },
        areaStyle: { color: 'rgba(124,58,237,0.08)' },
        data: [{ value: researchDims.map(d => d.value), name: '科研能力' }],
      },
      {
        type: 'radar',
        symbol: 'circle',
        symbolSize: 3,
        name: '竞赛能力',
        lineStyle: { width: 2, color: CHART_COLORS.amber },
        itemStyle: { color: CHART_COLORS.amber },
        areaStyle: { color: 'rgba(245,158,11,0.08)' },
        data: [{ value: competitionDims.map(d => d.value), name: '竞赛能力' }],
      },
    ],
  }
}

// ========================
// 趋势折线图
// ========================

export function buildReportTrendOption(trendData) {
  const snapshots = trendData || []
  const labels = snapshots.map(s => {
    const d = new Date(s.date)
    return `${d.getFullYear().toString().slice(2)}.${d.getMonth() + 1}`
  })

  return {
    tooltip: { show: false },
    legend: {
      bottom: 0,
      textStyle: { color: '#64748B', fontSize: 10 },
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 12,
    },
    grid: { left: '3%', right: '3%', top: 8, bottom: 28, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLabel: { color: CHART_COLORS.axisText, fontSize: 9 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
    },
    yAxis: {
      type: 'value',
      min: 0, max: 100,
      axisLabel: { color: CHART_COLORS.axisText, fontSize: 9 },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#F1F5F9' } },
    },
    series: [
      {
        name: '学习能力', type: 'line',
        data: snapshots.map(s => s.learning_total_score || 0),
        smooth: true, symbol: 'circle', symbolSize: 3,
        lineStyle: { width: 2, color: CHART_COLORS.blue },
        itemStyle: { color: CHART_COLORS.blue },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(37,99,235,0.10)' },
            { offset: 1, color: 'rgba(37,99,235,0.01)' },
          ]),
        },
      },
      {
        name: '科研能力', type: 'line',
        data: snapshots.map(s => s.research_total_score || 0),
        smooth: true, symbol: 'circle', symbolSize: 3,
        lineStyle: { width: 2, color: CHART_COLORS.purple },
        itemStyle: { color: CHART_COLORS.purple },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(124,58,237,0.08)' },
            { offset: 1, color: 'rgba(124,58,237,0.01)' },
          ]),
        },
      },
      {
        name: '竞赛能力', type: 'line',
        data: snapshots.map(s => s.competition_total_score || 0),
        smooth: true, symbol: 'circle', symbolSize: 3,
        lineStyle: { width: 2, color: CHART_COLORS.amber },
        itemStyle: { color: CHART_COLORS.amber },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(245,158,11,0.08)' },
            { offset: 1, color: 'rgba(245,158,11,0.01)' },
          ]),
        },
      },
    ],
  }
}

// ========================
// 综合能力小环形图
// ========================

export function buildReportRingOption(value) {
  const s = Math.max(0, Math.min(100, Math.round(value)))
  const color = s >= 70 ? '#2563EB' : s >= 50 ? '#F59E0B' : '#EF4444'
  return {
    series: [{
      type: 'gauge',
      startAngle: 210, endAngle: -30,
      center: ['50%', '55%'], radius: '80%',
      min: 0, max: 100, splitNumber: 10,
      axisLine: {
        lineStyle: {
          width: 8,
          color: [[s / 100, color], [1, '#E2E8F0']],
        },
      },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: {
        formatter: '{value}',
        color: '#0F172A',
        fontSize: 28,
        fontWeight: 700,
        offsetCenter: [0, '10%'],
      },
      data: [{ value: s }],
    }],
  }
}

// ========================
// 导出工具
// ========================

export async function renderChartsToImages(reportData) {
  const { learningDims, researchDims, competitionDims, trendData, overallScore } = reportData

  const [radarImg, trendImg, ringImg] = await Promise.all([
    // 雷达图
    (async () => {
      const opt = buildReportRadarOption(learningDims, researchDims, competitionDims)
      return chartToImage('rpt-radar-chart', opt, 560, 320)
    })(),
    // 趋势图
    trendData && trendData.length >= 2
      ? (async () => {
          const opt = buildReportTrendOption(trendData)
          return chartToImage('rpt-trend-chart', opt, 660, 260)
        })()
      : Promise.resolve(null),
    // 环形图
    (async () => {
      const opt = buildReportRingOption(overallScore)
      return chartToImage('rpt-ring-chart', opt, 140, 140)
    })(),
  ])

  return { radarImg, trendImg, ringImg }
}
