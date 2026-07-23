// 教师端 - 班级管理页
// 包含：班级列表 | 新增/编辑/删除 | 学生查看/添加/移除

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import {
  getAllTeachingClasses,
  getTeacherCourses, createTeachingClass, updateTeachingClass, deleteTeachingClass,
  getClassStudents, addClassStudents, removeClassStudent,
  getTeacherStudents,
} from '../api/teacher.js'
import { iconSearch, iconRefresh } from '../utils/icons.js'
import { initAllAutoResize } from '../utils/auto-resize.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { teacherCourseLabel } from '../utils/teacher-course.js'

export async function renderTeacherClasses(app) {
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

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title">班级管理</h2>
        <p class="page-subtitle">管理教学班级，维护学生与班级关系</p>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <div class="filter-bar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="search-keyword" placeholder="搜索班级名称..." style="flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <select id="filter-course" style="width:180px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
            <option value="">全部课程</option>
          </select>
          <button class="btn btn-primary" id="btn-search">${iconSearch()} 搜索</button>
          <button class="btn" id="btn-refresh" style="border:1px solid var(--border);">${iconRefresh()}</button>
          <button class="btn btn-primary" id="btn-create-class" style="margin-left:auto;">＋ 新建班级</button>
        </div>
      </div>

      <div id="class-list-container">
        <div class="empty-hint">正在加载班级数据...</div>
      </div>
    </div>

    <!-- 新建/编辑班级弹窗 -->
    <div id="class-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:500px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 id="class-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建班级</h3>
        <form id="class-form">
          <div class="form-group" style="margin-bottom:14px;">
            <label>所属课程 <span class="required">*</span></label>
            <select id="form-course-id" required style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
              <option value="">请选择课程</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>班级名称 <span class="required">*</span></label>
            <input type="text" id="form-class-name" required placeholder="例如：2024级计算机科学1班">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>学期</label>
              <input type="text" id="form-semester" placeholder="例如：2024-2025学年第一学期">
            </div>
            <div class="form-group">
              <label>班级人数上限</label>
              <input type="number" id="form-max-students" min="0" placeholder="不限">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>班级描述</label>
            <textarea id="form-class-desc" class="auto-resize-ta" rows="2" placeholder="可选描述..."></textarea>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="btn-modal-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 班级详情弹窗（查看学生 + 管理学生） -->
    <div id="class-detail-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:640px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">
          <div>
            <h3 id="cd-title" style="font-size:1.2rem;margin:0 0 4px;"></h3>
            <p id="cd-subtitle" style="color:var(--text-secondary);font-size:0.85rem;margin:0;"></p>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn" id="cd-add-student" style="border:1px solid var(--border);font-size:0.85rem;">＋ 添加学生</button>
            <button class="btn" id="cd-close" style="border:1px solid var(--border);font-size:0.85rem;">关闭</button>
          </div>
        </div>
        <div id="cd-student-list">
          <div class="empty-hint">加载中...</div>
        </div>
        <!-- 添加学生到班级 -->
        <div id="cd-add-form" style="display:none;margin-top:16px;padding:16px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
          <h4 style="font-size:0.95rem;margin:0 0 10px;">添加学生到本班级</h4>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="cd-add-search" placeholder="搜索学生姓名/学号..." style="flex:1;min-width:150px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            <select id="cd-add-select" style="min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
              <option value="">请先搜索选择学生</option>
            </select>
            <button class="btn btn-primary" id="cd-add-search-btn" style="font-size:0.85rem;">搜索</button>
            <button class="btn btn-primary" id="cd-add-confirm" disabled style="font-size:0.85rem;opacity:0.6;">确认添加</button>
          </div>
          <div id="cd-add-result" style="margin-top:8px;font-size:0.85rem;color:var(--text-muted);"></div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div id="delete-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:400px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);text-align:center;">
        <div style="font-size:3rem;margin-bottom:12px;">⚠️</div>
        <h3 style="font-size:1.1rem;margin-bottom:8px;">确认删除</h3>
        <p id="delete-text" style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:20px;"></p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn" id="del-cancel" style="border:1px solid var(--border);padding:8px 24px;">取消</button>
          <button class="btn" id="del-confirm" style="background:#dc2626;color:#fff;border:none;padding:8px 24px;border-radius:8px;cursor:pointer;">确认删除</button>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '班级管理',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // ---- 状态变量 ----
  let allCourses = []
  let currentClasses = []
  let editingClassId = null
  let deleteTargetId = null
  let currentDetailClassId = null
  let searchTimer = null

  // ---- 初始化 ----
  async function init() {
    try {
      const courseRes = await getTeacherCourses()
      allCourses = courseRes.data.list || []
      const select = document.getElementById('filter-course')
      allCourses.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.course_id
        opt.textContent = teacherCourseLabel(c)
        select.appendChild(opt)
      })
      // 班级表单中的课程下拉
      const formSelect = document.getElementById('form-course-id')
      allCourses.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.course_id
        opt.textContent = teacherCourseLabel(c)
        formSelect.appendChild(opt)
      })
    } catch (err) {
      console.error('加载课程失败', err)
    }
    loadClasses()
  }

  // ---- 加载班级 ----
  async function loadClasses() {
    const container = document.getElementById('class-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'

    try {
      const params = {}
      const keyword = document.getElementById('search-keyword')?.value
      const courseId = document.getElementById('filter-course')?.value
      if (keyword) params.keyword = keyword
      if (courseId) params.course_id = courseId

      const res = await getAllTeachingClasses(params)
      currentClasses = res.data.list || []
      renderClasses(currentClasses)
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><div class="error-message">${err.message}</div><button class="btn-retry" onclick="location.reload()">重试</button></div>`
    }
  }

  function renderClasses(classes) {
    const container = document.getElementById('class-list-container')
    if (!container) return

    if (!classes || classes.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="padding:60px 0;">暂无班级，点击上方"新建班级"开始创建</div>'
      return
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">
        ${classes.map(tc => `
          <div class="card" style="padding:20px;border-left:4px solid var(--stu-primary);">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
              <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">${escapeHtml(tc.teaching_class_name)}</h3>
              <span style="background:var(--bg);color:var(--text-secondary);padding:2px 10px;border-radius:12px;font-size:0.8rem;font-weight:500;border:1px solid var(--border);">
                ${tc.student_count || 0} 人
              </span>
            </div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:10px;">
              <div>${escapeHtml(tc.course_name || '未知课程')}</div>
              <div>${tc.semester || '未设置学期'}</div>
              ${tc.description ? `<div style="margin-top:4px;color:var(--text-muted);font-size:0.8rem;">${escapeHtml(tc.description.substring(0, 80))}${tc.description.length > 80 ? '...' : ''}</div>` : ''}
            </div>
            <div style="display:flex;gap:8px;padding-top:12px;border-top:1px solid var(--border);">
              <button class="btn-view-class" data-class-id="${tc.teaching_class_id}" style="flex:2;padding:7px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:0.85rem;">👥 查看学生</button>
              <button class="btn-edit-class" data-class-id="${tc.teaching_class_id}" style="flex:1;padding:7px;border:1px solid var(--border);border-radius:8px;background:#fff;cursor:pointer;font-size:0.85rem;">编辑</button>
              <button class="btn-del-class" data-class-id="${tc.teaching_class_id}" data-name="${tc.teaching_class_name}" style="flex:1;padding:7px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.85rem;">删除</button>
            </div>
          </div>
        `).join('')}
      </div>
    `

    // 查看学生
    container.querySelectorAll('.btn-view-class').forEach(btn => {
      btn.addEventListener('click', () => {
        const classId = parseInt(btn.dataset.classId, 10)
        openClassDetail(classId)
      })
    })

    // 编辑
    container.querySelectorAll('.btn-edit-class').forEach(btn => {
      btn.addEventListener('click', () => {
        const classId = parseInt(btn.dataset.classId, 10)
        const tc = currentClasses.find(c => c.teaching_class_id === classId)
        if (tc) openClassModal(tc)
      })
    })

    // 删除
    container.querySelectorAll('.btn-del-class').forEach(btn => {
      btn.addEventListener('click', () => {
        const classId = parseInt(btn.dataset.classId, 10)
        const name = btn.dataset.name
        openDeleteConfirm(classId, name)
      })
    })
  }

  // ========================
  // 班级 CRUD
  // ========================

  function openClassModal(cls = null) {
    const modal = document.getElementById('class-modal')
    modal.style.display = 'flex'
    editingClassId = cls?.teaching_class_id || null
    document.getElementById('class-modal-title').textContent = cls ? '编辑班级' : '新建班级'
    document.getElementById('form-course-id').value = cls?.course_id || ''
    document.getElementById('form-class-name').value = cls?.teaching_class_name || ''
    document.getElementById('form-semester').value = cls?.semester || ''
    document.getElementById('form-class-desc').value = cls?.description || ''
    initAllAutoResize()
  }

  document.getElementById('btn-create-class')?.addEventListener('click', () => openClassModal())
  document.getElementById('btn-modal-cancel')?.addEventListener('click', () => {
    document.getElementById('class-modal').style.display = 'none'
  })
  document.getElementById('class-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('class-modal')) {
      document.getElementById('class-modal').style.display = 'none'
    }
  })

  document.getElementById('class-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const courseId = parseInt(document.getElementById('form-course-id').value)
    const name = document.getElementById('form-class-name').value.trim()
    const semester = document.getElementById('form-semester').value.trim()
    const description = document.getElementById('form-class-desc').value.trim()

    if (!courseId || !name) {
      alert('请选择课程并填写班级名称')
      return
    }

    try {
      if (editingClassId) {
        await updateTeachingClass(editingClassId, {
          teaching_class_name: name,
          semester: semester || undefined,
          description: description || undefined,
        })
      } else {
        await createTeachingClass(courseId, {
          teaching_class_name: name,
          semester: semester || undefined,
          description: description || undefined,
        })
      }
      document.getElementById('class-modal').style.display = 'none'
      loadClasses()
    } catch (err) {
      alert(err.message || '操作失败')
    }
  })

  // ========================
  // 删除确认
  // ========================

  function openDeleteConfirm(classId, name) {
    deleteTargetId = classId
    document.getElementById('delete-text').textContent = `确定要删除班级「${name}」吗？该班级的学生关联关系将被移除。`
    document.getElementById('delete-modal').style.display = 'flex'
  }

  document.getElementById('del-cancel')?.addEventListener('click', () => {
    document.getElementById('delete-modal').style.display = 'none'
    deleteTargetId = null
  })
  document.getElementById('delete-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('delete-modal')) {
      document.getElementById('delete-modal').style.display = 'none'
      deleteTargetId = null
    }
  })

  document.getElementById('del-confirm')?.addEventListener('click', async () => {
    if (!deleteTargetId) return
    try {
      await deleteTeachingClass(deleteTargetId)
      document.getElementById('delete-modal').style.display = 'none'
      deleteTargetId = null
      loadClasses()
    } catch (err) {
      alert(err.message)
      document.getElementById('delete-modal').style.display = 'none'
      deleteTargetId = null
    }
  })

  // ========================
  // 班级详情 → 学生管理
  // ========================

  let detailClassInfo = null
  let detailStudents = []
  let availableStudents = []
  let selectedAddStudentId = null

  async function openClassDetail(classId) {
    const modal = document.getElementById('class-detail-modal')
    modal.style.display = 'flex'
    currentDetailClassId = classId
    document.getElementById('cd-add-form').style.display = 'none'

    const tc = currentClasses.find(c => c.teaching_class_id === classId)
    detailClassInfo = tc
    document.getElementById('cd-title').textContent = tc ? tc.teaching_class_name : '班级详情'
    document.getElementById('cd-subtitle').textContent = tc ? `${tc.course_name || '未知课程'} · ${tc.student_count || 0} 名学生` : ''

    await loadDetailStudents(classId)
  }

  async function loadDetailStudents(classId) {
    const container = document.getElementById('cd-student-list')
    container.innerHTML = '<div class="empty-hint">加载中...</div>'

    try {
      const res = await getClassStudents(classId)
      detailStudents = res.data.list || []
      renderDetailStudents(detailStudents)
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-message">${err.message}</div></div>`
    }
  }

  function renderDetailStudents(students) {
    const container = document.getElementById('cd-student-list')

    if (!students || students.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="padding:30px 0;">该班级暂无学生</div>'
      return
    }

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${students.map(s => {
          const name = s.student_name || '未知'
          const initial = name[0] || '?'
          return `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
            <div style="width:34px;height:34px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:600;flex-shrink:0;">
              ${initial}
            </div>
            <div style="flex:1;">
              <div style="font-weight:600;color:var(--stu-dark);">${escapeHtml(name)}</div>
              <div style="font-size:0.8rem;color:var(--text-muted);">学号：${escapeHtml(s.student_no || '-')} · ${escapeHtml(s.college || '')} ${escapeHtml(s.major || '')}</div>
            </div>
            <button class="cd-remove-student" data-student-id="${s.student_user_id}" style="padding:4px 10px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;">移除</button>
          </div>`
        }).join('')}
      </div>
    `

    container.querySelectorAll('.cd-remove-student').forEach(btn => {
      btn.addEventListener('click', async () => {
        const studentId = parseInt(btn.dataset.studentId)
        if (!confirm('确定将该学生从班级移除吗？')) return
        try {
          await removeClassStudent(currentDetailClassId, studentId)
          await loadDetailStudents(currentDetailClassId)
          // 刷新班级列表的人数
          loadClasses()
        } catch (err) {
          alert(err.message)
        }
      })
    })
  }

  // 关闭班级详情
  document.getElementById('cd-close')?.addEventListener('click', () => {
    document.getElementById('class-detail-modal').style.display = 'none'
  })
  document.getElementById('class-detail-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('class-detail-modal')) {
      document.getElementById('class-detail-modal').style.display = 'none'
    }
  })

  // 打开添加学生面板
  document.getElementById('cd-add-student')?.addEventListener('click', () => {
    const form = document.getElementById('cd-add-form')
    form.style.display = form.style.display === 'none' ? 'block' : 'none'
    document.getElementById('cd-add-search').value = ''
    document.getElementById('cd-add-select').innerHTML = '<option value="">请先搜索选择学生</option>'
    document.getElementById('cd-add-confirm').disabled = true
    document.getElementById('cd-add-confirm').style.opacity = '0.6'
    selectedAddStudentId = null
    availableStudents = []
  })

  // 搜索可添加的学生
  document.getElementById('cd-add-search-btn')?.addEventListener('click', async () => {
    const keyword = document.getElementById('cd-add-search').value.trim()
    if (!keyword) {
      alert('请输入搜索关键词')
      return
    }

    try {
      const res = await getTeacherStudents({ keyword, page_size: 50 })
      const allStudents = res.data.list || []
      // 过滤掉已在班级中的学生
      const existingIds = new Set(detailStudents.map(s => s.student_user_id))
      availableStudents = allStudents.filter(s => !existingIds.has(s.student_user_id ?? s.user_id))

      const select = document.getElementById('cd-add-select')
      if (availableStudents.length === 0) {
        select.innerHTML = '<option value="">未找到可添加的学生</option>'
        document.getElementById('cd-add-confirm').disabled = true
        document.getElementById('cd-add-confirm').style.opacity = '0.6'
      } else {
        select.innerHTML = '<option value="">请选择学生</option>'
        availableStudents.forEach(s => {
          const opt = document.createElement('option')
          opt.value = s.student_user_id ?? s.user_id
          opt.textContent = `${s.student_name || s.real_name || s.username} (${s.student_no || '无学号'})`
          select.appendChild(opt)
        })
      }
    } catch (err) {
      alert('搜索失败: ' + err.message)
    }
  })

  // 选择学生
  document.getElementById('cd-add-select')?.addEventListener('change', (e) => {
    selectedAddStudentId = parseInt(e.target.value) || null
    const confirmBtn = document.getElementById('cd-add-confirm')
    if (selectedAddStudentId) {
      confirmBtn.disabled = false
      confirmBtn.style.opacity = '1'
    } else {
      confirmBtn.disabled = true
      confirmBtn.style.opacity = '0.6'
    }
  })

  // 确认添加
  document.getElementById('cd-add-confirm')?.addEventListener('click', async () => {
    if (!selectedAddStudentId || !currentDetailClassId) return

    const btn = document.getElementById('cd-add-confirm')
    btn.disabled = true
    btn.textContent = '添加中...'

    try {
      await addClassStudents(currentDetailClassId, { student_user_ids: [selectedAddStudentId] })
      document.getElementById('cd-add-result').innerHTML = '<span style="color:#065f46;">✅ 添加成功</span>'
      document.getElementById('cd-add-form').style.display = 'none'
      await loadDetailStudents(currentDetailClassId)
      loadClasses()
    } catch (err) {
      document.getElementById('cd-add-result').innerHTML = `<span style="color:#dc2626;">❌ ${err.message}</span>`
    } finally {
      btn.disabled = false
      btn.textContent = '确认添加'
    }
  })

  // ========================
  // 搜索事件
  // ========================

  document.getElementById('btn-search')?.addEventListener('click', loadClasses)
  document.getElementById('search-keyword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadClasses()
  })
  document.getElementById('filter-course')?.addEventListener('change', loadClasses)
  document.getElementById('btn-refresh')?.addEventListener('click', loadClasses)

  initAllAutoResize()
  init()
}
