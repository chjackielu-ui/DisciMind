// 教师端 - 题库管理页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getTeacherQuestions, deleteTeacherQuestion, aiGenerateQuestions } from '../api/teacher.js'
import { iconSearch, iconRefresh } from '../utils/icons.js'

export async function renderTeacherQuestions(app) {
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
        <a href="#/teacher/tasks" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回作业考试</a>
      </div>
      <div class="page-header">
        <h2 class="page-title">题库管理</h2>
        <p class="page-subtitle">管理课程题目，支持单选题、多选题、判断题、填空题、简答题</p>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="search-keyword" placeholder="搜索题目..." style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <select id="filter-type" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            <option value="">全部题型</option>
            <option value="single_choice">单选题</option>
            <option value="multiple_choice">多选题</option>
            <option value="true_false">判断题</option>
            <option value="fill_blank">填空题</option>
            <option value="short_answer">简答题</option>
          </select>
          <select id="filter-difficulty" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            <option value="">全部难度</option>
            <option value="basic">基础</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
          <button class="btn btn-primary" id="btn-search">${iconSearch()} 搜索</button>
          <button class="btn" id="btn-refresh" style="border:1px solid var(--border);">${iconRefresh()}</button>
          <div style="margin-left:auto;display:flex;gap:8px;">
            <button class="btn" id="btn-ai-generate" style="border:1px solid #a78bfa;color:#7c3aed;">🤖 AI 生成</button>
            <button class="btn btn-primary" id="btn-create">＋ 新建题目</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div id="question-list-container">
          <div class="empty-hint">正在加载题库数据...</div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '题库管理',
    menuItems,
    contentHTML,
    user,
  })

  async function loadQuestions(params = {}) {
    const container = document.getElementById('question-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'

    try {
      const res = await getTeacherQuestions(params)
      renderQuestions(res.data.list || [], res.data)
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><div class="error-message">${err.message}</div><button class="btn-retry" onclick="location.reload()">重试</button></div>`
    }
  }

  function renderQuestions(questions, pageData) {
    const container = document.getElementById('question-list-container')
    if (!container) return

    if (!questions || questions.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">暂无题目，点击上方"新建题目"开始创建</div>'
      return
    }

    const typeLabels = { single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', fill_blank: '填空题', blank: '填空题', short_answer: '简答题', programming: '编程题' }
    const diffLabels = { basic: '基础', medium: '中等', hard: '困难' }

    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);">题目</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">题型</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:60px;">难度</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:60px;">分值</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:60px;">使用</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:100px;">状态</th>
            <th style="text-align:right;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:120px;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${questions.map(q => {
            const isAi = q.is_ai_generated
            return `
              <tr style="border-bottom:1px solid var(--border);transition:background 0.2s;" data-id="${q.question_id}">
                <td style="padding:12px 8px;">
                  <div style="font-weight:500;color:var(--text);font-size:0.9rem;">${q.title}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                    ${q.course_name || '-'} ${q.knowledge_point_name ? '· ' + q.knowledge_point_name : ''}
                    ${isAi ? '· <span style="color:#7c3aed;">AI生成</span>' : ''}
                  </div>
                </td>
                <td style="text-align:center;padding:12px 8px;font-size:0.85rem;">${typeLabels[q.question_type] || q.question_type}</td>
                <td style="text-align:center;padding:12px 8px;">
                  <span style="background:${q.difficulty_level === 'hard' ? '#fee2e2' : q.difficulty_level === 'medium' ? '#fef3c7' : '#d1fae5'};color:${q.difficulty_level === 'hard' ? '#dc2626' : q.difficulty_level === 'medium' ? '#b45309' : '#065f46'};padding:2px 8px;border-radius:8px;font-size:0.75rem;">${diffLabels[q.difficulty_level] || q.difficulty_level}</span>
                </td>
                <td style="text-align:center;padding:12px 8px;font-size:0.85rem;">${q.score}</td>
                <td style="text-align:center;padding:12px 8px;font-size:0.85rem;">${q.usage_count || 0}</td>
                <td style="text-align:center;padding:12px 8px;">
                  <span style="background:${q.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${q.status === 'active' ? '#065f46' : '#92400e'};padding:2px 8px;border-radius:8px;font-size:0.75rem;">${q.status === 'active' ? '正常' : q.status}</span>
                </td>
                <td style="text-align:right;padding:12px 8px;">
                  <button class="btn-edit" data-id="${q.question_id}" style="padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;font-size:0.8rem;margin-right:4px;">编辑</button>
                  <button class="btn-del" data-id="${q.question_id}" style="padding:4px 12px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;">删除</button>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
      ${pageData.total > pageData.page_size ? `
        <div style="display:flex;justify-content:center;gap:8px;padding:16px 0 0;font-size:0.85rem;color:var(--text-muted);">
          共 ${pageData.total} 题，第 ${pageData.page}/${Math.ceil(pageData.total / pageData.page_size)} 页
        </div>
      ` : ''}
    `

    // 编辑
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = `#/teacher/questions/${btn.dataset.id}`
      })
    })

    // 删除
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定删除该题目吗？')) return
        try {
          await deleteTeacherQuestion(parseInt(btn.dataset.id))
          loadQuestions(getFilters())
        } catch (err) {
          alert(err.message)
        }
      })
    })
  }

  function getFilters() {
    return {
      keyword: document.getElementById('search-keyword')?.value || '',
      question_type: document.getElementById('filter-type')?.value || '',
      difficulty_level: document.getElementById('filter-difficulty')?.value || '',
    }
  }

  document.getElementById('btn-search')?.addEventListener('click', () => loadQuestions(getFilters()))
  document.getElementById('btn-refresh')?.addEventListener('click', () => loadQuestions())
  document.getElementById('btn-create')?.addEventListener('click', () => {
    window.location.hash = '#/teacher/questions/create'
  })
  document.getElementById('btn-ai-generate')?.addEventListener('click', () => {
    alert('该功能正在开发中，敬请期待')
  })

  loadQuestions()
}
