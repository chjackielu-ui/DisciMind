// 注册页

import { register } from '../api/auth.js'
import { navigateTo } from '../utils/router.js'

const publicTeacherRegistrationEnabled = import.meta.env.VITE_PUBLIC_TEACHER_REGISTRATION_ENABLED === 'true'
  || (import.meta.env.DEV && import.meta.env.VITE_PUBLIC_TEACHER_REGISTRATION_ENABLED !== 'false')

export function renderRegisterPage(app) {
  app.innerHTML = `
    <div class="register-page">
      <div class="register-container">
        <div class="register-header">
          <h1>创建账号</h1>
          <p>加入学研智擎，开启智能教学科研之旅</p>
        </div>

        <form id="register-form" class="register-form">
          <div class="form-row">
            <div class="form-group">
              <label for="reg-username">用户名 <span class="required">*</span></label>
              <input type="text" id="reg-username" placeholder="请输入用户名" required />
            </div>
            <div class="form-group">
              <label for="reg-password">密码 <span class="required">*</span></label>
              <input type="password" id="reg-password" placeholder="请输入密码（至少6位）" required minlength="6" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="reg-real-name">真实姓名</label>
              <input type="text" id="reg-real-name" placeholder="请输入真实姓名" />
            </div>
            <div class="form-group">
              <label for="reg-role">角色 <span class="required">*</span></label>
              <select id="reg-role" required>
                <option value="">请选择角色</option>
                <option value="student">学生</option>
                ${publicTeacherRegistrationEnabled ? '<option value="teacher">教师</option>' : ''}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="reg-gender">性别</label>
              <select id="reg-gender">
                <option value="unknown">未知</option>
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </div>
            <div class="form-group">
              <label for="reg-phone">手机号</label>
              <input type="text" id="reg-phone" placeholder="请输入手机号" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="reg-email">邮箱</label>
              <input type="email" id="reg-email" placeholder="请输入邮箱地址" />
            </div>
            <div class="form-group">
              <label for="reg-college">学院</label>
              <input type="text" id="reg-college" placeholder="请输入所在学院" />
            </div>
          </div>

          <div class="form-row" id="reg-major-grade-row" hidden>
            <div class="form-group">
              <label for="reg-major">专业</label>
              <input type="text" id="reg-major" placeholder="请输入专业" />
            </div>
            <div class="form-group">
              <label for="reg-grade">年级</label>
              <input type="text" id="reg-grade" placeholder="如：2024级" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" id="reg-student-no-group" hidden>
              <label for="reg-student-no">学号</label>
              <input type="text" id="reg-student-no" placeholder="学生请填写学号" />
            </div>
            <div class="form-group" id="reg-teacher-no-group" hidden>
              <label for="reg-teacher-no">教师工号</label>
              <input type="text" id="reg-teacher-no" placeholder="教师请填写工号" />
            </div>
          </div>

          <div id="reg-error" class="form-error" style="display:none;"></div>
          <div id="reg-success" class="form-success" style="display:none;"></div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="reg-submit">注 册</button>
            <a href="#/login" class="btn btn-link">返回登录</a>
          </div>
        </form>
      </div>
    </div>
  `

  const form = document.getElementById('register-form')
  const errorEl = document.getElementById('reg-error')
  const successEl = document.getElementById('reg-success')
  const submitBtn = document.getElementById('reg-submit')
  const roleSelect = document.getElementById('reg-role')
  const majorGradeRow = document.getElementById('reg-major-grade-row')
  const studentNoGroup = document.getElementById('reg-student-no-group')
  const teacherNoGroup = document.getElementById('reg-teacher-no-group')

  function updateRoleFields() {
    const role = roleSelect.value
    majorGradeRow.hidden = role !== 'student'
    studentNoGroup.hidden = role !== 'student'
    teacherNoGroup.hidden = role !== 'teacher'
  }

  roleSelect.addEventListener('change', updateRoleFields)
  updateRoleFields()

  form.addEventListener('submit', async (e) => {
    e.preventDefault()

    // 收集表单数据
    const data = {
      username: document.getElementById('reg-username').value.trim(),
      password: document.getElementById('reg-password').value,
      role: document.getElementById('reg-role').value,
      real_name: document.getElementById('reg-real-name').value.trim(),
      gender: document.getElementById('reg-gender').value,
      phone: document.getElementById('reg-phone').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      college: document.getElementById('reg-college').value.trim(),
      major: roleSelect.value === 'student' ? document.getElementById('reg-major').value.trim() : undefined,
      grade: roleSelect.value === 'student' ? document.getElementById('reg-grade').value.trim() : undefined,
      student_no: roleSelect.value === 'student' ? document.getElementById('reg-student-no').value.trim() : undefined,
      teacher_no: roleSelect.value === 'teacher' ? document.getElementById('reg-teacher-no').value.trim() : undefined,
    }

    // 基本校验
    if (!data.username || !data.password || !data.role) {
      showError('用户名、密码、角色为必填项')
      return
    }

    if (data.password.length < 6) {
      showError('密码长度不能少于6位')
      return
    }

    // 清理空字符串（后端可选字段不传 undefined，传空字符串也可以）
    // 显示加载状态
    submitBtn.disabled = true
    submitBtn.textContent = '注册中...'
    hideError()
    hideSuccess()

    try {
      await register(data)
      showSuccess('注册成功！即将跳转到登录页...')
      setTimeout(() => {
        navigateTo('#/login')
      }, 1500)
    } catch (err) {
      showError(err.message || '注册失败，请稍后重试')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = '注 册'
    }
  })

  function showError(msg) {
    errorEl.textContent = msg
    errorEl.style.display = 'block'
  }

  function hideError() {
    errorEl.style.display = 'none'
  }

  function showSuccess(msg) {
    successEl.textContent = msg
    successEl.style.display = 'block'
  }

  function hideSuccess() {
    successEl.style.display = 'none'
  }
}
