// 教师端 - 学情分析页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getTeacherCourses, getTeacherDashboard, getAnalyticsProgress, getAnalyticsKnowledgeHeatmap, getAnalyticsScoreDistribution, getAnalyticsQuestionFrequency, getAnalyticsWeakKnowledgePoints } from '../api/teacher.js'

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
    { label: '教学管理', icon: 'book', hash: '#/teacher/courses', children: [
      { label: '课程管理', hash: '#/teacher/courses' },
      { label: '学生管理', hash: '#/teacher/students' },
      { label: '知识库', hash: '#/teacher/knowledge' },
    ]},
    { label: '作业考试', icon: 'edit', hash: '#/teacher/tasks', children: [
      { label: '作业任务', hash: '#/teacher/tasks' },
      { label: '题库管理', hash: '#/teacher/questions' },
    ]},
    { label: '学情分析', icon: 'chart', hash: '#/teacher/analytics' },
    { label: '个人中心', icon: 'user', hash: '#/teacher/profile' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title">学情分析</h2>
        <p class="page-subtitle">查看课程整体学习数据与学生表现统计</p>
      </div>

      <div style="margin-bottom:12px;">
        <a href="#/teacher/dashboard" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回首页</a>
      </div>

      <!-- 课程选择器 -->
      <div class="card" style="margin-bottom:20px;padding:14px 20px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label for="course-select" style="font-weight:600;font-size:0.9rem;color:var(--text);">选择课程：</label>
          <select id="course-select" style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
            <option value="">全部课程</option>
          </select>
          <span id="course-hint" style="font-size:0.8rem;color:var(--text-muted);">切换课程后将自动刷新分析数据</span>
        </div>
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
        <h3 class="card-title">成绩分布</h3>
        <div id="score-distribution-container">
          <div class="empty-hint">加载中...</div>
        </div>
      </div>

      <!-- 关键词词云 -->
      <div class="card" style="margin-bottom:20px;">
        <h3 class="card-title">学科对话关键词词云</h3>
        <p style="font-size:0.8rem;color:var(--text-muted);margin:-8px 0 12px;">基于学生学科对话提取的高频关键词，字体越大表示出现频率越高</p>
        <div id="word-cloud-container" style="min-height:120px;padding:8px 0;">
          <div class="empty-hint">加载中...</div>
        </div>
      </div>

      <!-- 薄弱知识点、高频提问、混淆标签三栏 -->
      <div class="content-columns-3" style="margin-bottom:20px;">
        <div class="card">
          <h3 class="card-title">薄弱知识点排行</h3>
          <div id="weak-kp-container">
            <div class="empty-hint">加载中...</div>
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">高频提问统计</h3>
          <div id="question-frequency-container">
            <div class="empty-hint">加载中...</div>
          </div>
        </div>
        <div class="card">
          <h3 class="card-title">常见混淆点</h3>
          <div id="confusion-tags-container" style="min-height:60px;">
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

  // ---- 课程选择状态 ----
  let selectedCourseId = null
  let courseList = []
  let isLoadingData = false

  // 加载课程列表
  async function loadCourses() {
    const select = document.getElementById('course-select')
    if (!select) return
    try {
      const res = await getTeacherCourses()
      courseList = res.data?.list || []
      select.innerHTML = '<option value="">全部课程</option>' +
        courseList.map(c => `<option value="${c.course_id}">${c.course_name}</option>`).join('')
    } catch (err) {
      console.error('加载课程列表失败', err)
    }
  }

  // 课程切换事件
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'course-select') {
      selectedCourseId = e.target.value ? parseInt(e.target.value) : null
      // 更新标题显示
      const titleEl = document.querySelector('.page-title')
      if (titleEl) {
        const courseName = e.target.options[e.target.selectedIndex]?.text || ''
        titleEl.textContent = courseName
          ? `学情分析 — ${courseName}`
          : '学情分析'
      }
      loadAll()
    }
  })

  // 获取当前课程参数（供各 API 调用使用）
  function getCourseParams() {
    return selectedCourseId ? { course_id: selectedCourseId } : {}
  }

  // 加载概览数据
  async function loadAll() {
    if (isLoadingData) return
    isLoadingData = true
    try {
      const dashboardRes = await getTeacherDashboard(getCourseParams())
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
      const scoreRes = await getAnalyticsScoreDistribution(getCourseParams())
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
      const weakRes = await getAnalyticsWeakKnowledgePoints(getCourseParams())
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

    // 高频提问 + 词云 + 混淆标签（同一个 API 返回）
    try {
      const freqRes = await getAnalyticsQuestionFrequency(getCourseParams())
      const freqList = freqRes.data?.list || []
      const totalQ = freqRes.data?.total_questions || 0
      const wordCloud = freqRes.data?.word_cloud || []
      const topTags = freqRes.data?.top_tags || []

      // 高频提问列表
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

      // 词云渲染
      const wcContainer = document.getElementById('word-cloud-container')
      if (!wordCloud || wordCloud.length === 0) {
        wcContainer.innerHTML = '<div class="empty-hint">暂无词云数据（学生进行学科对话后将自动生成）</div>'
      } else {
        const maxCount = Math.max(...wordCloud.map(w => w.count), 1)
        const minFont = 12
        const maxFont = 42
        const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b']
        wcContainer.innerHTML = `
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:16px;min-height:100px;background:rgba(255,255,255,0.4);border-radius:16px;border:1px solid var(--border);">
            ${wordCloud.map(w => {
              const ratio = w.count / maxCount
              const fontSize = minFont + ratio * (maxFont - minFont)
              const color = colors[Math.floor(Math.random() * colors.length)]
              const opacity = 0.55 + ratio * 0.45
              return `<span style="display:inline-block;font-size:${fontSize}px;font-weight:${ratio > 0.5 ? 700 : 400};color:${color};opacity:${opacity};padding:4px 8px;border-radius:8px;transition:all 0.2s;cursor:default;line-height:1.4;" title="出现 ${w.count} 次">${w.keyword}</span>`
            }).join('')}
          </div>
        `
      }

      // 混淆标签渲染
      const tagContainer = document.getElementById('confusion-tags-container')
      if (!topTags || topTags.length === 0) {
        tagContainer.innerHTML = '<div class="empty-hint">暂无标签数据</div>'
      } else {
        tagContainer.innerHTML = `
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${topTags.map(t => {
              const count = t.count || 1
              return `<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;background:#f0f0ff;color:#6366f1;border-radius:16px;font-size:0.85rem;border:1px solid #e0e0ff;">
                <span>${t.tag}</span>
                <span style="background:#6366f1;color:#fff;border-radius:10px;padding:0 6px;font-size:0.7rem;font-weight:600;line-height:1.5;">${count}</span>
              </span>`
            }).join('')}
          </div>
        `
      }
    } catch (err) {
      document.getElementById('question-frequency-container').innerHTML = `<div class="empty-hint">加载失败</div>`
      const wcEl = document.getElementById('word-cloud-container')
      if (wcEl) wcEl.innerHTML = '<div class="empty-hint">加载失败</div>'
    } finally {
      isLoadingData = false
    }
  }

  // 初始化：先加载课程列表，再加载分析数据
  loadCourses().then(() => loadAll())
}

