// 教师端 - 个人中心

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getUnreadNotificationCount, getNotifications, markNotificationRead, markAllNotificationsRead } from '../api/teacher.js'

export async function renderTeacherProfile(app) {
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
      <div style="margin-bottom:12px;">
        <a href="#/teacher/dashboard" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回首页</a>
      </div>
      <div class="page-header">
        <h2 class="page-title">个人中心</h2>
        <p class="page-subtitle">个人信息与消息通知</p>
      </div>

      <div class="content-columns">
        <!-- 个人信息卡片 -->
        <div class="card">
          <h3 class="card-title">个人信息</h3>
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
            <div class="info-item">
              <span class="info-label">手机号</span>
              <span class="info-value">${user.phone || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">性别</span>
              <span class="info-value">${user.profile?.gender === 'male' ? '男' : user.profile?.gender === 'female' ? '女' : '-'}</span>
            </div>
          </div>
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
            <p style="font-size:0.85rem;color:var(--text-muted);">个人信息修改功能请通过系统管理页面操作</p>
          </div>
        </div>

        <!-- 消息通知 -->
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 class="card-title" style="margin-bottom:0;">消息通知</h3>
            <button class="btn btn-link" id="btn-mark-all-read" style="font-size:0.8rem;padding:4px 12px;">全部已读</button>
          </div>
          <div id="notification-list">
            <div class="empty-hint">加载中...</div>
          </div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '个人中心',
    menuItems,
    contentHTML,
    user,
  })

  // 加载通知
  async function loadNotifications() {
    const container = document.getElementById('notification-list')
    if (!container) return

    try {
      const [notifRes, unreadRes] = await Promise.all([
        getNotifications({ page_size: 20 }),
        getUnreadNotificationCount(),
      ])

      const notifications = notifRes.data?.list || []
      const unreadCount = unreadRes.data?.unread_count || 0

      if (notifications.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无消息通知</div>'
        return
      }

      const typeLabels = {
        task_published: '任务发布',
        task_deadline: '任务截止',
        document_review: '文档审核',
        document_parsed: '文档解析',
        ai_grading_done: 'AI 批改',
        system_notice: '系统通知',
      }

      container.innerHTML = `
        ${unreadCount > 0 ? `<div style="margin-bottom:10px;font-size:0.85rem;color:var(--primary);">${unreadCount} 条未读</div>` : ''}
        ${notifications.map(n => `
          <div class="notification-item" data-id="${n.notification_id}" style="padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;${n.is_read ? '' : 'background:rgba(37,99,235,0.04);margin:0 -12px;padding:12px;border-radius:8px;'}">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <div>
                <span style="font-size:0.8rem;font-weight:${n.is_read ? '400' : '600'};color:var(--text);">${typeLabels[n.notification_type] || n.notification_type}</span>
                ${!n.is_read ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#3b82f6;margin-left:6px;"></span>' : ''}
              </div>
              <span style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${formatTime(n.created_at)}</span>
            </div>
            <div style="margin-top:4px;font-size:0.85rem;color:var(--text-secondary);">${n.title}</div>
            ${n.content ? `<div style="margin-top:2px;font-size:0.8rem;color:var(--text-muted);">${n.content}</div>` : ''}
          </div>
        `).join('')}
      `

      // 点击标记已读
      container.querySelectorAll('.notification-item').forEach(el => {
        el.addEventListener('click', async () => {
          const id = parseInt(el.dataset.id)
          try {
            await markNotificationRead(id)
            loadNotifications()
          } catch (err) {
            console.error(err)
          }
        })
      })
    } catch (err) {
      container.innerHTML = `<div class="empty-hint">加载失败: ${err.message}</div>`
    }
  }

  document.getElementById('btn-mark-all-read')?.addEventListener('click', async () => {
    try {
      await markAllNotificationsRead()
      loadNotifications()
    } catch (err) {
      alert(err.message)
    }
  })

  function formatTime(isoStr) {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    const now = new Date()
    const diffMs = now - d
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour}小时前`
    const diffDay = Math.floor(diffHour / 24)
    if (diffDay < 7) return `${diffDay}天前`
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  loadNotifications()
}
