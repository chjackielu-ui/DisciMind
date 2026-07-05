import { getMe } from '../api/auth.js'
import { getStudentCourses, uploadStudentDocument, parseStudentDocument, getStudentDocuments, getStudentDocumentDetail, deleteStudentDocument } from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, formatFileSize, documentParseStatusLabel, reviewStatusLabel, visibilityLabel, toLower } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts, bindResize, renderRingChart, CHART_COLORS } from '../utils/echarts.js'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ALLOWED_EXT = ['pdf', 'docx', 'txt', 'md']

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return null
    }
  }
  return user
}

function buildLoading() {
  return `<div class="complex-shell"><div class="complex-loading"><div class="complex-spinner"></div><p>正在加载知识库...</p></div></div>`
}

function statusCounts(list) {
  const counts = { total: list.length, parsed: 0, uploaded: 0, pending: 0, failed: 0 }
  list.forEach(doc => {
    const parse = toLower(doc.parse_status)
    const review = toLower(doc.review_status)
    if (parse === 'chunked' || parse === 'parsed') counts.parsed++
    if (parse === 'uploaded' || parse === 'parsing' || parse === 'chunking') counts.uploaded++
    if (parse === 'failed') counts.failed++
    if (review === 'pending') counts.pending++
  })
  return counts
}

function buildPage(state) {
  if (state.loading) return buildLoading()
  if (state.error) {
    return `<div class="complex-shell"><div class="complex-error"><h3>知识库加载失败</h3><p>${escapeHtml(state.error)}</p><button class="complex-btn" id="btn-retry-docs">重新加载</button></div></div>`
  }
  const counts = statusCounts(state.documents)
  return `
    <div class="complex-shell">
      <section class="complex-hero">
        <div>
          <h1>我的知识库</h1>
          <p>上传课程资料、学习笔记和文档，构建你的个人学习知识库。</p>
        </div>
        <div class="complex-actions">
          <button class="complex-btn" id="btn-pick-file">上传资料</button>
        </div>
      </section>

      <section class="complex-metric-grid">
        <div class="complex-metric"><b>${counts.total}</b><span>文档总数</span></div>
        <div class="complex-metric"><b>${counts.parsed}</b><span>已解析</span></div>
        <div class="complex-metric"><b>${counts.uploaded}</b><span>待解析</span></div>
        <div class="complex-metric"><b>${counts.pending}</b><span>审核中</span></div>
        <div class="complex-metric"><b>${counts.failed}</b><span>解析失败</span></div>
      </section>

      <section class="doc-layout">
        <div class="complex-card">
          <h3 class="complex-section-title">上传资料</h3>
          <div class="upload-dropzone" id="upload-dropzone">
            <strong style="color:var(--complex-deep);">点击或拖拽文件到这里</strong>
            <span style="color:var(--text-sub);font-size:0.84rem;">支持 pdf / docx / txt / md，最大 20MB</span>
            <span id="selected-file-name" style="color:var(--complex-primary);font-size:0.82rem;">${escapeHtml(state.selectedFile?.name || '')}</span>
          </div>
          <input type="file" id="doc-file-input" hidden accept=".pdf,.docx,.txt,.md">
          <div class="doc-form-grid">
            <input class="complex-input" id="doc-title" placeholder="标题" value="${escapeHtml(state.form.title || '')}">
            <select class="complex-select" id="doc-course">
              <option value="">不关联课程</option>
              ${state.courses.map(c => `<option value="${c.course_id}" ${String(state.form.course_id || '') === String(c.course_id) ? 'selected' : ''}>${escapeHtml(c.course_name)}</option>`).join('')}
            </select>
            <input class="complex-input" id="doc-kp" placeholder="知识点 ID（可选）" value="${escapeHtml(state.form.knowledge_point_id || '')}">
            <select class="complex-select" id="doc-visibility">
              <option value="private" ${state.form.visibility === 'private' ? 'selected' : ''}>private 仅自己</option>
              <option value="class" ${state.form.visibility === 'class' ? 'selected' : ''}>class 班级可见</option>
              <option value="college" ${state.form.visibility === 'college' ? 'selected' : ''}>college 学院可见</option>
              <option value="school" ${state.form.visibility === 'school' ? 'selected' : ''}>school 学校可见</option>
            </select>
          </div>
          <p style="margin:10px 0;color:var(--text-hint);font-size:0.76rem;">private 可以直接使用，其他范围需要审核。</p>
          <button class="complex-btn" id="btn-upload-doc" style="width:100%;" ${state.uploading ? 'disabled' : ''}>${state.uploading ? '文档上传中...' : '开始上传'}</button>
        </div>

        <div class="complex-card">
          <h3 class="complex-section-title">文档状态占比</h3>
          <div class="chart-container-sm" id="doc-status-chart"></div>
        </div>
      </section>

      <section>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
          <h3 class="complex-section-title" style="margin:0;">文档列表</h3>
          <button class="complex-btn-secondary" id="btn-refresh-docs">刷新列表</button>
        </div>
        ${state.documents.length ? `<div class="doc-list">${state.documents.map(buildDocCard).join('')}</div>` : `<div class="complex-empty"><h3>暂无文档</h3><p>上传学习资料后，系统会在这里展示解析和审核状态。</p></div>`}
      </section>
    </div>`
}

function buildDocCard(doc) {
  const parse = toLower(doc.parse_status)
  const review = toLower(doc.review_status)
  const ext = String(doc.file_ext || '').replace('.', '') || 'FILE'
  return `
    <article class="doc-card" data-doc-id="${doc.document_id}">
      <div class="doc-card-head">
        <div class="file-type-badge">${escapeHtml(ext)}</div>
        <div>
          <div class="doc-title">${escapeHtml(doc.title || doc.original_filename || '未命名文档')}</div>
          <div class="doc-meta">${escapeHtml(doc.original_filename || '')}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;">
        <span class="status-pill ${parse}">${documentParseStatusLabel(parse)}</span>
        <span class="status-pill ${review}">${reviewStatusLabel(review)}</span>
        <span class="status-pill">${visibilityLabel(doc.visibility)}</span>
      </div>
      <div class="doc-meta">${formatFileSize(doc.file_size)} · ${formatDate(doc.created_at)} · ${doc.chunk_count || 0} chunks</div>
      ${doc.course_name ? `<div class="doc-meta" style="margin-top:4px;">课程：${escapeHtml(doc.course_name)}</div>` : ''}
      <div class="doc-action-row">
        <button class="complex-btn-secondary btn-parse-doc" ${parse === 'parsing' || parse === 'chunking' ? 'disabled' : ''}>${parse === 'parsing' || parse === 'chunking' ? '解析中' : '解析'}</button>
        <button class="complex-btn-ghost btn-detail-doc">查看详情</button>
        <button class="complex-btn-danger btn-delete-doc">删除</button>
      </div>
    </article>`
}

function validateFile(file) {
  if (!file) return '请选择要上传的文件'
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) return '文件类型错误，仅支持 pdf / docx / txt / md'
  if (file.size > MAX_FILE_SIZE) return '文件超过 20MB 限制'
  return ''
}

function renderDocChart(documents) {
  bindResize()
  const counts = statusCounts(documents)
  renderRingChart('doc-status-chart', [
    { name: '已解析', value: counts.parsed, itemStyle: { color: CHART_COLORS.primary } },
    { name: '待解析', value: counts.uploaded, itemStyle: { color: CHART_COLORS.softYellow } },
    { name: '失败', value: counts.failed, itemStyle: { color: CHART_COLORS.softRed } },
    { name: '审核中', value: counts.pending, itemStyle: { color: CHART_COLORS.light } },
  ], '')
}

function buildDrawer(detail) {
  const chunks = detail.chunks_preview || []
  return `
    <div class="drawer-mask" id="doc-drawer-mask">
      <aside class="doc-drawer">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;">
          <h2 class="complex-section-title" style="margin:0;">文档详情</h2>
          <button class="complex-btn-ghost" id="btn-close-drawer">关闭</button>
        </div>
        <div class="complex-card" style="box-shadow:none;margin-bottom:14px;">
          <h3 class="complex-section-title">${escapeHtml(detail.title || detail.original_filename)}</h3>
          <p style="color:var(--text-sub);line-height:1.7;margin:0;">${escapeHtml(detail.original_filename || '')}</p>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px;">
            <span class="status-pill ${toLower(detail.parse_status)}">${documentParseStatusLabel(detail.parse_status)}</span>
            <span class="status-pill ${toLower(detail.review_status)}">${reviewStatusLabel(detail.review_status)}</span>
            <span class="status-pill">${visibilityLabel(detail.visibility)}</span>
          </div>
          <p style="color:var(--text-sub);font-size:0.82rem;margin:12px 0 0;">${formatFileSize(detail.file_size)} · ${detail.chunk_count || 0} chunks · ${formatDate(detail.created_at)}</p>
          ${detail.error_message ? `<p style="color:#B64C3D;">${escapeHtml(detail.error_message)}</p>` : ''}
        </div>
        <h3 class="complex-section-title">Chunks 预览</h3>
        ${chunks.length ? chunks.map(c => `<div class="chunk-preview"><b>#${c.chunk_index}</b> · ${c.token_count || 0} tokens<br>${escapeHtml(c.chunk_text || '')}</div>`).join('') : `<div class="complex-empty" style="min-height:180px;"><h3>暂无 chunks</h3><p>请先解析文档。</p></div>`}
      </aside>
    </div>`
}

export async function renderStudentDocuments(app) {
  disposeAllCharts()
  const user = await getAuthedUser()
  if (!user) return

  const state = {
    loading: true,
    error: '',
    courses: [],
    documents: [],
    selectedFile: null,
    uploading: false,
    form: { title: '', course_id: '', knowledge_point_id: '', visibility: 'private' },
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildPage(state), user })

  async function loadData() {
    state.loading = true
    state.error = ''
    rerender()
    try {
      const [courseRes, docRes] = await Promise.all([
        getStudentCourses().catch(() => ({ data: { list: [] } })),
        getStudentDocuments({ page_size: 50 }),
      ])
      state.courses = courseRes.data?.list || []
      state.documents = docRes.data?.list || []
    } catch (err) {
      state.error = err.message || '知识库加载失败'
      showToast('文档列表加载失败', 'error')
    } finally {
      state.loading = false
      rerender()
    }
  }

  async function uploadCurrent() {
    syncForm()
    const error = validateFile(state.selectedFile)
    if (error) {
      showToast(error, 'warning')
      return
    }
    const formData = new FormData()
    formData.append('file', state.selectedFile)
    formData.append('title', state.form.title || state.selectedFile.name)
    if (state.form.course_id) formData.append('course_id', state.form.course_id)
    if (state.form.knowledge_point_id) formData.append('knowledge_point_id', state.form.knowledge_point_id)
    formData.append('visibility', state.form.visibility || 'private')
    state.uploading = true
    rerender()
    try {
      await uploadStudentDocument(formData)
      showToast('文档上传成功', 'success')
      state.selectedFile = null
      state.form.title = ''
      await loadData()
    } catch (err) {
      showToast(err.message || '文档上传失败', 'error')
    } finally {
      state.uploading = false
      rerender()
    }
  }

  async function parseDoc(id) {
    const card = document.querySelector(`[data-doc-id="${id}"] .btn-parse-doc`)
    if (card) {
      card.disabled = true
      card.textContent = '解析中'
    }
    try {
      await parseStudentDocument(id)
      showToast('文档解析成功', 'success')
      await loadData()
    } catch (err) {
      showToast(err.message || '解析失败，请重新尝试', 'error')
      await loadData()
    }
  }

  async function openDetail(id) {
    try {
      const res = await getStudentDocumentDetail(id)
      document.querySelector('#doc-drawer-mask')?.remove()
      document.body.insertAdjacentHTML('beforeend', buildDrawer(res.data || {}))
      document.getElementById('btn-close-drawer')?.addEventListener('click', () => document.getElementById('doc-drawer-mask')?.remove())
      document.getElementById('doc-drawer-mask')?.addEventListener('click', e => { if (e.target.id === 'doc-drawer-mask') e.target.remove() })
    } catch (err) {
      showToast(err.message || '文档详情加载失败', 'error')
    }
  }

  async function deleteDoc(id) {
    const ok = window.confirm('确定删除这个文档吗？删除后不可恢复。')
    if (!ok) return
    try {
      await deleteStudentDocument(id)
      showToast('文档已删除', 'success')
      await loadData()
    } catch (err) {
      showToast(err.message || '删除失败', 'error')
    }
  }

  function syncForm() {
    state.form.title = document.getElementById('doc-title')?.value || ''
    state.form.course_id = document.getElementById('doc-course')?.value || ''
    state.form.knowledge_point_id = document.getElementById('doc-kp')?.value || ''
    state.form.visibility = document.getElementById('doc-visibility')?.value || 'private'
  }

  function setFile(file) {
    const error = validateFile(file)
    if (error) {
      showToast(error, 'warning')
      return
    }
    state.selectedFile = file
    if (!state.form.title) state.form.title = file.name.replace(/\.[^.]+$/, '')
    rerender()
  }

  function rerender() {
    const main = document.getElementById('student-main')
    if (!main) return
    main.innerHTML = buildPage(state)
    bindEvents()
    if (!state.loading && !state.error) requestAnimationFrame(() => renderDocChart(state.documents))
  }

  function bindEvents() {
    document.getElementById('btn-retry-docs')?.addEventListener('click', loadData)
    document.getElementById('btn-refresh-docs')?.addEventListener('click', loadData)
    document.getElementById('btn-pick-file')?.addEventListener('click', () => document.getElementById('doc-file-input')?.click())
    document.getElementById('upload-dropzone')?.addEventListener('click', () => document.getElementById('doc-file-input')?.click())
    document.getElementById('doc-file-input')?.addEventListener('change', e => setFile(e.target.files?.[0]))
    document.getElementById('btn-upload-doc')?.addEventListener('click', uploadCurrent)
    ;['doc-title', 'doc-course', 'doc-kp', 'doc-visibility'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', syncForm)
      document.getElementById(id)?.addEventListener('change', syncForm)
    })
    const dropzone = document.getElementById('upload-dropzone')
    if (dropzone) {
      dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover') })
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'))
      dropzone.addEventListener('drop', e => {
        e.preventDefault()
        dropzone.classList.remove('dragover')
        setFile(e.dataTransfer.files?.[0])
      })
    }
    document.querySelectorAll('.doc-card').forEach(card => {
      const id = card.dataset.docId
      card.querySelector('.btn-parse-doc')?.addEventListener('click', () => parseDoc(id))
      card.querySelector('.btn-detail-doc')?.addEventListener('click', () => openDetail(id))
      card.querySelector('.btn-delete-doc')?.addEventListener('click', () => deleteDoc(id))
    })
  }

  await loadData()
}
