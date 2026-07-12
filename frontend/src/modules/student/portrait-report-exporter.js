// 学生画像 PDF 报告 — 导出器
// 负责：数据获取 → 离屏渲染 → 图表生成 → html2canvas → jsPDF → 下载

import { getStudentPortraitReport } from '../../api/student.js'
import { showToast } from '../../utils/toast.js'
import { buildReportHTML } from './portrait-report-template.js'
import { renderChartsToImages } from './portrait-report-charts.js'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

let isExporting = false
let cleanupFn = null

/**
 * 导出学生画像 PDF 报告
 * @param {object} user - 当前登录用户
 */
export async function exportPortraitPDF(user) {
  if (isExporting) {
    showToast('报告正在生成中，请稍候', 'warning')
    return
  }

  isExporting = true

  // 状态更新回调（由调用方传入）
  let btnEl = document.getElementById('sp-export-btn')
  const setBtnState = (disabled, text) => {
    if (btnEl) {
      btnEl.disabled = disabled
      btnEl.innerHTML = text
    }
  }

  try {
    setBtnState(true, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> 正在生成报告…`)

    // 1. 获取报告数据
    const res = await getStudentPortraitReport()
    const reportData = res.data

    // 2. 计算维度数据（与页面算法一致）
    const portrait = reportData.portrait
    const learningDims = calcReportDims(portrait.learning_ability_score, 'learning', portrait)
    const researchDims = calcReportDims(portrait.research_ability_score, 'research', portrait)
    const competitionDims = calcReportDims(portrait.competition_ability_score, 'competition', portrait)
    const overallScore = clampNum(((portrait.learning_ability_score || 0) + (portrait.research_ability_score || 0) + (portrait.competition_ability_score || 0)) / 3)

    const chartData = {
      learningDims,
      researchDims,
      competitionDims,
      trendData: portrait.trend_data || [],
      overallScore,
    }

    // 3. 创建离屏容器
    const offscreen = document.createElement('div')
    offscreen.id = 'rpt-offscreen'
    offscreen.style.cssText = 'position:fixed;left:-99999px;top:0;width:1680px;z-index:-1;visibility:hidden;'
    document.body.appendChild(offscreen)

    // 注入报告样式
    injectReportStyles()

    // 4. 先生成 HTML（含图表占位容器）
    offscreen.innerHTML = buildReportHTML(reportData, {})
    offscreen.style.visibility = 'visible'

    // 5. 渲染图表并获取图片
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const chartImages = await renderChartsToImages(chartData)

    // 6. 将图表图片插入 DOM
    if (chartImages.ringImg) {
      const ringDom = offscreen.querySelector('#rpt-ring-chart')
      if (ringDom) ringDom.innerHTML = `<img src="${chartImages.ringImg}" style="width:140px;height:140px" alt="综合分数" />`
    }
    if (chartImages.radarImg) {
      const radarWrap = offscreen.querySelector('.rpt-radar-wrap')
      if (radarWrap) radarWrap.innerHTML = `<img src="${chartImages.radarImg}" style="width:100%;max-width:560px" alt="能力雷达图" />`
    }
    if (chartImages.trendImg) {
      const trendImgs = offscreen.querySelectorAll('.rpt-chart-img')
      trendImgs.forEach(img => {
        img.src = chartImages.trendImg
        img.style.width = '100%'
      })
    }

    // 7. 等待布局完成
    await new Promise(r => setTimeout(r, 500))

    // 8. html2canvas 快照
    const canvas = await html2canvas(offscreen.firstElementChild, {
      scale: 2,
      backgroundColor: '#FFFFFF',
      useCORS: true,
      allowTaint: false,
      logging: false,
    })

    // 9. 创建 A3 横向 PDF
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
    const pageW = pdf.internal.pageSize.getWidth()   // 420mm (A3 landscape)
    const pageH = pdf.internal.pageSize.getHeight()   // 297mm

    // 安全边距
    const margin = 6 // mm
    const contentW = pageW - margin * 2
    const contentH = pageH - margin * 2

    const imgRatio = canvas.width / canvas.height
    const targetRatio = contentW / contentH

    let drawW, drawH
    if (imgRatio > targetRatio) {
      // 图片更宽：宽度撑满，高度留白
      drawW = contentW
      drawH = contentW / imgRatio
    } else {
      // 图片更高：高度撑满，宽度留白
      drawH = contentH
      drawW = contentH * imgRatio
    }

    // 居中
    const x = margin + (contentW - drawW) / 2
    const y = margin + (contentH - drawH) / 2

    pdf.addImage(imgData, 'PNG', x, y, drawW, drawH)

    // 10. 生成文件名并下载
    const studentName = (reportData.student?.name || '学生').replace(/[\\/:*?"<>|]/g, '_')
    const studentNo = (reportData.student?.studentNo || '账号').replace(/[\\/:*?"<>|]/g, '_')
    const dateStr = new Date().toISOString().slice(0, 10)
    const filename = `DisciMind_学生学习能力报告_${studentName}_${studentNo}_${dateStr}.pdf`

    pdf.save(filename)

    showToast('学习报告已成功导出', 'success', 3000)
  } catch (err) {
    console.error('[portrait-report-exporter] 导出失败:', err.message)
    showToast('报告生成失败，请稍后重试', 'error', 3000)
  } finally {
    // 清理
    isExporting = false
    setBtnState(false, `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> 导出学习报告`)

    cleanupOffscreen()
  }
}

// ========================
// 工具函数
// ========================

function clampNum(val) {
  const n = Number(val)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function calcReportDims(totalScore, type, portrait) {
  const base = clampNum(totalScore)
  const mastery = portrait?.mastery_summary || {}
  const totalMastery = (mastery.weak_count || 0) + (mastery.general_count || 0) + (mastery.good_count || 0) + (mastery.excellent_count || 0)
  const goodRatio = totalMastery ? ((mastery.good_count || 0) + (mastery.excellent_count || 0)) / totalMastery : 0
  const weakPenalty = totalMastery ? ((mastery.weak_count || 0) / totalMastery) * 24 : 8

  if (type === 'learning') {
    return [
      { name: '知识掌握', value: totalMastery ? clampNum(goodRatio * 100) : clampNum(base - 4) },
      { name: '薄弱修复', value: clampNum(base + 14 - weakPenalty) },
      { name: '课程进展', value: clampNum(base + 6) },
      { name: '练习稳定', value: clampNum(base - 4) },
      { name: '自主学习', value: clampNum(base + 2) },
    ]
  }
  if (type === 'research') {
    const tagBoost = Math.min((portrait?.research_profile?.tags || []).length * 4, 16)
    return [
      { name: '文献检索', value: clampNum(base + tagBoost + 2) },
      { name: '问题定义', value: clampNum(base + 3) },
      { name: '数据分析', value: clampNum(base - 5) },
      { name: '实验设计', value: clampNum(base + 4) },
      { name: '学术表达', value: clampNum(base - 2) },
    ]
  }
  const tagBoost = Math.min((portrait?.competition_profile?.tags || []).length * 4, 16)
  return [
    { name: '算法基础', value: clampNum(base + tagBoost + 2) },
    { name: '工程实现', value: clampNum(base + 1) },
    { name: '创新思维', value: clampNum(base - 4) },
    { name: '团队协作', value: clampNum(base + 3) },
    { name: '成果表达', value: clampNum(base - 1) },
  ]
}

function cleanupOffscreen() {
  const el = document.getElementById('rpt-offscreen')
  if (el) el.remove()
  const style = document.getElementById('rpt-report-styles')
  if (style) style.remove()
}

let _stylesInjected = false

function injectReportStyles() {
  if (_stylesInjected) return
  _stylesInjected = true

  // 动态查找已加载的 report CSS，如果没有则注入内联
  const existing = document.querySelector('style[data-rpt-styles]')
  if (existing) return

  const style = document.createElement('style')
  style.setAttribute('data-rpt-styles', '1')
  style.textContent = `
    .rpt-sheet{width:1680px;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif;color:#0F172A;padding:32px 36px;box-sizing:border-box}
    .rpt-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:18px;border-bottom:2px solid #E2E8F0;margin-bottom:16px}
    .rpt-header-left{flex:1}
    .rpt-brand{font-size:14px;font-weight:700;color:#12304A;letter-spacing:0.06em;margin-bottom:4px}
    .rpt-title{font-size:24px;font-weight:700;color:#0F172A;margin:0 0 2px}
    .rpt-subtitle{font-size:12px;color:#64748B;margin:0 0 10px}
    .rpt-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px}
    .rpt-meta-item{display:flex;gap:6px;font-size:11px}
    .rpt-meta-label{color:#64748B;white-space:nowrap}
    .rpt-meta-value{color:#0F172A;font-weight:500}
    .rpt-meta-mono{font-family:Consolas,"Courier New",monospace;font-size:10px}
    .rpt-header-right{display:flex;align-items:center;gap:12px;flex-shrink:0}
    .rpt-overall-ring{width:100px;height:100px}
    .rpt-overall-info{display:flex;flex-direction:column;gap:1px}
    .rpt-overall-label{font-size:11px;color:#64748B}
    .rpt-overall-score{font-size:36px;font-weight:700;color:#0F172A;line-height:1}
    .rpt-overall-status{font-size:13px;font-weight:600}
    .rpt-ability-row{display:flex;gap:14px;margin-bottom:16px}
    .rpt-ability-card{flex:1;display:flex;gap:10px;padding:14px 16px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px}
    .rpt-ability-card-dot{width:8px;height:8px;border-radius:50%;margin-top:4px;flex-shrink:0}
    .rpt-ability-card-body{display:flex;flex-direction:column;gap:2px}
    .rpt-ability-card-name{font-size:13px;font-weight:600;color:#0F172A}
    .rpt-ability-card-score{font-size:26px;font-weight:700;color:#0F172A;line-height:1}
    .rpt-ability-card-status{font-size:11px;font-weight:500}
    .rpt-ability-card-track{height:4px;border-radius:2px;background:#E2E8F0;margin:2px 0;overflow:hidden}
    .rpt-ability-card-fill{height:100%;border-radius:2px}
    .rpt-ability-card-dims{font-size:10px;color:#94A3B8}
    .rpt-main-row{display:flex;gap:16px;margin-bottom:16px}
    .rpt-chart-card{flex:38;padding:14px;border:1px solid #E2E8F0;border-radius:10px}
    .rpt-table-card{flex:62;padding:14px;border:1px solid #E2E8F0;border-radius:10px}
    .rpt-card{flex:1;padding:14px;border:1px solid #E2E8F0;border-radius:10px}
    .rpt-section-title{font-size:14px;font-weight:700;color:#0F172A;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #F1F5F9}
    .rpt-radar-wrap{display:flex;justify-content:center;margin-bottom:8px}
    .rpt-chart-note{font-size:10px;color:#94A3B8;text-align:center;margin:0}
    .rpt-dim-table{width:100%;border-collapse:collapse;font-size:10px}
    .rpt-dim-table thead th{text-align:left;padding:6px 8px;font-weight:600;color:#475569;background:#F8FAFC;border-bottom:2px solid #E8EEF6;font-size:10px;white-space:nowrap}
    .rpt-dim-table-sm thead th{font-size:9px;padding:4px 6px}
    .rpt-dim-table tbody td{padding:5px 8px;border-bottom:1px solid #F1F5F9;vertical-align:middle}
    .rpt-dim-table-sm tbody td{font-size:9px;padding:3px 6px}
    .rpt-td-cat{display:flex;align-items:center;gap:4px;font-weight:500;white-space:nowrap}
    .rpt-cat-dot{width:6px;height:6px;border-radius:50%}
    .rpt-td-name{white-space:nowrap}
    .rpt-td-val{font-weight:700;text-align:right;white-space:nowrap}
    .rpt-td-status{text-align:center;white-space:nowrap}
    .rpt-td-change{font-size:10px;color:#64748B;white-space:nowrap}
    .rpt-td-updated{font-size:9px;color:#94A3B8;white-space:nowrap}
    .rpt-status-tag{padding:1px 7px;border-radius:8px;font-size:9px;font-weight:600}
    .rpt-bottom-row{display:flex;gap:16px;margin-bottom:16px}
    .rpt-footer-row{display:flex;gap:16px;margin-bottom:16px}
    .rpt-kp-section{display:flex;flex-direction:column;gap:8px}
    .rpt-kp-label{font-size:12px;font-weight:600;color:#475569;margin:0 0 2px}
    .rpt-kp-label-weak{margin-top:8px}
    .rpt-kp-row{display:flex;align-items:center;gap:8px;padding:3px 0}
    .rpt-kp-name{font-size:11px;color:#0F172A;min-width:80px}
    .rpt-kp-bar{flex:1;height:4px;border-radius:2px;background:#E2E8F0;overflow:hidden}
    .rpt-kp-fill{height:100%;border-radius:2px}
    .rpt-kp-fill-good{background:#10B981}
    .rpt-kp-fill-weak{background:#F59E0B}
    .rpt-kp-score{font-size:11px;font-weight:600;color:#0F172A;min-width:28px;text-align:right}
    .rpt-chart-img{max-width:100%}
    .rpt-algo-text{font-size:10px;color:#475569;line-height:1.5}
    .rpt-algo-text p{margin:0 0 4px}
    .rpt-algo-text code{background:#F1F5F9;padding:1px 4px;border-radius:3px;font-size:9px;font-family:Consolas,"Courier New",monospace}
    .rpt-page-footer{display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid #E2E8F0;font-size:9px;color:#94A3B8}
    .rpt-empty{font-size:11px;color:#94A3B8;text-align:center;padding:20px 0}
  `
  document.head.appendChild(style)
}
