// 教师端 - 题目创建/编辑页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { createTeacherQuestion, getTeacherQuestion, updateTeacherQuestion, getTeacherCourses } from '../api/teacher.js'
import { initAllAutoResize } from '../utils/auto-resize.js'

export async function renderTeacherQuestionCreate(app, params) {
  let user = getUser()
  const questionId = params?.question_id ? parseInt(params.question_id) : null
  const isEdit = !!questionId

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
        <h2 class="page-title">${isEdit ? '编辑题目' : '新建题目'}</h2>
        <p class="page-subtitle">${isEdit ? '修改题目内容与设置' : '为课程添加新的练习题目'}</p>
      </div>

      <div class="card">
        <form id="question-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="form-group">
              <label>所属课程 <span class="required">*</span></label>
              <select id="form-course" required>
                <option value="">请选择课程</option>
              </select>
            </div>
            <div class="form-group">
              <label>题型 <span class="required">*</span></label>
              <select id="form-type" required>
                <option value="single_choice">单选题</option>
                <option value="multiple_choice">多选题</option>
                <option value="true_false">判断题</option>
                <option value="fill_blank">填空题</option>
                <option value="short_answer">简答题</option>
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>题目 <span class="required">*</span></label>
            <input type="text" id="form-title" required placeholder="输入题目内容">
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>题目详情（可选）</label>
            <textarea id="form-content" class="auto-resize-ta" rows="3" placeholder="补充说明或详细题干"></textarea>
          </div>

          <div id="options-section" style="margin-bottom:16px;">
            <label style="display:block;margin-bottom:8px;font-weight:500;">选项</label>
            <div id="options-container"></div>
            <button type="button" id="btn-add-option" style="margin-top:8px;padding:6px 14px;border:1px dashed var(--border);border-radius:8px;background:transparent;cursor:pointer;font-size:0.85rem;">＋ 添加选项</button>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>正确答案 <span class="required">*</span></label>
            <input type="text" id="form-answer" required placeholder="例如：A">
            <span style="font-size:0.8rem;color:var(--text-muted);">单选题填选项字母(A/B/C/D)，多选题用逗号分隔(A,B,C)，判断题填true/false</span>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>题目解析</label>
            <textarea id="form-analysis" class="auto-resize-ta" rows="3" placeholder="题目的详细解析和知识点说明"></textarea>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="form-group">
              <label>难度</label>
              <select id="form-difficulty">
                <option value="basic">基础</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
              </select>
            </div>
            <div class="form-group">
              <label>分值</label>
              <input type="number" id="form-score" value="5" min="1" max="100">
            </div>
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
            <button type="button" class="btn" id="btn-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">${isEdit ? '保存修改' : '创建题目'}</button>
          </div>
        </form>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: isEdit ? '编辑题目' : '新建题目',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // 加载课程列表
  let courseList = []
  try {
    const res = await getTeacherCourses()
    courseList = res.data.list || []
    const select = document.getElementById('form-course')
    courseList.forEach(c => {
      const opt = document.createElement('option')
      opt.value = c.course_id
      opt.textContent = c.course_name
      select.appendChild(opt)
    })
  } catch (err) {
    console.error('加载课程失败', err)
  }

  // 如果是编辑，加载题目数据
  let questionData = null
  if (isEdit) {
    try {
      const res = await getTeacherQuestion(questionId)
      questionData = res.data
      fillForm(questionData)
    } catch (err) {
      alert('加载题目失败: ' + err.message)
      window.location.hash = '#/teacher/questions'
      return
    }
  }

  // 默认添加4个选项
  if (!isEdit) {
    for (let i = 0; i < 4; i++) addOptionField(String.fromCharCode(65 + i))
  }

  function fillForm(data) {
    document.getElementById('form-course').value = data.course_id || ''
    document.getElementById('form-type').value = data.question_type || 'single_choice'
    document.getElementById('form-title').value = data.title || ''
    document.getElementById('form-content').value = data.content || ''
    document.getElementById('form-answer').value = data.correct_answer || ''
    document.getElementById('form-analysis').value = data.analysis || ''
    document.getElementById('form-difficulty').value = data.difficulty_level || 'basic'
    document.getElementById('form-score').value = data.score || 5

    // 选项
    const container = document.getElementById('options-container')
    container.innerHTML = ''
    if (data.options && data.options.length > 0) {
      data.options.forEach(opt => addOptionField(opt.option_key, opt.option_content))
    }
  }

  function addOptionField(key = '', value = '') {
    const container = document.getElementById('options-container')
    if (!container) return
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const k = key || letters[container.children.length]
    const div = document.createElement('div')
    div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;'
    div.innerHTML = `
      <span style="font-weight:600;width:24px;font-size:0.9rem;">${k}</span>
      <input type="text" class="option-input" data-key="${k}" value="${value}" placeholder="选项 ${k} 内容" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;">
      <button type="button" class="btn-del-option" style="padding:4px 8px;border:none;background:none;color:#dc2626;cursor:pointer;font-size:1.1rem;">×</button>
    `
    container.appendChild(div)

    div.querySelector('.btn-del-option').addEventListener('click', () => {
      if (container.children.length <= 1) return
      div.remove()
    })
  }

  document.getElementById('btn-add-option')?.addEventListener('click', () => {
    addOptionField()
  })

  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    window.location.hash = '#/teacher/questions'
  })

  document.getElementById('question-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const type = document.getElementById('form-type').value
    const options = []
    document.querySelectorAll('.option-input').forEach(input => {
      options.push({
        option_key: input.dataset.key,
        option_content: input.value,
      })
    })

    const data = {
      course_id: parseInt(document.getElementById('form-course').value),
      question_type: type,
      title: document.getElementById('form-title').value.trim(),
      content: document.getElementById('form-content').value.trim() || document.getElementById('form-title').value.trim(),
      correct_answer: document.getElementById('form-answer').value.trim(),
      analysis: document.getElementById('form-analysis').value.trim(),
      difficulty_level: document.getElementById('form-difficulty').value,
      score: parseInt(document.getElementById('form-score').value) || 5,
    }

    if (type === 'single_choice' || type === 'multiple_choice' || type === 'true_false') {
      data.options = options.filter(o => o.option_content.trim())
    }

    if (!data.course_id || !data.title || !data.correct_answer) {
      alert('请填写必填项')
      return
    }

    try {
      if (isEdit) {
        await updateTeacherQuestion(questionId, data)
      } else {
        await createTeacherQuestion(data)
      }
      window.location.hash = '#/teacher/questions'
    } catch (err) {
      alert(err.message)
    }
  })

  initAllAutoResize()
}



