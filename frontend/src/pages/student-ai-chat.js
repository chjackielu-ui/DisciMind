// 学生端 AI 问答页面 v1
// 后续将支持课程知识库问答、引用溯源和多轮对话

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'

const MENU_ITEMS = STUDENT_MENU_ITEMS

export async function renderStudentAiChat(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(localStorage.getItem('token') || '', user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  const contentHTML = `
    <div class="page-header">
      <h2 class="page-title">🤖 AI 问答</h2>
      <p class="page-subtitle">智能课程知识助手</p>
    </div>
    <div class="ai-chat-placeholder">
      <div class="ai-chat-placeholder-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(47,102,144,0.3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </div>
      <h3 class="ai-chat-placeholder-title">AI 问答模块开发中</h3>
      <p class="ai-chat-placeholder-desc">后续将支持课程知识库问答、引用溯源和多轮对话</p>
      <div class="ai-chat-feature-grid">
        <div class="ai-chat-feature-card">
          <div class="ai-chat-feature-icon">📖</div>
          <h4>课程知识问答</h4>
          <p>基于课程知识库，精准回答学科相关问题，覆盖课程大纲内所有知识点</p>
        </div>
        <div class="ai-chat-feature-card">
          <div class="ai-chat-feature-icon">🔗</div>
          <h4>引用来源追溯</h4>
          <p>每条回答标注信息来源，支持追溯到原始教材、课件或论文的具体章节</p>
        </div>
        <div class="ai-chat-feature-card">
          <div class="ai-chat-feature-icon">💬</div>
          <h4>多轮对话</h4>
          <p>支持上下文感知的连续对话，可深入探讨复杂问题并逐步细化解答</p>
        </div>
        <div class="ai-chat-feature-card">
          <div class="ai-chat-feature-icon">💡</div>
          <h4>推荐学习建议</h4>
          <p>根据提问内容智能推荐相关学习资料、练习题和知识点巩固路径</p>
        </div>
      </div>
    </div>`

  renderDashboardLayout(app, { menuItems: MENU_ITEMS, contentHTML, user })
}
