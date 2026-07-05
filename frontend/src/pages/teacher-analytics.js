// 教师端 - 学情分析页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getTeacherDashboard, getAnalyticsProgress, getAnalyticsKnowledgeHeatmap, getAnalyticsScoreDistribution, getAnalyticsQuestionFrequency, getAnalyticsWeakKnowledgePoints } from '../api/teacher.js'

export async function renderTeacherAnalytics(app) {
  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? getToken() : '', user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  const displayName = getUserDisplayName()

  const menuItems = [
    { label: '首页', icon: 'home', hash: '#/teacher/dashboard' },
    { label: '我的课程', icon: 'book', hash: '#/teacher/courses' },
    { label: '学生管理', icon: 'user', hash: '#/teacher/students' },
    { label: '作业测试', icon: 'alert', hash: '#/teacher/tasks' },
    { label: '题库管理', icon: 'star', hash: '#/teacher/questions' },
    { label: '知识库', icon: 'book', hash: '#/teacher/knowledge' },
    { label: '学情分析', icon: 'star', hash: '#/teacher/analytics' },
    { label: '个人中心', icon: 'user', hash: '#/teacher/profile' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title">📊 学情分析</h2>
        <p class="page-subtitle">查看课程整体学习数据与学生表现统计</p>
      </div>

      <!-- 概览卡片 -->
      <div class="stats-grid" id="overview-stats">
        <div class="stat-card"><div class="stat-value" id="stat-students">-</div><div class="stat-label">学生总数</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-mastery">-</div><div class="stat-label">平均掌握度</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-score">-</div><div class="stat-label">平均成绩</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-questions">-</div><div class="stat-label">AI 提问数</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-weak">-</div><div class="stat-label">薄弱知识点</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-pending">-</div><div class="stat-label">待审文档</div></div>
      </div>

      <!-- 成绩分布 -->
      <div class="card" style="margin-bottom:20px;">
        <h3 class="card-title">📈 成绩分布</h3>
        <div id="score-distribution-container">
          <div class="empty-hint">加载中...</div>
        </div>
      </div>

      <!-- 薄弱知识点和高频提问两栏 -->
      <div class="content-columns">
        <div class="card">
          <h3 class="card-title">🔴 薄弱知识点排行</h3>
          <div id="weak-kp-container">
            <div class="empty-hint">加载中...</div>
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">❓ 高频提问统计</h3>
          <div id="question-frequency-container">
            <div class="empty-hint">加载中...</div>
          </div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '学情分析',
    menuItems,
    contentHTML,
    user,
  })

  // 加载概览数据
  async function loadAll() {
    try {
      const dashboardRes = await getTeacherDashboard()
      const dashboard = dashboardRes.data || {}

      document.getElementById('stat-students').textContent = dashboard.student_count ?? '-'
      document.getElementById('stat-mastery').textContent = dashboard.average_mastery_score != null ? `${dashboard.average_mastery_score}%` : '-'
      document.getElementById('stat-score').textContent = dashboard.average_test_score != null ? `${dashboard.average_test_score}%` : '-'
      document.getElementById('stat-questions').textContent = dashboard.ai_question_count ?? '-'
      document.getElementById('stat-weak').textContent = dashboard.weak_knowledge_point_count ?? '-'
      document.getElementById('stat-pending').textContent = dashboard.pending_review_document_count ?? '-'
    } catch (err) {
      console.error('加载概览失败', err)
    }

    // 成绩分布
    try {
      const scoreRes = await getAnalyticsScoreDistribution()
      const dist = scoreRes.data?.distribution || {}
      const total = scoreRes.data?.total_sessions || 0
      const avg = scoreRes.data?.average_score_rate || 0

      const container = document.getElementById('score-distribution-container')
      const items = [
        { key: 'excellent', label: '优秀 (90-100)', color: '#10b981', data: dist.excellent || {} },
        { key: 'good', label: '良好 (75-89)', color: '#3b82f6', data: dist.good || {} },
        { key: 'general', label: '一般 (60-74)', color: '#f59e0b', data: dist.general || {} },
        { key: 'weak', label: '薄弱 (0-59)', color: '#ef4444', data: dist.weak || {} },
      ]

      container.innerHTML = `
        <div style="margin-bottom:12px;font-size:0.9rem;color:var(--text-secondary);">
          共 ${total} 次提交 · 平均得分率 ${avg}%
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          ${items.map(item => `
            <div style="flex:1;min-width:120px;padding:14px;background:rgba(255,255,255,0.6);border-radius:12px;border:1px solid var(--border);text-align:center;">
              <div style="font-size:1.4rem;font-weight:700;color:${item.color};">${item.data.count || 0}</div>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">${item.label}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${item.data.percentage || 0}%</div>
            </div>
          `).join('')}
        </div>
      `
    } catch (err) {
      document.getElementById('score-distribution-container').innerHTML = `<div class="empty-hint">加载失败: ${err.message}</div>`
    }

    // 薄弱知识点
    try {
      const weakRes = await getAnalyticsWeakKnowledgePoints()
      const weakList = weakRes.data?.list || []
      const container = document.getElementById('weak-kp-container')

      if (weakList.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无薄弱知识点数据</div>'
      } else {
        container.innerHTML = weakList.slice(0, 10).map(kp => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:0.9rem;">${kp.knowledge_point_name}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:0.8rem;color:var(--text-muted);">${kp.student_count} 人</span>
              <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;font-size:0.75rem;">${kp.average_score}分</span>
            </div>
          </div>
        `).join('')
      }
    } catch (err) {
      document.getElementById('weak-kp-container').innerHTML = `<div class="empty-hint">加载失败</div>`
    }

    // 高频提问
    try {
      const freqRes = await getAnalyticsQuestionFrequency()
      const freqList = freqRes.data?.list || []
      const totalQ = freqRes.data?.total_questions || 0
      const container = document.getElementById('question-frequency-container')

      container.innerHTML = `
        <div style="margin-bottom:10px;font-size:0.8rem;color:var(--text-muted);">共 ${totalQ} 次提问</div>
        ${freqList.length === 0 ? '<div class="empty-hint">暂无提问数据</div>' : freqList.slice(0, 10).map(item => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:0.9rem;">${item.knowledge_point_name}</span>
            <div style="display:flex;gap:12px;font-size:0.8rem;color:var(--text-muted);">
              <span>${item.question_count} 次</span>
              <span>${item.student_count} 人</span>
            </div>
          </div>
        `).join('')}
      `
    } catch (err) {
      document.getElementById('question-frequency-container').innerHTML = `<div class="empty-hint">加载失败</div>`
    }
  }

  loadAll()
}
