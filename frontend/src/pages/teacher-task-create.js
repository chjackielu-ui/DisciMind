// 教师端 - 任务创建/编辑页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { createTeacherTask, getTeacherTask, updateTeacherTask, getTeacherCourses, getTeachingClasses, getTeacherQuestions } from '../api/teacher.js'
import { initAllAutoResize } from '../utils/auto-resize.js'

export async function renderTeacherTaskCreate(app, params) {
  let user = getUser()
  const taskId = params?.task_id ? parseInt(params.task_id) : null
  const isEdit = !!taskId

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
        <a href="#/teacher/tasks" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回任务列表</a>
      </div>
      <div class="page-header">
        <h2 class="page-title">${isEdit ? '✏️ 编辑任务' : '📝 新建任务'}</h2>
        <p class="page-subtitle">${isEdit ? '修改作业、测试或学习任务' : '发布新的作业、测试或学习任务'}</p>
      </div>

      <div class="card">
        <form id="task-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="form-group">
              <label>所属课程 <span class="required">*</span></label>
              <select id="form-course" required>
                <option value="">请选择课程</option>
              </select>
            </div>
            <div class="form-group">
              <label>教学班级 <span class="required">*</span></label>
              <select id="form-class" required>
                <option value="">请先选择课程</option>
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="form-group">
              <label>任务类型 <span class="required">*</span></label>
              <select id="form-type" required>
                <option value="homework">作业</option>
                <option value="quiz">测试</option>
                <option value="study_task">学习任务</option>
                <option value="review_plan">复习计划</option>
              </select>
            </div>
            <div class="form-group">
              <label>状态</label>
              <select id="form-status">
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>任务标题 <span class="required">*</span></label>
            <input type="text" id="form-title" required placeholder="例如：PCA 基础练习">
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>任务描述</label>
            <textarea id="form-description" class="auto-resize-ta" rows="3" placeholder="任务说明、要求等"></textarea>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="form-group">
              <label>开始时间</label>
              <input type="datetime-local" id="form-start">
            </div>
            <div class="form-group">
              <label>截止时间</label>
              <input type="datetime-local" id="form-deadline">
            </div>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>
              <input type="checkbox" id="form-late"> 允许补交
            </label>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>选择题目</label>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
              <select id="question-filter-course" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;">
                <option value="">按课程筛选题目</option>
              </select>
              <button type="button" id="btn-load-questions" class="btn" style="border:1px solid var(--border);font-size:0.85rem;">加载题目</button>
            </div>
            <div id="question-select-area" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:12px;">
              <div class="empty-hint" style="font-size:0.85rem;">请先选择课程并点击"加载题目"</div>
            </div>
            <div style="margin-top:8px;font-size:0.85rem;color:var(--text-muted);">
              已选 <span id="selected-count">0</span> 题
            </div>
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
            <button type="button" class="btn" id="btn-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">${isEdit ? '保存修改' : '创建任务'}</button>
          </div>
        </form>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: isEdit ? '编辑任务' : '新建任务',
    menuItems,
    contentHTML,
    user,
  })

  let courseList = []
  let questionList = []
  let selectedQuestionIds = new Set()

  // 加载课程
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

    // 也填充题目筛选课程下拉
    const filterSelect = document.getElementById('question-filter-course')
    courseList.forEach(c => {
      const opt = document.createElement('option')
      opt.value = c.course_id
      opt.textContent = c.course_name
      filterSelect.appendChild(opt)
    })
  } catch (err) {
    console.error('加载课程失败', err)
  }

  // 课程变化时加载班级
  document.getElementById('form-course')?.addEventListener('change', async (e) => {
    const courseId = parseInt(e.target.value)
    const classSelect = document.getElementById('form-class')
    classSelect.innerHTML = '<option value="">加载中...</option>'
    if (!courseId) {
      classSelect.innerHTML = '<option value="">请先选择课程</option>'
      return
    }
    try {
      const res = await getTeachingClasses(courseId)
      const classes = res.data.list || []
      classSelect.innerHTML = '<option value="">请选择教学班级</option>'
      classes.forEach(tc => {
        const opt = document.createElement('option')
        opt.value = tc.teaching_class_id
        opt.textContent = tc.teaching_class_name
        classSelect.appendChild(opt)
      })
    } catch (err) {
      classSelect.innerHTML = '<option value="">加载失败</option>'
    }
  })

  // 加载题目
  document.getElementById('btn-load-questions')?.addEventListener('click', async () => {
    const courseId = parseInt(document.getElementById('question-filter-course').value)
    if (!courseId) {
      alert('请先选择课程')
      return
    }
    try {
      const res = await getTeacherQuestions({ course_id: courseId, page_size: 200 })
      questionList = res.data.list || []
      renderQuestionCheckboxes()
    } catch (err) {
      alert(err.message)
    }
  })

  function renderQuestionCheckboxes() {
    const area = document.getElementById('question-select-area')
    if (!area) return

    if (questionList.length === 0) {
      area.innerHTML = '<div class="empty-hint" style="font-size:0.85rem;">该课程暂无题目</div>'
      return
    }

    const typeLabels = { single_choice: '单选', multiple_choice: '多选', true_false: '判断', fill_blank: '填空', short_answer: '简答' }

    area.innerHTML = questionList.map(q => `
      <label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <input type="checkbox" class="question-checkbox" value="${q.question_id}" ${selectedQuestionIds.has(q.question_id) ? 'checked' : ''}>
        <span style="flex:1;font-size:0.85rem;">${q.title}</span>
        <span style="font-size:0.75rem;color:var(--text-muted);">${typeLabels[q.question_type] || q.question_type} | ${q.score}分</span>
      </label>
    `).join('')

    area.querySelectorAll('.question-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const qid = parseInt(cb.value)
        if (cb.checked) selectedQuestionIds.add(qid)
        else selectedQuestionIds.delete(qid)
        document.getElementById('selected-count').textContent = selectedQuestionIds.size
      })
    })
  }

  // 如果是编辑，加载任务数据
  if (isEdit) {
    try {
      const res = await getTeacherTask(taskId)
      const data = res.data
      document.getElementById('form-course').value = data.course_id || ''
      document.getElementById('form-type').value = data.task_type || 'homework'
      document.getElementById('form-title').value = data.title || ''
      document.getElementById('form-description').value = data.description || ''
      document.getElementById('form-status').value = data.status || 'draft'
      document.getElementById('form-late').checked = data.allow_late_submit || false

      if (data.start_time) document.getElementById('form-start').value = data.start_time.substring(0, 16)
      if (data.deadline) document.getElementById('form-deadline').value = data.deadline.substring(0, 16)

      // 触发课程变更加载班级
      const event = new Event('change')
      document.getElementById('form-course').dispatchEvent(event)

      // 选中已有题目
      if (data.questions) {
        data.questions.forEach(q => selectedQuestionIds.add(q.question_id))
      }
    } catch (err) {
      alert('加载任务失败: ' + err.message)
      window.location.hash = '#/teacher/tasks'
      return
    }
  }

  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    window.location.hash = '#/teacher/tasks'
  })

  document.getElementById('task-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const data = {
      course_id: parseInt(document.getElementById('form-course').value),
      teaching_class_id: parseInt(document.getElementById('form-class').value),
      task_type: document.getElementById('form-type').value,
      title: document.getElementById('form-title').value.trim(),
      description: document.getElementById('form-description').value.trim(),
      status: document.getElementById('form-status').value,
      allow_late_submit: document.getElementById('form-late').checked,
      question_ids: [...selectedQuestionIds],
      start_time: document.getElementById('form-start').value || null,
      deadline: document.getElementById('form-deadline').value || null,
    }

    if (!data.course_id || !data.teaching_class_id || !data.title) {
      alert('请填写必填项（课程、班级、标题）')
      return
    }

    try {
      if (isEdit) {
        await updateTeacherTask(taskId, data)
      } else {
        await createTeacherTask(data)
      }
      window.location.hash = '#/teacher/tasks'
    } catch (err) {
      alert(err.message)
    }
  })

  initAllAutoResize()
}

