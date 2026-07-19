// 教师端 - 学生管理页（完整功能版）
// 包含：学生列表 | 新增/编辑/删除 | 多字段搜索 | 批量导入 | 模板导出

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import {
  getTeacherStudents, createTeacherStudent, updateTeacherStudent, deleteTeacherStudent,
  getTeacherCourses, getTeachingClasses, batchImportStudents, downloadStudentTemplate,
} from '../api/teacher.js'
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

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title">学生管理</h2>
        <p class="page-subtitle">查看和管理您的学生信息，支持多字段搜索与批量导入</p>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div class="filter-bar" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="search-keyword" placeholder="搜索姓名/用户名..." style="width:150px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <input type="text" id="search-studentno" placeholder="学号..." style="width:120px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <input type="text" id="search-classname" placeholder="班级..." style="width:120px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <input type="text" id="search-grade" placeholder="年级..." style="width:90px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <button class="btn btn-primary" id="btn-search" style="white-space:nowrap;">${iconSearch()} 搜索</button>
          <button class="btn" id="btn-refresh" style="border:1px solid var(--border);padding:8px 12px;">${iconRefresh()}</button>
          <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;">
            <button class="btn" id="btn-export-template" style="border:1px solid var(--border);white-space:nowrap;">下载模板</button>
            <button class="btn" id="btn-batch-import" style="border:1px solid var(--border);white-space:nowrap;">批量导入</button>
            <button class="btn btn-primary" id="btn-add-student" style="white-space:nowrap;">＋ 添加学生</button>
          </div>
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
        <h3 id="add-modal-title" style="margin-bottom:20px;font-size:1.2rem;">添加学生</h3>
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
              <label>年级</label>
              <input type="text" id="as-grade" placeholder="2024">
            </div>
            <div class="form-group">
              <label>手机号</label>
              <input type="text" id="as-phone" placeholder="13800000000">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="as-email" placeholder="student@demo.com">
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
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 编辑学生弹窗 -->
    <div id="edit-student-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin-bottom:20px;font-size:1.2rem;">编辑学生</h3>
        <form id="edit-student-form">
          <input type="hidden" id="es-userid">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>登录用户名</label>
              <input type="text" id="es-username" readonly style="background:#f5f5f5;">
            </div>
            <div class="form-group">
              <label>新密码（留空不修改）</label>
              <input type="password" id="es-password" placeholder="留空则不修改密码">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>真实姓名 <span class="required">*</span></label>
              <input type="text" id="es-realname" required>
            </div>
            <div class="form-group">
              <label>学号</label>
              <input type="text" id="es-studentno">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>学院</label>
              <input type="text" id="es-college">
            </div>
            <div class="form-group">
              <label>专业</label>
              <input type="text" id="es-major">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>年级</label>
              <input type="text" id="es-grade">
            </div>
            <div class="form-group">
              <label>手机号</label>
              <input type="text" id="es-phone">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="es-email">
            </div>
            <div class="form-group">
              <label>性别</label>
              <select id="es-gender">
                <option value="">未设置</option>
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="es-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存修改</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 批量导入弹窗 -->
    <div id="batch-import-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:560px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin-bottom:12px;font-size:1.2rem;">批量导入学生</h3>
        <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:16px;">
          请先下载模板，按模板格式填写学生信息后上传 CSV 文件。
        </p>
        <div style="margin-bottom:16px;">
          <button class="btn" id="bi-download-template" style="border:1px solid var(--border);">下载模板</button>
        </div>
        <div style="border:2px dashed var(--border);border-radius:12px;padding:30px;text-align:center;background:var(--bg);margin-bottom:16px;" id="drop-zone">
          <div style="font-size:2rem;margin-bottom:8px;"></div>
          <p style="color:var(--text-secondary);margin-bottom:8px;">拖拽 CSV 文件到此处，或点击选择文件</p>
          <input type="file" id="bi-file-input" accept=".csv" style="display:none;">
          <button class="btn" id="bi-select-file" style="border:1px solid var(--border);">选择文件</button>
          <div id="bi-file-info" style="margin-top:10px;font-size:0.9rem;color:var(--text-muted);display:none;"></div>
        </div>
        <div id="bi-preview" style="display:none;margin-bottom:16px;">
          <h4 style="font-size:0.95rem;margin-bottom:8px;">预览数据</h4>
          <div id="bi-preview-table" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;"></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
          <button type="button" class="btn" id="bi-cancel" style="border:1px solid var(--border);">取消</button>
          <button type="button" class="btn btn-primary" id="bi-submit" disabled style="opacity:0.6;">导入（0 条）</button>
        </div>
        <div id="bi-result" style="display:none;margin-top:16px;padding:16px;border-radius:8px;"></div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div id="delete-confirm-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:400px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);text-align:center;">
        <div style="font-size:3rem;margin-bottom:12px;">⚠️</div>
        <h3 style="font-size:1.1rem;margin-bottom:8px;">确认删除</h3>
        <p id="delete-confirm-text" style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:20px;"></p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn" id="dc-cancel" style="border:1px solid var(--border);padding:8px 24px;">取消</button>
          <button class="btn" id="dc-confirm" style="background:#dc2626;color:#fff;border:none;padding:8px 24px;border-radius:8px;cursor:pointer;">确认删除</button>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '学生管理',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // ---- 状态变量 ----
  let currentStudents = []
  let currentPage = 1
  let totalPages = 1
  const pageSize = 20
  let deleteTargetId = null
  let importFileData = []

  // ---- 加载学生 ----
  async function loadStudents(filters = {}, page = 1) {
    const container = document.getElementById('student-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'

    try {
      const params = { page, page_size: pageSize }
      if (filters.keyword) params.keyword = filters.keyword
      if (filters.student_no) params.student_no = filters.student_no
      if (filters.class_name) params.class_name = filters.class_name
      if (filters.grade) params.grade = filters.grade

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
              <th style="padding:14px 16px;text-align:left;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">班级</th>
              <th style="padding:14px 16px;text-align:left;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">学院/专业</th>
              <th style="padding:14px 16px;text-align:center;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">学习画像</th>
              <th style="padding:14px 16px;text-align:center;font-size:0.85rem;color:var(--text-secondary);font-weight:600;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${students.map((s) => {
              const studentName = s.student_name || s.real_name || s.name || s.username || '(未命名)'
              const studentNo = s.student_no || '-'
              const college = s.college || '-'
              const major = s.major || '-'
              const grade = s.grade || ''
              const classes = (s.courses || []).map(c => c.class_name).filter(Boolean)
              const classNames = classes.length > 0 ? classes.join('、') : '-'
              const courseCount = s.enrolled_course_count ?? s.course_count ?? (s.courses || []).length
              const evaluation = s.evaluation || {}
              const comprehensiveScore = evaluation.comprehensive_score ?? s.metrics?.comprehensive_score ?? 0
              const riskLevel = evaluation.risk_level || s.metrics?.risk_level || 'normal'
              const riskLabel = evaluation.risk_label || ({ normal: '正常', attention: '需要关注', high: '高风险' }[riskLevel] || '正常')
              return `
                <tr class="student-row" data-user-id="${s.student_user_id ?? s.user_id}" style="cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;">
                  <td style="padding:14px 16px;font-weight:500;color:var(--stu-dark);">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <div style="width:32px;height:32px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:600;flex-shrink:0;">
                        ${(studentName !== '(未命名)' ? studentName[0] : '?')}
                      </div>
                      <span>${studentName}</span>
                    </div>
                  </td>
                  <td style="padding:14px 16px;color:var(--text-secondary);font-size:0.9rem;">${studentNo}</td>
                  <td style="padding:14px 16px;color:var(--text-secondary);font-size:0.9rem;">${classNames}</td>
                  <td style="padding:14px 16px;color:var(--text-secondary);font-size:0.9rem;">${college}${major && major !== '-' ? ' · ' + major : ''}${grade ? ' (' + grade + '级)' : ''}</td>
                  <td style="padding:14px 16px;text-align:center;">
                    <div class="tsp-list-evaluation">
                      <strong>${Math.round(Number(comprehensiveScore) || 0)} 分</strong>
                      <span class="tsp-risk-badge tsp-risk-${riskLevel}">${riskLabel}</span>
                      <small>${courseCount} 门课程</small>
                    </div>
                  </td>
                  <td style="padding:14px 16px;text-align:center;">
                    <div style="display:flex;gap:6px;justify-content:center;" onclick="event.stopPropagation();">
                      <button class="btn-edit-student" data-user-id="${s.student_user_id ?? s.user_id}" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:0.8rem;">编辑</button>
                      <button class="btn-del-student" data-user-id="${s.student_user_id ?? s.user_id}" data-name="${studentName}" style="padding:4px 10px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;">删除</button>
                    </div>
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
    `

    // 行点击跳转详情
    container.querySelectorAll('.student-row').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        const userId = el.dataset.userId
        if (userId) {
          window.location.hash = `#/teacher/students/${userId}`
        }
      })
    })

    // 编辑按钮
    container.querySelectorAll('.btn-edit-student').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const userId = parseInt(btn.dataset.userId)
        const student = currentStudents.find(s => (s.student_user_id ?? s.user_id) === userId)
        if (student) openEditModal(student)
      })
    })

    // 删除按钮
    container.querySelectorAll('.btn-del-student').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const userId = parseInt(btn.dataset.userId)
        const name = btn.dataset.name
        openDeleteConfirm(userId, name)
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
      student_no: document.getElementById('search-studentno')?.value || '',
      class_name: document.getElementById('search-classname')?.value || '',
      grade: document.getElementById('search-grade')?.value || '',
    }
  }

  function doSearch() {
    const filters = getFilters()
    currentPage = 1
    loadStudents(filters, 1)
  }

  // ---- 搜索事件 ----
  document.getElementById('btn-search')?.addEventListener('click', doSearch)

  ;['search-keyword', 'search-studentno', 'search-classname', 'search-grade'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch()
    })
  })

  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    doSearch()
  })

  document.getElementById('btn-prev-page')?.addEventListener('click', () => {
    if (currentPage <= 1) return
    const filters = getFilters()
    loadStudents(filters, currentPage - 1)
  })

  document.getElementById('btn-next-page')?.addEventListener('click', () => {
    if (currentPage >= totalPages) return
    const filters = getFilters()
    loadStudents(filters, currentPage + 1)
  })

  // ========================
  // 添加学生
  // ========================
  const addModal = document.getElementById('add-student-modal')
  let courseList = []

  document.getElementById('btn-add-student')?.addEventListener('click', async () => {
    addModal.style.display = 'flex'
    document.getElementById('add-student-form').reset()
    document.getElementById('as-password').value = ''
    initAllAutoResize()

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

  document.getElementById('as-cancel')?.addEventListener('click', () => {
    addModal.style.display = 'none'
  })
  addModal?.addEventListener('click', (e) => {
    if (e.target === addModal) addModal.style.display = 'none'
  })

  document.getElementById('add-student-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const data = {
      username: document.getElementById('as-username').value.trim(),
      password: document.getElementById('as-password').value.trim(),
      real_name: document.getElementById('as-realname').value.trim(),
      student_no: document.getElementById('as-studentno').value.trim() || undefined,
      college: document.getElementById('as-college').value.trim() || undefined,
      major: document.getElementById('as-major').value.trim() || undefined,
      grade: document.getElementById('as-grade').value.trim() || undefined,
      phone: document.getElementById('as-phone').value.trim() || undefined,
      email: document.getElementById('as-email').value.trim() || undefined,
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
      doSearch()
    } catch (err) {
      alert(err.message)
    }
  })

  // ========================
  // 编辑学生
  // ========================
  const editModal = document.getElementById('edit-student-modal')

  function openEditModal(student) {
    editModal.style.display = 'flex'
    document.getElementById('es-userid').value = student.student_user_id ?? student.user_id
    document.getElementById('es-username').value = student.username || ''
    document.getElementById('es-password').value = ''
    document.getElementById('es-realname').value = student.student_name || student.real_name || ''
    document.getElementById('es-studentno').value = student.student_no || ''
    document.getElementById('es-college').value = student.college || ''
    document.getElementById('es-major').value = student.major || ''
    document.getElementById('es-grade').value = student.grade || ''
    document.getElementById('es-phone').value = student.phone || ''
    document.getElementById('es-email').value = student.email || ''
    document.getElementById('es-gender').value = (student.gender || '').toLowerCase() || ''
  }

  document.getElementById('es-cancel')?.addEventListener('click', () => {
    editModal.style.display = 'none'
  })
  editModal?.addEventListener('click', (e) => {
    if (e.target === editModal) editModal.style.display = 'none'
  })

  document.getElementById('edit-student-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const userId = parseInt(document.getElementById('es-userid').value)
    const data = {
      real_name: document.getElementById('es-realname').value.trim(),
      student_no: document.getElementById('es-studentno').value.trim() || undefined,
      college: document.getElementById('es-college').value.trim() || undefined,
      major: document.getElementById('es-major').value.trim() || undefined,
      grade: document.getElementById('es-grade').value.trim() || undefined,
      phone: document.getElementById('es-phone').value.trim() || undefined,
      email: document.getElementById('es-email').value.trim() || undefined,
      gender: document.getElementById('es-gender').value || undefined,
    }

    if (!data.real_name) {
      alert('真实姓名不能为空')
      return
    }

    try {
      await updateTeacherStudent(userId, data)
      alert('✅ 学生信息更新成功')
      editModal.style.display = 'none'
      doSearch()
    } catch (err) {
      alert(err.message)
    }
  })

  // ========================
  // 删除学生
  // ========================
  const deleteModal = document.getElementById('delete-confirm-modal')

  function openDeleteConfirm(userId, name) {
    deleteTargetId = userId
    document.getElementById('delete-confirm-text').textContent = `确定要删除学生「${name}」吗？此操作不可撤销，该学生的所有关联数据将被永久删除。`
    deleteModal.style.display = 'flex'
  }

  document.getElementById('dc-cancel')?.addEventListener('click', () => {
    deleteModal.style.display = 'none'
    deleteTargetId = null
  })
  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) {
      deleteModal.style.display = 'none'
      deleteTargetId = null
    }
  })

  document.getElementById('dc-confirm')?.addEventListener('click', async () => {
    if (!deleteTargetId) return
    try {
      await deleteTeacherStudent(deleteTargetId)
      alert('✅ 学生已删除')
      deleteModal.style.display = 'none'
      deleteTargetId = null
      doSearch()
    } catch (err) {
      alert(err.message)
      deleteModal.style.display = 'none'
      deleteTargetId = null
    }
  })

  // ========================
  // 批量导入
  // ========================
  const importModal = document.getElementById('batch-import-modal')
  const fileInput = document.getElementById('bi-file-input')
  const dropZone = document.getElementById('drop-zone')
  const fileInfo = document.getElementById('bi-file-info')
  const previewTable = document.getElementById('bi-preview-table')
  const previewSection = document.getElementById('bi-preview')
  const submitBtn = document.getElementById('bi-submit')
  const resultDiv = document.getElementById('bi-result')

  // 下载模板
  async function downloadTemplate() {
    try {
      // 前端生成CSV模板
      const headers = ['username', 'real_name', 'password', 'student_no', 'college', 'major', 'grade', 'gender', 'phone', 'email', 'class_name', 'course_name']
      const example = ['stu001', '张三', '123456', '2024001', '计算机与软件工程学院', '软件工程', '2024', 'male', '13800000001', 'stu001@demo.com', '软件2403班', '机器学习']
      const BOM = '﻿'
      let csv = BOM + headers.join(',') + '\n'
      csv += example.join(',') + '\n'

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'student_import_template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('下载模板失败: ' + err.message)
    }
  }

  document.getElementById('btn-export-template')?.addEventListener('click', downloadTemplate)
  document.getElementById('bi-download-template')?.addEventListener('click', downloadTemplate)

  // 打开导入弹窗
  document.getElementById('btn-batch-import')?.addEventListener('click', () => {
    importModal.style.display = 'flex'
    importFileData = []
    fileInput.value = ''
    fileInfo.style.display = 'none'
    previewSection.style.display = 'none'
    resultDiv.style.display = 'none'
    submitBtn.disabled = true
    submitBtn.textContent = '导入（0 条）'
    submitBtn.style.opacity = '0.6'
  })

  document.getElementById('bi-cancel')?.addEventListener('click', () => {
    importModal.style.display = 'none'
  })
  importModal?.addEventListener('click', (e) => {
    if (e.target === importModal) importModal.style.display = 'none'
  })

  // 选择文件
  document.getElementById('bi-select-file')?.addEventListener('click', () => fileInput.click())
  dropZone?.addEventListener('click', () => fileInput.click())

  // 拖拽上传
  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--primary)'
    dropZone.style.background = 'rgba(99,102,241,0.05)'
  })
  dropZone?.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border)'
    dropZone.style.background = 'var(--bg)'
  })
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--border)'
    dropZone.style.background = 'var(--bg)'
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files
      handleFile(e.dataTransfer.files[0])
    }
  })

  fileInput?.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0])
  })

  function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
      alert('请上传 CSV 文件')
      return
    }

    fileInfo.style.display = 'block'
    fileInfo.textContent = `已选择: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      parseCSV(text)
    }
    reader.readAsText(file)
  }

  function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim())
    if (lines.length < 2) {
      alert('CSV 文件至少需要包含表头和一行数据')
      return
    }

    // 解析表头（移除 BOM）
    const headers = lines[0].replace(/^﻿/, '').split(',').map(h => h.trim().toLowerCase())
    const requiredFields = ['username', 'real_name']
    const missingFields = requiredFields.filter(f => !headers.includes(f))
    if (missingFields.length > 0) {
      alert(`模板缺少必要字段: ${missingFields.join(', ')}`)
      return
    }

    const data = []
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim())
      const row = {}
      headers.forEach((h, idx) => { row[h] = values[idx] || '' })
      if (row.username || row.real_name) {
        data.push(row)
      }
    }

    if (data.length === 0) {
      alert('没有有效的学生数据')
      return
    }

    importFileData = data
    previewSection.style.display = 'block'
    submitBtn.disabled = false
    submitBtn.textContent = `导入（${data.length} 条）`
    submitBtn.style.opacity = '1'

    // 渲染预览表
    const displayHeaders = ['用户名', '姓名', '学号', '学院', '专业', '班级']
    let html = `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
      <thead><tr style="background:#f8f9fa;">`
    displayHeaders.forEach(h => {
      html += `<th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600;">${h}</th>`
    })
    html += '</tr></thead><tbody>'
    data.slice(0, 20).forEach(row => {
      html += `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border);">${escapeHtml(row.username || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border);">${escapeHtml(row.real_name || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border);">${escapeHtml(row.student_no || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border);">${escapeHtml(row.college || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border);">${escapeHtml(row.major || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border);">${escapeHtml(row.class_name || '')}</td>
      </tr>`
    })
    if (data.length > 20) {
      html += `<tr><td colspan="6" style="padding:8px;text-align:center;color:var(--text-muted);">... 还有 ${data.length - 20} 条</td></tr>`
    }
    html += '</tbody></table>'
    previewTable.innerHTML = html
  }

  submitBtn?.addEventListener('click', async () => {
    if (importFileData.length === 0) return

    submitBtn.disabled = true
    submitBtn.textContent = '导入中...'
    submitBtn.style.opacity = '0.6'
    resultDiv.style.display = 'none'

    try {
      const res = await batchImportStudents({ students: importFileData })
      const result = res.data || res

      let html = ''
      if (result.fail_count === 0) {
        html = `<div style="color:#065f46;background:#d1fae5;padding:12px 16px;border-radius:8px;font-weight:500;">
          ✅ 批量导入完成！成功 ${result.success_count} 条${result.fail_count > 0 ? `，失败 ${result.fail_count} 条` : ''}
        </div>`
      } else {
        html = `<div style="color:#92400e;background:#fef3c7;padding:12px 16px;border-radius:8px;font-weight:500;margin-bottom:10px;">
          ⚠️ 导入完成：成功 ${result.success_count} 条，失败 ${result.fail_count} 条
        </div>`
        html += '<div style="max-height:200px;overflow-y:auto;font-size:0.85rem;">'
        html += '<table style="width:100%;border-collapse:collapse;"><tr style="background:#f8f9fa;"><th style="padding:6px 8px;border:1px solid var(--border);">行号</th><th style="padding:6px 8px;border:1px solid var(--border);">用户名</th><th style="padding:6px 8px;border:1px solid var(--border);">姓名</th><th style="padding:6px 8px;border:1px solid var(--border);">结果</th><th style="padding:6px 8px;border:1px solid var(--border);">原因</th></tr>'
        ;(result.results || []).forEach(r => {
          const isSuccess = r.success
          html += `<tr style="color:${isSuccess ? '#065f46' : '#dc2626'};">
            <td style="padding:6px 8px;border:1px solid var(--border);">${r.row}</td>
            <td style="padding:6px 8px;border:1px solid var(--border);">${escapeHtml(r.username)}</td>
            <td style="padding:6px 8px;border:1px solid var(--border);">${escapeHtml(r.real_name)}</td>
            <td style="padding:6px 8px;border:1px solid var(--border);">${isSuccess ? '✅ 成功' : '❌ 失败'}</td>
            <td style="padding:6px 8px;border:1px solid var(--border);">${isSuccess ? '-' : (r.reason || '未知错误')}</td>
          </tr>`
        })
        html += '</table></div>'
      }

      resultDiv.innerHTML = html
      resultDiv.style.display = 'block'

      // 成功后刷新列表
      if (result.success_count > 0) {
        setTimeout(() => {
          importModal.style.display = 'none'
          doSearch()
        }, 2000)
      }
    } catch (err) {
      resultDiv.innerHTML = `<div style="color:#dc2626;background:#fef2f2;padding:12px 16px;border-radius:8px;">❌ 导入失败: ${err.message}</div>`
      resultDiv.style.display = 'block'
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = `导入（${importFileData.length} 条）`
      submitBtn.style.opacity = '1'
    }
  })

  // ---- 工具 ----
  function escapeHtml(str) {
    if (!str) return ''
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  // 初始化自适应文本域
  initAllAutoResize()

  loadStudents({}, 1)
}
