// 学生首页 — 以“下一步该做什么”为核心的真实数据总览

import { getMe } from '../api/auth.js'
import { getStudentDashboard, getStudentCourses, getStudentSharedResources } from '../api/student.js'
import { studentLearningPlanApi } from '../api/student-learning-plans.js'
import { listTasks, retryTask } from '../api/tasks.js'
import { listGeneratedArtifacts } from '../api/marketplace.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, recommendTypeLabel, isOverdue } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { getCourseCoverUrl } from '../utils/course-cover.js'
import { learningCardApi } from '../api/learning-cards.js'
import { createDailyLearningCardFan } from '../components/learning-card-platform.js'
import { safeRandomId } from '../utils/random-id.js'

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/api\/?$/, '')
const ACTIVE_TASKS = new Set(['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'])
const TASK_STATUS = { QUEUED: '等待开始', RUNNING: '生成中', WAITING_EXTERNAL: '等待外部服务', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消' }
let homeTaskRefreshTimer = null
let homeCardRefreshTimer = null
let homeCardFan = null

function responseData(response) { return response?.data ?? response ?? null }
function responseList(response, fallback = []) {
  const data = responseData(response)
  return Array.isArray(data) ? data : (data?.list || fallback)
}
function clampPercent(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0 }
function safeNumber(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback }
function homeOperationId() { return safeRandomId('home') }

function getAvatarUrl(user) {
  const url = user?.profile?.avatar_url || user?.avatar_url
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  return `${API_ORIGIN}${url.startsWith('/') ? url : '/' + url}`
}

function getDisplayName(user, dashboardUser) {
  return user?.profile?.real_name || dashboardUser?.real_name || getUserDisplayName() || user?.username || '同学'
}

function getClassName(user) {
  const profile = user?.profile || {}
  return profile.admin_class?.class_name || profile.admin_class_name || profile.class_name || '未绑定行政班'
}

function icon(name) {
  const paths = {
    course: '<path d="M4 5.5 12 3l8 2.5L12 8 4 5.5Zm0 0V16l8 4 8-4V5.5M8 7v7l4 2 4-2V7"/>',
    practice: '<path d="M7 3h10v4H7V3ZM5 5H4v16h16V5h-1M8 12l2 2 5-5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4V5Zm4 4h8M8 12h5"/>',
    flow: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><path d="M8 6h3a4 4 0 0 1 4 4v0M8 18h3a4 4 0 0 0 4-4v0"/>',
    wrong: '<path d="M12 3 3.5 19h17L12 3Zm0 6v4m0 3h.01"/>',
    task: '<path d="M8 4h8m-9 3h10v14H7V7Zm3 4h4m-4 4h4"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${paths[name] || paths.arrow}</svg>`
}

function currentNodeTitle(plan) {
  const nodes = plan?.graphSnapshot?.nodes || []
  const node = nodes.find(item => String(item.id) === String(plan?.currentNodeId || plan?.session?.currentNodeId))
  return node?.title || node?.name || plan?.currentNodeId || '等待进入学习节点'
}

function selectMainTask(model) {
  const plan = model.plan
  const planStatus = String(plan?.status || '').toLowerCase()
  const failedTask = model.asyncTasks.find(task => task.status === 'FAILED')
  const readyArtifact = model.artifacts.find(item => item.publicStatus === 'DOWNLOADABLE' || item.status === 'READY')
  const teacherTask = model.dashboardData.recent_tasks?.[0]
  const sharedResource = model.sharedResources.find(item => !item.read_at)
  const firstCourse = model.courses[0]
  if (plan && ['running', 'paused'].includes(planStatus)) {
    const progress = clampPercent(plan.progress)
    return { kind: 'continue-plan', eyebrow: planStatus === 'paused' ? '学习已暂停' : '当前学习计划', title: plan.learningGoal?.title || '继续当前学习计划', description: plan.workflow?.title || '继续沿当前学习流完成目标', course: plan.course?.name, knowledge: plan.knowledgePoint?.name, node: currentNodeTitle(plan), progress, eta: Math.max(1, Math.round(safeNumber(plan.estimatedMinutes, 25) * (100 - progress) / 100)), action: '继续学习', planId: plan.id }
  }
  if (failedTask) {
    return { kind: 'retry-task', eyebrow: '需要处理', title: failedTask.title || '生成任务失败', description: failedTask.errorMessage || failedTask.stage || '任务未能完成，可从任务中心记录重新执行。', course: failedTask.sourceAgent?.name || '异步任务', knowledge: failedTask.taskType, node: '失败任务', progress: clampPercent(failedTask.progress), action: '重试任务', taskId: failedTask.id }
  }
  if (plan && ['ready', 'draft', 'failed'].includes(planStatus)) {
    const preparing = ['QUEUED', 'PRELOADING'].includes(plan.preload?.status)
    return { kind: planStatus === 'draft' || planStatus === 'failed' ? 'prepare-plan' : 'start-plan', eyebrow: preparing ? '学习准备进行中' : '当前学习计划', title: plan.learningGoal?.title || '开始当前学习计划', description: plan.workflow?.title || '目标与学习流已匹配', course: plan.course?.name, knowledge: plan.knowledgePoint?.name, node: currentNodeTitle(plan), progress: clampPercent(plan.progress || plan.preload?.progress), eta: safeNumber(plan.estimatedMinutes, 0) || null, action: planStatus === 'ready' ? '开始学习' : '开始学习准备', planId: plan.id }
  }
  if (readyArtifact) {
    return { kind: 'artifact', eyebrow: '产物已生成', title: readyArtifact.title || '学习产物已就绪', description: readyArtifact.description || '文件生成任务已完成，可以查看和下载。', course: readyArtifact.course?.name, knowledge: (readyArtifact.knowledgePoints || []).map(item => item.name).join('、'), node: '生成完成', progress: 100, action: '查看结果', artifactId: readyArtifact.id }
  }
  if (teacherTask) {
    return { kind: 'teacher-task', eyebrow: isOverdue(teacherTask.deadline) ? '任务已截止' : '最近学习任务', title: teacherTask.task_title || '完成当前练习', description: teacherTask.deadline ? `${isOverdue(teacherTask.deadline) ? '截止于' : '截止'} ${formatDate(teacherTask.deadline, 'short')}` : '教师已发布新的学习任务。', node: '待完成练习', progress: 0, action: '开始学习', teacherTaskId: teacherTask.task_id }
  }
  if (sharedResource) {
    return { kind: 'shared-resource', eyebrow: '教师新资料', title: sharedResource.title, description: `${sharedResource.course?.course_name || '课程'} · ${sharedResource.distribution_type === 'pre_class_material' ? '课前资料' : '教学资源'}`, node: `资源版本 v${sharedResource.resource_version}`, progress: 0, action: '查看资料' }
  }
  if (firstCourse) {
    return { kind: 'course', eyebrow: '从课程开始', title: firstCourse.course_name || '进入最近课程', description: firstCourse.last_position ? `上次学到：${firstCourse.last_position}` : '查看课程知识点并创建学习计划。', course: firstCourse.course_name, node: firstCourse.last_position || '课程首页', progress: clampPercent(firstCourse.learning_progress ?? firstCourse.progress), action: '开始学习', courseId: firstCourse.course_id }
  }
  return { kind: 'empty', eyebrow: '今日主任务', title: '暂时没有待处理的学习事项', description: '加入课程或由教师发布任务后，这里会显示下一步建议。', progress: 0, action: '查看课程' }
}

function buildIdentity(user, displayName, overview) {
  const avatarUrl = getAvatarUrl(user)
  return `<div class="home-identity"><div class="home-identity-avatar">${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">` : `<span>${escapeHtml(displayName.slice(0, 1))}</span>`}</div><div><b>${escapeHtml(displayName)}</b><span>${escapeHtml(getClassName(user))}</span></div><a href="#/student/portrait">查看画像</a><div class="home-identity-progress"><span>总体进度</span><b>${clampPercent(overview.learning_progress)}%</b></div></div>`
}

function buildMainTask(task) {
  const facts = [task.course && ['课程', task.course], task.knowledge && ['知识点', task.knowledge], task.node && ['当前节点', task.node], task.eta && ['预计剩余', `${task.eta} 分钟`]].filter(Boolean)
  return `<section class="home-main-task home-module" data-home-kind="${task.kind}">
    <div class="home-main-copy"><span class="home-eyebrow">${escapeHtml(task.eyebrow)}</span><h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(task.description)}</p><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></div>
    <div class="home-main-action"><div class="home-main-progress"><div><span>当前进度</span><b>${task.progress}%</b></div><i><em data-home-progress="${task.progress}"></em></i></div><button type="button" data-main-action="${task.kind}" ${task.taskId ? `data-task-id="${task.taskId}"` : ''}>${escapeHtml(task.action)}${icon('arrow')}</button></div>
  </section>`
}

function buildMetrics(overview = {}) {
  const metrics = [
    { label: '总体学习进度', value: clampPercent(overview.learning_progress), suffix: '%', hint: '全部课程平均', tone: 'blue' },
    { label: '已掌握知识点', value: safeNumber(overview.mastered_knowledge_count), suffix: '', hint: '掌握良好及以上', tone: 'green' },
    { label: '薄弱知识点', value: safeNumber(overview.weak_knowledge_count), suffix: '', hint: '建议优先巩固', tone: 'amber' },
    { label: '本周学习时长', value: safeNumber(overview.weekly_study_hours), suffix: 'h', hint: '来自学习记录', tone: 'teal' },
  ]
  return `<section class="home-overview home-module"><div class="home-section-head"><div><h2>学习概览</h2><p>四项核心指标均来自当前学习记录。</p></div><span>未掌握错题 ${safeNumber(overview.wrong_question_count)} 道</span></div><div class="home-metric-grid">${metrics.map(item => `<article class="${item.tone}"><span>${item.label}</span><b data-home-count="${item.value}" data-home-suffix="${item.suffix}">${item.value}${item.suffix}</b><em>${item.hint}</em>${item.suffix === '%' ? `<i><u data-home-progress="${item.value}"></u></i>` : ''}</article>`).join('')}</div></section>`
}

function buildDailyLearningCards(model) {
  const set = model.dailyCardSet
  const status = ({ READY: '今日推荐已就绪', GENERATING: '先看快速卡，AI 正在补充', STALE: '学习状态已更新，后台刷新中', FAILED: '已使用规则卡片' })[set?.status] || '正在读取今日推荐'
  return `<section class="home-module lc-home-section" id="daily-learning-cards"><div class="lc-section-head"><div><h2>今日智学卡</h2><p>根据近期学习记录，为你整理今日最值得关注的内容</p></div><div><span id="lc-home-status">${escapeHtml(status)}</span><button type="button" id="lc-home-refresh">换一组</button></div></div><div class="lc-fan-root" id="lc-home-fan">${set?.cards?.length ? '' : '<div class="lc-empty"><b>正在整理今日卡片</b><span>无需等待 AI，你可以继续浏览首页。</span></div>'}</div></section>`
}

function buildQuickEntries(model) {
  const entries = [
    ['courses', 'course', model.courses.length ? '进入最近课程' : '查看课程'], ['practice', 'practice', '智能练习'], ['ai-chat', 'chat', '学科答疑'],
    ['learning-flows', 'flow', '学习流'], ['wrong-questions', 'wrong', '错题本'], ['teaching-tasks', 'task', '我的作业与考试'],
  ]
  return `<section class="home-quick-section home-module"><div class="home-section-head"><div><h2>快捷入口</h2><p>常用学习工具</p></div></div><div class="home-quick-grid">${entries.map(([target, iconName, label]) => `<button type="button" data-home-nav="${target}"><span>${icon(iconName)}</span><b>${label}</b>${icon('arrow')}</button>`).join('')}</div></section>`
}

function asyncTaskRow(task) {
  const progress = Number.isFinite(Number(task.progress)) ? clampPercent(task.progress) : null
  const resultUrl = task.resultUrl || (task.resultId ? `#/student/artifacts/${task.resultId}` : '')
  return `<article class="home-task-row status-${String(task.status).toLowerCase()}" data-async-task-id="${task.id}"><div><span>${escapeHtml(TASK_STATUS[task.status] || task.status)}</span><b>${escapeHtml(task.title || '后台任务')}</b><small>${escapeHtml(task.stage || task.description || '等待状态更新')}</small></div><div class="home-task-progress">${progress == null ? '<i class="indeterminate"></i>' : `<i><em data-home-progress="${progress}"></em></i><span>${progress}%</span>`}</div>${resultUrl ? `<button type="button" data-result-url="${escapeHtml(resultUrl)}">查看</button>` : '<button type="button" data-home-nav="agent-tasks">详情</button>'}</article>`
}

function teacherTaskRow(task) {
  return `<article class="home-task-row teacher"><div><span>${isOverdue(task.deadline) ? '已截止' : '课程任务'}</span><b>${escapeHtml(task.task_title || '学习任务')}</b><small>${task.deadline ? `${isOverdue(task.deadline) ? '截止于' : '截止'} ${formatDate(task.deadline, 'short')}` : '无截止时间'}</small></div><button type="button" data-teacher-task="${task.task_id}">开始答题</button></article>`
}

function buildTaskPanel(model) {
  const asyncRows = model.asyncTasks.slice(0, 4).map(asyncTaskRow)
  const teacherRows = (model.dashboardData.recent_tasks || []).slice(0, Math.max(1, 5 - asyncRows.length)).map(teacherTaskRow)
  return `<section class="home-panel home-task-panel home-module"><div class="home-panel-head"><div><h2>待办与任务</h2><p>生成中、失败和近期课程任务</p></div><button data-home-nav="agent-tasks">任务中心</button></div><div class="home-task-list">${[...asyncRows, ...teacherRows].join('') || '<div class="home-empty-inline">当前没有待办任务。</div>'}</div></section>`
}

function buildRecommendationPanel(model) {
  const recommendations = (model.dashboardData.recommendations || []).slice(0, 3)
  const weak = (model.dashboardData.weak_knowledge_points || []).slice(0, 3)
  const flow = model.plan?.workflow
  return `<section class="home-panel home-recommend-panel home-module"><div class="home-panel-head"><div><h2>推荐与薄弱项</h2><p>基于推荐记录和掌握度</p></div><button data-home-nav="recommendations">全部推荐</button></div><div class="home-rec-list">${recommendations.map(item => `<button type="button" data-home-nav="recommendations"><span>${escapeHtml(recommendTypeLabel(item.recommend_type))}</span><b>${escapeHtml(item.title || '推荐内容')}</b><small>${escapeHtml(item.reason || '根据近期学习记录推荐')}</small></button>`).join('')}${weak.map(item => `<button type="button" data-home-nav="practice"><span>薄弱知识点</span><b>${escapeHtml(item.knowledge_point_name || '未命名知识点')}</b><small>当前掌握度 ${safeNumber(item.mastery_score)} 分</small></button>`).join('')}${flow ? `<button type="button" data-home-nav="learning-flows"><span>推荐学习流</span><b>${escapeHtml(flow.title || '当前学习流')}</b><small>已关联当前学习目标</small></button>` : ''}${!recommendations.length && !weak.length && !flow ? '<div class="home-empty-inline">完成更多学习后会生成个性化推荐。</div>' : ''}</div></section>`
}

function buildCourseProgress(courses = []) {
  return `<section class="home-course-section home-module"><div class="home-panel-head"><div><h2>课程进度</h2><p>当前已加入课程</p></div><button data-home-nav="courses">全部课程</button></div>${courses.length ? `<div class="home-course-grid">${courses.map(course => {
    const progress = clampPercent(course.learning_progress ?? course.progress)
    const detail = course.progress_detail || {}
    const completed = detail.completed ?? course.completed_knowledge_count
    const total = detail.total ?? course.knowledge_point_count
    const cover = getCourseCoverUrl(course)
    return `<button type="button" class="home-course-card" data-course-id="${course.course_id}">${cover ? `<span class="home-course-thumb"><img src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></span>` : '<span class="home-course-placeholder">课</span>'}<div><span>${escapeHtml(course.course_code || '课程')}</span><b>${escapeHtml(course.course_name || '未命名课程')}</b><small>${course.last_position ? `最近：${escapeHtml(course.last_position)}` : completed != null && total != null ? `${completed}/${total} 知识点` : '暂无最近学习位置'}</small><i><em data-home-progress="${progress}"></em></i></div><strong>${progress}%</strong></button>`
  }).join('')}</div>` : '<div class="home-empty-inline">暂无课程，请等待加入教学班或课程。</div>'}</section>`
}

function buildSharedResources(resources = []) {
  const rows = resources.slice(0, 4)
  return `<section class="home-course-section home-module"><div class="home-panel-head"><div><h2>教师下发资料</h2><p>阅读与下载状态会回流给教师</p></div><button data-home-nav="documents">全部资料</button></div>${rows.length ? `<div class="home-task-list">${rows.map(item => `<article class="home-task-row teacher"><div><span>${item.read_at ? '已读' : '未读'} · v${item.resource_version}</span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.course?.course_name || '教学资源')} · ${formatDate(item.publish_at, 'short')}</small></div><button type="button" data-home-nav="documents">查看</button></article>`).join('')}</div>` : '<div class="home-empty-inline">当前没有教师下发资料。</div>'}</section>`
}

function buildHomeContent(model) {
  const overview = model.dashboardData.overview || {}
  const mainTask = selectMainTask(model)
  return `<div class="dashboard-content student-home-shell"><header class="student-home-head home-module"><div><span class="home-eyebrow">学习首页</span><h1>今天，先完成最重要的一步</h1><p>更新时间 ${formatDate(new Date().toISOString(), 'time')}</p></div>${buildIdentity(model.user, model.displayName, overview)}</header>${buildMetrics(overview)}${buildDailyLearningCards(model)}${buildMainTask(mainTask)}${buildQuickEntries(model)}<section class="home-work-grid">${buildTaskPanel(model)}${buildRecommendationPanel(model)}</section>${buildSharedResources(model.sharedResources)}${buildCourseProgress(model.courses)}</div>`
}

function buildErrorContent(message) {
  return `<div class="dashboard-content student-home-shell"><div class="error-state"><div class="error-icon">!</div><p class="error-message">${escapeHtml(message || '学生首页数据加载失败')}</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div></div>`
}

function animateHome() {
  const root = document.querySelector('.student-home-shell')
  if (!root) return
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  root.querySelectorAll('[data-home-progress]').forEach(bar => {
    const value = clampPercent(bar.dataset.homeProgress)
    if (reduced) bar.style.width = `${value}%`
    else requestAnimationFrame(() => { bar.style.width = `${value}%` })
  })
  root.querySelectorAll('[data-home-count]').forEach(element => {
    const target = safeNumber(element.dataset.homeCount)
    const suffix = element.dataset.homeSuffix || ''
    if (reduced) { element.textContent = `${target}${suffix}`; return }
    const start = performance.now()
    const decimals = Number.isInteger(target) ? 0 : 1
    const tick = now => {
      const ratio = Math.min(1, (now - start) / 520)
      const eased = 1 - ((1 - ratio) ** 3)
      element.textContent = `${(target * eased).toFixed(decimals)}${suffix}`
      if (ratio < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function navigate(target) {
  const routes = { courses: '#/student/courses', documents: '#/student/documents', practice: '#/student/practice', 'ai-chat': '#/student/ai-chat', 'learning-flows': '#/student/learning-flows', 'wrong-questions': '#/student/wrong-questions', 'teaching-tasks': '#/student/teaching-tasks', 'agent-tasks': '#/student/agent-tasks', recommendations: '#/student/recommendations' }
  if (routes[target]) window.location.hash = routes[target]
}

function bindHomeEvents(model) {
  const main = document.getElementById('student-main')
  if (!main) return
  if (main._studentHomeClickHandler) main.removeEventListener('click', main._studentHomeClickHandler)
  const handler = async event => {
    const button = event.target.closest('button,a')
    if (!button) return
    const mainAction = button.dataset.mainAction
    try {
      if (mainAction) {
        const task = selectMainTask(model)
        button.disabled = true
        if (mainAction === 'retry-task') { await retryTask(task.taskId); showToast('任务已重新进入队列', 'success'); navigate('agent-tasks') }
        else if (mainAction === 'continue-plan' && (model.plan?.learningSessionId || model.plan?.session?.id)) window.location.hash = `#/student/learning/session/${model.plan.learningSessionId || model.plan.session.id}`
        else if (['continue-plan', 'start-plan'].includes(mainAction)) {
          const result = responseData(await studentLearningPlanApi.start(model.plan.id))
          const sessionId = result?.session?.session_id || result?.session?.id
          if (!sessionId) throw new Error('学习会话创建失败')
          window.location.hash = `#/student/learning/session/${sessionId}`
        } else if (mainAction === 'prepare-plan') { await studentLearningPlanApi.prepare(model.plan.id, homeOperationId()); showToast('学习准备任务已创建', 'success'); navigate('learning-flows') }
        else if (mainAction === 'artifact') window.location.hash = `#/student/artifacts/${task.artifactId}`
        else if (mainAction === 'teacher-task') window.location.hash = `#/student/tasks/${task.teacherTaskId}/answer`
        else if (mainAction === 'course' && task.courseId) window.location.hash = `#/student/courses/${task.courseId}`
        else if (mainAction === 'shared-resource') navigate('documents')
        else navigate('courses')
        return
      }
      if (button.dataset.homeNav) { navigate(button.dataset.homeNav); return }
      if (button.dataset.courseId) { window.location.hash = `#/student/courses/${button.dataset.courseId}`; return }
      if (button.dataset.teacherTask) { window.location.hash = `#/student/tasks/${button.dataset.teacherTask}/answer`; return }
      if (button.dataset.resultUrl) {
        const target = button.dataset.resultUrl
        if (target.startsWith('#')) window.location.hash = target.slice(1)
        else window.location.hash = target
      }
    } catch (error) {
      button.disabled = false
      showToast(error.message || '操作失败，请稍后重试', 'error')
    }
  }
  main._studentHomeClickHandler = handler
  main.addEventListener('click', handler)
}

function taskSignature(tasks) {
  return tasks.map(task => `${task.id}:${task.status}:${task.progress}:${task.updatedAt}`).join('|')
}

function renderHomeModel(model, { replaceLayout = true } = {}) {
  homeCardFan?.destroy?.()
  homeCardFan = null
  const contentHTML = buildHomeContent(model)
  if (replaceLayout) renderDashboardLayout(model.app, { menuItems: STUDENT_MENU_ITEMS, contentHTML, user: model.user })
  else {
    const main = document.getElementById('student-main')
    if (main) main.innerHTML = contentHTML
  }
  bindHomeEvents(model)
  animateHome()
  mountDailyLearningCards(model)
}

function updateCardStatus(set) {
  const node = document.getElementById('lc-home-status')
  if (node) node.textContent = ({ READY: '今日推荐已就绪', GENERATING: '先看快速卡，AI 正在补充', STALE: '学习状态已更新，后台刷新中', FAILED: '已使用规则卡片' })[set?.status] || '今日推荐'
}

function scheduleCardRefresh(model) {
  clearTimeout(homeCardRefreshTimer)
  if (!['GENERATING', 'STALE'].includes(model.dailyCardSet?.status)) return
  homeCardRefreshTimer = window.setTimeout(async () => {
    if (!document.getElementById('lc-home-fan')) return
    try {
      model.dailyCardSet = responseData(await learningCardApi.daily())
      homeCardFan?.setCards(model.dailyCardSet.cards || [])
      updateCardStatus(model.dailyCardSet)
    } catch {}
    scheduleCardRefresh(model)
  }, 4000)
}

function mountDailyLearningCards(model) {
  const root = document.getElementById('lc-home-fan')
  if (!root) return
  if (model.dailyCardSet?.cards?.length) homeCardFan = createDailyLearningCardFan(root, { cards: model.dailyCardSet.cards })
  document.getElementById('lc-home-refresh')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true
    try {
      model.dailyCardSet = responseData(await learningCardApi.refresh({ eventType: 'MANUAL' }))
      if (!homeCardFan) homeCardFan = createDailyLearningCardFan(root, { cards: model.dailyCardSet.cards || [] })
      else homeCardFan.setCards(model.dailyCardSet.cards || [])
      updateCardStatus(model.dailyCardSet)
      showToast('已换一组今日智学卡', 'success')
      scheduleCardRefresh(model)
    } catch (error) { showToast(error.message || '卡片刷新失败', 'error') }
    finally { event.currentTarget.disabled = false }
  })
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  if (params.get('focus') === 'learning-cards') window.setTimeout(() => document.getElementById('daily-learning-cards')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  scheduleCardRefresh(model)
}

async function loadDailyLearningCards(model, pending) {
  try {
    const settled = await pending
    if (!settled.ok) throw settled.error
    model.dailyCardSet = responseData(settled.value)
    const root = document.getElementById('lc-home-fan')
    if (!root) return
    if (!homeCardFan) homeCardFan = createDailyLearningCardFan(root, { cards: model.dailyCardSet?.cards || [] })
    else homeCardFan.setCards(model.dailyCardSet?.cards || [])
    updateCardStatus(model.dailyCardSet)
    scheduleCardRefresh(model)
  } catch (error) {
    const root = document.getElementById('lc-home-fan')
    if (root) root.innerHTML = `<div class="lc-empty"><b>今日卡片暂未读取</b><span>${escapeHtml(error.message || '可稍后重试，其他学习功能不受影响。')}</span></div>`
  }
}

function scheduleTaskRefresh(model) {
  clearTimeout(homeTaskRefreshTimer)
  if (!model.asyncTasks.some(task => ACTIVE_TASKS.has(task.status))) return
  homeTaskRefreshTimer = setTimeout(async () => {
    if (!document.querySelector('.student-home-shell') || !window.location.hash.includes('/student')) return
    try {
      const [taskResult, artifactResult] = await Promise.all([listTasks({ pageSize: 12 }), listGeneratedArtifacts({ pageSize: 12 }).catch(() => null)])
      const nextTasks = responseList(taskResult)
      if (taskSignature(nextTasks) !== taskSignature(model.asyncTasks)) {
        model.asyncTasks = nextTasks
        if (artifactResult) model.artifacts = responseList(artifactResult)
        const scrollTop = window.scrollY
        renderHomeModel(model, { replaceLayout: false })
        window.scrollTo({ top: scrollTop, behavior: 'auto' })
      }
      scheduleTaskRefresh(model)
    } catch { scheduleTaskRefresh(model) }
  }, 6000)
}

export async function renderStudentDashboard(app) {
  clearTimeout(homeTaskRefreshTimer)
  clearTimeout(homeCardRefreshTimer)
  homeCardFan?.destroy?.(); homeCardFan = null
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: `<div class="dashboard-content student-home-shell home-skeleton"><i></i><i></i><i></i><i></i></div>`, user })
  try {
    const dailyCardsPending = learningCardApi.daily().then(value => ({ ok: true, value }), error => ({ ok: false, error }))
    const [dashboardSettled, coursesSettled, planSettled, tasksSettled, artifactsSettled, resourcesSettled] = await Promise.allSettled([
      getStudentDashboard(), getStudentCourses(), studentLearningPlanApi.current(false), listTasks({ pageSize: 12 }), listGeneratedArtifacts({ pageSize: 12 }), getStudentSharedResources({ page_size: 20 }),
    ])
    if (dashboardSettled.status !== 'fulfilled') throw dashboardSettled.reason
    const dashboardData = responseData(dashboardSettled.value) || {}
    const courses = coursesSettled.status === 'fulfilled' ? responseList(coursesSettled.value, dashboardData.courses || []) : (dashboardData.courses || [])
    const planPayload = planSettled.status === 'fulfilled' ? responseData(planSettled.value) : null
    const model = {
      app, user, dashboardData, courses,
      displayName: getDisplayName(user, dashboardData.user),
      plan: planPayload?.plan || null,
      asyncTasks: tasksSettled.status === 'fulfilled' ? responseList(tasksSettled.value) : [],
      artifacts: artifactsSettled.status === 'fulfilled' ? responseList(artifactsSettled.value) : [],
      sharedResources: resourcesSettled.status === 'fulfilled' ? responseList(resourcesSettled.value) : [], dailyCardSet: null,
    }
    renderHomeModel(model)
    scheduleTaskRefresh(model)
    void loadDailyLearningCards(model, dailyCardsPending)
  } catch (error) {
    renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildErrorContent(error.message), user })
  }
}
