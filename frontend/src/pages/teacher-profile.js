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
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 class="card-title" style="margin:0;">个人信息</h3>
            <button class="btn btn-sm" id="btn-toggle-edit" style="padding:5px 14px;border:1px solid var(--border);border-radius:8px;background:transparent;cursor:pointer;font-size:0.85rem;">编辑</button>
          </div>
          <div id="profile-display">
            <div class="user-info-grid">
              <div class="info-item"><span class="info-label">用户名</span><span class="info-value">${user.username || '-'}</span></div>
              <div class="info-item"><span class="info-label">角色</span><span class="info-value">教师</span></div>
              <div class="info-item"><span class="info-label">真实姓名</span><span class="info-value">${user.profile?.real_name || '-'}</span></div>
              <div class="info-item"><span class="info-label">学院</span><span class="info-value">${user.profile?.college || '-'}</span></div>
              <div class="info-item"><span class="info-label">专业</span><span class="info-value">${user.profile?.major || '-'}</span></div>
              <div class="info-item"><span class="info-label">工号</span><span class="info-value">${user.profile?.teacher_no || '-'}</span></div>
              <div class="info-item"><span class="info-label">邮箱</span><span class="info-value">${user.email || '-'}</span></div>
              <div class="info-item"><span class="info-label">手机号</span><span class="info-value">${user.phone || '-'}</span></div>
              <div class="info-item"><span class="info-label">性别</span><span class="info-value">${user.profile?.gender === 'male' ? '男' : user.profile?.gender === 'female' ? '女' : '-'}</span></div>
            </div>
          </div>
          <div id="profile-edit" style="display:none;">
            <div class="user-info-grid">
              <div class="info-item"><span class="info-label">真实姓名</span><input type="text" id="edit-real-name" value="${user.profile?.real_name || ''}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;"></div>
              <div class="info-item"><span class="info-label">学院</span><input type="text" id="edit-college" value="${user.profile?.college || ''}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;"></div>
              <div class="info-item"><span class="info-label">专业</span><input type="text" id="edit-major" value="${user.profile?.major || ''}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;"></div>
              <div class="info-item"><span class="info-label">邮箱</span><input type="email" id="edit-email" value="${user.email || ''}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;"></div>
              <div class="info-item"><span class="info-label">手机号</span><input type="text" id="edit-phone" value="${user.phone || ''}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;"></div>
              <div class="info-item"><span class="info-label">性别</span>
                <select id="edit-gender" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#fff;">
                  <option value="" ${!user.profile?.gender ? 'selected' : ''}>未设置</option>
                  <option value="male" ${user.profile?.gender === 'male' ? 'selected' : ''}>男</option>
                  <option value="female" ${user.profile?.gender === 'female' ? 'selected' : ''}>女</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
              <button class="btn btn-primary" id="btn-save-profile" style="padding:8px 24px;border:none;border-radius:8px;background:var(--primary);color:#fff;cursor:pointer;font-size:0.9rem;">保存</button>
              <button class="btn" id="btn-cancel-edit" style="padding:8px 24px;border:1px solid var(--border);border-radius:8px;background:transparent;cursor:pointer;font-size:0.9rem;">取消</button>
              <span id="profile-save-status" style="font-size:0.85rem;color:var(--text-muted);align-self:center;"></span>
            </div>
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

  // ---- 个人信息编辑 ----
  let isEditing = false
  const toggleBtn = document.getElementById('btn-toggle-edit')
  const displayDiv = document.getElementById('profile-display')
  const editDiv = document.getElementById('profile-edit')
  const saveStatus = document.getElementById('profile-save-status')
  const cancelBtn = document.getElementById('btn-cancel-edit')
  const saveBtn = document.getElementById('btn-save-profile')

  function toggleEditMode() {
    isEditing = !isEditing
    displayDiv.style.display = isEditing ? 'none' : ''
    editDiv.style.display = isEditing ? '' : 'none'
    toggleBtn.textContent = isEditing ? '取消' : '编辑'
    saveStatus.textContent = ''
  }

  if (toggleBtn) toggleBtn.addEventListener('click', toggleEditMode)
  if (cancelBtn) cancelBtn.addEventListener('click', toggleEditMode)
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const data = {
      real_name: document.getElementById('edit-real-name').value.trim(),
      college: document.getElementById('edit-college').value.trim(),
      major: document.getElementById('edit-major').value.trim(),
      email: document.getElementById('edit-email').value.trim(),
      phone: document.getElementById('edit-phone').value.trim(),
      gender: document.getElementById('edit-gender').value || undefined,
    }
    if (!data.real_name) { saveStatus.textContent = '真实姓名不能为空'; saveStatus.style.color = '#dc2626'; return }
    saveStatus.textContent = '保存中...'
    saveStatus.style.color = 'var(--text-muted)'
    saveBtn.disabled = true
    try {
      const { updateMe } = await import('../api/auth.js')
      const res = await updateMe(data)
      const updated = res.data?.user || {}
      // 更新显示
      const display = document.querySelectorAll('#profile-display .info-value')
      if (display[2]) display[2].textContent = data.real_name || '-'
      if (display[3]) display[3].textContent = data.college || '-'
      if (display[4]) display[4].textContent = data.major || '-'
      if (display[6]) display[6].textContent = data.email || '-'
      if (display[7]) display[7].textContent = data.phone || '-'
      if (display[8]) display[8].textContent = data.gender === 'male' ? '男' : data.gender === 'female' ? '女' : '-'
      // 更新 user 对象
      if (user.profile) {
        user.profile.real_name = data.real_name
        user.profile.college = data.college || null
        user.profile.major = data.major || null
        user.profile.gender = data.gender || null
      }
      user.email = data.email || null
      user.phone = data.phone || null
      saveStatus.textContent = '保存成功'
      saveStatus.style.color = '#10b981'
      setTimeout(() => { toggleEditMode(); saveStatus.textContent = '' }, 1000)
    } catch (err) {
      saveStatus.textContent = '保存失败: ' + (err.message || '未知错误')
      saveStatus.style.color = '#dc2626'
    } finally {
      saveBtn.disabled = false
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

