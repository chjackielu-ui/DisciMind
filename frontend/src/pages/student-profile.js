// 学生端个人主页 — 资料维护、头像上传、密码重置

import { getMe, updateMe, uploadAvatar, changePassword } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, roleLabel } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

const API_ORIGIN = 'http://localhost:3000'
const AVATAR_SOURCE_MAX_SIZE = 8 * 1024 * 1024
const AVATAR_OUTPUT_SIZE = 512

function avatarSrc(user) {
  const url = user?.profile?.avatar_url || user?.avatar_url
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  return `${API_ORIGIN}${url.startsWith('/') ? url : '/' + url}`
}

function initials(user) {
  const name = user?.profile?.real_name || user?.username || 'U'
  return String(name).slice(0, 2).toUpperCase()
}

function profileValue(user, key) {
  return user?.profile?.[key] || ''
}

function buildInfoPill(label, value) {
  return `
    <div class="profile-info-pill">
      <span>${label}</span>
      <b>${escapeHtml(value || '-')}</b>
    </div>`
}

function buildContent(user) {
  const profile = user.profile || {}
  const avatar = avatarSrc(user)
  const className = profile.admin_class?.class_name || '-'

  return `
    <div class="student-profile-shell">
      <div class="profile-hero-card">
        <div class="profile-avatar-block">
          <button class="profile-avatar-upload" id="btn-avatar-upload" type="button" title="更换头像">
            ${avatar
              ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(profile.real_name || user.username)}" id="profile-avatar-preview" />`
              : `<span id="profile-avatar-preview">${escapeHtml(initials(user))}</span>`}
            <em>更换</em>
          </button>
          <input type="file" id="profile-avatar-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
        </div>
        <div class="profile-hero-main">
          <span class="profile-eyebrow">Student Profile</span>
          <h1>${escapeHtml(profile.real_name || user.username)}</h1>
          <p>${escapeHtml(profile.college || '学院未填写')} · ${escapeHtml(profile.major || '专业未填写')} · ${escapeHtml(profile.grade || '年级未填写')}</p>
          <div class="profile-hero-meta">
            ${buildInfoPill('用户名', user.username)}
            ${buildInfoPill('身份', roleLabel(user.role))}
            ${buildInfoPill('学号', profile.student_no)}
            ${buildInfoPill('班级', className)}
          </div>
        </div>
      </div>

      <div class="profile-grid">
        <section class="profile-panel">
          <div class="profile-panel-header">
            <div>
              <h2>个人信息</h2>
              <p>维护联系方式和基础学籍信息</p>
            </div>
          </div>
          <form id="profile-form" class="profile-form">
            <label>
              <span>真实姓名</span>
              <input name="real_name" type="text" maxlength="50" value="${escapeHtml(profile.real_name || '')}" required />
            </label>
            <label>
              <span>性别</span>
              <select name="gender">
                <option value="unknown"${profile.gender === 'unknown' ? ' selected' : ''}>未设置</option>
                <option value="male"${profile.gender === 'male' ? ' selected' : ''}>男</option>
                <option value="female"${profile.gender === 'female' ? ' selected' : ''}>女</option>
              </select>
            </label>
            <label>
              <span>邮箱</span>
              <input name="email" type="email" maxlength="100" value="${escapeHtml(user.email || '')}" />
            </label>
            <label>
              <span>手机号</span>
              <input name="phone" type="tel" maxlength="20" value="${escapeHtml(user.phone || '')}" />
            </label>
            <label>
              <span>学院</span>
              <input name="college" type="text" maxlength="100" value="${escapeHtml(profileValue(user, 'college'))}" />
            </label>
            <label>
              <span>专业</span>
              <input name="major" type="text" maxlength="100" value="${escapeHtml(profileValue(user, 'major'))}" />
            </label>
            <label>
              <span>年级</span>
              <input name="grade" type="text" maxlength="20" value="${escapeHtml(profileValue(user, 'grade'))}" />
            </label>
            <label>
              <span>学号</span>
              <input type="text" value="${escapeHtml(profile.student_no || '-')}" disabled />
            </label>
            <label>
              <span>行政班</span>
              <input type="text" value="${escapeHtml(className)}" disabled />
            </label>
            <div class="profile-form-actions">
              <button class="btn-profile-primary" type="submit">保存信息</button>
            </div>
          </form>
        </section>

        <aside class="profile-side-stack">
          <section class="profile-panel">
            <div class="profile-panel-header">
              <div>
                <h2>账号状态</h2>
                <p>登录与账号基础信息</p>
              </div>
            </div>
            <div class="profile-account-list">
              ${buildInfoPill('账号状态', user.status === 'active' ? '正常' : user.status)}
              ${buildInfoPill('最近登录', formatDate(user.last_login_at))}
              ${buildInfoPill('创建时间', formatDate(user.created_at))}
              ${buildInfoPill('资料更新', formatDate(profile.updated_at))}
            </div>
          </section>

          <section class="profile-panel">
            <div class="profile-panel-header">
              <div>
                <h2>安全设置</h2>
                <p>使用当前密码完成重置</p>
              </div>
            </div>
            <form id="password-form" class="profile-form compact">
              <label>
                <span>当前密码</span>
                <input name="current_password" type="password" autocomplete="current-password" required />
              </label>
              <label>
                <span>新密码</span>
                <input name="new_password" type="password" autocomplete="new-password" minlength="6" required />
              </label>
              <label>
                <span>确认新密码</span>
                <input name="confirm_password" type="password" autocomplete="new-password" minlength="6" required />
              </label>
              <div class="profile-form-actions">
                <button class="btn-profile-secondary" type="submit">重置密码</button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </div>`
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片读取失败，请重新选择'))
    img.src = src
  })
}

function openAvatarCropper(file) {
  return new Promise(async (resolve) => {
    const objectUrl = URL.createObjectURL(file)
    let img
    try {
      img = await loadImage(objectUrl)
    } catch (err) {
      URL.revokeObjectURL(objectUrl)
      showToast(err.message || '图片读取失败', 'error')
      resolve(null)
      return
    }

    const overlay = document.createElement('div')
    overlay.className = 'avatar-crop-overlay'
    overlay.innerHTML = `
      <div class="avatar-crop-dialog" role="dialog" aria-modal="true" aria-label="裁剪头像">
        <div class="avatar-crop-head">
          <div>
            <b>裁剪头像</b>
            <span>拖动图片并调整缩放，保留裁剪框内区域</span>
          </div>
          <button class="avatar-crop-icon-btn" id="avatar-crop-close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="avatar-crop-stage" id="avatar-crop-stage">
          <canvas id="avatar-crop-canvas" width="320" height="320"></canvas>
          <div class="avatar-crop-frame" aria-hidden="true"></div>
        </div>
        <label class="avatar-crop-zoom">
          <span>缩放</span>
          <input id="avatar-crop-zoom" type="range" min="1" max="3" step="0.01" value="1">
        </label>
        <div class="avatar-crop-actions">
          <button class="btn-profile-secondary" id="avatar-crop-cancel" type="button">取消</button>
          <button class="btn-profile-primary" id="avatar-crop-confirm" type="button">确认上传</button>
        </div>
      </div>`
    document.body.appendChild(overlay)

    const stage = overlay.querySelector('#avatar-crop-stage')
    const canvas = overlay.querySelector('#avatar-crop-canvas')
    const zoomInput = overlay.querySelector('#avatar-crop-zoom')
    const ctx = canvas.getContext('2d')
    const stageSize = 320
    const frameSize = 220
    const frameLeft = (stageSize - frameSize) / 2
    const frameTop = frameLeft
    const baseScale = Math.max(frameSize / img.naturalWidth, frameSize / img.naturalHeight)
    const transform = {
      zoom: 1,
      scale: baseScale,
      x: (stageSize - img.naturalWidth * baseScale) / 2,
      y: (stageSize - img.naturalHeight * baseScale) / 2,
    }
    let drag = null
    let settled = false

    function clampTransform() {
      transform.scale = baseScale * transform.zoom
      const drawW = img.naturalWidth * transform.scale
      const drawH = img.naturalHeight * transform.scale
      const minX = frameLeft + frameSize - drawW
      const maxX = frameLeft
      const minY = frameTop + frameSize - drawH
      const maxY = frameTop
      transform.x = Math.min(Math.max(transform.x, minX), maxX)
      transform.y = Math.min(Math.max(transform.y, minY), maxY)
    }

    function renderCrop() {
      clampTransform()
      ctx.clearRect(0, 0, stageSize, stageSize)
      ctx.fillStyle = '#f7fafb'
      ctx.fillRect(0, 0, stageSize, stageSize)
      ctx.drawImage(
        img,
        transform.x,
        transform.y,
        img.naturalWidth * transform.scale,
        img.naturalHeight * transform.scale,
      )
    }

    function cleanup(value) {
      if (settled) return
      settled = true
      URL.revokeObjectURL(objectUrl)
      overlay.remove()
      resolve(value)
    }

    stage.addEventListener('pointerdown', (event) => {
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: transform.x,
        originY: transform.y,
      }
      stage.setPointerCapture?.(event.pointerId)
    })
    stage.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return
      transform.x = drag.originX + event.clientX - drag.startX
      transform.y = drag.originY + event.clientY - drag.startY
      renderCrop()
    })
    function endDrag(event) {
      if (!drag || drag.pointerId !== event.pointerId) return
      stage.releasePointerCapture?.(event.pointerId)
      drag = null
    }
    stage.addEventListener('pointerup', endDrag)
    stage.addEventListener('pointercancel', endDrag)
    zoomInput.addEventListener('input', () => {
      const prevScale = transform.scale
      const centerX = frameLeft + frameSize / 2
      const centerY = frameTop + frameSize / 2
      transform.zoom = Number(zoomInput.value) || 1
      transform.scale = baseScale * transform.zoom
      const ratio = transform.scale / prevScale
      transform.x = centerX - (centerX - transform.x) * ratio
      transform.y = centerY - (centerY - transform.y) * ratio
      renderCrop()
    })

    overlay.querySelector('#avatar-crop-close')?.addEventListener('click', () => cleanup(null))
    overlay.querySelector('#avatar-crop-cancel')?.addEventListener('click', () => cleanup(null))
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup(null)
    })
    overlay.querySelector('#avatar-crop-confirm')?.addEventListener('click', () => {
      const output = document.createElement('canvas')
      output.width = AVATAR_OUTPUT_SIZE
      output.height = AVATAR_OUTPUT_SIZE
      const outputCtx = output.getContext('2d')
      const sx = (frameLeft - transform.x) / transform.scale
      const sy = (frameTop - transform.y) / transform.scale
      const sSize = frameSize / transform.scale
      outputCtx.drawImage(img, sx, sy, sSize, sSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE)
      output.toBlob((blob) => {
        if (!blob) {
          showToast('头像裁剪失败，请重新选择', 'error')
          cleanup(null)
          return
        }
        const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
        cleanup(cropped)
      }, 'image/jpeg', 0.9)
    })

    renderCrop()
  })
}

export async function renderStudentProfile(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildContent(user), user })
  bindProfileEvents()
}

function bindProfileEvents() {
  const avatarBtn = document.getElementById('btn-avatar-upload')
  const avatarInput = document.getElementById('profile-avatar-input')
  const profileForm = document.getElementById('profile-form')
  const passwordForm = document.getElementById('password-form')

  avatarBtn?.addEventListener('click', () => avatarInput?.click())
  avatarInput?.addEventListener('change', async () => {
    const file = avatarInput.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error')
      return
    }
    if (file.size > AVATAR_SOURCE_MAX_SIZE) {
      showToast('原始图片不能超过 8MB', 'error')
      return
    }

    const croppedFile = await openAvatarCropper(file)
    avatarInput.value = ''
    if (!croppedFile) return

    const preview = document.getElementById('profile-avatar-preview')
    const nextSrc = URL.createObjectURL(croppedFile)
    if (preview?.tagName === 'IMG') {
      preview.src = nextSrc
    } else if (preview) {
      const img = document.createElement('img')
      img.id = 'profile-avatar-preview'
      img.alt = '头像预览'
      img.src = nextSrc
      preview.replaceWith(img)
    }

    try {
      const result = await uploadAvatar(croppedFile)
      setAuth(getToken(), result.data.user)
      showToast('头像已更新', 'success')
      URL.revokeObjectURL(nextSrc)
      setTimeout(() => window.location.reload(), 500)
    } catch (err) {
      URL.revokeObjectURL(nextSrc)
      showToast(err.message || '头像上传失败', 'error')
    }
  })

  profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = new FormData(profileForm)
    const payload = Object.fromEntries(form.entries())

    try {
      const result = await updateMe(payload)
      setAuth(getToken(), result.data.user)
      showToast('个人信息已保存', 'success')
      setTimeout(() => window.location.reload(), 500)
    } catch (err) {
      showToast(err.message || '保存失败', 'error')
    }
  })

  passwordForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = new FormData(passwordForm)
    const currentPassword = form.get('current_password')
    const newPassword = form.get('new_password')
    const confirmPassword = form.get('confirm_password')

    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'error')
      return
    }

    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      passwordForm.reset()
      showToast('密码已重置', 'success')
    } catch (err) {
      showToast(err.message || '密码重置失败', 'error')
    }
  })
}
