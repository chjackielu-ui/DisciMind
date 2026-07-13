// 教师端首页 — 紧凑工作台总览（对齐学生端布局结构）
// 布局参考学生端 student-dashboard.js，保持教师端琥珀色调与内容不变

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { getTeacherDashboard, getNotifications, markNotificationRead, markAllNotificationsRead, getUnreadNotificationCount } from '../api/teacher.js'
import { escapeHtml, formatPercent, formatDate } from '../utils/format.js'

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/api\/?$/, '')

function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function getAvatarUrl(user) {
  const url = user?.profile?.avatar_url || user?.avatar_url
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  return `${API_ORIGIN}${url.startsWith('/') ? url : '/' + url}`
}

function getInitial(name) {
  return String(name || '师').trim().slice(0, 1).toUpperCase()
}

function buildMetricGrid(overview = {}) {
  const metrics = [
    { label: '我的课程', value: safeNumber(overview.course_count), hint: '负责课程数', tone: 'blue' },
    { label: '教学班级', value: safeNumber(overview.teaching_class_count), hint: '当前学期', tone: 'green' },
    { label: '学生人数', value: safeNumber(overview.student_count), hint: '在读学生', tone: 'green' },
    { label: '平均成绩', value: overview.average_test_score != null ? `${overview.average_test_score}%` : '-', hint: '测试均分', tone: 'blue' },
    { label: '平均掌握度', value: overview.average_mastery_score != null ? `${overview.average_mastery_score}%` : '-', hint: '知识点掌握', tone: 'amber' },
    { label: '待审文档', value: safeNumber(overview.pending_review_document_count), hint: '需审核', tone: 'red' },
  ]

  return `
    <div class="home-metric-grid">
      ${metrics.map(item => `
        <article class="home-metric-card ${item.tone}">
          <span>${item.label}</span>
          <b>${escapeHtml(String(item.value))}</b>
          <em>${escapeHtml(item.hint)}</em>
        </article>
      `).join('')}
    </div>`
}

function buildQuickEntries() {
  const entries = [
    { label: '课程管理', sub: '管理课程与章节', hash: '#/teacher/courses' },
    { label: '学生管理', sub: '学生与班级', hash: '#/teacher/students' },
    { label: '作业任务', sub: '发布与批改', hash: '#/teacher/tasks' },
    { label: '学情分析', sub: '数据看板', hash: '#/teacher/analytics' },
    { label: '题库管理', sub: '建设题库', hash: '#/teacher/questions' },
    { label: '智能教案', sub: 'AI 备课', hash: '#/teacher/lesson-plan' },
  ]

  return `
    <div class="home-quick-grid">
      ${entries.map((item, idx) => `
        <button type="button" class="home-quick-card${idx === 0 ? ' primary' : ''}" data-teacher-nav="${item.hash}">
          <span>${escapeHtml(item.label)}</span>
          <b>${escapeHtml(item.sub)}</b>
        </button>
      `).join('')}
    </div>`
}

function buildProfileCard(user, displayName, overview = {}) {
  const avatarUrl = getAvatarUrl(user)
  const profile = user?.profile || {}
  const info = [
    { label: '姓名', value: displayName },
    { label: '学院', value: profile.college || '未填写' },
    { label: '工号', value: profile.teacher_no || '未填写' },
    { label: '邮箱', value: user.email || '未填写' },
  ]

  return `
    <aside class="home-student-card">
      <div class="home-student-avatar">
        ${avatarUrl
          ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
          : `<span>${escapeHtml(getInitial(displayName))}</span>`}
      </div>
      <div class="home-student-name">${escapeHtml(displayName)}</div>
      <div class="home-student-role">教师工作台</div>
      <div class="home-student-info-list">
        ${info.map(item => `
          <div class="home-student-info-row">
            <span>${escapeHtml(item.label)}</span>
            <b>${escapeHtml(item.value)}</b>
          </div>
        `).join('')}
      </div>
      <div class="home-student-progress">
        <div>
          <span>课程数量</span>
          <b>${safeNumber(overview.course_count)} 门</b>
        </div>
        <div class="home-progress-bar">
          <i style="width:${Math.min(100, safeNumber(overview.course_count) * 20)}%"></i>
        </div>
      </div>
    </aside>`
}

function buildOverviewPanel(overview = {}) {
  return `
    <section class="home-panel home-recommend-panel">
      <div class="home-panel-head">
        <div>
          <h3>教学概览</h3>
          <p>教学班级与学生的整体状态。</p>
        </div>
      </div>
      <div class="home-rec-list">
        <div class="home-rec-item">
          <span class="home-rec-tag green">教学班</span>
          <b>${safeNumber(overview.teaching_class_count)} 个教学班级</b>
          <em>当前学期负责的教学组织</em>
        </div>
        <div class="home-rec-item">
          <span class="home-rec-tag blue">学生</span>
          <b>${safeNumber(overview.student_count)} 名在读学生</b>
          <em>覆盖所有教学班级</em>
        </div>
        <div class="home-rec-item">
          <span class="home-rec-tag amber">文档</span>
          <b>${safeNumber(overview.pending_review_document_count)} 份待审核文档</b>
          <em>知识库文档审核队列</em>
        </div>
      </div>
    </section>`
}

function buildNotificationSection() {
  return `
    <section class="home-panel home-task-panel" id="notification-section">
      <div class="home-panel-head">
        <div>
          <h3>消息通知</h3>
          <span id="unread-badge" style="display:none;background:#dc2626;color:#fff;font-size:0.72rem;padding:1px 8px;border-radius:10px;font-weight:600;margin-left:8px;"></span>
        </div>
        <button class="home-panel-link" id="notif-mark-all-read" style="display:none;">全部标记已读</button>
      </div>
      <div id="notification-list" style="min-height:60px;">
        <div class="home-empty-inline">加载中...</div>
      </div>
    </section>`
}

function buildErrorContent(message) {
  return `
    <div class="dashboard-content">
      <div class="error-state">
        <div class="error-icon">!</div>
        <p class="error-message">${escapeHtml(message || '教师工作台数据加载失败')}</p>
        <button class="btn-retry" onclick="window.location.reload()">重新加载</button>
      </div>
    </div>`
}

function buildHomeContent({ user, displayName, dashboardData }) {
  const overview = dashboardData || {}

  return `
    <div class="dashboard-content teacher-home-shell">
      <section class="student-home-top">
        <div class="student-home-primary">
          <div class="student-home-title-row">
            <div>
              <span class="home-eyebrow">教学工作台</span>
              <h2>欢迎回来，${escapeHtml(displayName)}</h2>
              <p>这里汇总您的课程、班级、学生数据和教学快捷入口。</p>
            </div>
            <span class="home-sync-time">同步 ${formatDate(new Date().toISOString(), 'time')}</span>
          </div>
          ${buildMetricGrid(overview)}
          ${buildQuickEntries()}
        </div>
        ${buildProfileCard(user, displayName, overview)}
      </section>

      <section class="home-two-column">
        ${buildOverviewPanel(overview)}
        ${buildNotificationSection()}
      </section>
    </div>`
}

export async function renderTeacherDashboard(app) {
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

  // Loading 状态
  renderDashboardLayout(app, {
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML: `
      <div class="dashboard-content teacher-home-shell">
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p class="loading-text">正在加载教学工作台数据...</p>
        </div>
      </div>`,
    user,
  });

  // 加载真实数据
  let dashboardData = {}
  try {
    const res = await getTeacherDashboard()
    dashboardData = res.data || {}
  } catch (err) {
    console.error('加载概览数据失败', err)
    renderDashboardLayout(app, {
      menuItems: TEACHER_MENU_ITEMS,
      contentHTML: buildErrorContent(err.message),
      user,
    })
    return
  }

  const displayName = getUserDisplayName()
  const contentHTML = buildHomeContent({ user, displayName, dashboardData })

  renderDashboardLayout(app, {
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // 快捷入口点击
  bindTeacherHomeEvents()

  // 加载通知
  loadNotifications()

  // ========================
  // 快捷入口事件绑定
  // ========================
  function bindTeacherHomeEvents() {
    const main = document.getElementById('student-main')
    if (!main) return
    if (main._teacherHomeClickHandler) {
      main.removeEventListener('click', main._teacherHomeClickHandler)
    }

    const handler = (event) => {
      const nav = event.target.closest('[data-teacher-nav]')
      if (!nav) return
      const hash = nav.dataset.teacherNav
      if (hash && hash !== '#') {
        window.location.hash = hash
      }
    }

    main._teacherHomeClickHandler = handler
    main.addEventListener('click', handler)
  }

  // ========================
  // 消息通知
  // ========================
  async function loadNotifications() {
    const notifListEl = document.getElementById('notification-list')
    const badgeEl = document.getElementById('unread-badge')
    const markAllBtn = document.getElementById('notif-mark-all-read')
    if (!notifListEl) return

    try {
      // 获取未读数量
      const countRes = await getUnreadNotificationCount()
      const unreadCount = countRes.data?.unread_count || 0
      if (badgeEl) {
        if (unreadCount > 0) {
          badgeEl.textContent = unreadCount
          badgeEl.style.display = 'inline'
        } else {
          badgeEl.style.display = 'none'
        }
      }

      // 获取最近 5 条消息
      const res = await getNotifications({ page: 1, page_size: 5 })
      const list = res.data?.list || []

      if (markAllBtn) {
        markAllBtn.style.display = unreadCount > 0 ? 'inline-block' : 'none'
        // 移除旧监听避免重复绑定
        const handler = async () => {
          try {
            await markAllNotificationsRead()
            loadNotifications()
          } catch (err) { alert('操作失败: ' + err.message) }
        }
        markAllBtn.removeEventListener('click', handler)
        markAllBtn.addEventListener('click', handler)
      }

      if (list.length === 0) {
        notifListEl.innerHTML = '<div class="home-empty-inline">暂无消息通知</div>'
        return
      }

      const typeLabels = {
        task_published: '任务发布', task_deadline: '任务截止',
        document_review: '文档审核', document_parsed: '文档解析',
        ai_grading_done: 'AI批改', system_notice: '系统通知',
      }

      notifListEl.innerHTML = `<div class="home-task-list">${
        list.map((n) => {
          const time = n.created_at ? new Date(n.created_at).toLocaleString('zh-CN') : ''
          const typeLabel = typeLabels[n.notification_type] || n.notification_type
          return `<div class="home-task-item${n.is_read ? '' : ' unread'}" data-id="${n.notification_id}">
            <div>
              <b>${escapeHtml(n.title)}</b>
              <span>${typeLabel} · ${time}${!n.is_read ? ' · <em style="color:#dc2626;">未读</em>' : ''}</span>
            </div>
            <button type="button" class="notif-read-btn" data-id="${n.notification_id}" data-is-read="${n.is_read}">${n.is_read ? '已读' : '标为已读'}</button>
          </div>`
        }).join('')
      }</div>`

      // 绑定事件：点击通知项阅读详情
      notifListEl.querySelectorAll('.home-task-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.notif-read-btn')) return
          const nid = parseInt(item.dataset.id, 10)
          const notif = list.find((n) => n.notification_id === nid)
          if (notif) showNotificationDetail(notif)
        })
      })

      // 绑定标记已读/已读按钮
      notifListEl.querySelectorAll('.notif-read-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation()
          const nid = parseInt(btn.dataset.id, 10)
          const isRead = btn.dataset.isRead === 'true'
          if (isRead) {
            // 已读状态→打开详情
            const notif = list.find((n) => n.notification_id === nid)
            if (notif) showNotificationDetail(notif)
            return
          }
          try {
            await markNotificationRead(nid)
            loadNotifications()
          } catch (err) { alert('操作失败: ' + err.message) }
        })
      })
    } catch (err) {
      console.error('[teacher] 加载消息通知失败:', err.message)
      notifListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">消息通知加载失败</div>'
    }
  }

  // 显示通知详情弹窗
  function showNotificationDetail(notif) {
    // 若未读则自动标记已读
    if (!notif.is_read) {
      markNotificationRead(notif.notification_id).catch(() => {})
    }

    const typeLabels = {
      task_published: '任务发布', task_deadline: '任务截止',
      document_review: '文档审核', document_parsed: '文档解析',
      ai_grading_done: 'AI批改', system_notice: '系统通知',
    }
    const time = notif.created_at ? new Date(notif.created_at).toLocaleString('zh-CN') : ''
    const typeLabel = typeLabels[notif.notification_type] || notif.notification_type

    // 锁定滚动
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);'
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:22px;box-shadow:0 24px 64px rgba(0,0,0,0.15);padding:32px;width:90%;max-width:520px;max-height:80vh;overflow-y:auto;border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">
          <div>
            <span style="font-size:0.8rem;color:var(--text-muted);">${typeLabel}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);margin-left:10px;">${time}</span>
          </div>
          <button id="notif-close-btn" style="width:28px;height:28px;border:none;background:rgba(0,0,0,0.05);border-radius:50%;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">✕</button>
        </div>
        <h3 style="font-size:1.15rem;font-weight:700;color:var(--text);margin:0 0 12px;">${notif.title}</h3>
        ${notif.content ? `<div style="font-size:0.92rem;color:var(--text-secondary);line-height:1.8;padding:16px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:12px;white-space:pre-wrap;">${notif.content}</div>` : ''}
        ${notif.sender_name ? `<div style="font-size:0.8rem;color:var(--text-muted);">发送者：${notif.sender_name}</div>` : ''}
        <div style="text-align:right;margin-top:18px;">
          <button id="notif-close-btn2" style="padding:8px 24px;border-radius:10px;font-size:0.9rem;border:1px solid var(--border);background:transparent;cursor:pointer;color:var(--text-secondary);">关闭</button>
        </div>
      </div>
    `

    const container = document.querySelector('.student-dashboard-wrapper') || document.getElementById('app')
    container.appendChild(overlay)

    function closeNotifModal() {
      overlay.remove()
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
      // 刷新列表反映已读状态
      loadNotifications()
    }

    overlay.querySelector('#notif-close-btn').addEventListener('click', closeNotifModal)
    overlay.querySelector('#notif-close-btn2').addEventListener('click', closeNotifModal)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNotifModal() })
  }
}
