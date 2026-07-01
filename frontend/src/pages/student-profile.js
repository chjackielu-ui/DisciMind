// 学生端个人主页 — 资料维护、头像上传、密码重置

import { getMe, updateMe, uploadAvatar, changePassword } from '../api/auth.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, roleLabel } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

const API_ORIGIN = 'http://localhost:3000'

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

export async function renderStudentProfile(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(localStorage.getItem('token') || '', user)
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
    if (file.size > 2 * 1024 * 1024) {
      showToast('头像图片不能超过 2MB', 'error')
      return
    }

    const preview = document.getElementById('profile-avatar-preview')
    const nextSrc = URL.createObjectURL(file)
    if (preview?.tagName === 'IMG') preview.src = nextSrc

    try {
      const result = await uploadAvatar(file)
      setAuth(localStorage.getItem('token') || '', result.data.user)
      showToast('头像已更新', 'success')
      setTimeout(() => window.location.reload(), 500)
    } catch (err) {
      showToast(err.message || '头像上传失败', 'error')
    }
  })

  profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = new FormData(profileForm)
    const payload = Object.fromEntries(form.entries())

    try {
      const result = await updateMe(payload)
      setAuth(localStorage.getItem('token') || '', result.data.user)
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
