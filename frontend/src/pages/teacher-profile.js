import { getMe, changePassword, uploadAvatar } from '../api/auth.js'
import { getTeacherProfile, updateTeacherProfile } from '../api/teacher.js'
import { getUser, getToken, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

function shell(profile) {
  const prefs = profile.preferences || {}; const messages = prefs.message_preferences || {}; const ai = prefs.ai_preferences || {}
  return `<div class="teacher-profile-page"><header class="teacher-page-head compact"><div><span class="teacher-eyebrow">账户与教学偏好</span><h2>教师个人中心</h2><p>个人资料、默认课程、消息与 AI 偏好统一管理。</p></div></header><div class="teacher-profile-layout">
    <aside class="teacher-profile-summary"><label class="teacher-profile-avatar">${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="头像">` : `<span>${escapeHtml((profile.name || '师').slice(0, 1))}</span>`}<input id="profile-avatar-input" type="file" accept="image/png,image/jpeg,image/webp" hidden><i>更换头像</i></label><h3>${escapeHtml(profile.name || '教师')}</h3><p>${escapeHtml(profile.professional_title || '教师')} · ${escapeHtml(profile.college || '未填写学院')}</p><div><span><b>${profile.statistics?.course_count || 0}</b>负责课程</span><span><b>${profile.statistics?.teaching_class_count || 0}</b>教学班</span></div><dl><dt>教师工号</dt><dd>${escapeHtml(profile.teacher_no || '未填写')}</dd><dt>最近登录</dt><dd>${profile.last_login_at ? new Date(profile.last_login_at).toLocaleString('zh-CN') : '暂无记录'}</dd></dl></aside>
    <main><form id="teacher-profile-form" class="teacher-profile-card"><header><h3>基本资料</h3><button class="teacher-btn primary" type="submit">保存</button></header><div class="teacher-form-grid"><label>姓名<input name="name" value="${escapeHtml(profile.name || '')}"></label><label>职称<input name="professional_title" value="${escapeHtml(profile.professional_title || '')}"></label><label>学院<input name="college" value="${escapeHtml(profile.college || '')}"></label><label>邮箱<input name="email" type="email" value="${escapeHtml(profile.email || '')}"></label><label>手机<input name="phone" value="${escapeHtml(profile.phone || '')}"></label><label>默认课程<select name="default_course_id"><option value="">不指定</option>${(profile.courses || []).map(item => `<option value="${item.course_id}" ${item.course_id === profile.default_course_id ? 'selected' : ''}>${escapeHtml(item.course_name)}</option>`).join('')}</select></label></div></form>
    <form id="teacher-preference-form" class="teacher-profile-card"><header><h3>教学与 AI 偏好</h3><button class="teacher-btn primary" type="submit">保存偏好</button></header><div class="teacher-preference-grid"><section><h4>消息偏好</h4>${[['task_submission', '学生提交作业或考试'], ['knowledge_review', '知识库公开申请'], ['risk_alert', '风险学生与班级异常'], ['ai_task', 'AI 任务与文件完成']].map(([key, label]) => `<label><input type="checkbox" name="message_${key}" ${messages[key] !== false ? 'checked' : ''}><span>${label}</span></label>`).join('')}</section><section><h4>AI 偏好</h4><label>回答风格<select name="ai_response_style"><option value="structured" ${ai.response_style === 'structured' ? 'selected' : ''}>结构化</option><option value="concise" ${ai.response_style === 'concise' ? 'selected' : ''}>简洁</option><option value="detailed" ${ai.response_style === 'detailed' ? 'selected' : ''}>详细</option></select></label><label><input type="checkbox" name="ai_auto_sources" ${ai.auto_include_sources !== false ? 'checked' : ''}><span>默认标注数据来源</span></label><label>默认学情范围<select name="default_analytics_range"><option value="7d" ${prefs.default_analytics_range === '7d' ? 'selected' : ''}>最近 7 天</option><option value="30d" ${prefs.default_analytics_range === '30d' ? 'selected' : ''}>最近 30 天</option><option value="semester" ${prefs.default_analytics_range === 'semester' ? 'selected' : ''}>本学期</option></select></label></section></div></form>
    <form id="teacher-password-form" class="teacher-profile-card"><header><h3>修改密码</h3><button class="teacher-btn" type="submit">更新密码</button></header><div class="teacher-form-grid"><label>当前密码<input name="current_password" type="password" autocomplete="current-password" required></label><label>新密码<input name="new_password" type="password" minlength="6" autocomplete="new-password" required></label><label>确认新密码<input name="confirm_password" type="password" minlength="6" autocomplete="new-password" required></label></div></form>
    <section class="teacher-profile-card"><header><h3>负责教学空间</h3></header><div class="teacher-profile-course-list">${(profile.courses || []).map(course => `<button data-course-id="${course.course_id}"><b>${escapeHtml(course.course_name)}</b><span>${escapeHtml(course.course_code)}</span></button>`).join('') || '<p>暂无负责课程</p>'}</div></section></main></div></div>`
}

function bind(user) {
  document.getElementById('teacher-profile-form').addEventListener('submit', async event => { event.preventDefault(); await updateTeacherProfile(Object.fromEntries(new FormData(event.target).entries())); showToast('教师资料已更新', 'success') })
  document.getElementById('teacher-preference-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.target); await updateTeacherProfile({ preferences: { message_preferences: { task_submission: form.has('message_task_submission'), knowledge_review: form.has('message_knowledge_review'), risk_alert: form.has('message_risk_alert'), ai_task: form.has('message_ai_task') }, ai_preferences: { response_style: form.get('ai_response_style'), auto_include_sources: form.has('ai_auto_sources') }, default_analytics_range: form.get('default_analytics_range') } }); showToast('偏好已保存', 'success') })
  document.getElementById('teacher-password-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const currentPassword = String(formData.get('current_password') || '')
    const newPassword = String(formData.get('new_password') || '')
    const confirmPassword = String(formData.get('confirm_password') || '')

    if (!currentPassword) {
      showToast('请输入当前密码', 'warning')
      return
    }
    if (newPassword.length < 6) {
      showToast('新密码长度不能少于 6 位', 'warning')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'warning')
      return
    }

    const submitButton = form.querySelector('button[type="submit"]')
    const originalLabel = submitButton?.textContent
    if (submitButton) {
      submitButton.disabled = true
      submitButton.textContent = '更新中…'
    }

    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword })
      form.reset()
      showToast('密码已更新', 'success')
    } catch (error) {
      showToast(error?.message || '密码更新失败，请稍后重试', 'error')
    } finally {
      if (submitButton) {
        submitButton.disabled = false
        submitButton.textContent = originalLabel || '更新密码'
      }
    }
  })
  document.querySelector('.teacher-profile-avatar').addEventListener('click', () => document.getElementById('profile-avatar-input').click())
  document.getElementById('profile-avatar-input').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; const result = await uploadAvatar(file); user.profile = { ...(user.profile || {}), avatar_url: result.data?.avatar_url }; setAuth(getToken(), user); showToast('头像已更新，刷新页面后生效', 'success') })
  document.querySelectorAll('[data-course-id]').forEach(button => button.addEventListener('click', () => { window.location.hash = `#/teacher/courses/${button.dataset.courseId}` }))
}

export async function renderTeacherProfile(app) {
  let user = getUser(); try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }
  try { const result = await getTeacherProfile(); renderDashboardLayout(app, { title: '教师个人中心', menuItems: TEACHER_MENU_ITEMS, contentHTML: shell(result.data), user }); bind(user) }
  catch (error) { renderDashboardLayout(app, { title: '教师个人中心', menuItems: TEACHER_MENU_ITEMS, contentHTML: `<div class="analytics-empty"><b>个人中心加载失败</b><p>${escapeHtml(error.message)}</p></div>`, user }) }
}
