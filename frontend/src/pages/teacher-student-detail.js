// 教师端 - 学生详情页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { getTeacherStudent, getStudentMastery, getStudentPortrait, refreshStudentPortrait } from '../api/teacher.js'
import { escapeHtml } from '../utils/format.js'

function clampScore(value) {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
}

function getRiskMeta(level, label) {
  const key = String(level || 'normal').toLowerCase()
  if (key === 'high') return { label: label || '高风险', cls: 'tsp-risk-high' }
  if (key === 'attention') return { label: label || '需要关注', cls: 'tsp-risk-attention' }
  return { label: label || '正常', cls: 'tsp-risk-normal' }
}

function renderPortraitEvaluation(data) {
  const dimensions = Array.isArray(data?.dimensions) ? data.dimensions : []
  const weakPoints = Array.isArray(data?.weakPoints)
    ? data.weakPoints
    : (Array.isArray(data?.weak_knowledge_points) ? data.weak_knowledge_points : [])
  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : []
  const risk = getRiskMeta(data?.riskLevel, data?.riskLabel)
  const score = clampScore(data?.comprehensiveScore ?? data?.learning_ability?.total_score)
  const tendency = data?.learningTendency || {}

  return `
    <div class="tsp-evaluation-top">
      <div class="tsp-score-block">
        <span>综合学习评分</span>
        <strong>${score}</strong>
        <small>满分 100</small>
      </div>
      <div class="tsp-summary-block">
        <div class="tsp-summary-heading">
          <h4>${escapeHtml(tendency.type || '学习状态分析')}</h4>
          <span class="tsp-risk-badge ${risk.cls}">${escapeHtml(risk.label)}</span>
        </div>
        <p>${escapeHtml(data?.summary || '当前画像数据正在持续积累。')}</p>
        ${Array.isArray(data?.riskReasons) && data.riskReasons.length
          ? `<div class="tsp-risk-reasons">${data.riskReasons.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>`
          : ''}
      </div>
    </div>
    <div class="tsp-evaluation-body">
      <section class="tsp-dimensions">
        <h4>多维度评价</h4>
        <div class="tsp-dimension-list">
          ${dimensions.length ? dimensions.map(item => {
            const value = clampScore(item.score)
            return `
              <div class="tsp-dimension-row">
                <div class="tsp-dimension-head"><span>${escapeHtml(item.label || item.key || '学习指标')}</span><strong>${value}</strong></div>
                <div class="tsp-dimension-track"><span style="width:${value}%"></span></div>
                <small>${escapeHtml(item.description || '')}</small>
              </div>`
          }).join('') : '<div class="empty-hint">暂无多维度评价数据</div>'}
        </div>
      </section>
      <div class="tsp-insights">
        <section>
          <h4>薄弱知识点</h4>
          <div class="tsp-weak-list">
            ${weakPoints.length ? weakPoints.slice(0, 5).map(item => `
              <div><span>${escapeHtml(item.knowledge_point_name || '未命名知识点')}</span><strong>${clampScore(item.mastery_score)} 分</strong></div>
            `).join('') : '<p class="tsp-empty-text">当前没有明显薄弱知识点</p>'}
          </div>
        </section>
        <section>
          <h4>教学建议</h4>
          <ul class="tsp-suggestion-list">
            ${(suggestions.length ? suggestions : ['继续观察学生学习记录，并结合课堂表现进行反馈。'])
              .slice(0, 4)
              .map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </section>
      </div>
    </div>`
}

export async function renderTeacherStudentDetail(app, params) {
  let user = getUser()
  const studentUserId = params?.student_user_id ? parseInt(params.student_user_id) : null
  if (!studentUserId) {
    window.location.hash = '#/teacher/system?tab=students'
    return
  }

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

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title" id="student-name">学生详情</h2>
        <p class="page-subtitle" id="student-info">加载中...</p>
      </div>

      <div class="stats-grid" id="student-summary" style="margin-bottom:20px;">
        <div class="stat-card"><div class="stat-value" id="stu-sessions">-</div><div class="stat-label">练习次数</div></div>
        <div class="stat-card"><div class="stat-value" id="stu-questions">-</div><div class="stat-label">答题数</div></div>
        <div class="stat-card"><div class="stat-value" id="stu-correct">-</div><div class="stat-label">正确数</div></div>
        <div class="stat-card"><div class="stat-value" id="stu-duration">-</div><div class="stat-label">学习时长(分钟)</div></div>
      </div>

      <div class="card tsp-portrait-card">
        <div class="tsp-card-heading">
          <div>
            <h3 class="card-title">学生画像与多维评价</h3>
            <p>综合知识掌握、学习进度、作业和活跃度等学习数据</p>
          </div>
        </div>
        <div id="teacher-student-portrait"><div class="empty-hint">正在分析画像数据...</div></div>
      </div>

      <div class="content-columns">
        <div class="card">
          <h3 class="card-title">选修课程</h3>
          <div id="student-courses"><div class="empty-hint">加载中...</div></div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 class="card-title" style="margin-bottom:0;">知识点掌握度</h3>
            <button class="btn btn-link" id="btn-refresh-portrait" style="font-size:0.8rem;">刷新画像</button>
          </div>
          <div id="mastery-container"><div class="empty-hint">加载中...</div></div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '学生详情',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // 存储学生可选课程供刷新画像使用
  let studentCourses = []

  async function loadData() {
    try {
      const [studentRes, masteryRes, portraitRes] = await Promise.all([
        getTeacherStudent(studentUserId),
        getStudentMastery(studentUserId),
        getStudentPortrait(studentUserId),
      ])

      const studentData = studentRes.data?.student || {}
      studentCourses = studentRes.data?.courses || []
      const summary = studentRes.data?.summary || {}
      const masteryRecords = masteryRes.data?.mastery_records || []
      const portraitData = portraitRes.data || {}

      document.getElementById('student-name').textContent = studentData.student_name || '学生详情'
      document.getElementById('student-info').textContent = `${studentData.student_no || ''} · ${studentData.college || ''} ${studentData.major || ''}`.trim() || '学生信息'

      document.getElementById('stu-sessions').textContent = summary.total_sessions ?? 0
      document.getElementById('stu-questions').textContent = summary.total_questions ?? 0
      document.getElementById('stu-correct').textContent = summary.total_correct ?? 0
      document.getElementById('stu-duration').textContent = summary.total_duration ? Math.round(summary.total_duration / 60) : 0

      const portraitContainer = document.getElementById('teacher-student-portrait')
      if (portraitContainer) portraitContainer.innerHTML = renderPortraitEvaluation(portraitData)

      // 课程列表（点击跳转课程详情）
      const coursesContainer = document.getElementById('student-courses')
      if (studentCourses.length === 0) {
        coursesContainer.innerHTML = '<div class="empty-hint">暂未选修课程</div>'
      } else {
        coursesContainer.innerHTML = studentCourses.map(c => `
          <div class="enrolled-course" data-course-id="${c.course_id}" style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.15s;border-radius:6px;padding-left:8px;">
            <div style="font-weight:500;font-size:0.9rem;color:var(--primary);">${c.course_name || '未知课程'}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);">${c.class_name || '未分配班级'}</div>
          </div>
        `).join('')

        // 点击课程跳转到课程详情
        coursesContainer.querySelectorAll('.enrolled-course').forEach(el => {
          el.addEventListener('click', () => {
            window.location.hash = `#/teacher/courses/${el.dataset.courseId}`
          })
        })
      }

      // 掌握度
      const masteryContainer = document.getElementById('mastery-container')
      if (masteryRecords.length === 0) {
        masteryContainer.innerHTML = '<div class="empty-hint">暂无掌握度数据，点击"刷新画像"生成</div>'
      } else {
        masteryContainer.innerHTML = masteryRecords.map(m => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:0.9rem;">${m.knowledge_point_name || '未知知识点'}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:60px;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${m.mastery_score}%;background:${m.mastery_score >= 75 ? '#10b981' : m.mastery_score >= 60 ? '#f59e0b' : '#ef4444'};border-radius:3px;"></div>
              </div>
              <span style="font-size:0.8rem;font-weight:500;color:${m.mastery_score >= 75 ? '#10b981' : m.mastery_score >= 60 ? '#f59e0b' : '#ef4444'};">${m.mastery_score}分</span>
              <span style="font-size:0.75rem;color:var(--text-muted);">${m.mastery_level || '-'}</span>
            </div>
          </div>
        `).join('')
      }
    } catch (err) {
      document.getElementById('student-info').textContent = '加载失败: ' + err.message
    }
  }

  document.getElementById('btn-refresh-portrait')?.addEventListener('click', async () => {
    if (!studentCourses || studentCourses.length === 0) {
      alert('该学生暂无选修课程，无法刷新画像')
      return
    }

    // 用下拉选择框替代 prompt
    const options = studentCourses.map(c =>
      `<option value="${c.course_id}">${c.course_name}${c.class_name ? ' (' + c.class_name + ')' : ''}</option>`
    ).join('')

    const html = `
      <div style="padding:8px 0;">
        <p style="margin-bottom:12px;font-size:0.9rem;color:var(--text-secondary);">请选择要刷新画像的课程：</p>
        <select id="refresh-course-select" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">${options}</select>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
          <button id="refresh-cancel-btn" class="btn" style="border:1px solid var(--border);">取消</button>
          <button id="refresh-confirm-btn" class="btn btn-primary">确认刷新</button>
        </div>
      </div>
    `

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center;'
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px;width:400px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">${html}</div>`
    document.body.appendChild(overlay)

    overlay.querySelector('#refresh-cancel-btn').onclick = () => overlay.remove()
    overlay.querySelector('#refresh-confirm-btn').onclick = async () => {
      const courseId = parseInt(overlay.querySelector('#refresh-course-select').value)
      overlay.remove()
      try {
        await refreshStudentPortrait(studentUserId, { course_id: courseId })
        alert('画像刷新成功')
        loadData()
      } catch (err) {
        alert(err.message)
      }
    }
  })

  loadData()
}


