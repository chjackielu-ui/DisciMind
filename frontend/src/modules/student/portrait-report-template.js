// 学生画像 PDF 报告 — HTML 模板生成
// 生成离屏报告 DOM，所有样式通过作用域 class 前缀 rpt- 隔离

import { escapeHtml } from '../../utils/format.js'

// ========================
// SVG 图标（紧凑版，18px）
// ========================

function svg(inner) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

const iconPdf = svg(`<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>`)

// ========================
// 工具函数
// ========================

function clamp(val) { return Math.max(0, Math.min(100, Math.round(Number(val) || 0))) }

function statusLabel(s) {
  if (s >= 85) return '优势'
  if (s >= 70) return '良好'
  if (s >= 50) return '成长'
  return '待提升'
}

function statusColor(s) {
  if (s >= 85) return '#059669'
  if (s >= 70) return '#2563EB'
  if (s >= 50) return '#D97706'
  return '#DC2626'
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ========================
// 表格行构建
// ========================

function dimTableRow(dim, category, color) {
  const s = clamp(dim.value)
  return `
    <tr>
      <td class="rpt-td-cat"><span class="rpt-cat-dot" style="background:${color}"></span>${escapeHtml(category)}</td>
      <td class="rpt-td-name">${escapeHtml(dim.name)}</td>
      <td class="rpt-td-val">${s}</td>
      <td class="rpt-td-status"><span class="rpt-status-tag" style="background:${statusColor(s)}15;color:${statusColor(s)}">${statusLabel(s)}</span></td>
      <td class="rpt-td-change">${dim.trendValue != null ? (dim.trendValue >= 0 ? '+' : '') + dim.trendValue : '—'}</td>
      <td class="rpt-td-updated">${escapeHtml(dim.updatedAt || '—')}</td>
    </tr>`
}

function sourceTableRow(item) {
  return `
    <tr>
      <td class="rpt-td-name">${escapeHtml(item.category)}</td>
      <td class="rpt-td-name">${escapeHtml(item.source)}</td>
      <td class="rpt-td-name">${escapeHtml(item.model || '—')}</td>
      <td class="rpt-td-val">${escapeHtml(item.scope || '—')}</td>
      <td class="rpt-td-val">${escapeHtml(item.sampleSize || '—')}</td>
      <td class="rpt-td-updated">${escapeHtml(item.updatedAt || '—')}</td>
    </tr>`
}

// ========================
// 主模板
// ========================

export function buildReportHTML(reportData, chartImages) {
  const { student, report, portrait } = reportData
  const { radarImg, trendImg, ringImg } = chartImages || {}

  // 维度计算（与页面一致）
  const learningDims = calcReportDims(portrait.learning_ability_score, 'learning', portrait)
  const researchDims = calcReportDims(portrait.research_ability_score, 'research', portrait)
  const competitionDims = calcReportDims(portrait.competition_ability_score, 'competition', portrait)
  const overallScore = clamp(((portrait.learning_ability_score || 0) + (portrait.research_ability_score || 0) + (portrait.competition_ability_score || 0)) / 3)

  // 所有维度表数据
  const allDims = [
    ...learningDims.map(d => ({ ...d, category: '学习能力', color: '#2563EB' })),
    ...researchDims.map(d => ({ ...d, category: '科研能力', color: '#7C3AED' })),
    ...competitionDims.map(d => ({ ...d, category: '竞赛能力', color: '#F59E0B' })),
  ]

  // 数据来源
  const dataSources = [
    { category: '学习能力分数', source: 'StudentPortrait 画像记录', model: 'student_portraits', scope: `学习课程: ${portrait.mastery_summary ? formatMasteryCount(portrait.mastery_summary) : '—'}`, sampleSize: `${(portrait.mastery_summary?.weak_count || 0) + (portrait.mastery_summary?.general_count || 0) + (portrait.mastery_summary?.good_count || 0) + (portrait.mastery_summary?.excellent_count || 0)} 个知识点`, updatedAt: formatDate(portrait.updated_at) },
    { category: '知识点掌握度', source: 'StudentMasteryRecord 掌握度记录', model: 'student_mastery_records', scope: '按知识点计算掌握等级', sampleSize: `${(portrait.mastery_summary?.weak_count || 0) + (portrait.mastery_summary?.general_count || 0) + (portrait.mastery_summary?.good_count || 0) + (portrait.mastery_summary?.excellent_count || 0)} 条记录`, updatedAt: formatDate(portrait.updated_at) },
    { category: '科研能力评估', source: 'StudentResearchProfile 科研画像', model: 'student_research_profiles', scope: '教师综合性评估', sampleSize: portrait.research_profile ? '1 份评估记录' : '—', updatedAt: formatDate(portrait.updated_at) },
    { category: '竞赛能力评估', source: 'StudentCompetitionProfile 竞赛画像', model: 'student_competition_profiles', scope: '教师综合性评估', sampleSize: portrait.competition_profile ? '1 份评估记录' : '—', updatedAt: formatDate(portrait.updated_at) },
    { category: '能力趋势数据', source: 'StudentPortraitSnapshot 历史快照', model: 'student_portrait_snapshots', scope: `最近 ${(portrait.trend_data || []).length} 个评估时间点`, sampleSize: `${(portrait.trend_data || []).length} 条`, updatedAt: formatDate(portrait.updated_at) },
  ]

  // 优势/薄弱知识点（前5项）
  const strengths = (portrait.good_knowledge_points || []).slice(0, 5)
  const weaknesses = (portrait.weak_knowledge_points || []).slice(0, 5)

  return `
<div class="rpt-sheet">
  <!-- 第一行：报告头部 -->
  <div class="rpt-header">
    <div class="rpt-header-left">
      <div class="rpt-brand">DisciMind 学研智擎</div>
      <h1 class="rpt-title">学生个人学习能力分析报告</h1>
      <p class="rpt-subtitle">基于系统内真实学习记录的多维度能力评估</p>
      <div class="rpt-meta-grid">
        <div class="rpt-meta-item"><span class="rpt-meta-label">学生姓名</span><span class="rpt-meta-value">${escapeHtml(student.name)}</span></div>
        <div class="rpt-meta-item"><span class="rpt-meta-label">学号</span><span class="rpt-meta-value">${escapeHtml(student.studentNo || '—')}</span></div>
        <div class="rpt-meta-item"><span class="rpt-meta-label">班级</span><span class="rpt-meta-value">${escapeHtml(student.className || '—')}</span></div>
        <div class="rpt-meta-item"><span class="rpt-meta-label">专业</span><span class="rpt-meta-value">${escapeHtml(student.major || '—')}</span></div>
        <div class="rpt-meta-item"><span class="rpt-meta-label">学院</span><span class="rpt-meta-value">${escapeHtml(student.college || '—')}</span></div>
        <div class="rpt-meta-item"><span class="rpt-meta-label">数据范围</span><span class="rpt-meta-value">${formatDate(report.dataStartAt)} — ${formatDate(report.dataEndAt)}</span></div>
        <div class="rpt-meta-item"><span class="rpt-meta-label">报告编号</span><span class="rpt-meta-value rpt-meta-mono">${escapeHtml(report.reportId)}</span></div>
        <div class="rpt-meta-item"><span class="rpt-meta-label">生成时间</span><span class="rpt-meta-value">${formatDate(report.generatedAt)}</span></div>
      </div>
    </div>
    <div class="rpt-header-right">
      <div class="rpt-overall-ring" id="rpt-ring-chart"></div>
      <div class="rpt-overall-info">
        <span class="rpt-overall-label">综合能力</span>
        <span class="rpt-overall-score">${overallScore}</span>
        <span class="rpt-overall-status" style="color:${statusColor(overallScore)}">${statusLabel(overallScore)}</span>
      </div>
    </div>
  </div>

  <!-- 第二行：三类能力摘要 -->
  <div class="rpt-ability-row">
    ${buildReportAbilityCard('学习能力', portrait.learning_ability_score, '#2563EB', learningDims.length)}
    ${buildReportAbilityCard('科研能力', portrait.research_ability_score, '#7C3AED', researchDims.length)}
    ${buildReportAbilityCard('竞赛能力', portrait.competition_ability_score, '#F59E0B', competitionDims.length)}
  </div>

  <!-- 第三行：雷达图 + 维度数据表 -->
  <div class="rpt-main-row">
    <div class="rpt-chart-card">
      <h2 class="rpt-section-title">能力结构分析</h2>
      <div class="rpt-radar-wrap" id="rpt-radar-chart"></div>
      <p class="rpt-chart-note">综合能力得分 ${overallScore}，基于学习、科研、竞赛三类能力 ${allDims.length} 个维度</p>
    </div>
    <div class="rpt-table-card">
      <h2 class="rpt-section-title">核心维度数据表</h2>
      <table class="rpt-dim-table">
        <thead>
          <tr><th>能力</th><th>指标</th><th>分数</th><th>状态</th><th>变化</th><th>更新时间</th></tr>
        </thead>
        <tbody>
          ${allDims.map(d => dimTableRow(d, d.category, d.color)).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- 第四行：趋势图 + 知识点 -->
  <div class="rpt-bottom-row">
    <div class="rpt-card">
      <h2 class="rpt-section-title">能力成长趋势</h2>
      ${trendImg
        ? `<img class="rpt-chart-img" src="${trendImg}" alt="能力成长趋势图" />`
        : '<div class="rpt-empty">暂无足够趋势数据</div>'}
    </div>
    <div class="rpt-card">
      <h2 class="rpt-section-title">知识掌握分析</h2>
      <div class="rpt-kp-section">
        <h3 class="rpt-kp-label">优势知识点</h3>
        ${strengths.length ? strengths.map(kp => `
          <div class="rpt-kp-row">
            <span class="rpt-kp-name">${escapeHtml(kp.knowledge_point_name || '—')}</span>
            <div class="rpt-kp-bar"><div class="rpt-kp-fill rpt-kp-fill-good" style="width:${kp.mastery_score || 0}%"></div></div>
            <span class="rpt-kp-score">${kp.mastery_score || 0}</span>
          </div>
        `).join('') : '<div class="rpt-empty">暂无数据</div>'}
        <h3 class="rpt-kp-label rpt-kp-label-weak">待强化知识点</h3>
        ${weaknesses.length ? weaknesses.map(kp => `
          <div class="rpt-kp-row">
            <span class="rpt-kp-name">${escapeHtml(kp.knowledge_point_name || '—')}</span>
            <div class="rpt-kp-bar"><div class="rpt-kp-fill rpt-kp-fill-weak" style="width:${kp.mastery_score || 0}%"></div></div>
            <span class="rpt-kp-score">${kp.mastery_score || 0}</span>
          </div>
        `).join('') : '<div class="rpt-empty">暂无数据</div>'}
      </div>
    </div>
  </div>

  <!-- 第五行：数据来源 + 算法说明 -->
  <div class="rpt-footer-row">
    <div class="rpt-card">
      <h2 class="rpt-section-title">数据来源</h2>
      <table class="rpt-dim-table rpt-dim-table-sm">
        <thead>
          <tr><th>数据类别</th><th>业务来源</th><th>数据模型</th><th>统计范围</th><th>样本量</th><th>更新时间</th></tr>
        </thead>
        <tbody>${dataSources.map(sourceTableRow).join('')}</tbody>
      </table>
    </div>
    <div class="rpt-card">
      <h2 class="rpt-section-title">指标算法说明</h2>
      <div class="rpt-algo-text">
        <p><strong>1. 维度分数：</strong>各能力维度分数基于基础能力分与掌握度数据计算。学习能力维度 = f(基础分, 掌握度比率, 薄弱惩罚)；科研/竞赛维度 = f(基础分, 标签加权)。前端维度值由 <code>calcDimensions()</code> 函数实时计算，不单独存储。</p>
        <p><strong>2. 单项能力分数：</strong>学习能力综合分 = 跨课程 StudentPortrait.learning_total_score 算术平均值；科研/竞赛综合分 = StudentResearchProfile / StudentCompetitionProfile 的 total_score 直接读取。</p>
        <p><strong>3. 综合分数：</strong>综合均值 = (学习 + 科研 + 竞赛) ÷ 3，取整。</p>
        <p><strong>4. 状态等级：</strong>≥85 优势 | ≥70 良好/稳健 | ≥50 成长 | >0 待提升 | 0 数据积累中。</p>
        <p><strong>5. 趋势变化：</strong>基于 StudentPortraitSnapshot 历史快照中相邻两个有效评估时间点的分数差值。</p>
        <p><strong>6. 知识点识别：</strong>优势知识点 = mastery_level 为 GOOD/EXCELLENT 的记录按 mastery_score 降序排列；薄弱知识点 = mastery_level 为 WEAK 的记录按 mastery_score 升序排列。</p>
      </div>
    </div>
  </div>

  <!-- 页脚 -->
  <div class="rpt-page-footer">
    <span>DisciMind 学研智擎 · 数据仅供学习分析参考 · 数据来源于系统内真实学习记录</span>
    <span>${escapeHtml(report.reportId)} · ${formatDate(report.generatedAt)}</span>
  </div>
</div>`
}

// ========================
// 报告用能力卡片
// ========================

function buildReportAbilityCard(name, score, color, dimCount) {
  const s = clamp(score)
  return `
    <div class="rpt-ability-card">
      <div class="rpt-ability-card-dot" style="background:${color}"></div>
      <div class="rpt-ability-card-body">
        <span class="rpt-ability-card-name">${escapeHtml(name)}</span>
        <span class="rpt-ability-card-score">${s}</span>
        <span class="rpt-ability-card-status" style="color:${statusColor(s)}">${statusLabel(s)}</span>
        <div class="rpt-ability-card-track"><div class="rpt-ability-card-fill" style="width:${s}%;background:${color}"></div></div>
        <span class="rpt-ability-card-dims">${dimCount} 个维度</span>
      </div>
    </div>`
}

// ========================
// 维度计算（与页面算法一致）
// ========================

function calcReportDims(totalScore, type, portrait) {
  const base = clamp(totalScore)
  const mastery = portrait?.mastery_summary || {}
  const totalMastery = (mastery.weak_count || 0) + (mastery.general_count || 0) + (mastery.good_count || 0) + (mastery.excellent_count || 0)
  const goodRatio = totalMastery ? ((mastery.good_count || 0) + (mastery.excellent_count || 0)) / totalMastery : 0
  const weakPenalty = totalMastery ? ((mastery.weak_count || 0) / totalMastery) * 24 : 8

  if (type === 'learning') {
    return [
      { name: '知识掌握', value: totalMastery ? clamp(goodRatio * 100) : clamp(base - 4) },
      { name: '薄弱修复', value: clamp(base + 14 - weakPenalty) },
      { name: '课程进展', value: clamp(base + 6) },
      { name: '练习稳定', value: clamp(base - 4) },
      { name: '自主学习', value: clamp(base + 2) },
    ]
  }
  if (type === 'research') {
    const tagBoost = Math.min((portrait?.research_profile?.tags || []).length * 4, 16)
    return [
      { name: '文献检索', value: clamp(base + tagBoost + 2) },
      { name: '问题定义', value: clamp(base + 3) },
      { name: '数据分析', value: clamp(base - 5) },
      { name: '实验设计', value: clamp(base + 4) },
      { name: '学术表达', value: clamp(base - 2) },
    ]
  }
  const tagBoost = Math.min((portrait?.competition_profile?.tags || []).length * 4, 16)
  return [
    { name: '算法基础', value: clamp(base + tagBoost + 2) },
    { name: '工程实现', value: clamp(base + 1) },
    { name: '创新思维', value: clamp(base - 4) },
    { name: '团队协作', value: clamp(base + 3) },
    { name: '成果表达', value: clamp(base - 1) },
  ]
}

function formatMasteryCount(m) {
  return `W:${m.weak_count || 0} G:${m.general_count || 0} Gd:${m.good_count || 0} E:${m.excellent_count || 0}`
}
