// 教师端 - 学生管理页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getTeacherStudents, createTeacherStudent, getTeacherCourses, getTeachingClasses } from '../api/teacher.js'
import { iconSearch, iconRefresh, iconUser } from '../utils/icons.js'
import { initAllAutoResize } from '../utils/auto-resize.js'

export async function renderTeacherStudents(app) {
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

  const displayName = getUserDisplayName()

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
        <a href="#/teacher/courses" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回教学管理</a>
      </div>
      <div class="page-header">
        <h2 class="page-title">学生管理</h2>
        <p class="page-subtitle">查看和管理您的学生信息、学习进度与学情画像</p>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div class="filter-bar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="search-keyword" placeholder="搜索学生姓名或学号..." style="flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <input type="text" id="filter-course" placeholder="课程筛选..." style="width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <input type="text" id="filter-class" placeholder="班级筛选..." style="width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <button class="btn btn-primary" id="btn-search">${iconSearch()} 搜索</button>
          <button class="btn" id="btn-refresh" style="border:1px solid var(--border);">${iconRefresh()}</button>
          <button class="btn btn-primary" id="btn-add-student" style="margin-left:auto;">＋ 添加学生</button>
        </div>
      </div>

      <div id="student-list-container">
        <div class="empty-hint">正在加载学生数据...</div>
      </div>

      <div id="pagination" style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:20px;padding:16px 0;">
        <button class="btn" id="btn-prev-page" style="border:1px solid var(--border);padding:6px 16px;">上一页</button>
        <span id="page-info" style="font-size:0.9rem;color:var(--text-secondary);">第 1 页</span>
        <button class="btn" id="btn-next-page" style="border:1px solid var(--border);padding:6px 16px;">下一页</button>
      </div>
    </div>

    <!-- 添加学生弹窗 -->
    <div id="add-student-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin-bottom:20px;font-size:1.2rem;">➕ 手动添加学生</h3>
        <form id="add-student-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>登录用户名 <span class="required">*</span></label>
              <input type="text" id="as-username" required placeholder="student001">
            </div>
            <div class="form-group">
              <label>登录密码 <span class="required">*</span></label>
              <input type="password" id="as-password" required placeholder="初始密码">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>真实姓名 <span class="required">*</span></label>
              <input type="text" id="as-realname" required placeholder="张三">
            </div>
            <div class="form-group">
              <label>学号</label>
              <input type="text" id="as-studentno" placeholder="2403001">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>学院</label>
              <input type="text" id="as-college" placeholder="计算机与软件工程学院">
            </div>
            <div class="form-group">
              <label>专业</label>
              <input type="text" id="as-major" placeholder="软件工程">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>手机号</label>
              <input type="text" id="as-phone" placeholder="13800000000">
            </div>
            <div class="form-group">
              <label>性别</label>
              <select id="as-gender">
                <option value="">未设置</option>
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px;">
            <label style="font-weight:500;font-size:0.9rem;">自动加入班级（可选）</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px;">
              <div class="form-group">
                <label>选择课程</label>
                <select id="as-course">
                  <option value="">请选择课程</option>
                </select>
              </div>
              <div class="form-group">
                <label>选择教学班级</label>
                <select id="as-class">
                  <option value="">请先选择课程</option>
                </select>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="as-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">添加学生</button>
          </div>
        </form>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '学生管理',
    menuItems,
    contentHTML,
    user,
  })

  // ---- 加载学生 ----
  let currentStudents = []
  let currentPage = 1
  let totalPages = 1
  const pageSize = 20

  async function loadStudents(keyword = '', courseFilter = '', classFilter = '', page = 1) {
    const container = document.getElementById('student-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'

    try {
      const params = { page, page_size: pageSize }
      if (keyword) params.keyword = keyword
      if (courseFilter) params.course_name = courseFilter
      if (classFilter) params.class_name = classFilter

      const res = await getTeacherStudents(params)
      const data = res.data || res
      currentStudents = data.list || []
      currentPage = data.page || page
      totalPages = data.total_pages || Math.ceil((data.total || 0) / pageSize) || 1
      renderStudents(currentStudents)
      updatePagination()
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><div class="error-message">${err.message}</div><button class="btn-retry" onclick="location.reload()">重试</button></div>`
    }
  }

  function renderStudents(students) {
    const container = document.getElementById('student-list-container')
    if (!container) return

    if (!students || students.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="padding:60px 0;">暂无学生数据</div>'
      return
    }

    container.innerHTML = `
      <div class="card" style="overflow:hidden;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f8f9fa;border-bottom:2px solid var(--border);">
              <th style="padding:14px 16px;text-align:left;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">姓名</th>
              <th style="padding:14px 16px;text-align:left;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">学号</th>
              <th style="padding:14px 16px;text-align:left;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">学院</th>
              <th style="padding:14px 16px;text-align:center;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">专业</th>
              <th style="padding:14px 16px;text-align:center;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">已选课程</th>
            </tr>
          </thead>
          <tbody>
            ${students.map((s, index) => {
              const studentName = s.student_name || s.real_name || s.name || s.username || '(未命名)'
              const studentNo = s.student_no || '-'
              const college = s.college || '-'
              const major = s.major || '-'
              const courseCount = s.enrolled_course_count ?? s.course_count ?? 0
              return `
                <tr class="student-row" data-user-id="${s.student_user_id ?? s.user_id}" style="cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;">
                  <td style="padding:14px 16px;font-weight:500;color:var(--stu-dark);">${studentName}</td>
                  <td style="padding:14px 16px;color:var(--text-secondary);font-size:0.9rem;">${studentNo}</td>
                  <td style="padding:14px 16px;color:var(--text-secondary);font-size:0.9rem;">${college}</td>
                  <td style="padding:14px 16px;color:var(--text-secondary);font-size:0.9rem;text-align:center;">${major}</td>
                  <td style="padding:14px 16px;text-align:center;">
                    <span style="background:#e0f2fe;color:#0369a1;padding:2px 12px;border-radius:12px;font-size:0.8rem;font-weight:500;">${courseCount} 门</span>
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
    `

    // 行点击跳转
    container.querySelectorAll('.student-row').forEach(el => {
      el.addEventListener('click', (e) => {
        const userId = el.dataset.userId
        if (userId) {
          window.location.hash = `#/teacher/students/${userId}`
        }
      })
    })
  }

  function updatePagination() {
    const pageInfo = document.getElementById('page-info')
    const prevBtn = document.getElementById('btn-prev-page')
    const nextBtn = document.getElementById('btn-next-page')
    if (!pageInfo) return

    pageInfo.textContent = `第 ${currentPage} 页 / 共 ${totalPages} 页`
    if (prevBtn) prevBtn.disabled = currentPage <= 1
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages
  }

  function getFilters() {
    return {
      keyword: document.getElementById('search-keyword')?.value || '',
      course: document.getElementById('filter-course')?.value || '',
      class: document.getElementById('filter-class')?.value || '',
    }
  }

  // ---- 事件绑定 ----
  document.getElementById('btn-search')?.addEventListener('click', () => {
    const { keyword, course: courseFilter, class: classFilter } = getFilters()
    currentPage = 1
    loadStudents(keyword, courseFilter, classFilter, currentPage)
  })

  document.getElementById('search-keyword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const { keyword, course: courseFilter, class: classFilter } = getFilters()
      currentPage = 1
      loadStudents(keyword, courseFilter, classFilter, currentPage)
    }
  })

  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    const { keyword, course: courseFilter, class: classFilter } = getFilters()
    currentPage = 1
    loadStudents(keyword, courseFilter, classFilter, currentPage)
  })

  document.getElementById('btn-prev-page')?.addEventListener('click', () => {
    if (currentPage <= 1) return
    const { keyword, course: courseFilter, class: classFilter } = getFilters()
    loadStudents(keyword, courseFilter, classFilter, currentPage - 1)
  })

  document.getElementById('btn-next-page')?.addEventListener('click', () => {
    if (currentPage >= totalPages) return
    const { keyword, course: courseFilter, class: classFilter } = getFilters()
    loadStudents(keyword, courseFilter, classFilter, currentPage + 1)
  })

  // ========================
  // 添加学生弹窗
  // ========================
  const addModal = document.getElementById('add-student-modal')
  let courseList = []

  // 打开弹窗时加载课程列表
  document.getElementById('btn-add-student')?.addEventListener('click', async () => {
    addModal.style.display = 'flex'
    initAllAutoResize()

    // 加载课程下拉
    try {
      const res = await getTeacherCourses()
      courseList = res.data.list || []
      const select = document.getElementById('as-course')
      select.innerHTML = '<option value="">请选择课程</option>'
      courseList.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.course_id
        opt.textContent = c.course_name
        select.appendChild(opt)
      })
    } catch (err) {
      console.error('加载课程失败', err)
    }
  })

  // 课程切换 → 加载班级
  document.getElementById('as-course')?.addEventListener('change', async (e) => {
    const courseId = parseInt(e.target.value)
    const classSelect = document.getElementById('as-class')
    classSelect.innerHTML = '<option value="">加载中...</option>'
    if (!courseId) {
      classSelect.innerHTML = '<option value="">请先选择课程</option>'
      return
    }
    try {
      const res = await getTeachingClasses(courseId)
      const classes = res.data.list || []
      classSelect.innerHTML = '<option value="">不加入班级（仅创建账号）</option>'
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

  // 关闭弹窗
  document.getElementById('as-cancel')?.addEventListener('click', () => {
    addModal.style.display = 'none'
    document.getElementById('add-student-form').reset()
  })
  addModal?.addEventListener('click', (e) => {
    if (e.target === addModal) {
      addModal.style.display = 'none'
      document.getElementById('add-student-form').reset()
    }
  })

  // 提交表单
  document.getElementById('add-student-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const data = {
      username: document.getElementById('as-username').value.trim(),
      password: document.getElementById('as-password').value.trim(),
      real_name: document.getElementById('as-realname').value.trim(),
      student_no: document.getElementById('as-studentno').value.trim() || undefined,
      college: document.getElementById('as-college').value.trim() || undefined,
      major: document.getElementById('as-major').value.trim() || undefined,
      phone: document.getElementById('as-phone').value.trim() || undefined,
      gender: document.getElementById('as-gender').value || undefined,
      teaching_class_id: parseInt(document.getElementById('as-class').value) || undefined,
    }

    if (!data.username || !data.password || !data.real_name) {
      alert('请填写必填项（用户名、密码、真实姓名）')
      return
    }

    try {
      const res = await createTeacherStudent(data)
      alert(`✅ 学生「${res.data.real_name}」创建成功！` + (res.data.enrolled ? ' 已加入班级。' : ''))
      addModal.style.display = 'none'
      document.getElementById('add-student-form').reset()
      const { keyword, course: courseFilter, class: classFilter } = getFilters()
      loadStudents(keyword, courseFilter, classFilter, 1)
    } catch (err) {
      alert(err.message)
    }
  })

  // 初始化自适应文本域
  initAllAutoResize()

  loadStudents()
}

