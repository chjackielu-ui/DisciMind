// 管理端 - 课程列表页
// 展示全部课程，支持搜索、筛选、分页、创建及归档

import { getMe } from '../api/auth.js'
import { getAdminCourses, createAdminCourse, deleteAdminCourse } from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { ADMIN_MENU_ITEMS } from '../utils/admin-menu.js'
import { confirmAdmin } from '../utils/admin-ui.js'
import { loadAdminAccess, hasAdminPermission } from '../utils/admin-access.js'

function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

function showToast(message, type = 'success') {
  let container = document.querySelector('.role-admin .toast-container')
  if (!container) {
    container = document.createElement('div')
    container.className = 'toast-container'
    const main = document.querySelector('.role-admin .student-main')
    if (main) main.appendChild(container)
    else document.body.appendChild(container)
  }

  const item = document.createElement('div')
  item.className = `toast-item toast-${type}`
  item.textContent = message
  container.appendChild(item)

  setTimeout(() => {
    item.style.opacity = '0'
    item.style.transform = 'translateX(20px)'
    item.style.transition = 'opacity 0.3s, transform 0.3s'
    setTimeout(() => item.remove(), 300)
  }, 3000)
}

export async function renderAdminCourses(app) {
  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  let canManage = false
  try {
    const access = await loadAdminAccess(user.user_id)
    canManage = hasAdminPermission(access, 'admin.teaching.manage')
  } catch {
    canManage = false
  }

  // ---- 状态 ----
  let currentPage = 1
  let totalPages = 1
  let totalCount = 0
  let keyword = ''
  let statusFilter = 'all'
  let courses = []
  let isLoading = false
  let error = null
  let showCreateModal = false

  // ---- 加载课程列表 ----
  async function loadCourses() {
    isLoading = true
    error = null
    render()

    try {
      const params = {
        page: currentPage,
        page_size: 12,
      }
      if (keyword) params.keyword = keyword
      if (statusFilter !== 'all') params.status = statusFilter

      const result = await getAdminCourses(params)
      const data = result.data || {}
      courses = data.courses || data.list || []
      totalCount = data.total || 0
      const pageSize = data.page_size || 12
      totalPages = Math.max(Math.ceil(totalCount / pageSize), 1)
      if (currentPage > totalPages) {
        currentPage = totalPages
      }
    } catch (err) {
      error = err.message || '加载课程列表失败'
      courses = []
    } finally {
      isLoading = false
      render()
    }
  }

  // ---- 渲染页面 ----
  function render() {
    const contentHTML = buildContentHTML()
    renderDashboardLayout(app, {
      menuItems: ADMIN_MENU_ITEMS,
      contentHTML,
      user,
    })
    bindEvents()
  }

  function buildContentHTML() {
    const searchBarHTML = `
      <div class="search-bar">
        <input
          type="text"
          id="search-keyword"
          placeholder="搜索课程名称或课程代码..."
          value="${escapeHtml(keyword)}"
        />
        <select id="status-filter">
          <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>启用</option>
          <option value="archived" ${statusFilter === 'archived' ? 'selected' : ''}>已归档</option>
        </select>
        <button class="btn-sm btn-secondary" id="btn-search">搜索</button>
        ${canManage ? '<button class="btn-sm btn-primary" id="btn-create-course" style="margin-left:auto;">创建课程</button>' : ''}
      </div>
    `

    // 加载状态
    if (isLoading) {
      return `
        <div class="section-header">
          <h2>课程管理</h2>
        </div>
        ${searchBarHTML}
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p>正在加载课程列表...</p>
        </div>
      `
    }

    // 错误状态
    if (error) {
      return `
        <div class="section-header">
          <h2>课程管理</h2>
        </div>
        ${searchBarHTML}
        <div class="empty-state">
          <div class="empty-icon"></div>
          <p>${escapeHtml(error)}</p>
          <button class="btn-sm btn-primary" id="btn-retry" style="margin-top:12px;">重新加载</button>
        </div>
      `
    }

    // 空状态
    if (courses.length === 0) {
      const emptyMsg = keyword || statusFilter !== 'all'
        ? '未找到符合条件的课程，请调整搜索条件'
        : '暂无课程数据，点击上方按钮创建课程'
      return `
        <div class="section-header">
          <h2>课程管理</h2>
          <span style="color:var(--stu-text-muted);font-size:0.85rem;">共 ${totalCount} 门课程</span>
        </div>
        ${searchBarHTML}
        <div class="empty-state">
          <div class="empty-icon" aria-hidden="true"></div>
          <p>${emptyMsg}</p>
          ${canManage && !(keyword || statusFilter !== 'all') ? '<button class="btn-sm btn-primary" id="btn-create-course-empty" style="margin-top:12px;">创建课程</button>' : ''}
        </div>
      `
    }

    // 课程卡片
    const cardsHTML = courses.map((course) => {
      const courseId = course.course_id || course.id
      const isArchived = course.status === 'archived'
      const statusTag = isArchived
        ? '<span class="tag tag-disabled">已归档</span>'
        : '<span class="tag tag-active">启用</span>'

      return `
        <div class="course-card-item" data-course-id="${courseId}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div style="flex:1;min-width:0;">
              <h4>${escapeHtml(course.course_name || '未命名课程')}</h4>
              <div class="course-meta">
                <span>课程代码：${escapeHtml(course.course_code || '-')}</span>
                <span>科目：${escapeHtml(course.subject_category || '-')}</span>
              </div>
              <div class="course-meta" style="margin-top:8px;">
                <span>教师：${course.teacher_count ?? 0} 人</span>
                <span>章节：${course.chapter_count ?? 0} 个</span>
                <span>学生：${course.student_count ?? 0} 人</span>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;margin-left:12px;">
              ${statusTag}
              ${canManage && !isArchived ? `<button class="btn-sm btn-danger btn-archive" data-course-id="${courseId}">归档</button>` : ''}
            </div>
          </div>
        </div>
      `
    }).join('')

    const courseGridHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;margin-top:4px;">
        ${cardsHTML}
      </div>
    `

    const paginationHTML = buildPagination()
    const modalHTML = showCreateModal ? buildCreateModal() : ''

    return `
      <div class="section-header">
        <h2>课程管理</h2>
        <span style="color:var(--stu-text-muted);font-size:0.85rem;">共 ${totalCount} 门课程</span>
      </div>
      ${searchBarHTML}
      ${courseGridHTML}
      ${paginationHTML}
      ${modalHTML}
    `
  }

  function buildPagination() {
    if (totalPages <= 1) return ''

    const pages = []
    // 显示有限页码：当前页前后各 2 页，首尾页
    const rangeStart = Math.max(1, currentPage - 2)
    const rangeEnd = Math.min(totalPages, currentPage + 2)

    if (rangeStart > 1) {
      pages.push('<button data-page="1">1</button>')
      if (rangeStart > 2) {
        pages.push('<span class="page-info">...</span>')
      }
    }
    for (let i = rangeStart; i <= rangeEnd; i++) {
      pages.push(
        `<button data-page="${i}" class="${i === currentPage ? 'active' : ''}">${i}</button>`
      )
    }
    if (rangeEnd < totalPages) {
      if (rangeEnd < totalPages - 1) {
        pages.push('<span class="page-info">...</span>')
      }
      pages.push(`<button data-page="${totalPages}">${totalPages}</button>`)
    }

    return `
      <div class="pagination">
        <button data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
        ${pages.join('')}
        <span class="page-info">共 ${totalCount} 条</span>
        <button data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
      </div>
    `
  }

  function buildCreateModal() {
    return `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="create-course-title">
          <h3 id="create-course-title">创建新课程</h3>
          <div class="form-group">
            <label for="field-course-name">课程名称 <span style="color:#DC2626;">*</span></label>
            <input type="text" id="field-course-name" placeholder="请输入课程名称" />
          </div>
          <div class="form-group">
            <label for="field-course-code">课程代码 <span style="color:#DC2626;">*</span></label>
            <input type="text" id="field-course-code" placeholder="例如：CS101" />
          </div>
          <div class="form-group">
            <label for="field-subject-category">科目分类 <span style="color:#DC2626;">*</span></label>
            <input type="text" id="field-subject-category" placeholder="例如：计算机科学" />
          </div>
          <div class="form-group">
            <label for="field-description">课程描述</label>
            <textarea id="field-description" placeholder="请输入课程描述（可选）"></textarea>
          </div>
          <div class="form-group">
            <label for="field-cover-url">封面图片 URL</label>
            <input type="text" id="field-cover-url" placeholder="请输入封面图片链接（可选）" />
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" id="btn-cancel-create">取消</button>
            <button class="btn-confirm" id="btn-confirm-create">确认创建</button>
          </div>
        </div>
      </div>
    `
  }

  // ---- 事件绑定 ----
  function bindEvents() {
    // 搜索
    const keywordInput = document.getElementById('search-keyword')
    const statusSelect = document.getElementById('status-filter')

    const doSearch = () => {
      keyword = (document.getElementById('search-keyword')?.value || '').trim()
      statusFilter = document.getElementById('status-filter')?.value || 'all'
      currentPage = 1
      loadCourses()
    }

    document.getElementById('btn-search')?.addEventListener('click', doSearch)
    keywordInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch()
    })
    statusSelect?.addEventListener('change', doSearch)

    // 创建课程按钮
    document.querySelectorAll('[id^="btn-create-course"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showCreateModal = true
        render()
      })
    })

    // 取消创建
    document.getElementById('btn-cancel-create')?.addEventListener('click', () => {
      showCreateModal = false
      render()
    })

    // 点击蒙层关闭
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        showCreateModal = false
        render()
      }
    })

    // 确认创建
    const confirmBtn = document.getElementById('btn-confirm-create')
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const courseName = document.getElementById('field-course-name')?.value.trim()
        const courseCode = document.getElementById('field-course-code')?.value.trim()
        const subjectCategory = document.getElementById('field-subject-category')?.value.trim()
        const description = document.getElementById('field-description')?.value.trim()
        const coverUrl = document.getElementById('field-cover-url')?.value.trim()

        if (!courseName) { showToast('请输入课程名称', 'error'); return }
        if (!courseCode) { showToast('请输入课程代码', 'error'); return }
        if (!subjectCategory) { showToast('请输入科目分类', 'error'); return }

        try {
          confirmBtn.disabled = true
          confirmBtn.textContent = '创建中...'
          await createAdminCourse({
            course_name: courseName,
            course_code: courseCode,
            subject_category: subjectCategory,
            description: description || undefined,
            cover_url: coverUrl || undefined,
          })
          showToast('课程创建成功', 'success')
          showCreateModal = false
          currentPage = 1
          await loadCourses()
        } catch (err) {
          showToast(err.message || '创建失败', 'error')
        } finally {
          confirmBtn.disabled = false
          confirmBtn.textContent = '确认创建'
        }
      })
    }

    // 归档按钮
    document.querySelectorAll('.btn-archive').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const courseId = btn.dataset.courseId
        if (!(await confirmAdmin({ title: '归档课程', message: '确定要归档该课程吗？归档后课程将不再显示在启用列表中。', confirmLabel: '归档', danger: true }))) return
        try {
          btn.disabled = true
          await deleteAdminCourse(courseId)
          showToast('课程已归档', 'success')
          await loadCourses()
        } catch (err) {
          showToast(err.message || '归档失败', 'error')
          btn.disabled = false
        }
      })
    })

    // 课程卡片点击进入详情
    document.querySelectorAll('.course-card-item').forEach((card) => {
      card.addEventListener('click', () => {
        const courseId = card.dataset.courseId
        window.location.hash = `#/admin/courses/${courseId}`
      })
    })

    // 分页点击
    document.querySelectorAll('.pagination button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page, 10)
        if (page >= 1 && page <= totalPages && page !== currentPage) {
          currentPage = page
          loadCourses()
        }
      })
    })

    // 重试按钮
    document.getElementById('btn-retry')?.addEventListener('click', loadCourses)
  }

  // ---- 启动 ----
  await loadCourses()
}
