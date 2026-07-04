// 教师端 - 课程列表页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getTeacherCourses, createTeacherCourse, updateTeacherCourse, deleteTeacherCourse } from '../api/teacher.js'
import { iconBook, iconSearch, iconRefresh } from '../utils/icons.js'
import { initAllAutoResize } from '../utils/auto-resize.js'

export async function renderTeacherCourses(app) {
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
    { label: '首页', icon: 'home', hash: '#/teacher/dashboard' },
    { label: '我的课程', icon: 'book', hash: '#/teacher/courses' },
    { label: '学生管理', icon: 'user', hash: '#/teacher/students' },
    { label: '作业测试', icon: 'alert', hash: '#/teacher/tasks' },
    { label: '题库管理', icon: 'star', hash: '#/teacher/questions' },
    { label: '知识库', icon: 'book', hash: '#/teacher/knowledge' },
    { label: '学情分析', icon: 'star', hash: '#/teacher/analytics' },
    { label: '个人中心', icon: 'user', hash: '#/teacher/profile' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title">📚 我的课程</h2>
        <p class="page-subtitle">管理您所教授的课程、教学班级与教学内容</p>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div class="filter-bar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="search-keyword" placeholder="搜索课程名称..." style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <button class="btn btn-primary" id="btn-search">${iconSearch()} 搜索</button>
          <button class="btn" id="btn-refresh" style="border:1px solid var(--border);">${iconRefresh()}</button>
          <button class="btn btn-primary" id="btn-create-course" style="margin-left:auto;">＋ 新建课程</button>
        </div>
      </div>

      <div id="course-list-container">
        <div class="empty-hint">正在加载课程数据...</div>
      </div>
    </div>

    <!-- 新建/编辑课程弹窗 -->
    <div class="modal-overlay" id="course-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:none;align-items:center;justify-content:center;">
      <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 id="modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建课程</h3>
        <form id="course-form">
          <div class="form-group" style="margin-bottom:14px;">
            <label>课程名称 <span class="required">*</span></label>
            <input type="text" id="form-course-name" required placeholder="例如：机器学习">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>课程编码 <span class="required">*</span></label>
            <input type="text" id="form-course-code" required placeholder="例如：ML001">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>学科分类</label>
            <input type="text" id="form-subject-category" placeholder="计算机大类学科">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>课程描述</label>
            <textarea id="form-description" class="auto-resize-ta" rows="3" placeholder="课程简介..."></textarea>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="btn-modal-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '课程管理',
    menuItems,
    contentHTML,
    user,
  })

  // ---- 加载课程 ----
  let currentCourses = []

  async function loadCourses(keyword = '') {
    const container = document.getElementById('course-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'

    try {
      const res = await getTeacherCourses({ keyword })
      currentCourses = res.data.list || []
      renderCourses(currentCourses)
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><div class="error-message">${err.message}</div><button class="btn-retry" onclick="location.reload()">重试</button></div>`
    }
  }

  function renderCourses(courses) {
    const container = document.getElementById('course-list-container')
    if (!container) return

    if (!courses || courses.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="padding:60px 0;">暂无课程，点击上方"新建课程"开始创建</div>'
      return
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">
        ${courses.map(c => `
          <div class="card course-card" data-id="${c.course_id}" style="cursor:pointer;padding:20px;transition:all 0.25s ease;border-left:4px solid var(--stu-primary);">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;">
              <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);">${c.course_name}</h3>
              <span style="background:${c.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${c.status === 'active' ? '#065f46' : '#92400e'};padding:2px 10px;border-radius:12px;font-size:0.75rem;">${c.status === 'active' ? '进行中' : '已归档'}</span>
            </div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">
              <div>编码：${c.course_code}</div>
              <div>分类：${c.subject_category || '-'}</div>
              ${c.description ? `<div style="margin-top:4px;color:var(--text-muted);">${c.description.substring(0, 80)}${c.description.length > 80 ? '...' : ''}</div>` : ''}
            </div>
            <div style="display:flex;gap:16px;font-size:0.8rem;color:var(--text-muted);padding-top:12px;border-top:1px solid var(--border);margin-top:8px;">
              <span>📚 ${c.teaching_class_count || 0} 个班级</span>
              <span>👨‍🎓 ${c.student_count || 0} 名学生</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button class="btn-edit-course" data-id="${c.course_id}" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:0.85rem;">编辑</button>
              <button class="btn-delete-course" data-id="${c.course_id}" style="flex:1;padding:6px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.85rem;">删除</button>
            </div>
          </div>
        `).join('')}
      </div>
    `

    // 点击卡片进入详情
    container.querySelectorAll('.course-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        const id = el.dataset.id
        window.location.hash = `#/teacher/courses/${id}`
      })
    })

    // 编辑
    container.querySelectorAll('.btn-edit-course').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = parseInt(btn.dataset.id)
        const course = currentCourses.find(c => c.course_id === id)
        if (course) openModal(course)
      })
    })

    // 删除
    container.querySelectorAll('.btn-delete-course').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = parseInt(btn.dataset.id)
        if (!confirm('确定删除该课程吗？此操作不可撤销。')) return
        try {
          await deleteTeacherCourse(id)
          loadCourses(document.getElementById('search-keyword')?.value || '')
        } catch (err) {
          alert(err.message)
        }
      })
    })
  }

  // ---- 弹窗 ----
  let editingCourseId = null

  function openModal(course = null) {
    const modal = document.getElementById('course-modal')
    modal.style.display = 'flex'
    document.getElementById('modal-title').textContent = course ? '编辑课程' : '新建课程'
    document.getElementById('form-course-name').value = course?.course_name || ''
    document.getElementById('form-course-code').value = course?.course_code || ''
    document.getElementById('form-subject-category').value = course?.subject_category || ''
    document.getElementById('form-description').value = course?.description || ''
    editingCourseId = course?.course_id || null
    if (!course) document.getElementById('form-course-code').readOnly = false
  }

  function closeModal() {
    const modal = document.getElementById('course-modal')
    modal.style.display = 'none'
    editingCourseId = null
  }

  document.addEventListener('click', (e) => {
    if (e.target.id === 'btn-create-course') openModal()
    if (e.target.id === 'btn-modal-cancel') closeModal()
    if (e.target.classList.contains('modal-overlay')) closeModal()
  })

  document.getElementById('course-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = {
      course_name: document.getElementById('form-course-name').value.trim(),
      course_code: document.getElementById('form-course-code').value.trim(),
      subject_category: document.getElementById('form-subject-category').value.trim() || '计算机大类学科',
      description: document.getElementById('form-description').value.trim(),
    }

    if (!data.course_name || !data.course_code) {
      alert('课程名称和编码为必填项')
      return
    }

    try {
      if (editingCourseId) {
        await updateTeacherCourse(editingCourseId, data)
      } else {
        await createTeacherCourse(data)
      }
      closeModal()
      loadCourses(document.getElementById('search-keyword')?.value || '')
    } catch (err) {
      alert(err.message)
    }
  })

  document.getElementById('btn-search')?.addEventListener('click', () => {
    const keyword = document.getElementById('search-keyword')?.value || ''
    loadCourses(keyword)
  })

  document.getElementById('search-keyword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const keyword = document.getElementById('search-keyword')?.value || ''
      loadCourses(keyword)
    }
  })

  document.getElementById('btn-refresh')?.addEventListener('click', () => loadCourses())

  initAllAutoResize()
  loadCourses()
}
