// 教师端 — 智能教案生成页
// 包含：课程选择 → 词云关键词分析 → 教案生成 → 预览 → DOCX 下载
// v2: 左右双栏布局 + seed 关键词兜底 + 异步任务状态恢复 + 完成通知

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { getTeacherCourses, getTeachingClasses, createLessonPlanTask, getLessonPlanTask, getLessonPlanKeywords } from '../api/teacher.js'
import { getIcon } from '../utils/icons.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { getSeedKeywords, shouldUseSeed } from '../data/lesson-plan-seed-keywords.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

// sessionStorage keys for cross-page task state recovery
const TASK_STATE_KEY = 'discimind.lessonPlanTask'
const TASK_STATE_POLL_KEY = 'discimind.lessonPlanPolling'

function saveTaskState(state) {
  try { sessionStorage.setItem(TASK_STATE_KEY, JSON.stringify(state)) } catch {}
}
function loadTaskState() {
  try { const raw = sessionStorage.getItem(TASK_STATE_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
function clearTaskState() {
  try { sessionStorage.removeItem(TASK_STATE_KEY) } catch {}
}
function setPollingFlag(v) {
  try { sessionStorage.setItem(TASK_STATE_POLL_KEY, v ? '1' : '0') } catch {}
}
function getPollingFlag() {
  try { return sessionStorage.getItem(TASK_STATE_POLL_KEY) === '1' } catch { return false }
}

// 注入 toast CSS 动画（全局一次性）
function ensureToastStyle() {
  if (document.getElementById('lp-toast-style')) return
  const style = document.createElement('style')
  style.id = 'lp-toast-style'
  style.textContent = `@keyframes lpToastIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}`
  document.head.appendChild(style)
}
ensureToastStyle()

// ---- Toast 通知（挂载到 window，跨页面 SPA 导航后仍可用）----
function showToast(message, type = 'info', durationMs = 5000, onClick = null) {
  const existing = document.getElementById('lp-toast')
  if (existing) existing.remove()

  const bg = type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#2563eb'
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'
  const toast = document.createElement('div')
  toast.id = 'lp-toast'
  toast.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:99999;
    background:${bg};color:#fff;padding:12px 20px;border-radius:10px;
    box-shadow:0 4px 20px rgba(0,0,0,0.22);font-size:0.9rem;font-weight:500;
    display:flex;align-items:center;gap:10px;max-width:440px;cursor:default;
    animation:lpToastIn 0.3s ease;
  `
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`
  if (onClick) {
    toast.style.cursor = 'pointer'
    toast.addEventListener('click', onClick)
  }
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.3s'
    setTimeout(() => toast.remove(), 300)
  }, durationMs)
}

// 挂载到 window 以便全局轮询器跨页面调用
window.__lpShowToast = showToast

// ---- 跨页面全局轮询器（用户离开教案页面后仍持续检查任务状态）----
function startGlobalPoller(taskId) {
  // 先停掉已有的全局轮询器
  stopGlobalPoller()

  const POLL_INTERVAL_MS = 5000
  const MAX_DURATION_MS = 10 * 60 * 1000  // 最多轮询 10 分钟
  const startTime = Date.now()

  const poll = async () => {
    // 超时检查
    if (Date.now() - startTime > MAX_DURATION_MS) {
      stopGlobalPoller()
      clearTaskState()
      if (window.location.hash !== '#/teacher/lesson-plan') {
        window.__lpShowToast('⏱️ 教案生成超时，请返回教案页面重试', 'error', 8000)
      }
      return
    }

    // 检查任务是否已被清除（用户可能在页面上已完成/重置）
    const saved = loadTaskState()
    if (!saved || saved.taskId !== taskId) {
      stopGlobalPoller()
      return
    }

    try {
      const token = (await import('../utils/auth.js')).getToken()
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'
      const res = await fetch(`${API_BASE_URL}/teacher/lesson-plan/task/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
      const task = (await res.json()).data || (await res.json())

      if (task.status === 'SUCCEEDED') {
        stopGlobalPoller()
        // 不清理 sessionStorage — 保留 taskId 供返回页面时恢复结果
        // 仅当用户不在教案页面时显示跨页面通知（页面内有自己的通知）
        if (window.location.hash !== '#/teacher/lesson-plan') {
          window.__lpShowToast('📋 教案已生成完成！点击返回查看预览或下载 DOCX。', 'success', 10000, () => {
            window.location.hash = '#/teacher/lesson-plan'
          })
        }
      } else if (task.status === 'FAILED') {
        stopGlobalPoller()
        clearTaskState()
        if (window.location.hash !== '#/teacher/lesson-plan') {
          window.__lpShowToast('❌ 教案生成失败：' + (task.errorMessage || '请稍后重试'), 'error', 8000)
        }
      }
      // QUEUED / RUNNING → 继续轮询
    } catch {
      // 网络错误 → 继续轮询（不因单次失败停止）
    }
  }

  // 立即执行一次，然后定时轮询
  poll()
  const timerId = setInterval(poll, POLL_INTERVAL_MS)
  window.__lpGlobalPoller = { timerId, taskId }
}

function stopGlobalPoller() {
  if (window.__lpGlobalPoller) {
    clearInterval(window.__lpGlobalPoller.timerId)
    window.__lpGlobalPoller = null
  }
}

export async function renderTeacherLessonPlan(app) {
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

  const displayName = getUserDisplayName()

  // ---- 状态变量 ----
  let generatedPlan = null
  let generatedFileName = null
  let generatedFilePath = null
  let generatedDownloadUrl = null
  let currentKeywords = []
  let isGenerating = false
  let pollTimerId = null
  let courseList = []
  let classList = []
  let restoredTaskId = null

  // ---- 右侧栏 HTML ----
  const sidebarHTML = `
    <div class="lp-sidebar-card card" style="margin-bottom:16px;">
      <h3 class="card-title" style="margin-bottom:14px;font-size:0.95rem;">课程与班级</h3>
      <div class="form-group" style="margin-bottom:12px;">
        <label style="font-size:0.82rem;font-weight:600;">选择课程 <span class="required">*</span></label>
        <select id="lp-course" required style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;">
          <option value="">请选择课程</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:0.82rem;font-weight:600;">教学班级</label>
        <select id="lp-class" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;">
          <option value="">请先选择课程</option>
        </select>
      </div>
    </div>

    <div class="lp-sidebar-card card" style="margin-bottom:16px;">
      <h3 class="card-title" style="margin-bottom:14px;font-size:0.95rem;">教案参数</h3>
      <div class="form-group" style="margin-bottom:10px;">
        <label style="font-size:0.82rem;font-weight:600;">授课主题</label>
        <input type="text" id="lp-topic" placeholder="如：线性回归算法" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;">
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label style="font-size:0.82rem;font-weight:600;">授课日期</label>
        <input type="date" id="lp-date" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;">
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label style="font-size:0.82rem;font-weight:600;">课时安排</label>
        <input type="text" id="lp-period" placeholder="如：2课时（90分钟）" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;">
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label style="font-size:0.82rem;font-weight:600;">课型</label>
        <select id="lp-type" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;">
          <option value="新授课">新授课</option>
          <option value="复习课">复习课</option>
          <option value="讲评课">讲评课</option>
          <option value="实验课">实验课</option>
          <option value="练习课">练习课</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label style="font-size:0.82rem;font-weight:600;">授课地点</label>
        <input type="text" id="lp-venue" placeholder="如：多媒体教室A201" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;">
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:0.82rem;font-weight:600;">教材/教学资源</label>
        <input type="text" id="lp-material" placeholder="如：机器学习（周志华）" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;">
      </div>
    </div>

    <div class="lp-sidebar-card card" style="margin-bottom:16px;">
      <h3 class="card-title" style="margin-bottom:14px;font-size:0.95rem;">生成操作</h3>
      <button class="btn btn-primary" id="btn-generate" style="width:100%;padding:10px 0;font-size:0.9rem;font-weight:600;margin-bottom:10px;">生成教案</button>
      <button class="btn" id="btn-export-docx" style="width:100%;border:1px solid var(--border);padding:10px 0;font-size:0.85rem;display:none;">下载 DOCX</button>
      <button class="btn" id="btn-reset" style="width:100%;border:1px solid var(--border);padding:8px 0;font-size:0.82rem;display:none;margin-top:6px;">重新生成</button>
    </div>

    <div class="lp-sidebar-card card" style="margin-bottom:16px;" id="lp-status-card">
      <h3 class="card-title" style="margin-bottom:10px;font-size:0.95rem;">任务状态</h3>
      <div id="lp-status-content" style="font-size:0.82rem;color:var(--text-muted);line-height:1.6;">
        尚未开始生成教案。请选择课程后点击"生成教案"。
      </div>
      <div id="lp-status-progress" style="display:none;margin-top:10px;">
        <div style="background:#E2E8F0;border-radius:4px;height:6px;overflow:hidden;">
          <div id="lp-status-bar" style="background:var(--primary);height:100%;width:0%;transition:width 0.5s;"></div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;" id="lp-status-stage"></div>
      </div>
    </div>
  `

  // ---- 主内容 HTML ----
  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header" style="margin-bottom:18px;">
        <h2 class="page-title">智能教案生成</h2>
        <p class="page-subtitle">基于学情数据与词云关键词分析，自动生成结构化教案</p>
      </div>

      <div class="lp-layout" style="display:flex;gap:22px;align-items:flex-start;">
        <!-- 左侧：主内容区 -->
        <div class="lp-main" style="flex:1;min-width:0;">

          <!-- 词云关键词分析 -->
          <div class="card" style="margin-bottom:18px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <h3 class="card-title" style="margin:0;">词云关键词分析</h3>
              <button class="btn" id="btn-refresh-keywords" style="border:1px solid var(--border);padding:6px 14px;font-size:0.82rem;">刷新关键词</button>
            </div>
            <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px;">
              基于学生提问记录、错题文本、学习平台问答、词云分析自动提取。词越大代表出现频率越高。
            </p>
            <div id="keyword-cloud-container" style="min-height:60px;padding:8px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
              <span style="color:var(--text-muted);font-size:0.85rem;">请先选择课程，然后点击"刷新关键词"</span>
            </div>
            <div id="keyword-seed-hint" style="display:none;font-size:0.75rem;color:var(--text-muted);margin-top:6px;padding:4px 8px;background:#FFFBEB;border-radius:6px;border:1px dashed #FDE68A;"></div>
            <div id="keyword-table-container" style="margin-top:12px;display:none;">
              <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                <thead>
                  <tr style="background:var(--primary);color:#fff;">
                    <th style="padding:7px 10px;text-align:left;">关键词</th>
                    <th style="padding:7px 10px;text-align:center;">出现频次</th>
                    <th style="padding:7px 10px;text-align:center;">关键词类型</th>
                    <th style="padding:7px 10px;text-align:center;">难度判断</th>
                  </tr>
                </thead>
                <tbody id="keyword-table-body"></tbody>
              </table>
            </div>
          </div>

          <!-- 教案预览区 -->
          <div id="plan-preview" style="display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
              <h3 style="font-size:1.1rem;font-weight:700;color:#1F2933;margin:0;">教案预览</h3>
              <span style="font-size:0.82rem;color:var(--text-muted);" id="generate-time"></span>
            </div>
            <div class="card" id="plan-content" style="padding:28px;line-height:1.8;font-size:0.88rem;"></div>
          </div>
        </div>

        <!-- 右侧：控制区 -->
        <div class="lp-sidebar" style="width:280px;flex-shrink:0;">
          ${sidebarHTML}
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '智能教案',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // ---- 响应式调整：窄屏时右侧栏移到下方 ----
  function applyResponsive() {
    const layout = document.querySelector('.lp-layout')
    if (!layout) return
    if (window.innerWidth <= 900) {
      layout.style.flexDirection = 'column'
      const sidebar = layout.querySelector('.lp-sidebar')
      if (sidebar) { sidebar.style.width = '100%'; sidebar.style.flexShrink = '1' }
    } else {
      layout.style.flexDirection = 'row'
      const sidebar = layout.querySelector('.lp-sidebar')
      if (sidebar) { sidebar.style.width = '280px'; sidebar.style.flexShrink = '0' }
    }
  }
  applyResponsive()
  window.addEventListener('resize', applyResponsive)

  // ---- 初始化日期 ----
  const today = new Date().toISOString().slice(0, 10)
  const dateEl = document.getElementById('lp-date')
  if (dateEl && !dateEl.value) dateEl.value = today

  // ---- 加载课程 ----
  async function loadCourses() {
    try {
      const res = await getTeacherCourses()
      courseList = res.data.list || []
      const select = document.getElementById('lp-course')
      select.innerHTML = '<option value="">请选择课程</option>'
      courseList.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.course_id
        opt.textContent = c.course_name
        select.appendChild(opt)
      })
    } catch (err) {
      console.error('加载课程失败', err)
    }
  }

  // ---- 课程切换 → 加载班级 ----
  document.getElementById('lp-course')?.addEventListener('change', async (e) => {
    const courseId = parseInt(e.target.value)
    const classSelect = document.getElementById('lp-class')
    classSelect.innerHTML = '<option value="">加载中...</option>'
    if (!courseId) {
      classSelect.innerHTML = '<option value="">请先选择课程</option>'
      document.getElementById('keyword-cloud-container').innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem;">请先选择课程</span>'
      document.getElementById('keyword-table-container').style.display = 'none'
      document.getElementById('keyword-seed-hint').style.display = 'none'
      return
    }
    try {
      const res = await getTeachingClasses(courseId)
      classList = res.data.list || []
      classSelect.innerHTML = '<option value="">全选班级</option>'
      classList.forEach(tc => {
        const opt = document.createElement('option')
        opt.value = tc.teaching_class_id
        opt.textContent = tc.teaching_class_name
        classSelect.appendChild(opt)
      })
    } catch (err) {
      classSelect.innerHTML = '<option value="">加载失败</option>'
    }
  })

  // ---- 渲染关键词云与表格 ----
  function renderKeywordDisplay(keywords, isSeed = false) {
    const cloudContainer = document.getElementById('keyword-cloud-container')
    const tableContainer = document.getElementById('keyword-table-container')
    const tableBody = document.getElementById('keyword-table-body')
    const seedHint = document.getElementById('keyword-seed-hint')

    if (!keywords || keywords.length === 0) {
      cloudContainer.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem;width:100%;text-align:center;padding:16px 0;">当前暂无关键词数据</span>'
      tableContainer.style.display = 'none'
      if (seedHint) seedHint.style.display = 'none'
      return
    }

    // seed 提示
    if (seedHint) {
      seedHint.style.display = isSeed ? 'block' : 'none'
      if (isSeed) seedHint.textContent = '💡 当前展示的是示例关键词数据（用于页面排版预览），真实学生提问数据不足时自动显示。生成教案时会使用真实数据。'
    }

    // 词云渲染
    const maxFreq = keywords[0]?.frequency || keywords[0]?.count || 1
    cloudContainer.innerHTML = keywords.map(k => {
      const freq = k.frequency || k.count || 1
      const ratio = freq / maxFreq
      const size = 14 + Math.round(ratio * 28)
      const color = ratio >= 0.7 ? '#dc2626' : ratio >= 0.4 ? '#d97706' : '#2563eb'
      return `<span style="display:inline-block;padding:6px 10px;font-size:${size}px;color:${color};font-weight:${ratio >= 0.7 ? 700 : 500};border-radius:8px;background:${ratio >= 0.7 ? '#FEF2F2' : ratio >= 0.4 ? '#FFFBEB' : '#EFF6FF'};border:1px solid ${color}20;transition:all 0.2s;" title="频次:${freq} 难度:${k.difficulty || '-'}">${escapeHtml(k.keyword || k.word || '')}</span>`
    }).join('')

    // 关键词表格
    tableContainer.style.display = 'block'
    tableBody.innerHTML = keywords.map(k => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid var(--border);font-weight:${k.difficulty === '高' ? '600' : '400'};">${escapeHtml(k.keyword || k.word || '')}</td>
        <td style="padding:6px 10px;text-align:center;border-bottom:1px solid var(--border);">${k.frequency || k.count || 0}</td>
        <td style="padding:6px 10px;text-align:center;border-bottom:1px solid var(--border);">${escapeHtml(k.category || '-')}</td>
        <td style="padding:6px 10px;text-align:center;border-bottom:1px solid var(--border);">
          <span style="background:${k.difficulty === '高' ? '#FEF2F2' : k.difficulty === '中' ? '#FFFBEB' : '#F0FDF4'};color:${k.difficulty === '高' ? '#dc2626' : k.difficulty === '中' ? '#d97706' : '#16a34a'};padding:2px 8px;border-radius:10px;font-weight:500;">
            ${k.difficulty === '高' ? '高（重点关注）' : k.difficulty === '中' ? '中（需要关注）' : '低（一般提及）'}
          </span>
        </td>
      </tr>
    `).join('')
  }

  // ---- 刷新关键词（带 seed 兜底）----
  document.getElementById('btn-refresh-keywords')?.addEventListener('click', async () => {
    const courseId = parseInt(document.getElementById('lp-course').value)
    if (!courseId) { alert('请先选择课程'); return }

    const cloudContainer = document.getElementById('keyword-cloud-container')
    const tableContainer = document.getElementById('keyword-table-container')
    const seedHint = document.getElementById('keyword-seed-hint')
    cloudContainer.innerHTML = '<span style="color:var(--text-muted);">加载中...</span>'
    tableContainer.style.display = 'none'
    if (seedHint) seedHint.style.display = 'none'

    try {
      const res = await getLessonPlanKeywords({ course_id: courseId })
      currentKeywords = res.data?.keywords || []

      if (shouldUseSeed(currentKeywords)) {
        // 真实数据为空 → 使用 seed 兜底展示
        const seedData = getSeedKeywords()
        renderKeywordDisplay(seedData, true)
        currentKeywords = [] // 保持空，确保真实数据优先原则
        return
      }

      // 有真实数据 → 优先使用
      renderKeywordDisplay(currentKeywords, false)
    } catch (err) {
      cloudContainer.innerHTML = `<span style="color:#dc2626;">加载失败: ${escapeHtml(err.message)}</span>`
    }
  })

  // ---- 收集表单数据 ----
  function collectFormData() {
    return {
      course_id: parseInt(document.getElementById('lp-course').value),
      teaching_class_id: parseInt(document.getElementById('lp-class').value) || undefined,
      topic: document.getElementById('lp-topic').value.trim() || undefined,
      teaching_date: document.getElementById('lp-date').value || undefined,
      period: document.getElementById('lp-period').value.trim() || undefined,
      lesson_type: document.getElementById('lp-type').value || undefined,
      venue: document.getElementById('lp-venue').value.trim() || undefined,
      teaching_material: document.getElementById('lp-material').value.trim() || undefined,
    }
  }

  // ---- 更新右侧状态栏 ----
  function updateStatusCard(statusHtml, showProgress = false) {
    const content = document.getElementById('lp-status-content')
    const progress = document.getElementById('lp-status-progress')
    if (content) content.innerHTML = statusHtml
    if (progress) progress.style.display = showProgress ? 'block' : 'none'
  }

  function updateStatusProgress(percent, stageText) {
    const bar = document.getElementById('lp-status-bar')
    const stage = document.getElementById('lp-status-stage')
    if (bar) bar.style.width = (percent || 0) + '%'
    if (stage) stage.textContent = stageText || ''
  }

  // ---- 轮询任务状态 ----
  async function pollTask(taskId) {
    if (pollTimerId) { clearTimeout(pollTimerId); pollTimerId = null }
    setPollingFlag(true)
    const maxAttempts = 60
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => { pollTimerId = setTimeout(r, 3000) })
      try {
        const res = await getLessonPlanTask(taskId)
        const task = res.data || res
        updateStatusProgress(task.progress || 0, task.stage || '')
        updateStatusCard(`
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:20px;height:20px;border:3px solid #BFDBFE;border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
            <span style="color:var(--primary);font-weight:600;">${task.status === 'RUNNING' ? '正在生成教案...' : task.stage || '处理中...'}</span>
          </div>
        `, true)

        if (task.status === 'SUCCEEDED') {
          setPollingFlag(false)
          onTaskSuccess(task)
          return
        }
        if (task.status === 'FAILED') {
          setPollingFlag(false)
          onTaskFailed(task)
          return
        }
      } catch (e) {
        console.error('轮询失败:', e)
      }
    }
    setPollingFlag(false)
    onTaskTimeout()
  }

  function onTaskSuccess(task) {
    if (pollTimerId) { clearTimeout(pollTimerId); pollTimerId = null }
    const meta = task.metadataJson || {}

    updateStatusProgress(100, '✅ 教案生成完成！')
    updateStatusCard(`
      <div style="color:#16a34a;font-weight:600;">✅ 教案生成完成！</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${new Date(task.completedAt || Date.now()).toLocaleString()}</div>
    `, true)
    document.getElementById('lp-status-bar').style.background = '#16a34a'

    document.getElementById('generate-time').textContent = `生成时间：${new Date(task.completedAt || Date.now()).toLocaleString()}`

    // 渲染预览
    if (meta.result_json) {
      generatedPlan = meta.result_json
      renderPlanPreview(generatedPlan)
      document.getElementById('plan-preview').style.display = 'block'
    } else {
      document.getElementById('plan-content').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">教案已生成，请下载 DOCX 查看完整内容</div>'
      document.getElementById('plan-preview').style.display = 'block'
    }

    // 下载链接
    generatedDownloadUrl = meta.docx_download_url || null
    generatedFileName = meta.docx_file_name || null
    generatedFilePath = meta.docx_path || null
    document.getElementById('btn-export-docx').style.display = 'inline-block'
    document.getElementById('btn-reset').style.display = 'inline-block'
    document.getElementById('btn-generate').disabled = false
    document.getElementById('btn-generate').textContent = '重新生成'
    isGenerating = false

    // 停止全局轮询器 + 清除保存的任务状态
    stopGlobalPoller()
    clearTaskState()

    // Toast 通知（页面内）
    showToast('教案已生成完成！可下载 DOCX 查看完整内容。', 'success', 6000)
  }

  function onTaskFailed(task) {
    if (pollTimerId) { clearTimeout(pollTimerId); pollTimerId = null }
    updateStatusProgress(0, '')
    document.getElementById('lp-status-bar').style.background = '#dc2626'
    updateStatusCard(`
      <div style="color:#dc2626;font-weight:600;">❌ 生成失败</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${escapeHtml(task.errorMessage || '未知错误')}</div>
    `)
    showToast('教案生成失败：' + (task.errorMessage || '请稍后重试'), 'error', 6000)
    document.getElementById('btn-generate').disabled = false
    document.getElementById('btn-generate').textContent = '生成教案'
    isGenerating = false
    stopGlobalPoller()
    clearTaskState()
  }

  function onTaskTimeout() {
    if (pollTimerId) { clearTimeout(pollTimerId); pollTimerId = null }
    updateStatusCard(`
      <div style="color:#d97706;font-weight:600;">⏱️ 生成超时</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">请稍后重试或查看任务列表</div>
    `)
    showToast('教案生成超时，请稍后重试', 'error', 5000)
    document.getElementById('btn-generate').disabled = false
    document.getElementById('btn-generate').textContent = '生成教案'
    isGenerating = false
    stopGlobalPoller()
    clearTaskState()
  }

  // ---- 生成教案（异步任务）----
  document.getElementById('btn-generate')?.addEventListener('click', async () => {
    const formData = collectFormData()
    if (!formData.course_id) { alert('请选择课程'); return }

    isGenerating = true
    const btnGen = document.getElementById('btn-generate')
    btnGen.disabled = true
    btnGen.textContent = '创建任务...'

    updateStatusCard(`
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:20px;height:20px;border:3px solid #BFDBFE;border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <span style="color:var(--primary);font-weight:600;">正在创建教案生成任务...</span>
      </div>
    `, true)
    updateStatusProgress(0, '')
    document.getElementById('lp-status-bar').style.background = 'var(--primary)'

    document.getElementById('btn-export-docx').style.display = 'none'
    document.getElementById('btn-reset').style.display = 'none'
    document.getElementById('plan-preview').style.display = 'none'
    generatedPlan = null
    generatedDownloadUrl = null

    try {
      const res = await createLessonPlanTask(formData)
      const task = res.data || res
      if (task.code && task.code > 0) throw new Error(task.message || '创建任务失败')

      // 保存任务状态到 sessionStorage（用于离开页面后恢复）
      saveTaskState({
        taskId: task.id,
        courseId: formData.course_id,
        createdAt: Date.now(),
      })
      restoredTaskId = task.id

      // 启动跨页面全局轮询器（用户离开本页后仍持续检查并通知）
      startGlobalPoller(task.id)

      updateStatusCard(`
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:20px;height:20px;border:3px solid #BFDBFE;border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
          <span style="color:var(--primary);font-weight:600;">任务已创建，正在生成...</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">您可以切换到其他页面，生成完成后会收到通知。</div>
      `, true)

      pollTask(task.id)
    } catch (err) {
      updateStatusCard(`<div style="color:#dc2626;">创建任务失败: ${escapeHtml(err.message)}</div>`)
      showToast('创建任务失败: ' + err.message, 'error')
      btnGen.disabled = false
      btnGen.textContent = '生成教案'
      isGenerating = false
    }
  })

  // ---- 导出 DOCX（异步任务完成后下载）----
  document.getElementById('btn-export-docx')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-export-docx')
    btn.disabled = true
    btn.textContent = '下载中...'

    try {
      let downloadPath = generatedFilePath
      let downloadName = generatedFileName

      if (generatedDownloadUrl) {
        const urlParams = new URLSearchParams(generatedDownloadUrl.split('?')[1] || '')
        downloadPath = urlParams.get('path') || generatedFilePath
        downloadName = urlParams.get('name') || generatedFileName
      }

      if (!downloadPath) {
        const formData = collectFormData()
        if (!formData.course_id) { alert('请选择课程'); return }
        const token = getToken()
        const res = await fetch(`${API_BASE}/teacher/lesson-plan/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(formData),
          credentials: 'include',
        })
        const result = await res.json()
        if (result.code !== 0 && result.code !== undefined) throw new Error(result.message || '导出失败')
        downloadPath = (result.data || result).file_path
        downloadName = (result.data || result).file_name
      }

      const downloadUrl = `${API_BASE}/teacher/lesson-plan/download?path=${encodeURIComponent(downloadPath)}&name=${encodeURIComponent(downloadName || '教案.docx')}`

      const fileRes = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${getToken()}` },
        credentials: 'include',
      })
      if (!fileRes.ok) throw new Error('文件下载失败')
      const blob = await fileRes.blob()
      const blobUrl = URL.createObjectURL(blob)
      const dl = document.createElement('a')
      dl.href = blobUrl
      dl.download = downloadName || '教案.docx'
      document.body.appendChild(dl)
      dl.click()
      document.body.removeChild(dl)
      URL.revokeObjectURL(blobUrl)

      showToast('DOCX 教案下载成功！', 'success', 4000)
    } catch (err) {
      showToast('下载失败: ' + err.message, 'error')
    } finally {
      btn.disabled = false
      btn.textContent = '下载 DOCX'
    }
  })

  // ---- 重新生成 ----
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    document.getElementById('plan-preview').style.display = 'none'
    document.getElementById('btn-export-docx').style.display = 'none'
    document.getElementById('btn-reset').style.display = 'none'
    generatedPlan = null
    stopGlobalPoller()
    clearTaskState()
    restoredTaskId = null
    updateStatusCard('尚未开始生成教案。请选择课程后点击"生成教案"。')
    updateStatusProgress(0, '')
    document.getElementById('lp-status-progress').style.display = 'none'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })

  // ---- 渲染教案预览（兼容新旧 schema，条件渲染复盘模块）----
  function renderPlanPreview(plan) {
    const container = document.getElementById('plan-content')
    if (!plan) { container.innerHTML = '<div class="empty-hint">暂无教案数据</div>'; return }

    // 兼容 snake_case / camelCase
    const bi = plan.basic_info || plan.basicInfo || {}
    const sa = plan.student_analysis || plan.studentAnalysis || {}
    const rm = plan.review_module || plan.reviewModule || null
    const tg = plan.teaching_goals || plan.teachingGoals || {}
    const kp = plan.key_points || plan.keyPoints || []
    const df = plan.difficulties || []
    const tm = plan.teaching_methods || plan.teachingMethods || []
    const tp = plan.teaching_preparation || plan.teachingPreparation || {}
    const tpc = plan.teaching_process || plan.teachingProcess || []
    const ev = plan.evaluation_design || plan.evaluationDesign || {}
    const bd = plan.board_design || plan.boardDesign || {}
    const hw = plan.homework_design || plan.homeworkDesign || {}
    const rf = plan.reflection || {}

    // 判断是否有真实的学生提问数据 → 决定是否渲染复盘模块
    const hasStudentQuestions = rm && (
      (rm.keyword_sources && rm.keyword_sources !== '当前课程暂无学科专属助手对话数据') ||
      (rm.concept_keywords && rm.concept_keywords.length > 0) ||
      (rm.mistake_keywords && rm.mistake_keywords.length > 0) ||
      (rm.student_focus_points && rm.student_focus_points.length > 0) ||
      (rm.student_confusion_points && rm.student_confusion_points.length > 0)
    )

    // 兼容 string → object
    const saText = typeof sa === 'string' ? sa : (sa.knowledge_foundation || sa.common_problems || '')
    const bdText = typeof bd === 'string' ? bd : (bd.core_concepts || bd.theme || '')
    const rfText = typeof rf === 'string' ? rf : (rf.goal_achievement || '')

    let html = ''
    let moduleIndex = 0

    // 一、基本信息
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:20px 0 12px;">${toChineseNum(moduleIndex)}、基本信息</h4>`
    html += `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">`
    const fields = [
      ['课程名称', bi.course_name], ['授课主题', bi.topic], ['授课教师', bi.teacher_name],
      ['授课班级', bi.class_name], ['授课日期', bi.teaching_date], ['课时安排', bi.period],
      ['课型', bi.lesson_type], ['授课地点', bi.venue], ['使用教材/资源', bi.teaching_material],
    ]
    fields.forEach(([label, value], i) => {
      html += `<tr${i % 2 === 0 ? ' style="background:#F8FAFC;"' : ''}><td style="padding:6px 12px;font-weight:600;color:var(--text-secondary);width:120px;border-bottom:1px solid var(--border);">${label}</td><td style="padding:6px 12px;border-bottom:1px solid var(--border);">${escapeHtml(value || '-')}</td></tr>`
    })
    html += `</table>`

    // 二、学情分析
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、学情分析</h4>`
    html += `<p style="line-height:1.8;color:var(--text);">${escapeHtml(saText)}</p>`

    // 三、上一节课复盘模块（条件渲染：有学生提问数据时才渲染）
    if (hasStudentQuestions) {
      moduleIndex++
      html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、上一节课复盘模块</h4>`
      if (rm.keyword_sources) {
        html += `<h5 style="margin:10px 0 6px;font-size:0.88rem;">数据来源</h5>`
        html += `<p style="font-size:0.83rem;color:var(--text-secondary);">${escapeHtml(rm.keyword_sources)}</p>`
      }
      if (rm.keyword_summary) {
        html += `<h5 style="margin:10px 0 6px;font-size:0.88rem;">关键词分析摘要</h5>`
        html += `<p style="font-size:0.83rem;color:var(--text);">${escapeHtml(rm.keyword_summary)}</p>`
      }
      if (rm.concept_keywords && rm.concept_keywords.length > 0) {
        html += `<p style="font-size:0.83rem;font-weight:600;margin:6px 0;">核心概念类：</p>`
        rm.concept_keywords.forEach(k => { html += `<span style="display:inline-block;padding:2px 10px;margin:2px 4px;background:#EFF6FF;border-radius:12px;font-size:0.78rem;">${escapeHtml(typeof k === 'string' ? k : k.word || k.keyword)}</span>` })
      }
      if (rm.mistake_keywords && rm.mistake_keywords.length > 0) {
        html += `<p style="font-size:0.83rem;font-weight:600;margin:8px 0 4px;">易错理解类：</p>`
        rm.mistake_keywords.forEach(k => { html += `<span style="display:inline-block;padding:2px 10px;margin:2px 4px;background:#FEF2F2;border-radius:12px;font-size:0.78rem;">${escapeHtml(typeof k === 'string' ? k : k.word || k.keyword)}</span>` })
      }
      if (rm.review_conclusion) {
        html += `<h5 style="margin:12px 0 6px;font-size:0.88rem;">复盘结论</h5>`
        html += `<p style="line-height:1.8;padding:12px 16px;background:#F8FAFC;border-radius:8px;border-left:4px solid var(--primary);">${escapeHtml(rm.review_conclusion)}</p>`
      }
      if (rm.teaching_adjustments && rm.teaching_adjustments.length > 0) {
        html += `<h5 style="margin:12px 0 6px;font-size:0.88rem;">调整策略</h5>`
        html += `<div style="padding:12px 16px;background:#FFFBEB;border-radius:8px;border-left:4px solid #F59E0B;font-size:0.83rem;line-height:1.8;">`
        rm.teaching_adjustments.forEach(line => { html += `<div>• ${escapeHtml(typeof line === 'string' ? line.replace(/^\d+\.\s*/, '') : '')}</div>` })
        html += `</div>`
      }
    }

    // 四 → 教学目标
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、教学目标</h4>`
    html += `<p><strong>知识目标：</strong>${escapeHtml(tg.knowledge || '')}</p>`
    html += `<p><strong>能力目标：</strong>${escapeHtml(tg.ability || '')}</p>`
    html += `<p><strong>素养/情感目标：</strong>${escapeHtml(tg.emotion || '')}</p>`

    // 五 → 教学重点
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、教学重点</h4>`
    html += `<ul>${kp.map(k => `<li style="margin:4px 0;">${escapeHtml(typeof k === 'string' ? k : k.name || '')}</li>`).join('')}</ul>`

    // 六 → 教学难点
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、教学难点</h4>`
    html += `<ul>${df.map(d => `<li style="margin:4px 0;">${escapeHtml(typeof d === 'string' ? d : d.name || '')}</li>`).join('')}</ul>`

    // 七 → 教学方法
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、教学方法与教学策略</h4>`
    html += `<p>${tm.map(m => `<span style="display:inline-block;padding:3px 12px;margin:3px 4px;background:#F0F4FA;border-radius:12px;font-size:0.83rem;">${escapeHtml(typeof m === 'string' ? m : m.name || '')}</span>`).join('')}</p>`

    // 八 → 教学准备
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、教学准备</h4>`
    html += `<p><strong>教师准备：</strong>${escapeHtml(tp.teacher || '')}</p>`
    html += `<p><strong>学生准备：</strong>${escapeHtml(tp.student || '')}</p>`

    // 九 → 教学过程
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、教学过程设计</h4>`
    if (tpc.length > 0) {
      html += `<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
        <thead><tr style="background:var(--primary);color:#fff;">
          <th style="padding:8px 10px;text-align:left;width:12%;">教学环节</th>
          <th style="padding:8px 10px;text-align:left;width:35%;">教师活动</th>
          <th style="padding:8px 10px;text-align:left;width:30%;">学生活动</th>
          <th style="padding:8px 10px;text-align:left;width:23%;">设计意图</th>
        </tr></thead><tbody>`
      tpc.forEach(s => {
        html += `<tr><td style="padding:8px 10px;border-bottom:1px solid var(--border);font-weight:600;">${escapeHtml(s.stage)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid var(--border);">${escapeHtml(s.teacher_activity || s.teacherActivity || '')}</td>
          <td style="padding:8px 10px;border-bottom:1px solid var(--border);">${escapeHtml(s.student_activity || s.studentActivity || '')}</td>
          <td style="padding:8px 10px;border-bottom:1px solid var(--border);font-size:0.78rem;color:var(--text-secondary);">${escapeHtml(s.design_intent || s.intent || '')}</td></tr>`
      })
      html += `</tbody></table>`
    }

    // 十 → 评价设计
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、课堂评价设计</h4>`
    html += `<p><strong>过程性评价：</strong>${escapeHtml(ev.process || '')}</p>`
    html += `<p><strong>结果性评价：</strong>${escapeHtml(ev.result || '')}</p>`
    html += `<p><strong>数据辅助评价：</strong>${escapeHtml(ev.data_assisted || ev.data || '')}</p>`

    // 十一 → 板书设计
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、板书设计</h4>`
    html += `<pre style="background:#F8FAFC;padding:16px;border-radius:8px;font-size:0.83rem;line-height:1.6;white-space:pre-wrap;">${escapeHtml(bdText)}</pre>`

    // 十二 → 作业设计
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、作业设计</h4>`
    html += `<p><strong>基础作业：</strong>${escapeHtml(hw.basic || '')}</p>`
    html += `<p><strong>提升作业：</strong>${escapeHtml(hw.advanced || '')}</p>`
    if (hw.tiered) html += `<p><strong>分层作业：</strong>${escapeHtml(hw.tiered)}</p>`
    html += `<p><strong>预习作业：</strong>${escapeHtml(hw.preview || '')}</p>`

    // 十三 → 课后反思
    moduleIndex++
    html += `<h4 style="color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:6px;margin:25px 0 12px;">${toChineseNum(moduleIndex)}、课后反思</h4>`
    html += `<pre style="background:#FFFBEB;padding:16px;border-radius:8px;font-size:0.83rem;line-height:1.8;white-space:pre-wrap;border:1px dashed #FDE68A;">${escapeHtml(rfText)}</pre>`

    html += `<div style="margin-top:20px;padding:12px;text-align:center;font-size:0.78rem;color:var(--text-muted);border-top:1px solid var(--border);">教案由 DisciMind 学研智擎智能教案生成系统辅助生成</div>`

    container.innerHTML = html
  }

  // ---- 数字转中文 ----
  function toChineseNum(n) {
    const map = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三']
    return map[n] || String(n)
  }

  // ---- 初始化 ----
  loadCourses()

  // ---- 尝试恢复任务状态（页面切换后返回）----
  const savedState = loadTaskState()
  if (savedState && savedState.taskId && (Date.now() - savedState.createdAt < 10 * 60 * 1000)) {
    // 任务创建未超过 10 分钟，尝试恢复
    restoredTaskId = savedState.taskId
    const selectedCourseId = savedState.courseId

    // 等待课程列表加载完成后设置课程选择
    const checkCoursesLoaded = setInterval(() => {
      const select = document.getElementById('lp-course')
      if (select && select.options.length > 1) {
        clearInterval(checkCoursesLoaded)
        if (selectedCourseId && select.querySelector(`option[value="${selectedCourseId}"]`)) {
          select.value = String(selectedCourseId)
          select.dispatchEvent(new Event('change'))
        }
        // 检查任务当前状态
        checkAndRestoreTask(restoredTaskId)
      }
    }, 200)

    // 最多等 5 秒
    setTimeout(() => clearInterval(checkCoursesLoaded), 5000)
  }

  async function checkAndRestoreTask(taskId) {
    try {
      const res = await getLessonPlanTask(taskId)
      const task = res.data || res

      if (task.status === 'SUCCEEDED') {
        // 已完成 → 恢复结果
        updateStatusCard(`
          <div style="color:#16a34a;font-weight:600;">✅ 教案已生成完成</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${new Date(task.completedAt || Date.now()).toLocaleString()}</div>
        `)
        const meta = task.metadataJson || {}
        if (meta.result_json) {
          generatedPlan = meta.result_json
          renderPlanPreview(generatedPlan)
          document.getElementById('plan-preview').style.display = 'block'
        }
        generatedDownloadUrl = meta.docx_download_url || null
        generatedFileName = meta.docx_file_name || null
        generatedFilePath = meta.docx_path || null
        document.getElementById('btn-export-docx').style.display = 'inline-block'
        document.getElementById('btn-reset').style.display = 'inline-block'
        document.getElementById('btn-generate').disabled = false
        document.getElementById('btn-generate').textContent = '重新生成'
        document.getElementById('generate-time').textContent = `生成时间：${new Date(task.completedAt || Date.now()).toLocaleString()}`
        stopGlobalPoller()
        clearTaskState()
      } else if (task.status === 'FAILED') {
        updateStatusCard(`
          <div style="color:#dc2626;font-weight:600;">❌ 上次生成失败</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${escapeHtml(task.errorMessage || '未知错误')}</div>
        `)
        stopGlobalPoller()
        clearTaskState()
      } else if (task.status === 'RUNNING' || task.status === 'QUEUED') {
        // 仍在执行 → 恢复轮询
        updateStatusCard(`
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:20px;height:20px;border:3px solid #BFDBFE;border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
            <span style="color:var(--primary);font-weight:600;">教案正在生成中（已恢复）...</span>
          </div>
        `, true)
        updateStatusProgress(task.progress || 0, task.stage || '')
        document.getElementById('btn-generate').disabled = true
        document.getElementById('btn-generate').textContent = '生成中...'
        isGenerating = true
        pollTask(taskId)
      } else {
        clearTaskState()
      }
    } catch {
      // 任务查询失败，清除状态
      stopGlobalPoller()
      clearTaskState()
      updateStatusCard('尚未开始生成教案。请选择课程后点击"生成教案"。')
    }
  }
}
