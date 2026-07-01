// 教师端首页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

export async function renderTeacherDashboard(app) {
  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? localStorage.getItem('token') : '', user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  const displayName = getUserDisplayName()

  const menuItems = [
    { label: '首页', icon: 'home' },
    { label: '我的课程', icon: 'book' },
    { label: '学生画像', icon: 'user' },
    { label: '作业测试', icon: 'alert' },
    { label: '知识库管理', icon: 'book' },
    { label: '学情分析', icon: 'star' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <!-- 欢迎横幅 -->
      <div class="welcome-banner teacher-banner">
        <div class="welcome-text">
          <h2>欢迎你，${displayName}</h2>
          <p>教学工作顺利，桃李满天下！</p>
        </div>
        <div class="welcome-illustration">👨‍🏫</div>
      </div>

      <!-- 数据卡片 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">1</div>
          <div class="stat-label">我的课程</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">1</div>
          <div class="stat-label">教学班级</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">45</div>
          <div class="stat-label">学生人数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">3</div>
          <div class="stat-label">待批改任务</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">18</div>
          <div class="stat-label">高频提问</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">8</div>
          <div class="stat-label">知识库文档</div>
        </div>
      </div>

      <!-- 下方两栏 -->
      <div class="content-columns">
        <!-- 学情概览 -->
        <div class="card">
          <h3 class="card-title">📈 学情概览</h3>
          <div class="learning-overview">
            <div class="overview-item">
              <span class="overview-topic">PCA 主成分分析</span>
              <span class="overview-level level-ok">掌握一般</span>
            </div>
            <div class="overview-item">
              <span class="overview-topic">SVM 支持向量机</span>
              <span class="overview-level level-weak">薄弱</span>
            </div>
            <div class="overview-item">
              <span class="overview-topic">神经网络基础</span>
              <span class="overview-level level-weak">薄弱</span>
            </div>
          </div>
        </div>

        <!-- 待办事项 -->
        <div class="card">
          <h3 class="card-title">📋 待办事项</h3>
          <ul class="task-list">
            <li class="task-item">
              <span class="task-dot pending"></span>
              <span>审核学生上传资料</span>
            </li>
            <li class="task-item">
              <span class="task-dot pending"></span>
              <span>查看 PCA 单元测验结果</span>
            </li>
            <li class="task-item">
              <span class="task-dot pending"></span>
              <span>发布下一阶段学习任务</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- 用户信息卡片 -->
      <div class="card user-info-card">
        <h3 class="card-title">📋 账户信息</h3>
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
  `

  renderDashboardLayout(app, {
    title: '教师教学中心',
    menuItems,
    contentHTML,
    user,
  })
}
