// 管理端 — 行政班级管理页面
// 支持搜索、筛选、分页、新建/编辑/删除班级

import { getMe } from '../api/auth.js'
import { getAdminClasses, createAdminClass, updateAdminClass, deleteAdminClass } from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { ADMIN_MENU_ITEMS } from '../utils/admin-menu.js'

export async function renderAdminClasses(app) {
  // ---- 认证检查 ----
  let user = getUser()
  try {
    const meResult = await getMe()
    user = meResult.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  // ---- 页面状态 ----
  let classes = []
  let total = 0
  let page = 1
  const pageSize = 10
  let keyword = ''
  let collegeFilter = ''
  let gradeFilter = ''
  let isLoading = true
  let errorMsg = ''
  let deleteTargetId = null

  // ---- Toast 提示 ----
  function showToast(msg, type = 'success') {
    const container = document.getElementById('admin-toast-container')
    if (!container) return
    const el = document.createElement('div')
    el.className = `toast-item toast-${type}`
    el.textContent = msg
    container.appendChild(el)
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s'
      el.style.opacity = '0'
      setTimeout(() => el.remove(), 300)
    }, 2500)
  }

  // ---- 获取班级列表 ----
  async function fetchClasses() {
    isLoading = true
    errorMsg = ''
    renderContent()

    try {
      const params = { page, page_size: pageSize }
      if (keyword.trim()) params.keyword = keyword.trim()
      if (collegeFilter.trim()) params.college = collegeFilter.trim()
      if (gradeFilter) params.grade = gradeFilter

      const result = await getAdminClasses(params)
      const data = result.data || {}
      classes = data.list || data.classes || data.data || []
      total = data.total || data.count || 0
    } catch (err) {
      errorMsg = err.message || '获取班级列表失败'
      classes = []
      total = 0
    } finally {
      isLoading = false
      renderContent()
    }
  }

  // ---- 工具函数 ----
  function escapeHtml(str) {
    if (str == null) return ''
    const d = document.createElement('div')
    d.textContent = String(str)
    return d.innerHTML
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-'
    try {
      const d = new Date(dateStr)
      const y = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const da = String(d.getDate()).padStart(2, '0')
      const h = String(d.getHours()).padStart(2, '0')
      const mi = String(d.getMinutes()).padStart(2, '0')
      return `${y}-${mo}-${da} ${h}:${mi}`
    } catch {
      return dateStr
    }
  }

  function getGradeOptions(selected) {
    const cy = new Date().getFullYear()
    const opts = [{ v: '', l: '全部年级' }]
    for (let y = cy; y >= cy - 6; y--) {
      opts.push({ v: String(y), l: `${y} 级` })
    }
    return opts
      .map((o) => `<option value="${o.v}" ${selected === o.v ? 'selected' : ''}>${o.l}</option>`)
      .join('')
  }

  function calcTotalPages() {
    return Math.max(1, Math.ceil(total / pageSize))
  }

  // ---- 渲染页面内容 ----
  function renderContent() {
    const tp = calcTotalPages()

    // ---- 表格主体 ----
    let tbodyHTML = ''
    if (isLoading) {
      tbodyHTML = `
        <tr>
          <td colspan="7">
            <div class="loading-state">
              <div class="loading-spinner"></div>
              <p>正在加载班级数据...</p>
            </div>
          </td>
        </tr>`
    } else if (errorMsg) {
      tbodyHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-icon"></div>
              <p>${escapeHtml(errorMsg)}</p>
              <button class="btn-sm btn-primary" id="btn-retry" style="margin-top:12px;">重新加载</button>
            </div>
          </td>
        </tr>`
    } else if (classes.length === 0) {
      tbodyHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-icon"></div>
              <p>暂无班级数据</p>
              <p style="font-size:0.82rem;margin-top:4px;">点击上方「新建班级」按钮创建第一个班级</p>
            </div>
          </td>
        </tr>`
    } else {
      tbodyHTML = classes
        .map((c) => {
          const id = c.admin_class_id
          const name = escapeHtml(c.class_name || '')
          const college = escapeHtml(c.college || '-')
          const major = escapeHtml(c.major || '-')
          const grade = escapeHtml(c.grade || '-')
          const count = c.student_count != null ? c.student_count : 0
          const createdAt = formatDate(c.created_at)
          return `<tr>
            <td><strong>${name}</strong></td>
            <td>${college}</td>
            <td>${major}</td>
            <td>${grade}</td>
            <td>${count}</td>
            <td>${createdAt}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-id="${id}">编辑</button>
                <button class="btn-danger" data-id="${id}" data-name="${escapeHtml(c.class_name)}" data-count="${count}">删除</button>
              </div>
            </td>
          </tr>`
        })
        .join('')
    }

    // ---- 分页 ----
    let pageHTML = ''
    if (total > 0) {
      if (tp > 1) {
        let btns = ''
        let start = Math.max(1, page - 2)
        let end = Math.min(tp, page + 2)
        if (start > 1) {
          btns += `<button data-page="1">1</button>`
          if (start > 2) btns += `<span class="page-info">…</span>`
        }
        for (let i = start; i <= end; i++) {
          btns += `<button data-page="${i}" class="${i === page ? 'active' : ''}">${i}</button>`
        }
        if (end < tp) {
          if (end < tp - 1) btns += `<span class="page-info">…</span>`
          btns += `<button data-page="${tp}">${tp}</button>`
        }
        pageHTML = `
          <div class="pagination">
            <button ${page <= 1 ? 'disabled' : ''} id="btn-prev">上一页</button>
            ${btns}
            <button ${page >= tp ? 'disabled' : ''} id="btn-next">下一页</button>
            <span class="page-info">共 ${total} 条，第 ${page}/${tp} 页</span>
          </div>`
      } else {
        pageHTML = `<div class="pagination"><span class="page-info">共 ${total} 条</span></div>`
      }
    }

    // ---- 搜索栏 ----
    const searchHTML = `
      <div class="search-bar">
        <input type="text" id="search-keyword" placeholder="搜索班级名称 / 学院 / 专业" value="${escapeHtml(keyword)}">
        <input type="text" id="filter-college" placeholder="学院" value="${escapeHtml(collegeFilter)}">
        <select id="filter-grade">${getGradeOptions(gradeFilter)}</select>
        <button class="btn-sm btn-primary" id="btn-search">搜索</button>
        <button class="btn-sm btn-secondary" id="btn-reset">重置</button>
      </div>`

    // ---- 完整页面 HTML ----
    const contentHTML = `
      <div class="dashboard-content">
        <div style="margin-bottom:12px;">
          <a href="#/admin/courses" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回教学管理</a>
        </div>
        <div class="section-header">
          <h2>行政班级管理</h2>
          <button class="btn-sm btn-primary" id="btn-create-class">+ 新建班级</button>
        </div>

        ${searchHTML}

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>班级名称</th>
                <th>学院</th>
                <th>专业</th>
                <th>年级</th>
                <th>学生人数</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${tbodyHTML}</tbody>
          </table>
        </div>

        ${pageHTML}
      </div>

      <!-- Toast 容器 -->
      <div id="admin-toast-container" class="toast-container"></div>

      <!-- 新建 / 编辑 模态框 -->
      <div id="class-modal" class="modal-overlay" style="display:none;">
        <div class="modal-box">
          <h3 id="modal-title">新建班级</h3>
          <form id="class-form">
            <input type="hidden" id="form-class-id" value="">
            <div class="form-group">
              <label>班级名称 <span style="color:#DC2626;">*</span></label>
              <input type="text" id="form-class-name" required placeholder="例如：计算机科学2024级1班">
            </div>
            <div class="form-group">
              <label>学院</label>
              <input type="text" id="form-college" placeholder="例如：计算机科学与技术学院">
            </div>
            <div class="form-group">
              <label>专业</label>
              <input type="text" id="form-major" placeholder="例如：计算机科学与技术">
            </div>
            <div class="form-group">
              <label>年级</label>
              <select id="form-grade">
                <option value="">请选择</option>
                ${getGradeOptions('')}
              </select>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-cancel" id="btn-modal-cancel">取消</button>
              <button type="submit" class="btn-confirm" id="btn-modal-confirm">确定</button>
            </div>
          </form>
        </div>
      </div>

      <!-- 删除确认模态框 -->
      <div id="delete-modal" class="modal-overlay" style="display:none;">
        <div class="modal-box">
          <h3>确认删除</h3>
          <p id="delete-msg" style="margin-bottom:12px;color:var(--stu-text-secondary);"></p>
          <div id="delete-student-warning" style="display:none;padding:12px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;margin-bottom:12px;font-size:0.85rem;color:#92400E;">
             该班级中还有 <strong id="delete-student-count">0</strong> 名学生，删除班级不会删除学生账号，但会解除学生与该班级的关联关系。
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" id="btn-delete-cancel">取消</button>
            <button class="btn-confirm" id="btn-delete-confirm" style="background:#DC2626;">确认删除</button>
          </div>
        </div>
      </div>`

    renderDashboardLayout(app, {
      title: '行政班级管理',
      menuItems: ADMIN_MENU_ITEMS,
      contentHTML,
      user,
    })

    bindEvents()
  }

  // ---- 模态框操作 ----
  function openCreateModal() {
    document.getElementById('modal-title').textContent = '新建班级'
    document.getElementById('form-class-id').value = ''
    document.getElementById('form-class-name').value = ''
    document.getElementById('form-college').value = ''
    document.getElementById('form-major').value = ''
    document.getElementById('form-grade').value = ''
    document.getElementById('class-modal').style.display = ''
  }

  function openEditModal(id) {
    const c = classes.find((x) => (x.admin_class_id) == id)
    if (!c) {
      showToast('未找到班级信息', 'error')
      return
    }
    document.getElementById('modal-title').textContent = '编辑班级'
    document.getElementById('form-class-id').value = id
    document.getElementById('form-class-name').value = c.class_name || ''
    document.getElementById('form-college').value = c.college || ''
    document.getElementById('form-major').value = c.major || ''
    document.getElementById('form-grade').value = c.grade || ''
    document.getElementById('class-modal').style.display = ''
  }

  function closeModal() {
    document.getElementById('class-modal').style.display = 'none'
  }

  function openDeleteModal(id, name, count) {
    deleteTargetId = id
    document.getElementById('delete-msg').textContent = `确定要删除班级「${name}」吗？此操作不可撤销。`
    const warn = document.getElementById('delete-student-warning')
    const countEl = document.getElementById('delete-student-count')
    if (count > 0) {
      warn.style.display = ''
      countEl.textContent = count
    } else {
      warn.style.display = 'none'
    }
    document.getElementById('delete-modal').style.display = ''
  }

  function closeDeleteModal() {
    document.getElementById('delete-modal').style.display = 'none'
    deleteTargetId = null
  }

  // ---- 绑定事件 ----
  function bindEvents() {
    // 搜索
    document.getElementById('btn-search')?.addEventListener('click', () => {
      keyword = document.getElementById('search-keyword')?.value || ''
      collegeFilter = document.getElementById('filter-college')?.value || ''
      gradeFilter = document.getElementById('filter-grade')?.value || ''
      page = 1
      fetchClasses()
    })

    // 重置
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      keyword = ''
      collegeFilter = ''
      gradeFilter = ''
      page = 1
      const kw = document.getElementById('search-keyword')
      const clg = document.getElementById('filter-college')
      const grd = document.getElementById('filter-grade')
      if (kw) kw.value = ''
      if (clg) clg.value = ''
      if (grd) grd.value = ''
      fetchClasses()
    })

    // 回车搜索
    document.getElementById('search-keyword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-search')?.click()
      }
    })

    // 重试
    document.getElementById('btn-retry')?.addEventListener('click', () => fetchClasses())

    // 新建
    document.getElementById('btn-create-class')?.addEventListener('click', openCreateModal)

    // 编辑
    document.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id))
    })

    // 删除
    document.querySelectorAll('.btn-danger[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id
        const name = btn.dataset.name
        const count = parseInt(btn.dataset.count, 10) || 0
        openDeleteModal(id, name, count)
      })
    })

    // 分页
    document.getElementById('btn-prev')?.addEventListener('click', () => {
      if (page > 1) {
        page--
        fetchClasses()
      }
    })
    document.getElementById('btn-next')?.addEventListener('click', () => {
      if (page < calcTotalPages()) {
        page++
        fetchClasses()
      }
    })
    document.querySelectorAll('.pagination button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page, 10)
        if (p && p !== page) {
          page = p
          fetchClasses()
        }
      })
    })

    // 模态框：取消
    document.getElementById('btn-modal-cancel')?.addEventListener('click', closeModal)
    document.getElementById('class-modal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal()
    })

    // 模态框：提交表单
    document.getElementById('class-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const id = document.getElementById('form-class-id').value
      const data = {
        class_name: document.getElementById('form-class-name').value.trim(),
        college: document.getElementById('form-college').value.trim(),
        major: document.getElementById('form-major').value.trim(),
        grade: document.getElementById('form-grade').value,
      }
      if (!data.class_name) {
        showToast('请输入班级名称', 'error')
        return
      }

      try {
        if (id) {
          await updateAdminClass(id, data)
          showToast('班级更新成功')
        } else {
          await createAdminClass(data)
          showToast('班级创建成功')
        }
        closeModal()
        fetchClasses()
      } catch (err) {
        showToast(err.message || '操作失败', 'error')
      }
    })

    // 删除：取消
    document.getElementById('btn-delete-cancel')?.addEventListener('click', closeDeleteModal)
    document.getElementById('delete-modal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeDeleteModal()
    })

    // 删除：确认
    document.getElementById('btn-delete-confirm')?.addEventListener('click', async () => {
      if (!deleteTargetId) return
      try {
        await deleteAdminClass(deleteTargetId)
        showToast('班级已删除')
        closeDeleteModal()
        fetchClasses()
      } catch (err) {
        showToast(err.message || '删除失败', 'error')
      }
    })
  }

  // ---- 首次加载 ----
  renderContent()
  fetchClasses()
}

