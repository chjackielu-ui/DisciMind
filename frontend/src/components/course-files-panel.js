import {
  getCourseFiles, uploadCourseFile, updateCourseFile, publishCourseFile,
  unpublishCourseFile, deleteCourseFile, downloadCourseFile,
} from '../api/course-files.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { getIcon } from '../utils/icons.js'

const CATEGORY_LABELS = { all: '全部', courseware: '课件', reading: '阅读', assignment: '作业附件', reference: '参考资料', dataset: '数据集', other: '其他' }

function sizeLabel(value) {
  const bytes = Number(value || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function statusLabel(value) {
  return { active: '已发布', draft: '草稿', unpublished: '已下架' }[String(value || '').toLowerCase()] || value || '未知'
}

function classButtons(classes, selectedId) {
  return (classes || []).map((item) => `<button type="button" data-course-file-class="${item.teaching_class_id}" class="${String(item.teaching_class_id) === String(selectedId) ? 'is-active' : ''}">${escapeHtml(item.teaching_class_name || `教学班 ${item.teaching_class_id}`)}</button>`).join('')
}

export function renderCourseFilesPanel({ user, course, classes = [], canManage: permissionCanManage = true }) {
  const role = String(user?.role || '').toLowerCase()
  const selectedId = new URLSearchParams((window.location.hash.split('?')[1] || '')).get('classId') || classes[0]?.teaching_class_id || course?.teaching_class?.teaching_class_id || ''
  const availableClasses = classes.length ? classes : course?.teaching_class ? [course.teaching_class] : []
  const canManage = role === 'teacher' || (role === 'admin' && permissionCanManage)
  return `<section class="course-files-panel role-${escapeHtml(role)}" id="course-files-panel" data-course-id="${course.course_id}" data-selected-class="${escapeHtml(String(selectedId))}">
    <header class="course-files-head"><div><span class="course-files-head-icon">${getIcon('document')}</span><div><h3>课程文件</h3><p>${canManage ? '面向单个教学班发布、管理和追踪教学资料' : '查看并下载当前教学班已经发布的资料'}</p></div></div>${canManage ? `<button type="button" class="course-file-primary" id="course-file-upload-open">${getIcon('document')} 上传文件</button>` : ''}</header>
    ${availableClasses.length > 1 || canManage ? `<div class="course-file-class-picker"><span>教学班</span><div id="course-file-class-buttons">${classButtons(availableClasses, selectedId)}</div></div>` : ''}
    <div class="course-file-toolbar">
      <label class="course-file-search">${getIcon('search')}<input type="search" id="course-file-search" placeholder="搜索文件名称或标题" autocomplete="off"></label>
      <div class="course-file-category-filter" id="course-file-category-filter">${Object.entries(CATEGORY_LABELS).map(([key, label]) => `<button type="button" data-course-file-category="${key}" class="${key === 'all' ? 'is-active' : ''}">${label}</button>`).join('')}</div>
      <div class="course-file-sort" id="course-file-sort"><button type="button" data-course-file-sort="latest" class="is-active">最新发布</button><button type="button" data-course-file-sort="oldest">最早发布</button></div>
    </div>
    <div class="course-file-status" id="course-file-status" aria-live="polite"></div>
    <div class="course-file-grid" id="course-file-grid"><div class="course-file-loading">正在读取课程文件</div></div>
    ${canManage ? `<div class="course-file-dialog" id="course-file-dialog" hidden><div role="dialog" aria-modal="true" aria-labelledby="course-file-dialog-title"><header><div><strong id="course-file-dialog-title">上传课程文件</strong><small>文件只发布给当前选择的单个教学班</small></div><button type="button" data-course-file-dialog-close aria-label="关闭">${getIcon('close')}</button></header><form id="course-file-form"><input type="hidden" name="file_id"><label class="course-file-drop"><span>${getIcon('document')}</span><strong id="course-file-choice">选择文件</strong><small>PDF、Office、文本、图片或 ZIP，最大 30MB</small><input type="file" name="file" accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.zip"></label><label><span>标题</span><input type="text" name="title" maxlength="200" required></label><label><span>说明</span><textarea name="description" maxlength="5000" rows="3"></textarea></label><fieldset><legend>文件分类</legend><div id="course-file-form-categories">${Object.entries(CATEGORY_LABELS).filter(([key]) => key !== 'all').map(([key, label]) => `<button type="button" data-form-category="${key}" class="${key === 'courseware' ? 'is-active' : ''}">${label}</button>`).join('')}</div><input type="hidden" name="category" value="courseware"></fieldset><label class="course-file-publish-switch"><input type="checkbox" name="publish_now" checked><span></span><b>上传后立即发布并通知学生</b></label><footer><button type="button" data-course-file-dialog-close>取消</button><button type="submit" class="is-primary" id="course-file-submit">上传并保存</button></footer></form></div></div><div class="course-file-confirm" id="course-file-confirm" hidden><div role="alertdialog" aria-modal="true"><strong>确认删除课程文件？</strong><p>文件记录将被软删除，学生将立即不可见；历史审计记录会保留。</p><footer><button type="button" data-confirm-cancel>取消</button><button type="button" class="is-danger" data-confirm-delete>确认删除</button></footer></div></div>` : ''}
  </section>`
}

function fileCard(file, canManage, targetId) {
  const published = file.status === 'active'
  return `<article class="course-file-card${String(file.file_id) === String(targetId) ? ' is-target' : ''}" data-course-file-id="${file.file_id}">
    <div class="course-file-type">${escapeHtml(String(file.original_filename || '').split('.').pop()?.slice(0, 5).toUpperCase() || 'FILE')}</div>
    <div class="course-file-copy"><span>${escapeHtml(CATEGORY_LABELS[file.category] || CATEGORY_LABELS.other)} · ${escapeHtml(statusLabel(file.status))}</span><h4 title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</h4><p>${escapeHtml(file.description || file.original_filename)}</p><small>${sizeLabel(file.size_bytes)} · ${escapeHtml(file.uploader_name || '发布教师')} · ${file.published_at ? formatDate(file.published_at, 'short') : formatDate(file.created_at, 'short')}</small></div>
    <div class="course-file-state">${file.is_unread ? '<i>新</i>' : ''}${file.is_downloaded ? '<span>已下载</span>' : ''}</div>
    ${canManage ? `<dl><div><dt>接收</dt><dd>${file.recipient_count || 0}</dd></div><div><dt>下载</dt><dd>${file.downloaded_count || 0}</dd></div><div><dt>未读</dt><dd>${file.unread_count || 0}</dd></div></dl>` : ''}
    <footer><button type="button" data-file-action="download">${getIcon('document')} 下载</button>${canManage ? `<button type="button" data-file-action="edit">编辑</button>${published ? '<button type="button" data-file-action="unpublish">下架</button>' : '<button type="button" data-file-action="publish">发布</button>'}<button type="button" class="is-danger" data-file-action="delete">删除</button>` : ''}</footer>
  </article>`
}

export function mountCourseFilesPanel({ user, course, classes = [], canManage: permissionCanManage = true }) {
  const root = document.getElementById('course-files-panel')
  if (!root) return
  const role = String(user?.role || '').toLowerCase()
  const canManage = role === 'teacher' || (role === 'admin' && permissionCanManage)
  const grid = root.querySelector('#course-file-grid')
  const status = root.querySelector('#course-file-status')
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const targetId = params.get('fileId')
  let selectedClassId = Number(root.dataset.selectedClass)
  let category = 'all'
  let sort = 'latest'
  let searchTimer = null
  let files = []
  let pendingDeleteId = null
  let openDialog = () => {}

  function notify(message, error = false) {
    status.textContent = message || ''
    status.classList.toggle('is-error', error)
    status.hidden = !message
    if (message && !error) window.setTimeout(() => { if (status.textContent === message) status.hidden = true }, 3200)
  }

  async function load() {
    if (!selectedClassId) { grid.innerHTML = '<div class="course-file-empty">请先选择教学班</div>'; return }
    grid.innerHTML = '<div class="course-file-loading">正在读取课程文件</div>'
    try {
      const result = await getCourseFiles(course.course_id, selectedClassId, { keyword: root.querySelector('#course-file-search')?.value || '', category: category === 'all' ? '' : category, sort })
      files = result.data?.list || []
      grid.innerHTML = files.length ? files.map((file) => fileCard(file, canManage, targetId)).join('') : '<div class="course-file-empty">当前教学班还没有可展示的课程文件</div>'
      const target = targetId && grid.querySelector(`[data-course-file-id="${CSS.escape(String(targetId))}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (error) {
      grid.innerHTML = `<div class="course-file-empty is-error">${escapeHtml(error.message || '课程文件读取失败')}</div>`
    }
  }

  root.querySelector('#course-file-class-buttons')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-course-file-class]')
    if (!button) return
    selectedClassId = Number(button.dataset.courseFileClass)
    root.querySelectorAll('[data-course-file-class]').forEach((item) => item.classList.toggle('is-active', item === button))
    load()
  })
  root.querySelector('#course-file-category-filter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-course-file-category]')
    if (!button) return
    category = button.dataset.courseFileCategory
    root.querySelectorAll('[data-course-file-category]').forEach((item) => item.classList.toggle('is-active', item === button))
    load()
  })
  root.querySelector('#course-file-sort').addEventListener('click', (event) => {
    const button = event.target.closest('[data-course-file-sort]')
    if (!button) return
    sort = button.dataset.courseFileSort
    root.querySelectorAll('[data-course-file-sort]').forEach((item) => item.classList.toggle('is-active', item === button))
    load()
  })
  root.querySelector('#course-file-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(load, 260) })
  grid.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-file-action]')
    const card = event.target.closest('[data-course-file-id]')
    if (!action || !card) return
    const fileId = Number(card.dataset.courseFileId)
    const file = files.find((item) => item.file_id === fileId)
    try {
      if (action.dataset.fileAction === 'download') { await downloadCourseFile(course.course_id, selectedClassId, fileId, file?.original_filename); if (!canManage) await load(); return }
      if (action.dataset.fileAction === 'edit') { openDialog(file); return }
      if (action.dataset.fileAction === 'publish') { await publishCourseFile(course.course_id, selectedClassId, fileId); notify('文件已发布，学生通知已写入消息中心'); await load(); return }
      if (action.dataset.fileAction === 'unpublish') { await unpublishCourseFile(course.course_id, selectedClassId, fileId); notify('文件已下架'); await load(); return }
      if (action.dataset.fileAction === 'delete') { pendingDeleteId = fileId; root.querySelector('#course-file-confirm').hidden = false }
    } catch (error) { notify(error.message || '操作失败', true) }
  })

  if (canManage) {
    const dialog = root.querySelector('#course-file-dialog')
    const form = root.querySelector('#course-file-form')
    const fileInput = form.elements.file
    const submit = root.querySelector('#course-file-submit')
    function closeDialog() { dialog.hidden = true; form.reset(); form.elements.file_id.value = ''; form.elements.category.value = 'courseware'; root.querySelector('#course-file-choice').textContent = '选择文件'; root.querySelectorAll('[data-form-category]').forEach((button) => button.classList.toggle('is-active', button.dataset.formCategory === 'courseware')) }
    openDialog = function (file = null) {
      if (!selectedClassId) { notify('请先选择教学班', true); return }
      dialog.hidden = false
      root.querySelector('#course-file-dialog-title').textContent = file ? '编辑课程文件' : '上传课程文件'
      form.elements.file_id.value = file?.file_id || ''
      form.elements.title.value = file?.title || ''
      form.elements.description.value = file?.description || ''
      form.elements.category.value = file?.category || 'courseware'
      fileInput.required = !file
      root.querySelector('.course-file-drop').hidden = Boolean(file)
      root.querySelector('.course-file-publish-switch').hidden = Boolean(file)
      submit.textContent = file ? '保存修改' : '上传并保存'
      root.querySelectorAll('[data-form-category]').forEach((button) => button.classList.toggle('is-active', button.dataset.formCategory === form.elements.category.value))
      form.elements.title.focus()
    }
    root.querySelector('#course-file-upload-open').addEventListener('click', () => openDialog())
    root.querySelectorAll('[data-course-file-dialog-close]').forEach((button) => button.addEventListener('click', closeDialog))
    dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog() })
    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; root.querySelector('#course-file-choice').textContent = file?.name || '选择文件'; if (file && !form.elements.title.value) form.elements.title.value = file.name.replace(/\.[^.]+$/, '') })
    root.querySelector('#course-file-form-categories').addEventListener('click', (event) => { const button = event.target.closest('[data-form-category]'); if (!button) return; form.elements.category.value = button.dataset.formCategory; root.querySelectorAll('[data-form-category]').forEach((item) => item.classList.toggle('is-active', item === button)) })
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      submit.disabled = true
      try {
        const fileId = Number(form.elements.file_id.value)
        if (fileId) {
          await updateCourseFile(course.course_id, selectedClassId, fileId, { title: form.elements.title.value, description: form.elements.description.value, category: form.elements.category.value })
          notify('课程文件信息已更新')
        } else {
          const body = new FormData()
          body.append('file', fileInput.files[0])
          body.append('title', form.elements.title.value)
          body.append('description', form.elements.description.value)
          body.append('category', form.elements.category.value)
          body.append('publish_now', form.elements.publish_now.checked ? 'true' : 'false')
          const result = await uploadCourseFile(course.course_id, selectedClassId, body)
          notify(result.data?.duplicate ? '相同文件已存在，未重复写入' : (form.elements.publish_now.checked ? '文件已上传并通知学生' : '文件已保存为草稿'))
        }
        closeDialog(); await load()
      } catch (error) { notify(error.message || '文件保存失败', true) } finally { submit.disabled = false }
    })
    root.querySelector('[data-confirm-cancel]').addEventListener('click', () => { root.querySelector('#course-file-confirm').hidden = true; pendingDeleteId = null })
    root.querySelector('[data-confirm-delete]').addEventListener('click', async () => {
      try { await deleteCourseFile(course.course_id, selectedClassId, pendingDeleteId); notify('课程文件已软删除'); root.querySelector('#course-file-confirm').hidden = true; pendingDeleteId = null; await load() } catch (error) { notify(error.message || '删除失败', true) }
    })
  }
  load()
}
