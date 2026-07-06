// 教师端 - 知识库管理页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getKnowledgeDocuments, reviewKnowledgeDocument, uploadKnowledgeDocument } from '../api/teacher.js'
import { iconSearch, iconRefresh } from '../utils/icons.js'
import { initAllAutoResize } from '../utils/auto-resize.js'

export async function renderTeacherKnowledge(app) {
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

  const menuItems = [
    { label: '首页', icon: 'home', hash: '#/teacher/dashboard' },
    { label: '教学管理', icon: 'book', hash: '#/teacher/courses' },
    { label: '作业考试', icon: 'edit', hash: '#/teacher/tasks' },
    { label: '学情分析', icon: 'chart', hash: '#/teacher/analytics' },
    { label: '个人中心', icon: 'user', hash: '#/teacher/profile' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <div style="margin-bottom:12px;">
        <a href="#/teacher/courses" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回教学管理</a>
      </div>
      <div class="page-header">
        <h2 class="page-title">知识库管理</h2>
        <p class="page-subtitle">管理与审核课程相关的知识库文档</p>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="search-keyword" placeholder="搜索文档标题..." style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <select id="filter-status" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已拒绝</option>
          </select>
          <select id="filter-parse" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            <option value="">全部解析状态</option>
            <option value="uploaded">已上传</option>
            <option value="parsing">解析中</option>
            <option value="parsed">已解析</option>
            <option value="failed">失败</option>
          </select>
          <button class="btn btn-primary" id="btn-search">${iconSearch()} 搜索</button>
          <button class="btn" id="btn-refresh" style="border:1px solid var(--border);">${iconRefresh()}</button>
          <button class="btn btn-primary" id="btn-upload-doc" style="margin-left:auto;">＋ 上传文档</button>
        </div>
      </div>

      <div class="card">
        <div id="document-list-container">
          <div class="empty-hint">正在加载文档数据...</div>
        </div>
      </div>
    </div>

    <div id="review-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin-bottom:16px;">审核文档</h3>
        <p id="review-doc-title" style="margin-bottom:16px;color:var(--text-secondary);font-size:0.9rem;"></p>
        <div class="form-group" style="margin-bottom:16px;">
          <label>审核结果</label>
          <select id="review-status" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            <option value="approved">✅ 通过</option>
            <option value="rejected">❌ 拒绝</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label>审核意见</label>
          <textarea id="review-comment" class="auto-resize-ta" rows="3" placeholder="请输入审核意见..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;"></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn" id="btn-review-cancel" style="border:1px solid var(--border);">取消</button>
          <button class="btn btn-primary" id="btn-review-submit">提交审核</button>
        </div>
      </div>
    </div>

    <!-- 上传文档弹窗 -->
    <div id="upload-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin-bottom:20px;">📄 上传知识库文档</h3>
        <form id="upload-form">
          <div class="form-group" style="margin-bottom:14px;">
            <label>选择文件 <span class="required">*</span></label>
            <input type="file" id="upload-file" accept=".pdf,.docx,.doc,.txt,.md" required style="padding:8px;border:1px solid var(--border);border-radius:8px;width:100%;">
            <span style="font-size:0.8rem;color:var(--text-muted);">支持 PDF、DOCX、DOC、TXT、MD，最大 20MB</span>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>文档标题</label>
            <input type="text" id="upload-title" placeholder="默认使用文件名" style="padding:10px;border:1px solid var(--border);border-radius:8px;width:100%;">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="form-group">
              <label>范围</label>
              <select id="upload-scope" style="padding:10px;border:1px solid var(--border);border-radius:8px;">
                <option value="course">课程知识库</option>
                <option value="personal">个人知识库</option>
              </select>
            </div>
            <div class="form-group">
              <label>可见性</label>
              <select id="upload-visibility" style="padding:10px;border:1px solid var(--border);border-radius:8px;">
                <option value="class">班级可见</option>
                <option value="college">学院可见</option>
                <option value="private">仅自己可见</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>所属课程</label>
            <select id="upload-course" style="padding:10px;border:1px solid var(--border);border-radius:8px;width:100%;">
              <option value="">请选择课程（可选）</option>
            </select>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="upload-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">上传</button>
          </div>
        </form>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '知识库管理',
    menuItems,
    contentHTML,
    user,
  })

  let currentDocId = null
  let documents = []

  async function loadDocuments(params = {}) {
    const container = document.getElementById('document-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const res = await getKnowledgeDocuments(params)
      documents = res.data.list || []
      renderDocuments(documents)
    } catch (err) {
      container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><div class="error-message">${err.message}</div><button class="btn-retry" onclick="location.reload()">重试</button></div>`
    }
  }

  function renderDocuments(docs) {
    const container = document.getElementById('document-list-container')
    if (!container) return

    if (!docs || docs.length === 0) {
      container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">暂无知识库文档</div>'
      return
    }

    const parseLabels = { uploaded: '已上传', parsing: '解析中', parsed: '已解析', chunking: '切片中', chunked: '已切片', embedding: '向量化中', embedded: '已向量化', failed: '失败' }
    const reviewLabels = { pending: '待审核', approved: '已通过', rejected: '已拒绝' }
    const reviewColors = { pending: '#fef3c7', approved: '#d1fae5', rejected: '#fee2e2' }
    const reviewTextColors = { pending: '#92400e', approved: '#065f46', rejected: '#dc2626' }
    const scopeLabels = { platform: '平台', course: '课程', class: '班级', personal: '个人' }

    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);">文档名称</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:70px;">类型</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">范围</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">解析状态</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:80px;">审核状态</th>
            <th style="text-align:center;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:100px;">上传者</th>
            <th style="text-align:right;padding:10px 8px;font-size:0.85rem;color:var(--text-muted);width:100px;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${docs.map(d => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:12px 8px;">
                <div style="font-weight:500;font-size:0.9rem;">${d.title}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);">${d.original_filename || ''} ${d.file_size_bytes ? '· ' + Math.round(d.file_size_bytes / 1024) + 'KB' : ''}</div>
              </td>
              <td style="text-align:center;padding:12px 8px;font-size:0.85rem;">.${d.file_ext || '-'}</td>
              <td style="text-align:center;padding:12px 8px;font-size:0.8rem;">${scopeLabels[d.scope_type] || d.scope_type}</td>
              <td style="text-align:center;padding:12px 8px;">
                <span style="background:${d.parse_status === 'failed' ? '#fee2e2' : '#d1fae5'};color:${d.parse_status === 'failed' ? '#dc2626' : '#065f46'};padding:2px 8px;border-radius:8px;font-size:0.75rem;">${parseLabels[d.parse_status] || d.parse_status}</span>
              </td>
              <td style="text-align:center;padding:12px 8px;">
                <span style="background:${reviewColors[d.review_status]};color:${reviewTextColors[d.review_status]};padding:2px 8px;border-radius:8px;font-size:0.75rem;">${reviewLabels[d.review_status] || d.review_status}</span>
              </td>
              <td style="text-align:center;padding:12px 8px;font-size:0.85rem;">${d.owner_name || '-'}</td>
              <td style="text-align:right;padding:12px 8px;">
                ${d.review_status === 'pending' ? `
                  <button class="btn-review" data-id="${d.document_id}" data-title="${d.title}" style="padding:4px 12px;border:1px solid var(--primary);border-radius:6px;background:var(--primary-light);color:var(--primary);cursor:pointer;font-size:0.8rem;">审核</button>
                ` : `
                  <span style="font-size:0.8rem;color:var(--text-muted);">已处理</span>
                `}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `

    container.querySelectorAll('.btn-review').forEach(btn => {
      btn.addEventListener('click', () => {
        currentDocId = parseInt(btn.dataset.id)
        document.getElementById('review-doc-title').textContent = `文档：${btn.dataset.title}`
        document.getElementById('review-modal').style.display = 'flex'
      })
    })
  }

  function getFilters() {
    return {
      keyword: document.getElementById('search-keyword')?.value || '',
      review_status: document.getElementById('filter-status')?.value || '',
      parse_status: document.getElementById('filter-parse')?.value || '',
    }
  }

  document.getElementById('btn-search')?.addEventListener('click', () => loadDocuments(getFilters()))
  document.getElementById('btn-refresh')?.addEventListener('click', () => loadDocuments())
  document.getElementById('btn-review-cancel')?.addEventListener('click', () => {
    document.getElementById('review-modal').style.display = 'none'
  })
  document.getElementById('btn-review-submit')?.addEventListener('click', async () => {
    if (!currentDocId) return
    const status = document.getElementById('review-status').value
    const comment = document.getElementById('review-comment').value.trim()
    try {
      await reviewKnowledgeDocument(currentDocId, { review_status: status, review_comment: comment })
      document.getElementById('review-modal').style.display = 'none'
      loadDocuments(getFilters())
    } catch (err) {
      alert(err.message)
    }
  })

  // ---- 上传文档 ----
  const uploadModal = document.getElementById('upload-modal')

  document.getElementById('btn-upload-doc')?.addEventListener('click', async () => {
    uploadModal.style.display = 'flex'
    initAllAutoResize()
    try {
      const { getTeacherCourses } = await import('../api/teacher.js')
      const res = await getTeacherCourses()
      const select = document.getElementById('upload-course')
      select.innerHTML = '<option value="">请选择课程（可选）</option>'
      ;(res.data.list || []).forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.course_id
        opt.textContent = c.course_name
        select.appendChild(opt)
      })
    } catch (err) {
      console.error('加载课程失败', err)
    }
  })

  document.getElementById('upload-cancel')?.addEventListener('click', () => {
    uploadModal.style.display = 'none'
    document.getElementById('upload-form').reset()
  })
  uploadModal?.addEventListener('click', (e) => {
    if (e.target === uploadModal) {
      uploadModal.style.display = 'none'
      document.getElementById('upload-form').reset()
    }
  })

  document.getElementById('upload-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fileInput = document.getElementById('upload-file')
    if (!fileInput.files || fileInput.files.length === 0) {
      alert('请选择要上传的文件')
      return
    }
    const formData = new FormData()
    formData.append('file', fileInput.files[0])
    formData.append('title', document.getElementById('upload-title').value.trim() || fileInput.files[0].name)
    formData.append('scope_type', document.getElementById('upload-scope').value)
    formData.append('visibility', document.getElementById('upload-visibility').value)
    const courseId = parseInt(document.getElementById('upload-course').value)
    if (courseId) formData.append('course_id', courseId)

    try {
      await uploadKnowledgeDocument(formData)
      alert('上传成功')
      uploadModal.style.display = 'none'
      document.getElementById('upload-form').reset()
      loadDocuments(getFilters())
    } catch (err) {
      alert(err.message)
    }
  })

  initAllAutoResize()
  loadDocuments()
}
