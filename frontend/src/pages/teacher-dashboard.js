// 教师端首页
// 接入真实 API 数据

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getTeacherDashboard } from '../api/teacher.js'
import { getNotifications, markNotificationRead, markAllNotificationsRead, getUnreadNotificationCount } from '../api/teacher.js'

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

  const displayName = getUserDisplayName()

  const menuItems = [
    { label: '首页', icon: 'home', hash: '#/teacher/dashboard' },
    { label: '教学管理', icon: 'book', hash: '#/teacher/courses' },
    { label: '作业考试', icon: 'edit', hash: '#/teacher/tasks' },
    { label: '学情分析', icon: 'chart', hash: '#/teacher/analytics' },
    { label: '个人中心', icon: 'user', hash: '#/teacher/profile' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <!-- 欢迎横幅 -->
      <div class="welcome-banner teacher-banner">
        <div class="welcome-text">
          <h2>欢迎你，${displayName}</h2>
          <p>教学工作顺利，桃李满天下！</p>
        </div>
        <div class="welcome-illustration"></div>
      </div>

      <!-- 数据卡片 -->
      <div class="stats-grid" id="stats-container">
        <div class="stat-card"><div class="stat-value" id="stat-courses">-</div><div class="stat-label">我的课程</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-classes">-</div><div class="stat-label">教学班级</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-students">-</div><div class="stat-label">学生人数</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-testscore">-</div><div class="stat-label">平均成绩</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-mastery">-</div><div class="stat-label">平均掌握度</div></div>
        <div class="stat-card"><div class="stat-value" id="stat-pending">-</div><div class="stat-label">待审文档</div></div>
      </div>

      <!-- 下方两栏 -->
      <div class="content-columns">
        <!-- 快捷入口 -->
        <div class="card">
          <h3 class="card-title">快捷入口</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="quick-link" data-hash="#/teacher/courses" style="padding:14px;border:1px solid var(--border);border-radius:12px;cursor:pointer;text-align:center;transition:all 0.2s;">
              <div style="font-size:0.85rem;margin-top:4px;">课程管理</div>
            </div>
            <div class="quick-link" data-hash="#/teacher/tasks" style="padding:14px;border:1px solid var(--border);border-radius:12px;cursor:pointer;text-align:center;transition:all 0.2s;">
              <div style="font-size:0.85rem;margin-top:4px;">作业任务</div>
            </div>
            <div class="quick-link" data-hash="#/teacher/students" style="padding:14px;border:1px solid var(--border);border-radius:12px;cursor:pointer;text-align:center;transition:all 0.2s;">
              <div style="font-size:0.85rem;margin-top:4px;">学生管理</div>
            </div>
            <div class="quick-link" data-hash="#/teacher/analytics" style="padding:14px;border:1px solid var(--border);border-radius:12px;cursor:pointer;text-align:center;transition:all 0.2s;">
              <div style="font-size:0.85rem;margin-top:4px;">学情分析</div>
            </div>
            <div class="quick-link" data-hash="#/teacher/questions" style="padding:14px;border:1px solid var(--border);border-radius:12px;cursor:pointer;text-align:center;transition:all 0.2s;">
              <div style="font-size:0.85rem;margin-top:4px;">题库管理</div>
            </div>
            <div class="quick-link" data-hash="#" id="ai-quick-btn" style="padding:14px;border:1px solid #a78bfa;border-radius:12px;cursor:pointer;text-align:center;transition:all 0.2s;background:rgba(167,139,250,0.05);">
              <div style="font-size:0.85rem;margin-top:4px;color:#7c3aed;">AI 助手</div>
            </div>
          </div>
        </div>

        <!-- 账户信息 -->
        <div class="card user-info-card">
          <h3 class="card-title">账户信息</h3>
          <div class="user-info-grid">
            <div class="info-item">
              <span class="info-label">用户名</span>
              <span class="info-value">${user.username || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">角色</span>
              <span class="info-value">教师</span>
            </div>
            <div class="info-item">
              <span class="info-label">真实姓名</span>
              <span class="info-value">${user.profile?.real_name || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">学院</span>
              <span class="info-value">${user.profile?.college || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">工号</span>
              <span class="info-value">${user.profile?.teacher_no || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">邮箱</span>
              <span class="info-value">${user.email || '-'}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
    <!-- 消息通知开始 -->
    <div class="card" id="notification-section" style="margin-top:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 class="card-title" style="margin:0;display:flex;align-items:center;gap:8px;">
          消息通知
          <span id="unread-badge" style="display:none;background:#dc2626;color:#fff;font-size:0.72rem;padding:1px 8px;border-radius:10px;font-weight:600;"></span>
        </h3>
        <button class="btn-mark-all-read" id="notif-mark-all-read" style="padding:5px 14px;font-size:0.8rem;border:1px solid var(--border);border-radius:8px;background:transparent;cursor:pointer;color:var(--text-secondary);display:none;">全部标记已读</button>
      </div>
      <div id="notification-list" style="min-height:60px;">
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.9rem;">加载中...</div>
      </div>
    </div>
    <!-- 消息通知结束 -->
  `

  renderDashboardLayout(app, {
    title: '教师教学中心',
    menuItems,
    contentHTML,
    user,
  })

  // 加载真实数据
  async function loadStats() {
    try {
      const res = await getTeacherDashboard()
      const data = res.data || {}

      document.getElementById('stat-courses').textContent = data.course_count ?? '-'
      document.getElementById('stat-classes').textContent = data.teaching_class_count ?? '-'
      document.getElementById('stat-students').textContent = data.student_count ?? '-'
      document.getElementById('stat-testscore').textContent = data.average_test_score != null ? `${data.average_test_score}%` : '-'
      document.getElementById('stat-mastery').textContent = data.average_mastery_score != null ? `${data.average_mastery_score}%` : '-'
      document.getElementById('stat-pending').textContent = data.pending_review_document_count ?? '-'
    } catch (err) {
      console.error('加载概览数据失败', err)
    }
  }

  // 快捷入口点击
  document.querySelectorAll('.quick-link').forEach(el => {
    el.addEventListener('click', () => {
      const hash = el.dataset.hash
      if (hash && hash !== '#') {
        window.location.hash = hash
      }
    })
  })

  document.getElementById('ai-quick-btn')?.addEventListener('click', () => {
    alert('该功能正在开发中，敬请期待')
  })

  loadStats()
  loadNotifications()

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
        notifListEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.9rem;">暂无消息通知</div>'
        return
      }

      const typeLabels = {
        task_published: '任务发布', task_deadline: '任务截止',
        document_review: '文档审核', document_parsed: '文档解析',
        ai_grading_done: 'AI批改', system_notice: '系统通知',
      }

      notifListEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">${
        list.map((n) => {
          const time = n.created_at ? new Date(n.created_at).toLocaleString('zh-CN') : ''
          const typeLabel = typeLabels[n.notification_type] || n.notification_type
          return `<div class="notif-item" data-id="${n.notification_id}" style="cursor:pointer;display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-radius:12px;background:${n.is_read ? 'transparent' : 'rgba(255,149,5,0.06)'};border:1px solid ${n.is_read ? 'var(--border)' : 'rgba(255,149,5,0.15)'};transition:all 0.2s;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:0.8rem;color:var(--text-muted);">${typeLabel}</span>
                <span style="font-size:0.75rem;color:var(--text-muted);">${time}</span>
                ${!n.is_read ? '<span style="width:7px;height:7px;border-radius:50%;background:#dc2626;flex-shrink:0;"></span>' : ''}
              </div>
              <div class="notif-title" style="font-weight:${n.is_read ? '400' : '600'};color:var(--text);font-size:0.9rem;margin-top:4px;">${n.title}</div>
              ${n.content ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px;">${n.content}</div>` : ''}
              ${n.sender_name ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">来自：${n.sender_name}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="notif-read-btn" data-id="${n.notification_id}" data-is-read="${n.is_read}" style="padding:4px 12px;font-size:0.78rem;border:1px solid var(--border);border-radius:8px;background:${n.is_read ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.7)'};cursor:pointer;color:var(--text-secondary);white-space:nowrap;">${n.is_read ? '已读' : '标为已读'}</button>
            </div>
          </div>`
        }).join('')
      }</div>`

      // 绑定事件：点击通知项阅读详情
      notifListEl.querySelectorAll('.notif-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.notif-read-btn')) return // 交给按钮自己的事件
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
