// 教师端 - 任务详情页（含提交列表）

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { getTeacherTask, getTaskSubmissions, getTaskSubmission, deleteTeacherTask } from '../api/teacher.js'

export async function renderTeacherTaskDetail(app, params) {
  let user = getUser()
  const taskId = params?.task_id ? parseInt(params.task_id) : null
  if (!taskId) {
    window.location.hash = '#/teacher/tasks'
    return
  }

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

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title" id="task-title">任务详情</h2>
        <p class="page-subtitle" id="task-subtitle">加载中...</p>
      </div>

      <!-- 任务信息 -->
      <div class="card" style="margin-bottom:20px;" id="task-info-card">
        <div class="empty-hint">加载中...</div>
      </div>

      <!-- 提交列表 -->
      <div class="card">
        <h3 class="card-title">学生提交列表</h3>
        <div id="submissions-container">
          <div class="empty-hint">加载中...</div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '任务详情',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  async function loadTask() {
    try {
      const res = await getTeacherTask(taskId)
      const data = res.data

      document.getElementById('task-title').textContent = data.title || '任务详情'

      const typeLabels = { homework: '作业', quiz: '测试', study_task: '学习任务', review_plan: '复习计划' }
      const statusLabels = { draft: '草稿', published: '已发布', closed: '已截止' }
      const statusColors = { draft: '#6b7280', published: '#065f46', closed: '#92400e' }
      const statusBgs = { draft: '#f3f4f6', published: '#d1fae5', closed: '#fef3c7' }

      document.getElementById('task-subtitle').textContent = `${typeLabels[data.task_type] || data.task_type} · ${data.course_name || ''} ${data.class_name || ''}`.trim()

      document.getElementById('task-info-card').innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:16px;">
          <div style="flex:2;min-width:300px;">
            <div style="margin-bottom:8px;">
              <span style="background:${statusBgs[data.status]};color:${statusColors[data.status]};padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:500;">${statusLabels[data.status] || data.status}</span>
              <span style="background:#ede9fe;color:#6d28d9;padding:4px 12px;border-radius:12px;font-size:0.8rem;margin-left:6px;">${typeLabels[data.task_type] || data.task_type}</span>
            </div>
            ${data.description ? `<p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:8px;">${data.description}</p>` : ''}
            <div style="font-size:0.85rem;color:var(--text-muted);">
              <div>${data.start_time ? formatDate(data.start_time) : '无开始时间'} → ${data.deadline ? formatDate(data.deadline) : '无截止时间'}</div>
              <div>🔢 ${data.questions?.length || 0} 道题目</div>
              <div>${data.submission_count || 0} 次提交</div>
              ${data.allow_late_submit ? '<div>✅ 允许补交</div>' : ''}
            </div>
          </div>
          <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:8px;justify-content:flex-end;">
            <button class="btn" id="btn-edit-task" style="border:1px solid var(--border);font-size:0.85rem;">编辑任务</button>
            <button class="btn" id="btn-delete-task" style="border:1px solid #fecaca;color:#dc2626;font-size:0.85rem;">删除任务</button>
          </div>
        </div>
      `

      document.getElementById('btn-edit-task')?.addEventListener('click', () => {
        window.location.hash = `#/teacher/tasks/${taskId}/edit`
      })

      document.getElementById('btn-delete-task')?.addEventListener('click', async () => {
        if (!confirm('确定删除此任务吗？此操作不可撤销。')) return
        try {
          await deleteTeacherTask(taskId)
          window.location.hash = '#/teacher/tasks'
        } catch (err) {
          alert(err.message)
        }
      })
    } catch (err) {
      document.getElementById('task-title').textContent = '加载失败'
      document.getElementById('task-info-card').innerHTML = `<div class="error-state"><div class="error-message">${err.message}</div></div>`
    }
  }

  async function loadSubmissions() {
    const container = document.getElementById('submissions-container')
    try {
      const res = await getTaskSubmissions(taskId)
      const submissions = res.data.list || []

      if (submissions.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无学生提交</div>'
        return
      }

      const statusLabels = { in_progress: '进行中', submitted: '已提交', graded: '已批改' }
      const statusColors = { in_progress: '#6b7280', submitted: '#f59e0b', graded: '#10b981' }

      container.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <th style="text-align:left;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);">学生</th>
              <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">状态</th>
              <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">得分</th>
              <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">批改状态</th>
              <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">用时</th>
              <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:120px;">提交时间</th>
            </tr>
          </thead>
          <tbody>
            ${submissions.map(s => `
              <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:10px 8px;">
                  <div style="font-weight:500;font-size:0.9rem;">${s.student_name || '未知'}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);">${s.student_no || ''}</div>
                </td>
                <td style="text-align:center;padding:10px 8px;">
                  <span style="color:${statusColors[s.submission_status] || '#6b7280'};font-size:0.85rem;">${statusLabels[s.submission_status] || s.submission_status}</span>
                </td>
                <td style="text-align:center;padding:10px 8px;font-weight:600;font-size:0.9rem;">
                  ${s.total_score != null ? s.total_score : '-'}
                </td>
                <td style="text-align:center;padding:10px 8px;">
                  <span style="font-size:0.8rem;color:var(--text-muted);">${s.grading_status || '-'}</span>
                </td>
                <td style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);">
                  ${s.duration_seconds ? Math.round(s.duration_seconds / 60) + '分钟' : '-'}
                </td>
                <td style="text-align:center;padding:10px 8px;font-size:0.8rem;color:var(--text-muted);">
                  ${s.submitted_at ? formatDate(s.submitted_at) : '-'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="margin-top:12px;font-size:0.85rem;color:var(--text-muted);text-align:center;">
          共 ${submissions.length} 条提交记录
        </div>
      `
    } catch (err) {
      container.innerHTML = `<div class="empty-hint">加载失败: ${err.message}</div>`
    }
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-'
    const d = new Date(isoStr)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  await loadTask()
  await loadSubmissions()
}



