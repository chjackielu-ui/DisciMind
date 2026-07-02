// 学生端首页 v2 — 学习驾驶舱
// 新增：课程选择器、模块拖拽排序、固定/隐藏、布局持久化

import { getMe } from '../api/auth.js'
import { getStudentDashboard, getStudentCourses, getStudentCourseDetail, getStudentCourseKnowledgePoints } from '../api/student.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatPercent, formatDate, masteryLabel, recommendTypeLabel, isOverdue } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { iconLayout, iconGrip } from '../utils/icons.js'
import {
  disposeAllCharts, bindResize,
  renderGaugeChart, renderRingChart, renderHorizontalBarChart, renderBarChart,
  renderEmptyPanel, renderInsightPanel,
  CHART_COLORS,
} from '../utils/echarts.js'

// ========================
// 默认模块配置
// ========================

const DEFAULT_MODULES = [
  { id: 'hero-overview', title: '学习总览', pinned: true, visible: true, order: 1, lockPinned: true },
  { id: 'metric-cards', title: '核心指标', pinned: true, visible: true, order: 2 },
  { id: 'progress-chart', title: '学习进度', pinned: false, visible: true, order: 3 },
  { id: 'mastery-chart', title: '掌握度分布', pinned: false, visible: true, order: 4 },
  { id: 'weak-chart', title: '薄弱知识点', pinned: false, visible: true, order: 5 },
  { id: 'course-panel', title: '当前课程', pinned: false, visible: true, order: 6 },
  { id: 'recommendation-panel', title: '推荐内容', pinned: false, visible: true, order: 7 },
  { id: 'task-panel', title: '最近任务', pinned: false, visible: true, order: 8 },
  { id: 'insight-panel', title: '学习建议', pinned: false, visible: true, order: 9 },
]

function getLayoutConfig(userId) {
  const key = `discimind_dashboard_layout_${userId}`
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      const parsed = JSON.parse(saved)
      // 合并默认配置（新模块不会丢失）
      const merged = DEFAULT_MODULES.map(dm => {
        const savedMod = parsed.find(m => m.id === dm.id)
        return savedMod ? { ...dm, ...savedMod } : dm
      })
      return merged
    }
  } catch (e) { /* ignore */ }
  return [...DEFAULT_MODULES]
}

function saveLayoutConfig(userId, modules) {
  const key = `discimind_dashboard_layout_${userId}`
  localStorage.setItem(key, JSON.stringify(modules))
}

function getSelectedCourse(userId) {
  const key = `discimind_student_selected_course_${userId}`
  try {
    const val = localStorage.getItem(key)
    return val ? JSON.parse(val) : null
  } catch { return null }
}

function saveSelectedCourse(userId, courseId, courseName) {
  const key = `discimind_student_selected_course_${userId}`
  localStorage.setItem(key, JSON.stringify({ course_id: courseId, course_name: courseName }))
}

// ========================
// HTML 构建
// ========================

function buildHero(user, welcomeName, courses, selectedCourse, overview = {}) {
  const profile = user?.profile || {}
  const infoItems = [
    { label: '学号', value: profile.student_no || user?.student_no },
    { label: '班级', value: profile.admin_class?.class_name || profile.class_name || profile.admin_class_name },
    { label: '邮箱', value: user?.email },
    { label: '课程', value: `${overview?.course_count ?? (courses?.length || 0)} 门` },
    { label: '进度', value: formatPercent(overview?.learning_progress) },
  ].filter(item => item.value != null && item.value !== '')

  return `
    <div class="dashboard-hero" id="module-hero-overview">
      <div class="hero-content">
        <div class="hero-text">
          <h2>欢迎你，${escapeHtml(welcomeName)}</h2>
          <p>${selectedCourse ? `当前正在查看《${escapeHtml(selectedCourse.course_name || selectedCourse)}》的学习情况` : '这里是你的个性化学习状态总览，系统根据你的学习行为持续更新各维度数据。'}</p>
          <div class="hero-student-meta">
            ${infoItems.map(item => `<span><b>${item.label}</b>${escapeHtml(item.value)}</span>`).join('')}
          </div>
        </div>
      </div>
    </div>`
}

function buildDashboardToolbar(courses, selectedCourse) {
  return `
    <div class="dashboard-control-bar">
      <div class="course-selector">
        <span class="course-select-label">课程视图：</span>
        <button type="button" class="course-select-capsule${!selectedCourse ? ' active' : ''}" data-course-id="">全部课程</button>
        ${(courses || []).map(c => `
          <button type="button" class="course-select-capsule${selectedCourse && selectedCourse.course_id === c.course_id ? ' active' : ''}" data-course-id="${c.course_id}" data-course-name="${escapeHtml(c.course_name)}">${escapeHtml(c.course_name)}</button>
        `).join('')}
      </div>
      <div class="dashboard-control-actions">
        <span class="last-sync">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          最后同步：${formatDate(new Date().toISOString(), 'time')}
        </span>
        <button class="btn-layout-settings" id="btn-layout-settings" type="button" title="布局设置">
          ${iconLayout()} 布局设置
        </button>
      </div>
    </div>`
}

function buildStatCards(overview) {
  const cards = [
    { icon: '📚', value: overview?.course_count || 0, label: '课程数量', cls: '' },
    { icon: '📈', value: formatPercent(overview?.learning_progress), label: '学习进度', cls: 'success' },
    { icon: '✅', value: overview?.mastered_knowledge_count || 0, label: '已掌握知识点', cls: 'success' },
    { icon: '⚠️', value: overview?.weak_knowledge_count || 0, label: '薄弱知识点', cls: 'warning' },
    { icon: '📝', value: overview?.wrong_question_count || 0, label: '错题数量', cls: 'danger' },
    { icon: '⏱️', value: (overview?.weekly_study_hours || 0) + 'h', label: '本周学习时长', cls: '' },
    { icon: '🤖', value: overview?.ai_question_count || 0, label: 'AI 提问次数', cls: '' },
  ]
  return `<div class="stat-cards-row dashboard-module" id="module-metric-cards" draggable="true">${cards.map(c => `
    <div class="stat-card-enhanced ${c.cls}">
      <div class="stat-icon">${c.icon}</div>
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div>`).join('')}</div>`
}

function buildPortraitHTML(portrait) {
  const learning = portrait?.learning_ability_score
  return `
    <div class="card">
      <h3 class="card-title">📊 学习画像</h3>
      <div class="profile-list">
        <div class="profile-item"><span class="profile-label">学习能力</span><span class="profile-value high">${learning != null ? learning : '暂未评估'}</span></div>
        <div class="profile-item"><span class="profile-label">科研能力</span><span class="profile-value muted">${portrait?.research_ability_score != null ? portrait.research_ability_score : '暂未评估'}</span></div>
        <div class="profile-item"><span class="profile-label">竞赛能力</span><span class="profile-value muted">${portrait?.competition_ability_score != null ? portrait.competition_ability_score : '暂未评估'}</span></div>
      </div>
    </div>`
}

function buildCourseCards(courses) {
  if (!courses || courses.length === 0) return '<div class="empty-hint">暂无课程</div>'
  return courses.map(c => `
    <div class="course-card-mini" data-course-id="${c.course_id}">
      <div class="course-icon">📘</div>
      <div class="course-info"><div class="course-name">${escapeHtml(c.course_name)}</div><div class="course-meta">${escapeHtml(c.course_code || '')}</div></div>
      <div class="course-arrow">→</div>
    </div>`).join('')
}

function buildRecommendationsHTML(recommendations) {
  if (!recommendations || recommendations.length === 0) return '<div class="empty-hint">暂无推荐内容</div>'
  return recommendations.slice(0, 5).map(r => `
    <div class="rec-item"><span class="rec-tag ${r.recommend_type || ''}">${recommendTypeLabel(r.recommend_type)}</span><span class="rec-title" style="display:inline;margin-left:6px;">${escapeHtml(r.title)}</span>${r.reason ? `<div class="rec-reason">${escapeHtml(r.reason)}</div>` : ''}</div>`).join('')
}

function buildRecentTasksHTML(tasks) {
  if (!tasks || tasks.length === 0) return '<div class="empty-hint">暂无学习任务</div>'
  return tasks.map(t => `
    <div class="task-item">
      <span class="task-dot ${t.status !== 'published' ? 'pending' : ''}"></span>
      <span style="flex:1;min-width:0;">${escapeHtml(t.task_title)}</span>
      <span class="task-deadline ${isOverdue(t.deadline) ? 'overdue' : ''}">${isOverdue(t.deadline) ? '已截止' : '截止: ' + formatDate(t.deadline, 'short')}</span>
      <button class="btn-quick-action btn-task-answer" data-task-answer="${t.task_id}" type="button">开始答题</button>
    </div>`).join('')
}

// ========================
// 模块渲染
// ========================

function renderModuleHTML(moduleId, data) {
  const { overview, portrait, courses, weak_knowledge_points, recommendations, recent_tasks } = data
  switch (moduleId) {
    case 'progress-chart':
      return `<div class="chart-card dashboard-module" id="module-progress-chart" draggable="true"><div class="chart-header"><span class="chart-title">📊 学习进度仪表盘</span></div><div class="chart-container" id="chart-progress-gauge"></div></div>`
    case 'mastery-chart':
      return `<div class="chart-card dashboard-module" id="module-mastery-chart" draggable="true"><div class="chart-header"><span class="chart-title">🎯 知识点掌握分布</span></div><div class="chart-container" id="chart-mastery-ring"></div></div>`
    case 'weak-chart':
      return `<div class="chart-card dashboard-module" id="module-weak-chart" draggable="true"><div class="chart-header"><span class="chart-title">⚠️ 薄弱知识点</span></div><div class="chart-container-lg" id="chart-weak-bar"></div></div>`
    case 'course-panel':
      return `<div class="card dashboard-module" id="module-course-panel" draggable="true"><h3 class="card-title">📚 当前课程</h3>${buildCourseCards(courses)}</div>`
    case 'recommendation-panel':
      return `<div class="card dashboard-module" id="module-recommendation-panel" draggable="true"><h3 class="card-title">⭐ 推荐学习内容</h3>${buildRecommendationsHTML(recommendations)}${recommendations && recommendations.length > 0 ? `<div style="text-align:right;margin-top:12px;"><button class="btn-quick-action" data-nav="recommendations">查看更多推荐 →</button></div>` : ''}</div>`
    case 'task-panel':
      return `<div class="card dashboard-module" id="module-task-panel" draggable="true"><h3 class="card-title">📋 最近学习任务</h3>${buildRecentTasksHTML(recent_tasks)}</div>`
    case 'insight-panel':
      return `<div class="card dashboard-module" id="module-insight-panel" draggable="true"><h3 class="card-title">💡 学习建议</h3><div class="insight-panel-list"><li>薄弱知识点较多，建议优先复习 SVM 和神经网络基础</li><li>本周学习时长偏低，建议每天保持30分钟以上</li><li>PCA 简答题得分较低，建议加强练习</li></div></div>`
    default: return ''
  }
}

// ========================
// 图表渲染
// ========================

function renderCharts(modules, overview, weakPoints, masteryData) {
  bindResize()

  // Helper: check if DOM container exists with non-zero dimensions
  function hasContainer(id) {
    const el = document.getElementById(id)
    return el && el.clientWidth > 0 && el.clientHeight > 0
  }

  modules.forEach(m => {
    if (!m.visible) return
    switch (m.id) {
      case 'progress-chart': {
        if (!hasContainer('chart-progress-gauge')) return
        if (overview?.learning_progress != null && overview.learning_progress > 0) {
          renderGaugeChart('chart-progress-gauge', overview.learning_progress, '学习进度')
        } else {
          renderInsightPanel('chart-progress-gauge', '今日学习建议', [
            '优先复习薄弱知识点，巩固基础',
            '完成最近的学习任务，保持学习节奏',
            '查看推荐学习内容，拓展知识面',
          ])
        }
        break
      }
      case 'mastery-chart': {
        if (!hasContainer('chart-mastery-ring')) return
        const mastered = overview?.mastered_knowledge_count || 0
        const weak = overview?.weak_knowledge_count || 0
        const total = mastered + weak
        if (total > 0) {
          const general = Math.max(1, (masteryData?.general_count || 0))
          const ringData = [
            { name: '已掌握', value: mastered, itemStyle: { color: CHART_COLORS.softGreen } },
            { name: '一般', value: general, itemStyle: { color: CHART_COLORS.warm } },
            { name: '薄弱', value: Math.max(1, weak), itemStyle: { color: CHART_COLORS.softRed } },
          ]
          renderRingChart('chart-mastery-ring', ringData, '知识点掌握分布')
        } else {
          renderEmptyPanel('chart-mastery-ring', '暂无掌握度数据', '完成课程学习后将生成知识点掌握分布。')
        }
        break
      }
      case 'weak-chart':
        if (!hasContainer('chart-weak-bar')) return
        if (weakPoints && weakPoints.length > 0) {
          renderHorizontalBarChart('chart-weak-bar', weakPoints.map(p => p.knowledge_point_name), weakPoints.map(p => p.mastery_score || 0), '薄弱知识点掌握度')
        } else {
          renderInsightPanel('chart-weak-bar', '暂无薄弱知识点', [
            '当前课程表现良好，继续保持！',
            '建议挑战更高难度的知识点，拓展能力边界',
          ])
        }
        break
    }
  })
}

// ========================
// 主渲染
// ========================

export async function renderStudentDashboard(app) {
  disposeAllCharts()

  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(localStorage.getItem('token') || '', user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  const userId = user.user_id
  const displayName = user?.profile?.real_name || getUserDisplayName()

  const menuItems = STUDENT_MENU_ITEMS

  // 获取课程列表（用于课程选择器）
  let courses = []
  try {
    const cr = await getStudentCourses()
    courses = cr.data?.list || []
  } catch (e) { /* ignore */ }

  // 读取已保存的课程选择
  let selectedCourse = getSelectedCourse(userId)
  // 验证课程仍存在
  if (selectedCourse && selectedCourse.course_id) {
    const found = courses.find(c => c.course_id === selectedCourse.course_id)
    if (!found) selectedCourse = null
  }

  // 读取模块布局配置
  let layoutModules = getLayoutConfig(userId)

  // 获取仪表盘数据
  let dashboardData = null
  let loadError = false
  try {
    if (selectedCourse && selectedCourse.course_id) {
      // 聚焦单门课程
      const [detailRes, kpRes] = await Promise.all([
        getStudentCourseDetail(selectedCourse.course_id),
        getStudentCourseKnowledgePoints(selectedCourse.course_id),
      ])
      const detail = detailRes.data
      const kps = kpRes.data?.list || []
      const mastered = kps.filter(k => k.mastery_level === 'good' || k.mastery_level === 'excellent').length
      const weak = kps.filter(k => k.mastery_level === 'weak').length
      dashboardData = {
        user: { real_name: displayName },
        overview: {
          course_count: 1,
          learning_progress: detail.learning_progress || 0,
          mastered_knowledge_count: mastered,
          weak_knowledge_count: weak,
          wrong_question_count: 0,
          weekly_study_hours: 0,
          ai_question_count: 0,
        },
        portrait: null,
        courses: [detail],
        weak_knowledge_points: kps.filter(k => k.mastery_level === 'weak').map(k => ({ knowledge_point_name: k.knowledge_point_name, mastery_score: k.mastery_score })),
        recommendations: [],
        recent_tasks: detail.recent_tasks || [],
        _kps: kps,
      }
    } else {
      const dashResult = await getStudentDashboard()
      dashboardData = dashResult.data
    }
  } catch (err) {
    console.error('获取首页数据失败:', err.message)
    loadError = true
  }

  // 构建内容
  let contentHTML
  let generalCount = 3
  if (loadError) {
    contentHTML = `<div class="dashboard-content">${buildDashboardToolbar(courses, selectedCourse)}${buildHero(user, displayName, courses, selectedCourse)}<div class="error-state"><div class="error-icon">😞</div><p class="error-message">数据加载失败</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div></div>`
  } else {
    const { overview, portrait, weak_knowledge_points, recommendations, recent_tasks } = dashboardData
    const dashCourses = dashboardData.courses || courses
    const allKpCount = dashCourses.reduce((s, c) => s + (c.knowledge_point_count || 0), 0)
    generalCount = Math.max(0, allKpCount - (overview.mastered_knowledge_count || 0) - (overview.weak_knowledge_count || 0))

    // 筛选可见模块
    const visibleModules = layoutModules.filter(m => m.visible).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.order - b.order
    })

    // 分组
    const pinnedModules = visibleModules.filter(m => m.pinned)
    const normalModules = visibleModules.filter(m => !m.pinned)

    // 构建模块 HTML
    let modulesHTML = ''
    if (pinnedModules.length > 0) {
      modulesHTML += pinnedModules.map((m, idx) => {
        if (m.id === 'hero-overview') return buildHero(user, displayName, courses, selectedCourse, overview).replace('id="module-hero-overview"', `id="module-hero-overview" class="dashboard-module"`)
        if (m.id === 'metric-cards') return buildStatCards(overview)
        return renderModuleHTML(m.id, { overview, portrait, courses: dashCourses, weak_knowledge_points, recommendations, recent_tasks })
      }).join('')
    }
    if (normalModules.length > 0) {
      modulesHTML += normalModules.map(m => renderModuleHTML(m.id, { overview, portrait, courses: dashCourses, weak_knowledge_points, recommendations, recent_tasks })).join('')
    }

    // 快捷操作
    const quickActionsHTML = `
      <div class="quick-actions" style="margin-top:24px;">
        <button class="btn-quick-action" data-nav="courses">📚 查看全部课程</button>
        <button class="btn-quick-action" data-nav="wrong-questions">📝 查看错题本</button>
        <button class="btn-quick-action" data-nav="recommendations">⭐ 查看推荐</button>
      </div>`

    contentHTML = `<div class="dashboard-content">${buildDashboardToolbar(courses, selectedCourse)}${modulesHTML}${quickActionsHTML}</div>`
  }

  renderDashboardLayout(app, { menuItems, contentHTML, user })
  bindDashboardEvents(userId, courses, layoutModules)

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!loadError && dashboardData) {
        renderCharts(layoutModules, dashboardData.overview, dashboardData.weak_knowledge_points, { general_count: generalCount || 3 })
      }
    })
  })
}

// ========================
// 事件绑定
// ========================

function bindDashboardEvents(userId, courses, layoutModules) {
  // 使用事件委托 — 绑定到稳定的父容器，避免 DOM 替换后事件丢失
  const main = document.getElementById('student-main')
  if (!main) return

  // 移除旧的事件委托（避免重复绑定）
  if (main._dashClickHandler) {
    main.removeEventListener('click', main._dashClickHandler)
  }

  const handler = (e) => {
    const coursePill = e.target.closest('.course-select-capsule')
    const courseCard = e.target.closest('.course-card-mini')
    const taskAnswerBtn = e.target.closest('[data-task-answer]')
    const navTarget = e.target.closest('[data-nav]')
    const settingsBtn = e.target.closest('#btn-layout-settings')

    // 课程选择器
    if (coursePill) {
      const courseId = coursePill.dataset.courseId ? parseInt(coursePill.dataset.courseId, 10) : null
      const courseName = coursePill.dataset.courseName || null
      if (courseId) {
        saveSelectedCourse(userId, courseId, courseName)
        showToast(`已切换到《${courseName}》学习视图`, 'info')
      } else {
        localStorage.removeItem(`discimind_student_selected_course_${userId}`)
        showToast('已切换到全部课程视图', 'info')
      }
      setTimeout(() => window.location.reload(), 300)
      return
    }

    // 课程卡片
    if (courseCard) {
      const cid = courseCard.dataset.courseId
      if (cid) window.location.hash = `#/student/courses/${cid}`
      return
    }

    // 最近任务答题入口
    if (taskAnswerBtn) {
      const tid = taskAnswerBtn.dataset.taskAnswer
      if (tid) window.location.hash = `#/student/tasks/${tid}/answer`
      return
    }

    // 快捷操作
    if (navTarget) {
      const t = navTarget.dataset.nav
      if (t === 'courses') window.location.hash = '#/student/courses'
      else if (t === 'wrong-questions') window.location.hash = '#/student/wrong-questions'
      else if (t === 'recommendations') window.location.hash = '#/student/recommendations'
      return
    }

    // 布局设置按钮
    if (settingsBtn) {
      openLayoutSettings(userId, layoutModules)
      return
    }
  }

  main._dashClickHandler = handler
  main.addEventListener('click', handler)

  // 模块拖拽
  setupModuleDragDrop(userId)
}

// ========================
// 布局设置面板
// ========================

function openLayoutSettings(userId, modules) {
  // 移除已有面板
  document.querySelector('.layout-settings-overlay')?.remove()

  const pinnedItems = modules.filter(m => m.pinned).sort((a, b) => a.order - b.order)
  const normalItems = modules.filter(m => !m.pinned).sort((a, b) => a.order - b.order)

  function buildItemHTML(m, idx, list) {
    return `
      <div class="layout-module-item" data-module-id="${m.id}">
        <span class="module-order">${idx + 1}</span>
        <span class="module-name">${m.title}</span>
        ${m.pinned ? '<span class="module-pinned-badge">📌 已固定</span>' : ''}
        ${m.lockPinned ? '' : `<button class="btn-module-toggle" data-action="pin" data-id="${m.id}" title="${m.pinned ? '取消固定' : '固定'}">📌</button>`}
        <button class="btn-module-toggle${m.visible ? '' : ' hidden'}" data-action="toggle" data-id="${m.id}" title="${m.visible ? '隐藏' : '显示'}">${m.visible ? '👁️' : '🚫'}</button>
        ${idx > 0 ? `<button class="btn-module-move" data-action="up" data-id="${m.id}">↑</button>` : '<span style="width:28px;"></span>'}
        ${idx < list.length - 1 ? `<button class="btn-module-move" data-action="down" data-id="${m.id}">↓</button>` : '<span style="width:28px;"></span>'}
      </div>`
  }

  const overlay = document.createElement('div')
  overlay.className = 'layout-settings-overlay'
  overlay.innerHTML = `
    <div class="layout-settings-panel">
      <div class="layout-settings-header">
        <h3>📐 布局设置</h3>
        <button class="btn-close-panel">✕</button>
      </div>
      <div class="layout-settings-body">
        ${pinnedItems.length > 0 ? `<div class="layout-settings-section"><h4>优先显示</h4>${pinnedItems.map((m, i) => buildItemHTML(m, i, pinnedItems)).join('')}</div>` : ''}
        <div class="layout-settings-section"><h4>📋 全部模块</h4>${normalItems.map((m, i) => buildItemHTML(m, i, normalItems)).join('')}</div>
      </div>
      <div class="layout-settings-footer">
        <button class="btn-reset-layout" id="btn-reset-layout">恢复默认布局</button>
      </div>
    </div>`

  document.body.appendChild(overlay)

  // 关闭
  overlay.querySelector('.btn-close-panel')?.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  // 操作按钮
  overlay.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action
      const modId = btn.dataset.id
      const mod = modules.find(m => m.id === modId)
      if (!mod) return

      if (action === 'toggle') {
        mod.visible = !mod.visible
      } else if (action === 'pin') {
        mod.pinned = !mod.pinned
        // 移到对应区域末尾
        const sameArea = modules.filter(m => m.pinned === mod.pinned && m.id !== mod.id)
        mod.order = sameArea.length > 0 ? Math.max(...sameArea.map(m => m.order)) + 1 : 1
      } else if (action === 'up') {
        const sameArea = modules.filter(m => m.pinned === mod.pinned).sort((a, b) => a.order - b.order)
        const idx = sameArea.findIndex(m => m.id === mod.id)
        if (idx > 0) {
          const prev = sameArea[idx - 1]
          const tmp = mod.order
          mod.order = prev.order
          prev.order = tmp
        }
      } else if (action === 'down') {
        const sameArea = modules.filter(m => m.pinned === mod.pinned).sort((a, b) => a.order - b.order)
        const idx = sameArea.findIndex(m => m.id === mod.id)
        if (idx < sameArea.length - 1) {
          const next = sameArea[idx + 1]
          const tmp = mod.order
          mod.order = next.order
          next.order = tmp
        }
      }

      saveLayoutConfig(userId, modules)
      overlay.remove()
      showToast('布局已更新', 'success')
      setTimeout(() => window.location.reload(), 400)
    })
  })

  // 恢复默认
  overlay.querySelector('#btn-reset-layout')?.addEventListener('click', () => {
    localStorage.removeItem(`discimind_dashboard_layout_${userId}`)
    overlay.remove()
    showToast('已恢复默认布局', 'info')
    setTimeout(() => window.location.reload(), 400)
  })
}

// ========================
// 模块拖拽（简化版，基于设置面板完成排序）
// ========================

function setupModuleDragDrop(userId) {
  const modules = document.querySelectorAll('.dashboard-module[draggable]')
  modules.forEach(mod => {
    mod.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', mod.id)
      mod.classList.add('dragging')
    })
    mod.addEventListener('dragend', () => mod.classList.remove('dragging'))
    mod.addEventListener('dragover', (e) => {
      e.preventDefault()
      mod.classList.add('drag-over')
    })
    mod.addEventListener('dragleave', () => mod.classList.remove('drag-over'))
    mod.addEventListener('drop', (e) => {
      e.preventDefault()
      mod.classList.remove('drag-over')
      const draggedId = e.dataTransfer.getData('text/plain')
      // 简化：提示使用布局设置面板
      if (draggedId && draggedId !== mod.id) {
        showToast('拖拽排序请使用右上角「布局设置」面板', 'info')
      }
    })
    // 添加拖拽手柄
    const handle = document.createElement('div')
    handle.className = 'module-drag-handle'
    handle.innerHTML = iconGrip()
    handle.title = '拖拽排序（或使用布局设置）'
    mod.appendChild(handle)
  })
}
