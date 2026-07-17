// 学生端学习画像页面 v2 — 紧凑型学生能力分析控制台
// 重构目标：信息密度提升、数据层级清晰、emoji 替换为 SVG、紧凑布局

import { getMe } from '../api/auth.js'
import { getStudentPortrait } from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import {
  disposeAllCharts, bindResize,
} from '../utils/echarts.js'
import * as echarts from 'echarts'
import { exportPortraitPDF } from '../modules/student/portrait-report-exporter.js'

const MENU_ITEMS = STUDENT_MENU_ITEMS

// ========================
// 工具函数
// ========================

function clampScore(value) {
  const n = Number(value)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function scoreText(value) {
  return value != null ? clampScore(value) : '—'
}

function abilityLevel(score) {
  const value = clampScore(score)
  if (value >= 85) return '优势突出'
  if (value >= 70) return '表现稳健'
  if (value >= 50) return '正在成长'
  if (value > 0) return '需要强化'
  return '数据积累中'
}

function levelColor(score) {
  const value = clampScore(score)
  if (value >= 85) return '#10B981'
  if (value >= 70) return '#2563EB'
  if (value >= 50) return '#F59E0B'
  if (value > 0) return '#EF4444'
  return '#94A3B8'
}

function dimensionStatus(value) {
  if (value >= 85) return { label: '优势', cls: 'dim-status-advantage' }
  if (value >= 70) return { label: '良好', cls: 'dim-status-good' }
  if (value >= 50) return { label: '成长', cls: 'dim-status-growing' }
  return { label: '待提升', cls: 'dim-status-weak' }
}

// 趋势变化标签
function trendLabel(current, previous) {
  if (previous == null || previous === 0) return ''
  const diff = current - previous
  if (diff > 5) return `<span class="trend-up">↑${Math.round(diff)}</span>`
  if (diff < -5) return `<span class="trend-down">↓${Math.abs(Math.round(diff))}</span>`
  return `<span class="trend-flat">→</span>`
}

// ========================
// SVG 图标系统（替代 emoji）
// ========================

const S = { w: 22, sw: 1.8 }

function svgIcon(inner, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${S.sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
}

// 学习能力 — 打开的书本 + 中央知识节点
const iconLearning = svgIcon(`
  <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
  <circle cx="13" cy="11" r="2.5"/>
  <path d="M13 8.5v5"/>
`)

// 科研能力 — 六边形研究节点 + 数据连接
const iconResearch = svgIcon(`
  <path d="M12 2l6 4v6l-6 4-6-4V6z"/>
  <circle cx="12" cy="5" r="1.5"/>
  <line x1="12" y1="6.5" x2="12" y2="14"/>
  <line x1="8" y1="8" x2="16" y2="12"/>
`)

// 竞赛能力 — 几何奖章 + 星
const iconCompetition = svgIcon(`
  <circle cx="12" cy="12" r="10"/>
  <polygon points="12 6 13.5 10.5 18 10.5 14.5 13.5 16 18 12 15 8 18 9.5 13.5 6 10.5 10.5 10.5"/>
`)

// 优势知识点 — 向上趋势节点高亮
const iconStrength = svgIcon(`
  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
  <polyline points="16 7 22 7 22 13"/>
`, 16)

// 待强化 — 目标准星
const iconWeakness = svgIcon(`
  <circle cx="12" cy="12" r="10"/>
  <circle cx="12" cy="12" r="5"/>
  <circle cx="12" cy="12" r="1.5"/>
`, 16)

// 能力趋势 — 折线 + 三个数据节点
const iconTrend = svgIcon(`
  <polyline points="3 18 9 12 14 14 21 6"/>
  <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="14" cy="14" r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="21" cy="6" r="1.5" fill="currentColor" stroke="none"/>
`)

// 通用小图标
const iconScore = svgIcon(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`, 16)
const iconRadar = svgIcon(`<circle cx="12" cy="12" r="9"/><polygon points="12,3 20,9 18,19 6,19 4,9" fill="none"/>`, 16)

// ========================
// 维度计算
// ========================

function calcDimensions(totalScore, type, portraitData) {
  const base = clampScore(totalScore)
  const mastery = portraitData?.mastery_summary || {}
  const totalMastery = (mastery.weak_count || 0) + (mastery.general_count || 0) + (mastery.good_count || 0) + (mastery.excellent_count || 0)
  const goodRatio = totalMastery ? ((mastery.good_count || 0) + (mastery.excellent_count || 0)) / totalMastery : 0
  const weakPenalty = totalMastery ? ((mastery.weak_count || 0) / totalMastery) * 24 : 8

  if (type === 'learning') {
    return [
      { name: '知识掌握', value: totalMastery ? clampScore(goodRatio * 100) : clampScore(base - 4) },
      { name: '薄弱修复', value: clampScore(base + 14 - weakPenalty) },
      { name: '课程进展', value: clampScore(base + 6) },
      { name: '练习稳定', value: clampScore(base - 4) },
      { name: '自主学习', value: clampScore(base + 2) },
    ]
  }

  if (type === 'research') {
    const tagBoost = Math.min((portraitData?.research_profile?.tags || []).length * 4, 16)
    return [
      { name: '文献检索', value: clampScore(base + tagBoost + 2) },
      { name: '问题定义', value: clampScore(base + 3) },
      { name: '数据分析', value: clampScore(base - 5) },
      { name: '实验设计', value: clampScore(base + 4) },
      { name: '学术表达', value: clampScore(base - 2) },
    ]
  }

  // competition
  const tagBoost = Math.min((portraitData?.competition_profile?.tags || []).length * 4, 16)
  return [
    { name: '算法基础', value: clampScore(base + tagBoost + 2) },
    { name: '工程实现', value: clampScore(base + 1) },
    { name: '创新思维', value: clampScore(base - 4) },
    { name: '团队协作', value: clampScore(base + 3) },
    { name: '成果表达', value: clampScore(base - 1) },
  ]
}

// ========================
// 构建能力卡片 HTML
// ========================

function buildAbilityCard({ key, icon, title, score, color, trendDiff }) {
  const s = clampScore(score)
  return `
    <div class="sp-ability-card" data-ability="${key}">
      <div class="sp-ability-card-icon" style="--sp-accent:${color}">${icon}</div>
      <div class="sp-ability-card-body">
        <div class="sp-ability-card-head">
          <span class="sp-ability-card-title">${title}</span>
          ${trendDiff != null ? trendLabel(s, s - trendDiff) : ''}
        </div>
        <div class="sp-ability-card-score">
          <span class="sp-ability-card-value">${scoreText(score)}</span>
          <span class="sp-ability-card-level" style="color:${levelColor(s)}">${abilityLevel(s)}</span>
        </div>
        <div class="sp-ability-card-bar">
          <div class="sp-ability-card-fill" style="width:${s}%;background:${color}"></div>
        </div>
      </div>
    </div>`
}

// ========================
// 构建维度指标行
// ========================

function buildDimRow(dim) {
  const status = dimensionStatus(dim.value)
  return `
    <div class="sp-dim-row">
      <span class="sp-dim-name">${escapeHtml(dim.name)}</span>
      <div class="sp-dim-track">
        <div class="sp-dim-fill" style="width:${dim.value}%"></div>
      </div>
      <span class="sp-dim-value">${dim.value}</span>
      <span class="sp-dim-tag ${status.cls}">${status.label}</span>
    </div>`
}

// ========================
// 构建知识点条目
// ========================

function buildKpItem(point, isStrength) {
  const s = point.mastery_score ?? 0
  return `
    <div class="sp-kp-item">
      <span class="sp-kp-icon">${isStrength ? iconStrength : iconWeakness}</span>
      <span class="sp-kp-name">${escapeHtml(point.knowledge_point_name || '未命名')}</span>
      <div class="sp-kp-track"><div class="sp-kp-fill ${isStrength ? 'sp-kp-fill-good' : 'sp-kp-fill-weak'}" style="width:${s}%"></div></div>
      <span class="sp-kp-score">${s}</span>
    </div>`
}

// ========================
// 构建表格行
// ========================

function buildMetricRow(item) {
  const status = dimensionStatus(item.value)
  return `
    <tr class="sp-metric-row">
      <td class="sp-metric-name">${escapeHtml(item.name)}</td>
      <td class="sp-metric-category">${escapeHtml(item.category)}</td>
      <td class="sp-metric-value">${item.value}</td>
      <td class="sp-metric-status"><span class="sp-dim-tag ${status.cls}">${status.label}</span></td>
      <td class="sp-metric-change">${item.change || '—'}</td>
      <td class="sp-metric-source">${escapeHtml(item.source || '—')}</td>
      <td class="sp-metric-updated">${escapeHtml(item.updatedAt || '—')}</td>
    </tr>`
}

// ========================
// 主渲染函数
// ========================

export async function renderStudentPortrait(app) {
  disposeAllCharts()

  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  let portraitData = null
  let loadError = false

  try {
    const res = await getStudentPortrait()
    portraitData = res.data
  } catch (err) {
    console.error('获取画像数据失败:', err.message)
    loadError = true
  }

  let contentHTML

  if (loadError) {
    contentHTML = `
      <div class="sp-page">
        <div class="sp-error-state">
          <div class="sp-error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <p class="sp-error-msg">画像数据加载失败</p>
          <button class="sp-btn-retry" onclick="window.location.reload()">重新加载</button>
        </div>
      </div>`
  } else if (!portraitData || (!portraitData.learning_ability_score && !portraitData.research_ability_score && !portraitData.competition_ability_score)) {
    // 无画像数据
    contentHTML = `
      <div class="sp-page">
        <div class="sp-empty-state">
          <div class="sp-empty-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(47,102,144,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <h3 class="sp-empty-title">画像生成中</h3>
          <p class="sp-empty-desc">系统将在你完成学习任务、答题和问答后生成能力画像</p>
        </div>
      </div>`
  } else {
    // 有数据
    const learning = portraitData.learning_ability_score
    const research = portraitData.research_ability_score
    const competition = portraitData.competition_ability_score
    const avgScore = clampScore(((learning || 0) + (research || 0) + (competition || 0)) / 3)

    // 计算各能力维度和标签
    const learningDims = calcDimensions(learning, 'learning', portraitData)
    const researchDims = calcDimensions(research, 'research', portraitData)
    const competitionDims = calcDimensions(competition, 'competition', portraitData)

    const abilityTabs = [
      { key: 'learning', title: '学习能力', icon: iconLearning, color: '#2563EB', score: learning, dims: learningDims, tags: portraitData.research_profile?.tags || [], comment: '' },
      { key: 'research', title: '科研能力', icon: iconResearch, color: '#7C3AED', score: research, dims: researchDims, tags: portraitData.research_profile?.tags || [], comment: portraitData.research_profile?.teacher_comment || '' },
      { key: 'competition', title: '竞赛能力', icon: iconCompetition, color: '#F59E0B', score: competition, dims: competitionDims, tags: portraitData.competition_profile?.tags || [], comment: portraitData.competition_profile?.teacher_comment || '' },
    ]

    // 构建所有维度表格数据
    const allMetrics = [
      ...learningDims.map(d => ({ ...d, category: '学习能力', change: '', source: '掌握度综合计算', updatedAt: '' })),
      ...researchDims.map(d => ({ ...d, category: '科研能力', change: '', source: '教师评估', updatedAt: '' })),
      ...competitionDims.map(d => ({ ...d, category: '竞赛能力', change: '', source: '教师评估', updatedAt: '' })),
    ]

    contentHTML = `
      <div class="sp-page">

        <!-- 第一部分：紧凑 Header -->
        <div class="sp-header">
          <div class="sp-header-left">
            <span class="sp-eyebrow">STUDENT PORTRAIT</span>
            <h1 class="sp-title">学习画像</h1>
            <p class="sp-desc">综合能力分析与诊断 · 基于 ${portraitData.mastery_summary ? ((portraitData.mastery_summary.weak_count || 0) + (portraitData.mastery_summary.general_count || 0) + (portraitData.mastery_summary.good_count || 0) + (portraitData.mastery_summary.excellent_count || 0)) : 0} 个知识点掌握数据</p>
          </div>
          <div class="sp-header-right">
            <button class="sp-export-btn" id="sp-export-btn" aria-label="导出学习报告" title="导出学习报告 PDF">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> 导出学习报告
            </button>
            <div class="sp-overall-ring" id="sp-overall-ring"></div>
            <div class="sp-overall-info">
              <span class="sp-overall-label">综合均值</span>
              <span class="sp-overall-score">${scoreText(avgScore)}</span>
              <span class="sp-overall-level" style="color:${levelColor(avgScore)}">${abilityLevel(avgScore)}</span>
            </div>
          </div>
        </div>

        <!-- 第二部分：能力摘要栏 -->
        <div class="sp-ability-cards">
          ${buildAbilityCard({ key: 'learning', icon: iconLearning, title: '学习能力', score: learning, color: '#2563EB' })}
          ${buildAbilityCard({ key: 'research', icon: iconResearch, title: '科研能力', score: research, color: '#7C3AED' })}
          ${buildAbilityCard({ key: 'competition', icon: iconCompetition, title: '竞赛能力', score: competition, color: '#F59E0B' })}
        </div>

        <!-- 第三部分：能力详情 Tab + 雷达图 -->
        <div class="sp-detail-section">
          <div class="sp-detail-tabs" id="sp-detail-tabs">
            ${abilityTabs.map((t, i) => `
              <button class="sp-detail-tab ${i === 0 ? 'active' : ''}" data-tab="${t.key}" style="--sp-tab-color:${t.color}">
                ${t.icon}
                <span>${t.title}</span>
              </button>
            `).join('')}
          </div>
          <div class="sp-detail-panels">
            ${abilityTabs.map((t, i) => `
              <div class="sp-detail-panel ${i === 0 ? 'active' : ''}" data-panel="${t.key}">
                <div class="sp-detail-grid">
                  <div class="sp-detail-left">
                    <div class="sp-radar-container" id="sp-radar-${t.key}"></div>
                    <div class="sp-detail-meta">
                      <span class="sp-detail-score" style="color:${t.color}">${scoreText(t.score)}</span>
                      <span class="sp-detail-status" style="color:${levelColor(t.score)}">${abilityLevel(t.score)}</span>
                    </div>
                  </div>
                  <div class="sp-detail-right">
                    <h3 class="sp-section-subtitle">维度明细</h3>
                    <div class="sp-dim-list">
                      ${t.dims.map(d => buildDimRow(d)).join('')}
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 第四部分：趋势 + 知识点分析（两列） -->
        <div class="sp-analysis-grid">
          <div class="sp-analysis-card">
            <div class="sp-card-header">
              <span class="sp-card-header-icon">${iconTrend}</span>
              <h3 class="sp-card-header-title">能力成长趋势</h3>
            </div>
            <div class="sp-trend-chart" id="sp-trend-chart"></div>
          </div>
          <div class="sp-analysis-card">
            <div class="sp-card-header">
              <span class="sp-card-header-icon">${iconRadar}</span>
              <h3 class="sp-card-header-title">知识掌握分析</h3>
            </div>
            <div class="sp-kp-section">
              <div class="sp-kp-group">
                <h4 class="sp-kp-group-title">
                  <span class="sp-kp-group-icon">${iconStrength}</span>优势知识点
                </h4>
                ${portraitData.good_knowledge_points && portraitData.good_knowledge_points.length
                  ? portraitData.good_knowledge_points.map(p => buildKpItem(p, true)).join('')
                  : '<div class="sp-kp-empty">暂无优势知识点数据</div>'}
              </div>
              <div class="sp-kp-group">
                <h4 class="sp-kp-group-title">
                  <span class="sp-kp-group-icon">${iconWeakness}</span>待强化知识点
                </h4>
                ${portraitData.weak_knowledge_points && portraitData.weak_knowledge_points.length
                  ? portraitData.weak_knowledge_points.map(p => buildKpItem(p, false)).join('')
                  : '<div class="sp-kp-empty">暂无薄弱知识点数据</div>'}
              </div>
            </div>
          </div>
        </div>

        <!-- 第五部分：数据指标表 -->
        <div class="sp-metrics-section">
          <div class="sp-card-header">
            <span class="sp-card-header-icon">${iconScore}</span>
            <h3 class="sp-card-header-title">能力指标明细</h3>
            <span class="sp-card-header-count">${allMetrics.length} 项</span>
          </div>
          <div class="sp-table-wrap">
            <table class="sp-metrics-table">
              <thead>
                <tr>
                  <th>指标名称</th>
                  <th>所属能力</th>
                  <th>当前值</th>
                  <th>状态</th>
                  <th>最近变化</th>
                  <th>数据来源</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                ${allMetrics.map(m => buildMetricRow(m)).join('')}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `
  }

  renderDashboardLayout(app, { menuItems: MENU_ITEMS, contentHTML, user })

  // ========================
  // 图表渲染
  // ========================
  if (!loadError && portraitData && (portraitData.learning_ability_score || portraitData.research_ability_score || portraitData.competition_ability_score)) {
    const learning = portraitData.learning_ability_score
    const research = portraitData.research_ability_score
    const competition = portraitData.competition_ability_score
    const avgScore = clampScore(((learning || 0) + (research || 0) + (competition || 0)) / 3)

    const abilityConfigs = {
      learning: { dims: calcDimensions(learning, 'learning', portraitData), title: '学习能力', color: '#2563EB' },
      research: { dims: calcDimensions(research, 'research', portraitData), title: '科研能力', color: '#7C3AED' },
      competition: { dims: calcDimensions(competition, 'competition', portraitData), title: '竞赛能力', color: '#F59E0B' },
    }

    // 综合均值环形图
    requestAnimationFrame(() => {
      renderOverallRing(avgScore)

      // 默认渲染学习能力雷达图
      renderPortraitRadar('learning', abilityConfigs.learning)
      renderTrendChart(portraitData)

      bindResize()
    })

    // Tab 切换
    const tabs = document.querySelectorAll('.sp-detail-tab')
    const panels = document.querySelectorAll('.sp-detail-panel')
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetKey = tab.dataset.tab
        tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        panels.forEach(p => p.classList.remove('active'))
        const panel = document.querySelector(`.sp-detail-panel[data-panel="${targetKey}"]`)
        if (panel) {
          panel.classList.add('active')
          requestAnimationFrame(() => {
            renderPortraitRadar(targetKey, abilityConfigs[targetKey])
          })
        }
      })
    })

    // 能力卡点击也切换 Tab
    document.querySelectorAll('.sp-ability-card').forEach(card => {
      card.addEventListener('click', () => {
        const key = card.dataset.ability
        const targetTab = document.querySelector(`.sp-detail-tab[data-tab="${key}"]`)
        if (targetTab) targetTab.click()
        const detailSection = document.querySelector('.sp-detail-section')
        if (detailSection) detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })

    // 导出 PDF 报告按钮
    const exportBtn = document.getElementById('sp-export-btn')
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        exportPortraitPDF(user)
      })
    }
  }
}

// ========================
// 环形图 — 综合均值
// ========================

function renderOverallRing(value) {
  const dom = document.getElementById('sp-overall-ring')
  if (!dom) return
  dom.innerHTML = ''
  const inst = echarts.init(dom)
  const s = clampScore(value)
  const color = value >= 70 ? '#2563EB' : value >= 50 ? '#F59E0B' : '#EF4444'
  inst.setOption({
    series: [{
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      center: ['50%', '50%'],
      radius: '90%',
      min: 0,
      max: 100,
      splitNumber: 10,
      axisLine: {
        show: true,
        lineStyle: {
          width: 6,
          color: [[s / 100, color], [1, '#E2E8F0']],
        },
      },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: {
        valueAnimation: true,
        formatter: '{value}',
        color: '#0F172A',
        fontSize: 22,
        fontWeight: 700,
        offsetCenter: [0, '12%'],
      },
      data: [{ value: s }],
    }],
  })
  // 注册 resize
  window.addEventListener('resize', () => { try { inst.resize() } catch (e) { /* ignore */ } }, { passive: true })
}

// ========================
// 雷达图
// ========================

function renderPortraitRadar(key, config) {
  const domId = `sp-radar-${key}`
  const dom = document.getElementById(domId)
  if (!dom) return

  const { dims, title, color } = config
  if (!dims || dims.length === 0) {
    dom.innerHTML = '<div class="sp-chart-empty">暂无维度数据</div>'
    return
  }

  dom.innerHTML = ''
  const inst = echarts.init(dom)
  inst.setOption({
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      borderColor: 'rgba(37, 99, 235, 0.2)',
      borderWidth: 1,
      textStyle: { color: '#fff', fontSize: 13 },
      extraCssText: 'border-radius: 8px; padding: 10px 14px;',
    },
    radar: {
      center: ['50%', '50%'],
      radius: '65%',
      indicator: dims.map(d => ({ name: d.name, max: 100 })),
      splitNumber: 4,
      axisName: { color: '#475569', fontSize: 12, fontWeight: 500 },
      axisLine: { lineStyle: { color: 'rgba(37,99,235,0.12)' } },
      splitLine: { lineStyle: { color: 'rgba(37,99,235,0.08)' } },
      splitArea: {
        areaStyle: {
          color: ['rgba(37,99,235,0.03)', 'rgba(37,99,235,0.01)'],
        },
      },
    },
    series: [{
      type: 'radar',
      symbol: 'circle',
      symbolSize: 4,
      lineStyle: { width: 2.5, color },
      itemStyle: { color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
          { offset: 0, color: color.replace(')', ',0.25)').replace('rgb', 'rgba').replace('#2563EB', 'rgba(37,99,235').replace('#7C3AED', 'rgba(124,58,237').replace('#F59E0B', 'rgba(245,158,11') },
          { offset: 1, color: color.replace(')', ',0.06)').replace('rgb', 'rgba').replace('#2563EB', 'rgba(37,99,235').replace('#7C3AED', 'rgba(124,58,237').replace('#F59E0B', 'rgba(245,158,11') },
        ]),
      },
      data: [{ value: dims.map(d => d.value), name: title }],
    }],
  })
  window.addEventListener('resize', () => { try { inst.resize() } catch (e) { /* ignore */ } }, { passive: true })
}

// ========================
// 趋势折线图
// ========================

function renderTrendChart(portraitData) {
  const dom = document.getElementById('sp-trend-chart')
  if (!dom) return

  // 从 snapshot 数据构建趋势
  const snapshots = portraitData?.snapshots || portraitData?.trend_data
  // 如果后端没有返回快照数据，尝试用当前值构建
  if (!snapshots || !Array.isArray(snapshots) || snapshots.length < 2) {
    dom.innerHTML = `
      <div class="sp-chart-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <p>继续学习后将展示能力成长趋势</p>
      </div>`
    return
  }

  dom.innerHTML = ''
  const inst = echarts.init(dom)
  const labels = snapshots.map(s => {
    const d = new Date(s.date || s.snapshot_date)
    return `${d.getMonth() + 1}月`
  })
  const learningVals = snapshots.map(s => s.learning_total_score || s.learning || 0)
  const researchVals = snapshots.map(s => s.research_total_score || s.research || 0)
  const competitionVals = snapshots.map(s => s.competition_total_score || s.competition || 0)

  inst.setOption({
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      borderColor: 'rgba(37, 99, 235, 0.2)',
      borderWidth: 1,
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'border-radius: 8px; padding: 8px 12px;',
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#64748B', fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 16,
    },
    grid: { left: '3%', right: '4%', top: 8, bottom: 36, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLabel: { color: '#94A3B8', fontSize: 11 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#E2E8F0' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: '#94A3B8', fontSize: 11 },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#F1F5F9' } },
    },
    series: [
      {
        name: '学习能力',
        type: 'line',
        data: learningVals,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2.5, color: '#2563EB' },
        itemStyle: { color: '#2563EB' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(37, 99, 235, 0.12)' },
            { offset: 1, color: 'rgba(37, 99, 235, 0.01)' },
          ]),
        },
      },
      {
        name: '科研能力',
        type: 'line',
        data: researchVals,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2.5, color: '#7C3AED' },
        itemStyle: { color: '#7C3AED' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(124, 58, 237, 0.10)' },
            { offset: 1, color: 'rgba(124, 58, 237, 0.01)' },
          ]),
        },
      },
      {
        name: '竞赛能力',
        type: 'line',
        data: competitionVals,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2.5, color: '#F59E0B' },
        itemStyle: { color: '#F59E0B' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(245, 158, 11, 0.10)' },
            { offset: 1, color: 'rgba(245, 158, 11, 0.01)' },
          ]),
        },
      },
    ],
  })
  window.addEventListener('resize', () => { try { inst.resize() } catch (e) { /* ignore */ } }, { passive: true })
}
