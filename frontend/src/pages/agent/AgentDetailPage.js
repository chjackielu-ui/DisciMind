import { getMe } from '../../api/auth.js'
import { getUser, setAuth, clearAuth, getToken } from '../../utils/auth.js'
import { renderDashboardLayout } from '../../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../../utils/student-menu.js'

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return null
    }
  }
  return user
}

function buildAgentDetailHTML() {
  return `
    <div class="complex-shell">
      <section class="complex-hero">
        <div>
          <h1>AI 训练师</h1>
          <p>面向知识点的诊断训练 Agent，已接入真实 Dify Workflow、答题记录、错题本和掌握度更新。</p>
          <div class="exam-meta-row">
            <span>已启用</span>
            <span>诊断题</span>
            <span>深度批改</span>
            <span>自适应下一题</span>
          </div>
        </div>
        <div class="complex-actions">
          <button class="complex-btn" id="btn-use-trainer-agent" type="button">立即使用</button>
        </div>
      </section>
      <div class="complex-grid-2">
        <section class="complex-card">
          <h3 class="complex-section-title">训练师 Agent</h3>
          <p style="color:var(--text-sub);line-height:1.7;">从课程与知识点上下文装配开始，生成诊断题；提交答案后才展示正确答案、解析、错误分析和补救建议。</p>
        </section>
        <section class="complex-card">
          <h3 class="complex-section-title">其他 Agent</h3>
          <p style="color:var(--text-sub);line-height:1.7;">学习规划、科研助手、竞赛助手等正式 Workflow 尚未启用。</p>
          <span class="complex-tag">尚未启用</span>
        </section>
      </div>
    </div>`
}

export async function renderStudentAgentDetail(app) {
  const user = await getAuthedUser()
  if (!user) return
  renderDashboardLayout(app, {
    menuItems: STUDENT_MENU_ITEMS,
    contentHTML: buildAgentDetailHTML(),
    user,
  })
  document.getElementById('btn-use-trainer-agent')?.addEventListener('click', () => {
    window.location.hash = '#/student/trainer'
  })
}

export default function AgentDetailPage() {
  return null
}
