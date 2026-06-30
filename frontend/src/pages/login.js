// 登录页

import { login } from '../api/auth.js'
import { setAuth, getUser } from '../utils/auth.js'
import { navigateTo } from '../utils/router.js'

// 角色 → 默认首页路由
const ROLE_HOME = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

export function renderLoginPage(app) {
  app.innerHTML = `
    <div class="login-page">
      <div class="login-container">
        <!-- 左侧：项目介绍 -->
        <div class="login-intro">
          <div class="login-intro-content">
            <h1 class="login-project-name">学研智擎</h1>
            <p class="login-project-en">DisciMind</p>
            <p class="login-project-desc">
              面向一流学科建设的垂类大模型<br/>教学科研创新应用平台
            </p>
            <div class="login-features">
              <div class="feature-item">📖 知识库管理与 RAG 问答</div>
              <div class="feature-item">🤖 多模型 AI 对话与智能体协同</div>
              <div class="feature-item">📊 学习画像与学情分析</div>
              <div class="feature-item">🎓 教学科研一站式解决方案</div>
            </div>
          </div>
        </div>

        <!-- 右侧：登录卡片 -->
        <div class="login-card-wrapper">
          <div class="login-card">
            <h2 class="login-card-title">用户登录</h2>
            <form id="login-form" class="login-form">
              <div class="form-group">
                <label for="login-account">账号</label>
                <input
                  type="text"
                  id="login-account"
                  placeholder="请输入用户名 / 手机号 / 邮箱"
                  autocomplete="username"
                  required
                />
              </div>
              <div class="form-group">
                <label for="login-password">密码</label>
                <input
                  type="password"
                  id="login-password"
                  placeholder="请输入密码"
                  autocomplete="current-password"
                  required
                />
              </div>
              <div id="login-error" class="form-error" style="display:none;"></div>
              <button type="submit" class="btn btn-primary btn-login" id="login-submit">
                登 录
              </button>
            </form>
            <div class="login-extra">
              <span>还没有账号？</span>
              <a href="#/register" class="link-register">立即注册</a>
            </div>

            <!-- 演示账号提示 -->
            <div class="demo-accounts">
              <p class="demo-title">🔑 演示账号</p>
              <div class="demo-list">
                <div class="demo-item">
                  <span class="demo-role admin">管理员</span>
                  <code>admin_demo / 123456</code>
                </div>
                <div class="demo-item">
                  <span class="demo-role teacher">教师</span>
                  <code>teacher_demo / 123456</code>
                </div>
                <div class="demo-item">
                  <span class="demo-role student">学生</span>
                  <code>student_demo / 123456</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  // 绑定登录表单提交事件
  const form = document.getElementById('login-form')
  const errorEl = document.getElementById('login-error')
  const submitBtn = document.getElementById('login-submit')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()

    const account = document.getElementById('login-account').value.trim()
    const password = document.getElementById('login-password').value

    if (!account || !password) {
      showError('请输入账号和密码')
      return
    }

    // 显示加载状态
    submitBtn.disabled = true
    submitBtn.textContent = '登录中...'
    hideError()

    try {
      const result = await login({ account, password })
      const { token, user } = result.data

      // 保存登录状态
      setAuth(token, user)

      // 根据角色跳转
      const home = ROLE_HOME[user.role] || '/student/dashboard'
      navigateTo(`#${home}`)
    } catch (err) {
      showError(err.message || '登录失败，请稍后重试')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = '登 录'
    }
  })

  function showError(msg) {
    errorEl.textContent = msg
    errorEl.style.display = 'block'
  }

  function hideError() {
    errorEl.style.display = 'none'
  }
}
