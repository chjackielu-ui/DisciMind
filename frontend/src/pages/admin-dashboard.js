// 管理员端首页 — 系统总览仪表盘

import { getMe } from '../api/auth.js'
import { getAdminDashboard } from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

export async function renderAdminDashboard(app) {
  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  const displayName = getUserDisplayName()

  // 获取真实统计数据
  let stats = {
    user_count: '-',
    student_count: '-',
    teacher_count: '-',
    course_count: '-',
    knowledge_document_count: '-',
    ai_call_count_today: '-',
    pending_review_document_count: '-',
  }

  try {
    const result = await getAdminDashboard()
    if (result.data) {
      stats = { ...stats, ...result.data }
    }
  } catch (err) {
    console.warn('[admin] 获取仪表盘数据失败:', err.message)
  }

  const menuItems = [
    { label: '首页', icon: 'home', hash: '#/admin/dashboard' },
    { label: '用户管理', icon: 'user', hash: '#/admin/users' },
    { label: '教学管理', icon: 'book', hash: '#/admin/courses', prefixMatch: '/admin/courses', children: [
      { label: '课程管理', hash: '#/admin/courses' },
      { label: '班级管理', hash: '#/admin/classes' },
    ]},
    { label: '系统管理', icon: 'settings', hash: '#/admin/knowledge', prefixMatch: '/admin/knowledge', children: [
      { label: '知识库管理', hash: '#/admin/knowledge' },
      { label: '操作日志', hash: '#/admin/logs' },
      { label: '通知管理', hash: '#/admin/notifications' },
      { label: 'AI 配置', hash: '#/admin/ai-config' },
      { label: '个人信息', hash: '#/admin/profile' },
    ]},
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <!-- 欢迎横幅 -->
      <div class="welcome-banner admin-banner">
        <div class="welcome-text">
          <h2>欢迎你，${displayName}</h2>
          <p>系统运行一切正常，请放心管理！</p>
        </div>
        <div class="welcome-illustration">🛡️</div>
      </div>

      <!-- 数据卡片 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.user_count}</div>
          <div class="stat-label">用户总数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.student_count}</div>
          <div class="stat-label">学生数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.teacher_count}</div>
          <div class="stat-label">教师数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.course_count}</div>
          <div class="stat-label">课程数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.knowledge_document_count}</div>
          <div class="stat-label">知识库文档</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.ai_call_count_today}</div>
          <div class="stat-label">今日 AI 调用</div>
        </div>
      </div>

      <!-- 待审核文档提示 -->
      ${stats.pending_review_document_count > 0 ? `
      <div class="card" style="border-left: 4px solid #7C3AED;">
        <h3 class="card-title">待处理事项</h3>
        <p style="color: var(--stu-text-secondary); font-size: 0.92rem;">
          共有 <strong style="color: #7C3AED;">${stats.pending_review_document_count}</strong> 份知识库文档等待审核，
          <a href="#/admin/knowledge" style="color: #7C3AED; font-weight: 600;">点击前往处理</a>
        </p>
      </div>
      ` : ''}

      <!-- 系统管理入口 -->
      <div class="card">
        <h3 class="card-title"> 系统管理入口</h3>
        <div class="admin-links">
          <div class="admin-link-item" data-hash="#/admin/users">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">用户管理</span>
              <span class="admin-link-desc">管理学生、教师、管理员账号</span>
            </div>
          </div>
          <div class="admin-link-item" data-hash="#/admin/courses">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">课程管理</span>
              <span class="admin-link-desc">创建和维护课程信息</span>
            </div>
          </div>
          <div class="admin-link-item" data-hash="#/admin/classes">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">班级管理</span>
              <span class="admin-link-desc">管理行政班级与教学班级</span>
            </div>
          </div>
          <div class="admin-link-item" data-hash="#/admin/knowledge">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">知识库管理</span>
              <span class="admin-link-desc">管理知识库文档与分类</span>
            </div>
          </div>
          <div class="admin-link-item" data-hash="#/admin/logs">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">操作日志</span>
              <span class="admin-link-desc">查看系统操作与运行日志</span>
            </div>
          </div>
          <div class="admin-link-item" data-hash="#/admin/notifications">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">通知管理</span>
              <span class="admin-link-desc">管理系统通知消息</span>
            </div>
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
            <span class="info-value">管理员</span>
          </div>
          <div class="info-item">
            <span class="info-label">真实姓名</span>
            <span class="info-value">${user.profile?.real_name || '-'}</span>
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
            <span class="info-label">用户ID</span>
            <span class="info-value">${user.user_id || '-'}</span>
          </div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '系统管理中心',
    menuItems,
    contentHTML,
    user,
  })

  // 快捷入口点击
  document.querySelectorAll('.admin-link-item[data-hash]').forEach((item) => {
    item.addEventListener('click', () => {
      window.location.hash = item.dataset.hash
    })
  })
}

