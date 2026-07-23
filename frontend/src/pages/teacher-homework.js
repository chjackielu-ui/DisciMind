// 教师端 - 作业管理页（独立 homework 模块）
// Tab1: 作业发布管理 | Tab2: 作业批改工作台

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import {
  getTeacherCourses,
  createHomework, updateHomework, publishHomework, closeHomework,
  getHomeworkList, getHomeworkDetail, getHomeworkSubmissions,
  aiMarkSubmission, batchAiMarkHomework, manualMarkSubmission, getHomeworkScoreStat,
} from '../api/teacher.js'
import { iconSearch, iconRefresh } from '../utils/icons.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { teacherCourseLabel } from '../utils/teacher-course.js'

export async function renderTeacherHomework(app) {
  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? getToken() : '', user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  const displayName = getUserDisplayName()
  const HW_TAB_HEIGHT = 56

  const contentHTML = `
    <div class="dashboard-content" style="padding-top:0;">
      <!-- 固定顶部作业管理二级导航栏（与系统管理格式一致） -->
      <div id="hw-tab-bar" style="position:fixed;top:0;left:128px;right:0;z-index:99;background:#fff;border-bottom:1px solid var(--border);padding:0 28px;display:flex;align-items:flex-end;gap:24px;height:${HW_TAB_HEIGHT}px;box-shadow:none;">
        <button class="hw-tab-btn active" data-tab="publish" style="padding:0 0 10px;border:none;background:none;font-size:0.88rem;font-weight:600;cursor:pointer;color:#1F2937;border-bottom:2px solid #2563EB;height:auto;line-height:1;letter-spacing:0.02em;">作业发布管理</button>
        <button class="hw-tab-btn" data-tab="grade" style="padding:0 0 10px;border:none;background:none;font-size:0.88rem;font-weight:400;cursor:pointer;color:#64748B;border-bottom:2px solid transparent;height:auto;line-height:1;letter-spacing:0.02em;">作业批改工作台</button>
      </div>

      <!-- 内容区（预留固定栏高度） -->
      <div style="padding-top:${HW_TAB_HEIGHT + 16}px;min-height:60vh;">
      <!-- Tab1: 作业发布管理 -->
      <div id="hw-tab-publish" class="hw-tab-content">
        <div class="card" style="margin-bottom:20px;">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <select id="hw-filter-course" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;min-width:150px;">
              <option value="">全部课程</option>
            </select>
            <select id="hw-filter-status" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
              <option value="closed">已关闭</option>
            </select>
            <button class="btn btn-primary" id="hw-btn-search" style="padding:6px 12px;font-size:0.85rem;">${iconSearch()} 搜索</button>
            <button class="btn" id="hw-btn-refresh" style="border:1px solid var(--border);padding:6px 10px;">${iconRefresh()}</button>
            <button class="btn btn-primary" id="hw-btn-create" style="margin-left:auto;padding:6px 14px;font-size:0.85rem;">＋ 新建作业</button>
          </div>
        </div>
        <div id="hw-list-container"><div class="empty-hint">加载中...</div></div>
      </div>

      <!-- Tab2: 作业批改工作台 -->
      <div id="hw-tab-grade" class="hw-tab-content" style="display:none;">
        <div class="card" style="margin-bottom:20px;">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <select id="hw-grade-select" style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;"><option value="">请先选择要批改的作业</option></select>
            <select id="hw-grade-mark-status" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
              <option value="">全部批改状态</option>
              <option value="unmarked">未批改</option>
              <option value="marked">已批改</option>
            </select>
            <select id="hw-grade-submit-status" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
              <option value="">全部提交状态</option>
              <option value="submitted">已提交</option>
              <option value="late">迟交</option>
              <option value="unsubmit">未提交</option>
            </select>
            <button class="btn btn-primary" id="hw-grade-search" style="padding:6px 12px;font-size:0.85rem;">${iconSearch()}</button>
            <button class="btn" id="hw-grade-batch-ai" style="border:1px solid var(--border);padding:6px 10px;font-size:0.8rem;">AI批量批改</button>
          </div>
        </div>
        <div id="hw-grade-container"><div class="empty-hint">请先选择作业后查看提交记录</div></div>
        <!-- 成绩统计 -->
        <div id="hw-score-stat" style="margin-top:16px;display:none;"></div>
      </div>
    </div>

    <!-- 新建作业弹窗 -->
    <div id="hw-create-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:640px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 id="hw-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建作业</h3>
        <form id="hw-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>所属课程 <span class="required">*</span></label>
              <select id="hw-form-course" required style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;"><option value="">请选择</option></select>
            </div>
            <div class="form-group">
              <label>截止时间</label>
              <input type="datetime-local" id="hw-form-deadline" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>作业标题 <span class="required">*</span></label>
            <input type="text" id="hw-form-title" required placeholder="例如：线性回归专项练习" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>作业说明</label>
            <textarea id="hw-form-desc" rows="2" placeholder="可选填写作业要求..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;resize:vertical;"></textarea>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>总分</label>
            <input type="number" id="hw-form-total" value="100" min="1" style="width:120px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          </div>
          <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px;">
            <h4 style="font-size:0.95rem;margin:0 0 10px;">试题列表</h4>
            <div id="hw-form-questions">
              <div class="empty-hint" style="padding:20px 0;">暂无试题，请添加</div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button type="button" class="btn" id="hw-add-question" style="border:1px solid var(--border);font-size:0.85rem;">＋ 添加题目</button>
              <button type="button" class="btn" id="hw-add-choice" style="border:1px solid var(--border);font-size:0.85rem;">＋ 选择题</button>
              <button type="button" class="btn" id="hw-add-short" style="border:1px solid var(--border);font-size:0.85rem;">＋ 简答题</button>
            </div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="hw-modal-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存草稿</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 批改弹窗 -->
    <div id="hw-mark-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:640px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin-bottom:16px;font-size:1.1rem;">批改作业</h3>
        <div id="hw-mark-content"><div class="empty-hint">加载中...</div></div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '作业管理',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // ---- 状态 ----
  let courseList = []
  let hwList = []
  let currentHomeworkId = null
  let editingHomeworkId = null
  let questions = []
  const pageSize = 10

  // ---- 初始化课程下拉 ----
  async function loadCourses() {
    try {
      const res = await getTeacherCourses()
      courseList = res.data.list || []
      const selects = ['hw-form-course', 'hw-filter-course']
      selects.forEach(id => {
        const sel = document.getElementById(id)
        if (!sel) return
        sel.innerHTML = '<option value="">全部课程</option>'
        if (id === 'hw-form-course') sel.innerHTML = '<option value="">请选择课程</option>'
        courseList.forEach(c => {
          const opt = document.createElement('option')
          opt.value = c.course_id
          opt.textContent = teacherCourseLabel(c)
          sel.appendChild(opt)
        })
      })
    } catch (err) { console.error(err) }
  }

  // ---- Tab 切换（系统管理格式）----
  let currentHwTab = 'publish'
  document.querySelectorAll('.hw-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      if (tab === currentHwTab) return
      currentHwTab = tab
      document.querySelectorAll('.hw-tab-btn').forEach(b => {
        b.classList.remove('active')
        b.style.color = '#64748B'
        b.style.borderBottomColor = 'transparent'
        b.style.fontWeight = '400'
      })
      btn.classList.add('active')
      btn.style.color = '#1F2937'
      btn.style.borderBottomColor = '#2563EB'
      btn.style.fontWeight = '600'
      document.querySelectorAll('.hw-tab-content').forEach(c => c.style.display = 'none')
      const pane = document.getElementById('hw-tab-' + tab)
      if (pane) pane.style.display = 'block'
      if (tab === 'publish') loadHomeworkList()
    })
  })

  // ========================
  // Tab1: 作业发布管理
  // ========================

  async function loadHomeworkList() {
    const container = document.getElementById('hw-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const params = {}
      const courseId = document.getElementById('hw-filter-course')?.value
      const status = document.getElementById('hw-filter-status')?.value
      if (courseId) params.course_id = courseId
      if (status) params.status = status

      const res = await getHomeworkList(params)
      hwList = res.data.list || []
      renderHomeworkList(hwList)
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-message">${err.message}</div></div>`
    }
  }

  function renderHomeworkList(list) {
    const container = document.getElementById('hw-list-container')
    if (!list.length) {
      container.innerHTML = '<div class="empty-hint" style="padding:60px 0;">暂无作业，点击"新建作业"开始创建</div>'
      return
    }
    const statusMap = { draft: '草稿', published: '已发布', closed: '已关闭' }
    const statusColor = { draft: '#f59e0b', published: '#10b981', closed: '#64748b' }
    container.innerHTML = list.map(h => `
      <div class="card" style="margin-bottom:12px;padding:16px 20px;">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
              <h3 style="font-size:1rem;font-weight:600;margin:0;color:var(--stu-dark);">${escapeHtml(h.title)}</h3>
              <span style="background:${statusColor[h.status] || '#94a3b8'}1a;color:${statusColor[h.status] || '#94a3b8'};padding:2px 10px;border-radius:10px;font-size:0.75rem;font-weight:600;">${statusMap[h.status] || h.status}</span>
            </div>
            <div style="font-size:0.82rem;color:var(--text-secondary);">
              <span>${escapeHtml(h.course_name || '-')}</span>
              <span style="margin:0 8px;">|</span>
              <span>${h.total_score}分</span>
              <span style="margin:0 8px;">|</span>
              <span>👥 ${h.submit_count} 人提交</span>
              ${h.deadline ? `<span style="margin:0 8px;">|</span><span>${formatDate(h.deadline)}</span>` : ''}
            </div>
            ${h.description ? `<div style="margin-top:6px;font-size:0.82rem;color:var(--text-muted);">${escapeHtml(h.description)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
            ${h.status === 'draft' ? `<button class="btn-sm btn-primary hw-publish" data-id="${h.homework_id}" style="padding:5px 12px;font-size:0.8rem;border:none;border-radius:6px;background:var(--primary);color:#fff;cursor:pointer;">发布</button>` : ''}
            ${h.status === 'published' ? `<button class="btn-sm hw-close" data-id="${h.homework_id}" style="padding:5px 12px;font-size:0.8rem;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;">关闭</button>` : ''}
            <button class="btn-sm hw-grade-tab" data-id="${h.homework_id}" style="padding:5px 12px;font-size:0.8rem;border:1px solid var(--border);border-radius:6px;cursor:pointer;">批改</button>
          </div>
        </div>
      </div>
    `).join('')

    // 发布
    container.querySelectorAll('.hw-publish').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id)
        if (!confirm('确定发布该作业吗？发布后将对学生可见。')) return
        try {
          await publishHomework(id)
          loadHomeworkList()
          loadGradeSelect()
        } catch (err) { alert(err.message) }
      })
    })
    // 关闭
    container.querySelectorAll('.hw-close').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id)
        if (!confirm('确定关闭该作业吗？关闭后学生将无法提交。')) return
        try {
          await closeHomework(id)
          loadHomeworkList()
          loadGradeSelect()
        } catch (err) { alert(err.message) }
      })
    })
    // 切到批改
    container.querySelectorAll('.hw-grade-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id)
        const gradeSelect = document.getElementById('hw-grade-select')
        if (gradeSelect) gradeSelect.value = id
        switchToGradeTab(id)
      })
    })
  }

  // ---- 新建/编辑作业 ----
  let editingHwId = null

  document.getElementById('hw-btn-create')?.addEventListener('click', () => {
    editingHwId = null
    questions = []
    document.getElementById('hw-modal-title').textContent = '新建作业'
    document.getElementById('hw-form-title').value = ''
    document.getElementById('hw-form-desc').value = ''
    document.getElementById('hw-form-total').value = '100'
    document.getElementById('hw-form-deadline').value = ''
    document.getElementById('hw-form-course').value = ''
    renderQuestions()
    document.getElementById('hw-create-modal').style.display = 'flex'
  })

  document.getElementById('hw-modal-cancel')?.addEventListener('click', () => {
    document.getElementById('hw-create-modal').style.display = 'none'
  })

  // 添加题目类型
  document.getElementById('hw-add-question')?.addEventListener('click', () => {
    questions.push({ id: 'q_' + Date.now(), type: 'SHORT_ANSWER', stem: '', answer: '', score: 10 })
    renderQuestions()
  })
  document.getElementById('hw-add-choice')?.addEventListener('click', () => {
    questions.push({ id: 'q_' + Date.now(), type: 'SINGLE_CHOICE', stem: '', options: ['', '', '', ''], answer: '', score: 10 })
    renderQuestions()
  })
  document.getElementById('hw-add-short')?.addEventListener('click', () => {
    questions.push({ id: 'q_' + Date.now(), type: 'SHORT_ANSWER', stem: '', answer: '', score: 10 })
    renderQuestions()
  })

  function renderQuestions() {
    const container = document.getElementById('hw-form-questions')
    if (!container) return
    if (questions.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="padding:20px 0;">暂无试题，请添加</div>'
      return
    }
    container.innerHTML = questions.map((q, i) => `
      <div style="padding:14px;margin-bottom:10px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:600;font-size:0.85rem;">第 ${i + 1} 题 · ${q.type === 'SINGLE_CHOICE' ? '选择题' : '简答题'}</span>
          <button type="button" class="hw-del-q" data-index="${i}" style="border:none;background:none;color:#dc2626;cursor:pointer;font-size:0.8rem;">删除</button>
        </div>
        <input type="text" class="hw-q-stem" data-index="${i}" value="${escapeHtml(q.stem)}" placeholder="请输入题目内容..." style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.85rem;margin-bottom:6px;box-sizing:border-box;">
        ${q.type === 'SINGLE_CHOICE' ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            ${(q.options || ['', '', '', '']).map((opt, oi) => `
              <div style="display:flex;align-items:center;gap:4px;">
                <span style="font-size:0.8rem;color:var(--text-muted);">${String.fromCharCode(65 + oi)}.</span>
                <input type="text" class="hw-q-opt" data-qidx="${i}" data-oidx="${oi}" value="${escapeHtml(opt)}" placeholder="选项${String.fromCharCode(65 + oi)}" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.82rem;">
              </div>
            `).join('')}
          </div>
          <div style="margin-top:6px;">
            <label style="font-size:0.8rem;">正确答案：</label>
            <input type="text" class="hw-q-answer" data-index="${i}" value="${escapeHtml(q.answer || '')}" placeholder="如: A" style="width:80px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.82rem;">
          </div>
        ` : `
          <div>
            <label style="font-size:0.8rem;">参考答案：</label>
            <input type="text" class="hw-q-answer" data-index="${i}" value="${escapeHtml(q.answer || '')}" placeholder="参考答案" style="width:200px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.82rem;">
          </div>
        `}
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
          <label style="font-size:0.8rem;">分值：</label>
          <input type="number" class="hw-q-score" data-index="${i}" value="${q.score || 10}" min="1" style="width:70px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.82rem;">
        </div>
      </div>
    `).join('')

    // 绑定删除
    container.querySelectorAll('.hw-del-q').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index)
        questions.splice(idx, 1)
        renderQuestions()
      })
    })
  }

  // 表单提交
  document.getElementById('hw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    // 收集试题数据
    const questionInputs = document.querySelectorAll('.hw-q-stem')
    questionInputs.forEach((input, i) => {
      if (questions[i]) questions[i].stem = input.value
    })
    document.querySelectorAll('.hw-q-answer').forEach(input => {
      const i = parseInt(input.dataset.index)
      if (questions[i]) questions[i].answer = input.value
    })
    document.querySelectorAll('.hw-q-score').forEach(input => {
      const i = parseInt(input.dataset.index)
      if (questions[i]) questions[i].score = parseFloat(input.value) || 10
    })
    document.querySelectorAll('.hw-q-opt').forEach(input => {
      const qi = parseInt(input.dataset.qidx)
      const oi = parseInt(input.dataset.oidx)
      if (questions[qi] && questions[qi].options) questions[qi].options[oi] = input.value
    })

    const courseId = parseInt(document.getElementById('hw-form-course').value)
    const title = document.getElementById('hw-form-title').value.trim()
    if (!courseId || !title) { alert('请选择课程并填写作业标题'); return }
    if (questions.length === 0) { alert('请至少添加一道题目'); return }

    const data = {
      course_id: courseId,
      title,
      description: document.getElementById('hw-form-desc').value.trim() || undefined,
      question_json: questions,
      total_score: parseFloat(document.getElementById('hw-form-total').value) || 100,
      deadline: document.getElementById('hw-form-deadline').value ? new Date(document.getElementById('hw-form-deadline').value).toISOString() : undefined,
    }

    try {
      if (editingHwId) {
        await updateHomework(editingHwId, data)
      } else {
        await createHomework(data)
      }
      document.getElementById('hw-create-modal').style.display = 'none'
      loadHomeworkList()
      loadGradeSelect()
    } catch (err) { alert(err.message) }
  })

  // 搜索与刷新
  document.getElementById('hw-btn-search')?.addEventListener('click', loadHomeworkList)
  document.getElementById('hw-btn-refresh')?.addEventListener('click', loadHomeworkList)
  document.getElementById('hw-filter-status')?.addEventListener('change', loadHomeworkList)
  document.getElementById('hw-filter-course')?.addEventListener('change', loadHomeworkList)

  // ========================
  // Tab2: 作业批改工作台
  // ========================

  async function loadGradeSelect() {
    try {
      const res = await getHomeworkList({ status: 'published' })
      const list = res.data.list || []
      const sel = document.getElementById('hw-grade-select')
      sel.innerHTML = '<option value="">请选择要批改的作业</option>'
      list.forEach(h => {
        const opt = document.createElement('option')
        opt.value = h.homework_id
        opt.textContent = h.title
        sel.appendChild(opt)
      })
    } catch (err) { console.error(err) }
  }

  function switchToGradeTab(homeworkId) {
    currentHomeworkId = homeworkId
    document.querySelector('.hw-tab[data-tab="grade"]')?.click()
    loadSubmissions(homeworkId)
  }

  document.getElementById('hw-grade-select')?.addEventListener('change', (e) => {
    currentHomeworkId = parseInt(e.target.value) || null
    if (currentHomeworkId) loadSubmissions(currentHomeworkId)
  })

  document.getElementById('hw-grade-search')?.addEventListener('click', () => {
    if (currentHomeworkId) loadSubmissions(currentHomeworkId)
  })

  async function loadSubmissions(homeworkId) {
    const container = document.getElementById('hw-grade-container')
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const params = {}
      const markStatus = document.getElementById('hw-grade-mark-status')?.value
      const submitStatus = document.getElementById('hw-grade-submit-status')?.value
      if (markStatus) params.mark_status = markStatus
      if (submitStatus) params.submit_status = submitStatus

      const res = await getHomeworkSubmissions(homeworkId, params)
      const list = res.data.list || []

      if (!list.length) {
        container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">暂无提交记录</div>'
        document.getElementById('hw-score-stat').style.display = 'none'
        return
      }

      const markStatusLabel = s => s.mark_record ? s.mark_record.mark_type === 'ai_auto' ? 'AI已批' : s.mark_record.mark_type === 'combined' ? '已复核' : '已批改' : '待批改'
      const markStatusColor = s => s.mark_record ? '#10b981' : '#f59e0b'
      const submitLabel = s => ({ submitted: '已提交', late: '迟交', unsubmit: '未提交' })[s.submit_status] || s.submit_status

      container.innerHTML = `
        <div class="card" style="overflow:hidden;padding:0;">
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <thead>
              <tr style="background:#f8f9fa;border-bottom:2px solid var(--border);">
                <th style="padding:10px 14px;text-align:left;">学生</th>
                <th style="padding:10px 14px;text-align:center;">提交状态</th>
                <th style="padding:10px 14px;text-align:center;">提交时间</th>
                <th style="padding:10px 14px;text-align:center;">AI评分</th>
                <th style="padding:10px 14px;text-align:center;">最终得分</th>
                <th style="padding:10px 14px;text-align:center;">批改状态</th>
                <th style="padding:10px 14px;text-align:center;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(s => `
                <tr style="border-bottom:1px solid var(--border);">
                  <td style="padding:10px 14px;font-weight:500;">${escapeHtml(s.student_name)}</td>
                  <td style="padding:10px 14px;text-align:center;">
                    <span style="background:${s.submit_status === 'late' ? '#FEF2F2' : '#F0FDF4'};color:${s.submit_status === 'late' ? '#dc2626' : '#16a34a'};padding:2px 8px;border-radius:8px;font-size:0.78rem;">${submitLabel(s)}</span>
                  </td>
                  <td style="padding:10px 14px;text-align:center;color:var(--text-secondary);font-size:0.8rem;">${s.submit_time ? formatDate(s.submit_time) : '-'}</td>
                  <td style="padding:10px 14px;text-align:center;">${s.mark_record?.ai_score != null ? s.mark_record.ai_score : '-'}</td>
                  <td style="padding:10px 14px;text-align:center;font-weight:600;">${s.score != null ? s.score : '-'}</td>
                  <td style="padding:10px 14px;text-align:center;">
                    <span style="background:${markStatusColor(s)}20;color:${markStatusColor(s)};padding:2px 8px;border-radius:8px;font-size:0.78rem;font-weight:500;">${markStatusLabel(s)}</span>
                  </td>
                  <td style="padding:10px 14px;text-align:center;">
                    <button class="hw-mark-btn" data-sub-id="${s.submission_id}" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:0.78rem;">批改</button>
                    <button class="hw-ai-mark-btn" data-sub-id="${s.submission_id}" style="padding:4px 10px;border:1px solid #a78bfa;border-radius:6px;background:#f5f3ff;color:#7c3aed;cursor:pointer;font-size:0.78rem;">AI批改</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `

      container.querySelectorAll('.hw-mark-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const subId = parseInt(btn.dataset.subId)
          openMarkModal(subId)
        })
      })
      container.querySelectorAll('.hw-ai-mark-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const subId = parseInt(btn.dataset.subId)
          btn.disabled = true
          btn.textContent = '批改中...'
          try {
            await aiMarkSubmission(subId)
            loadSubmissions(currentHomeworkId)
            loadScoreStat(currentHomeworkId)
          } catch (err) { alert(err.message) }
        })
      })

      // 加载成绩统计
      loadScoreStat(homeworkId)
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-message">${err.message}</div></div>`
    }
  }

  // ---- AI 批量批改 ----
  document.getElementById('hw-grade-batch-ai')?.addEventListener('click', async () => {
    if (!currentHomeworkId) { alert('请先选择作业'); return }
    if (!confirm('确定对当前作业所有未批改的提交进行 AI 批量批改吗？')) return
    try {
      await batchAiMarkHomework(currentHomeworkId)
      alert('✅ AI 批量批改任务已创建，正在后台处理...')
      setTimeout(() => loadSubmissions(currentHomeworkId), 2000)
    } catch (err) { alert(err.message) }
  })

  // ---- 成绩统计 ----
  async function loadScoreStat(homeworkId) {
    const container = document.getElementById('hw-score-stat')
    try {
      const res = await getHomeworkScoreStat(homeworkId)
      const data = res.data || {}
      container.style.display = 'block'
      container.innerHTML = `
        <div class="card">
          <h3 class="card-title" style="margin-bottom:12px;">成绩统计</h3>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
            <div style="flex:1;min-width:100px;padding:12px;background:var(--bg);border-radius:8px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:700;color:var(--primary);">${data.total_submissions || 0}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">提交人数</div>
            </div>
            <div style="flex:1;min-width:100px;padding:12px;background:var(--bg);border-radius:8px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:700;color:#10b981;">${data.average_score || 0}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">平均分</div>
            </div>
            <div style="flex:1;min-width:100px;padding:12px;background:var(--bg);border-radius:8px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:700;color:#6366f1;">${data.max_score || 0}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">最高分</div>
            </div>
            <div style="flex:1;min-width:100px;padding:12px;background:var(--bg);border-radius:8px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:700;color:#f59e0b;">${data.min_score || 0}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">最低分</div>
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${['excellent', 'good', 'general', 'weak'].map(k => {
              const item = data.distribution?.[k] || {}
              const color = { excellent: '#10b981', good: '#3b82f6', general: '#f59e0b', weak: '#ef4444' }[k]
              return `<div style="flex:1;min-width:80px;padding:10px;border-radius:8px;border:1px solid ${color}30;text-align:center;">
                <div style="font-size:0.78rem;color:${color};font-weight:600;">${item.count || 0}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">${item.label || k}</div>
              </div>`
            }).join('')}
          </div>
          ${(data.top_wrong_keywords || []).length > 0 ? `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
              <h4 style="font-size:0.85rem;margin:0 0 8px;">高频错题关键词</h4>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${data.top_wrong_keywords.slice(0, 8).map(kw => `
                  <span style="padding:4px 10px;background:#FEF2F2;color:#dc2626;border-radius:12px;font-size:0.78rem;border:1px solid #FECACA;">
                    ${escapeHtml(kw.keyword)} (${kw.count})
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `
    } catch (err) {
      container.style.display = 'none'
    }
  }

  // ---- 批改弹窗 ----
  async function openMarkModal(submissionId) {
    const modal = document.getElementById('hw-mark-modal')
    modal.style.display = 'flex'
    const content = document.getElementById('hw-mark-content')
    content.innerHTML = '<div class="empty-hint">加载中...</div>'

    try {
      const res = await getHomeworkSubmissions(currentHomeworkId)
      const list = res.data.list || []
      const sub = list.find(s => s.submission_id === submissionId)
      if (!sub) { content.innerHTML = '<div class="empty-hint">未找到提交记录</div>'; return }

      const hwRes = await getHomeworkDetail(currentHomeworkId)
      const hw = hwRes.data || {}

      content.innerHTML = `
        <div style="margin-bottom:14px;">
          <div style="font-weight:600;">${escapeHtml(sub.student_name)}</div>
          <div style="font-size:0.82rem;color:var(--text-muted);">提交时间：${sub.submit_time ? formatDate(sub.submit_time) : '-'}</div>
        </div>
        <div style="margin-bottom:14px;padding:12px;background:var(--bg);border-radius:8px;">
          <h4 style="font-size:0.85rem;margin:0 0 8px;">学生作答</h4>
          ${sub.submit_content ? `<pre style="font-size:0.82rem;white-space:pre-wrap;margin:0;">${escapeHtml(JSON.stringify(sub.submit_content, null, 2))}</pre>` : '<div class="empty-hint">未提交作答</div>'}
        </div>
        <div style="margin-bottom:14px;padding:12px;background:#F0FDF4;border-radius:8px;">
          <h4 style="font-size:0.85rem;margin:0 0 4px;">AI 评分</h4>
          <div style="font-size:1.3rem;font-weight:700;color:#10b981;">${sub.mark_record?.ai_score != null ? sub.mark_record.ai_score + '分' : '暂未批改'}</div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:6px;">教师评分</label>
          <input type="number" id="hw-mark-score" value="${sub.mark_record?.manual_score ?? sub.score ?? ''}" min="0" style="width:120px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
        </div>
        <div style="margin-bottom:14px;">
          <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:6px;">评语</label>
          <textarea id="hw-mark-comment" rows="2" placeholder="可选填写评语..." style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;resize:vertical;">${escapeHtml(sub.mark_record?.comment || '')}</textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
          <button type="button" class="btn" id="hw-mark-cancel" style="border:1px solid var(--border);">取消</button>
          <button type="button" class="btn btn-primary" id="hw-mark-save" data-sub-id="${submissionId}">保存批改</button>
        </div>
      `

      document.getElementById('hw-mark-cancel')?.addEventListener('click', () => { modal.style.display = 'none' })
      document.getElementById('hw-mark-save')?.addEventListener('click', async () => {
        const score = parseFloat(document.getElementById('hw-mark-score').value)
        const comment = document.getElementById('hw-mark-comment').value.trim()
        if (isNaN(score) || score < 0) { alert('请输入有效分数'); return }
        try {
          await manualMarkSubmission(submissionId, { score, comment: comment || undefined })
          modal.style.display = 'none'
          loadSubmissions(currentHomeworkId)
          loadScoreStat(currentHomeworkId)
        } catch (err) { alert(err.message) }
      })
    } catch (err) {
      content.innerHTML = `<div class="empty-hint">加载失败: ${err.message}</div>`
    }
  }

  document.getElementById('hw-mark-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('hw-mark-modal')) {
      document.getElementById('hw-mark-modal').style.display = 'none'
    }
  })

  // 初始化
  await loadCourses()
  await loadHomeworkList()
  await loadGradeSelect()
}
