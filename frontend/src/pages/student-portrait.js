// 学生端学习画像页面 v1
// 展示学生学习能力、科研能力、竞赛能力画像及知识点雷达图

import { getMe } from '../api/auth.js'
import { getStudentPortrait } from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import {
  disposeAllCharts, bindResize,
  renderRadarChart,
} from '../utils/echarts.js'

const MENU_ITEMS = STUDENT_MENU_ITEMS

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

function dimensionSet(totalScore, type, portraitData) {
  const base = clampScore(totalScore)
  const mastery = portraitData?.mastery_summary || {}
  const totalMastery = (mastery.weak_count || 0) + (mastery.general_count || 0) + (mastery.good_count || 0) + (mastery.excellent_count || 0)
  const goodRatio = totalMastery ? ((mastery.good_count || 0) + (mastery.excellent_count || 0)) / totalMastery : 0
  const weakPenalty = totalMastery ? ((mastery.weak_count || 0) / totalMastery) * 24 : 8

  if (type === 'learning') {
    return [
      { name: '知识掌握', value: totalMastery ? clampScore(goodRatio * 100) : base },
      { name: '薄弱修复', value: clampScore(base + 14 - weakPenalty) },
      { name: '课程进展', value: clampScore(base + 6) },
      { name: '练习稳定', value: clampScore(base - 4) },
      { name: '自主学习', value: clampScore(base + 2) },
    ]
  }

  if (type === 'research') {
    const tagBoost = Math.min((portraitData?.research_profile?.tags || []).length * 4, 16)
    return [
      { name: '问题发现', value: clampScore(base + tagBoost - 3) },
      { name: '文献理解', value: clampScore(base + 2) },
      { name: '实验设计', value: clampScore(base - 5) },
      { name: '数据分析', value: clampScore(base + 4) },
      { name: '表达沉淀', value: clampScore(base - 2) },
    ]
  }

  const tagBoost = Math.min((portraitData?.competition_profile?.tags || []).length * 4, 16)
  return [
    { name: '算法基础', value: clampScore(base + tagBoost - 2) },
    { name: '建模能力', value: clampScore(base + 3) },
    { name: '解题速度', value: clampScore(base - 6) },
    { name: '创新策略', value: clampScore(base + 1) },
    { name: '抗压协作', value: clampScore(base - 1) },
  ]
}

function buildAbilityPanel({ key, icon, title, score, tone, dimensions, open = false, tags = [], comment = '' }) {
  const chartId = `portrait-radar-${key}`
  return `
    <details class="portrait-ability-panel ${tone}" ${open ? 'open' : ''}>
      <summary>
        <span class="ability-icon">${icon}</span>
        <span class="ability-summary-main">
          <span class="ability-title">${title}</span>
          <span class="ability-desc">${abilityLevel(score)} · ${dimensions.length} 个评估维度</span>
        </span>
        <span class="ability-score">${scoreText(score)}</span>
      </summary>
      <div class="ability-panel-body">
        <div class="ability-radar" id="${chartId}"></div>
        <div class="ability-dimension-list">
          ${dimensions.map(d => `
            <div class="ability-dimension-row">
              <div class="dimension-row-head"><span>${escapeHtml(d.name)}</span><b>${d.value}</b></div>
              <div class="dimension-track"><span style="width:${d.value}%"></span></div>
            </div>
          `).join('')}
          ${tags.length ? `<div class="ability-tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${comment ? `<p class="ability-comment">${escapeHtml(comment)}</p>` : ''}
        </div>
      </div>
    </details>`
}

function buildKnowledgeList(title, points, emptyText) {
  return `
    <div class="portrait-knowledge-card">
      <h3>${title}</h3>
      ${points && points.length ? points.map(p => `
        <div class="portrait-kp-row">
          <span>${escapeHtml(p.knowledge_point_name || '未命名知识点')}</span>
          <b>${p.mastery_score ?? 0}</b>
        </div>
      `).join('') : `<div class="empty-hint">${emptyText}</div>`}
    </div>`
}

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
      <div class="page-header">
        <h2 class="page-title">📊 学习画像</h2>
        <p class="page-subtitle">综合能力分析与诊断</p>
      </div>
      <div class="error-state">
        <div class="error-icon">😞</div>
        <p class="error-message">画像数据加载失败</p>
        <button class="btn-retry" onclick="window.location.reload()">重新加载</button>
      </div>`
  } else if (!portraitData || (!portraitData.learning_ability_score && !portraitData.research_ability_score && !portraitData.competition_ability_score)) {
    // 无画像数据 — 显示规划信息
    contentHTML = `
      <div class="page-header">
        <h2 class="page-title">📊 学习画像</h2>
        <p class="page-subtitle">综合能力分析与诊断</p>
      </div>
      <div class="portrait-placeholder">
        <div class="portrait-placeholder-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(47,102,144,0.3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <h3 class="portrait-placeholder-title">画像生成中</h3>
        <p class="portrait-placeholder-desc">系统将在你完成学习任务、答题和问答后生成能力画像</p>
        <div class="portrait-feature-grid">
          <div class="portrait-feature-card">
            <div class="portrait-feature-icon">📚</div>
            <h4>学习能力分析</h4>
            <p>基于课程学习进度、知识点掌握度、答题正确率等维度综合评估学习能力</p>
          </div>
          <div class="portrait-feature-card">
            <div class="portrait-feature-icon">🔬</div>
            <h4>科研能力分析</h4>
            <p>通过论文阅读、实验完成度、项目参与度等指标衡量科研潜力</p>
          </div>
          <div class="portrait-feature-card">
            <div class="portrait-feature-icon">🏆</div>
            <h4>竞赛能力分析</h4>
            <p>结合算法练习、竞赛模拟成绩、创新思维评分等维度评估竞赛水平</p>
          </div>
          <div class="portrait-feature-card">
            <div class="portrait-feature-icon">🎯</div>
            <h4>知识点掌握雷达图</h4>
            <p>多维度展示各知识领域掌握程度，直观发现优势与薄弱环节</p>
          </div>
          <div class="portrait-feature-card">
            <div class="portrait-feature-icon">🔍</div>
            <h4>薄弱点诊断</h4>
            <p>精准定位学习薄弱知识点，提供针对性提升建议和学习路径规划</p>
          </div>
          <div class="portrait-feature-card">
            <div class="portrait-feature-icon">📈</div>
            <h4>成长轨迹追踪</h4>
            <p>记录学习历程中的能力变化，可视化呈现个人成长曲线</p>
          </div>
        </div>
      </div>`
  } else {
    // 有数据 — 展示画像
    const learning = portraitData.learning_ability_score
    const research = portraitData.research_ability_score
    const competition = portraitData.competition_ability_score
    const learningDims = dimensionSet(learning, 'learning', portraitData)
    const researchDims = dimensionSet(research, 'research', portraitData)
    const competitionDims = dimensionSet(competition, 'competition', portraitData)

    contentHTML = `
      <div class="portrait-page-shell">
        <div class="portrait-hero">
          <div>
            <span class="portrait-eyebrow">Student Portrait</span>
            <h2>学习画像</h2>
            <p>从学习能力、科研能力、竞赛能力三个方向拆解关键维度，展开任一模块即可查看能力雷达图。</p>
          </div>
          <div class="portrait-hero-score">
            <span>综合均值</span>
            <b>${scoreText(((learning || 0) + (research || 0) + (competition || 0)) / 3)}</b>
          </div>
        </div>
        <div class="portrait-scores-grid">
          <div class="portrait-score-card learning">
            <div class="portrait-score-label">学习能力</div>
            <div class="portrait-score-value high">${scoreText(learning)}</div>
            <div class="portrait-score-bar"><div class="portrait-score-fill" style="width:${clampScore(learning)}%"></div></div>
          </div>
          <div class="portrait-score-card research">
            <div class="portrait-score-label">科研能力</div>
            <div class="portrait-score-value">${scoreText(research)}</div>
            <div class="portrait-score-bar"><div class="portrait-score-fill" style="width:${clampScore(research)}%"></div></div>
          </div>
          <div class="portrait-score-card competition">
            <div class="portrait-score-label">竞赛能力</div>
            <div class="portrait-score-value">${scoreText(competition)}</div>
            <div class="portrait-score-bar"><div class="portrait-score-fill" style="width:${clampScore(competition)}%"></div></div>
          </div>
        </div>
        <div class="portrait-ability-stack">
          ${buildAbilityPanel({
            key: 'learning',
            icon: '📚',
            title: '学习能力',
            score: learning,
            tone: 'learning',
            dimensions: learningDims,
            open: true,
          })}
          ${buildAbilityPanel({
            key: 'research',
            icon: '🔬',
            title: '科研能力',
            score: research,
            tone: 'research',
            dimensions: researchDims,
            tags: portraitData.research_profile?.tags || [],
            comment: portraitData.research_profile?.teacher_comment || '',
          })}
          ${buildAbilityPanel({
            key: 'competition',
            icon: '🏆',
            title: '竞赛能力',
            score: competition,
            tone: 'competition',
            dimensions: competitionDims,
            tags: portraitData.competition_profile?.tags || [],
            comment: portraitData.competition_profile?.teacher_comment || '',
          })}
        </div>
        <div class="portrait-knowledge-grid">
          ${buildKnowledgeList('优势知识点', portraitData.good_knowledge_points, '暂无优势知识点数据')}
          ${buildKnowledgeList('待强化知识点', portraitData.weak_knowledge_points, '暂无薄弱知识点数据')}
        </div>
      </div>
    `
  }

  renderDashboardLayout(app, { menuItems: MENU_ITEMS, contentHTML, user })

  if (!loadError && portraitData && (portraitData.learning_ability_score || portraitData.research_ability_score || portraitData.competition_ability_score)) {
    const learningDims = dimensionSet(portraitData.learning_ability_score, 'learning', portraitData)
    const researchDims = dimensionSet(portraitData.research_ability_score, 'research', portraitData)
    const competitionDims = dimensionSet(portraitData.competition_ability_score, 'competition', portraitData)
    const chartSets = {
      learning: learningDims,
      research: researchDims,
      competition: competitionDims,
    }
    const renderOne = (key) => {
      const dims = chartSets[key]
      renderRadarChart(`portrait-radar-${key}`, dims.map(d => d.name), dims.map(d => d.value), key === 'learning' ? '学习能力' : key === 'research' ? '科研能力' : '竞赛能力')
    }
    requestAnimationFrame(() => {
      bindResize()
      document.querySelectorAll('.portrait-ability-panel').forEach((panel) => {
        const key = panel.classList.contains('learning') ? 'learning' : panel.classList.contains('research') ? 'research' : 'competition'
        if (panel.open) renderOne(key)
        panel.addEventListener('toggle', () => {
          if (panel.open) requestAnimationFrame(() => renderOne(key))
        })
      })
    })
  }
}
