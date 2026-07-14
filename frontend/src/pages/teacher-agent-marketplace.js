import { getMe } from '../api/auth.js'
import { getTeacherAiContextOptions } from '../api/teacher.js'
import { getUser, getToken, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

const SYSTEM_META = {
  learning_analysis: {
    category: '学情诊断',
    description: '读取教师授权的课程、教学班与学习记录，辅助识别薄弱知识点和教学风险。',
    tags: ['班级学情', '风险识别', '数据分析'],
  },
  preparation: {
    category: '智慧备课',
    description: '结合课程目标、授课主题与班级学情，组织教学设计和差异化备课建议。',
    tags: ['教案设计', '课堂活动', '因材施教'],
  },
  question_generation: {
    category: '教学内容',
    description: '围绕课程知识点和教学目标生成题目，并辅助组织作业与测评素材。',
    tags: ['智能出题', '作业设计', '教学测评'],
  },
  document_generation: {
    category: '知识与资源',
    description: '生成面向教学与科研场景的结构化文档，沉淀可复用的课程资料。',
    tags: ['教学文档', '课程资料', '内容生成'],
  },
}

const CATEGORIES = ['全部', '智慧备课', '学情诊断', '教学内容', '知识与资源', '科研支持']
const FORBIDDEN_STUDENT_CONTENT = /复习|考研|学习规划|英语写作|高等数学答疑|学生助手|作业辅导/i
const TEACHER_CONTENT = /教学|教师|备课|课程|学情|题目|试卷|批改|教案|文档|科研|论文|研究|知识|实验|课堂|评估|评价|分析|概念/i

const state = { agents: [], category: '全部', search: '', lifecycle: null }

function categoryFor(agent) {
  const text = `${agent.name || ''} ${agent.description || ''}`
  if (/科研|论文|研究/.test(text)) return '科研支持'
  if (/学情|分析|评估|评价/.test(text)) return '学情诊断'
  if (/备课|教案|课堂|教学设计/.test(text)) return '智慧备课'
  if (/题目|试卷|批改|测评/.test(text)) return '教学内容'
  return '知识与资源'
}

function normalizeAgent(agent) {
  const meta = SYSTEM_META[agent.id]
  const source = agent.source || (meta ? 'system' : 'marketplace')
  const category = meta?.category || categoryFor(agent)
  return {
    ...agent,
    id: String(agent.id),
    name: agent.name || '未命名教学智能体',
    description: meta?.description || agent.description || '已接入教师授权范围，可在教学智能助手中按需调用。',
    category,
    source,
    tags: meta?.tags || [category, source === 'mine' ? '我的智能体' : '教师可调用'],
  }
}

function isTeacherAgent(agent) {
  if (SYSTEM_META[agent.id] || agent.source === 'system') return true
  const text = `${agent.name || ''} ${agent.description || ''}`
  return !FORBIDDEN_STUDENT_CONTENT.test(text) && TEACHER_CONTENT.test(text)
}

function uniqueTeacherAgents(agents) {
  const seen = new Set()
  return (agents || []).filter(isTeacherAgent).map(normalizeAgent).filter(agent => {
    const key = agent.name.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sourceLabel(agent) {
  if (agent.source === 'system') return '系统内置'
  if (agent.source === 'mine') return '我的智能体'
  return '教师可调用'
}

function iconLetter(agent) {
  return escapeHtml((agent.name || '教').replace(/Agent/ig, '').trim().slice(0, 1) || '教')
}

function visibleAgents() {
  const keyword = state.search.trim().toLowerCase()
  return state.agents.filter(agent => {
    if (state.category !== '全部' && agent.category !== state.category) return false
    if (!keyword) return true
    return `${agent.name} ${agent.description} ${agent.tags.join(' ')}`.toLowerCase().includes(keyword)
  })
}

function card(agent) {
  const encodedId = encodeURIComponent(agent.id)
  return `<article class="teacher-agent-card">
    <header><div class="teacher-agent-avatar">${iconLetter(agent)}</div><div><span>${escapeHtml(agent.category)}</span><h3>${escapeHtml(agent.name)}</h3></div><em>${escapeHtml(sourceLabel(agent))}</em></header>
    <p>${escapeHtml(agent.description)}</p>
    <div class="teacher-agent-tags">${agent.tags.slice(0, 3).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
    <footer><button type="button" data-teacher-agent-detail="${encodedId}">查看能力</button><button type="button" class="primary" data-teacher-agent-use="${encodedId}">在教师 AI 中调用</button></footer>
  </article>`
}

function renderCards() {
  const agents = visibleAgents()
  const count = document.getElementById('teacher-agent-result-count')
  const grid = document.getElementById('teacher-agent-grid')
  if (count) count.textContent = `${agents.length} 个可用智能体`
  if (grid) grid.innerHTML = agents.length
    ? agents.map(card).join('')
    : '<div class="teacher-agent-empty"><b>没有匹配的教师智能体</b><span>请调整分类或搜索关键词。</span></div>'
}

function renderShell() {
  return `<div class="teacher-agent-market-page">
    <header class="teacher-agent-page-head">
      <div><span>TEACHER AGENT HUB</span><h2>教师智能体广场</h2><p>围绕智慧备课、学情诊断、教学内容与科研支持，统一调用当前账号已获授权的智能体。</p></div>
      <a href="#/teacher/ai">进入教师 AI</a>
    </header>
    <section class="teacher-agent-hero">
      <div><span>教学智能协作</span><h3>让智能体进入真实教学流程</h3><p>广场只展示教师场景相关能力；课程与班级数据仍按教师权限校验。</p></div>
      <div class="teacher-agent-hero-metrics"><span><b id="teacher-agent-total">—</b>已授权智能体</span><span><b>5</b>教师能力方向</span></div>
    </section>
    <section class="teacher-agent-toolbar">
      <label><span aria-hidden="true">⌕</span><input id="teacher-agent-search" type="search" placeholder="搜索备课、学情、论文、题目等能力" autocomplete="off"></label>
      <div>${CATEGORIES.map(category => `<button type="button" data-teacher-agent-category="${escapeHtml(category)}" class="${category === '全部' ? 'active' : ''}">${escapeHtml(category)}</button>`).join('')}</div>
    </section>
    <div class="teacher-agent-result-head"><div><span></span><b>面向教师的智能能力</b></div><em id="teacher-agent-result-count">正在读取授权能力…</em></div>
    <section id="teacher-agent-grid" class="teacher-agent-grid"><div class="teacher-agent-loading">正在读取教师智能体…</div></section>
    <dialog id="teacher-agent-detail-dialog" class="teacher-agent-detail-dialog"><div id="teacher-agent-detail-body"></div></dialog>
  </div>`
}

function openDetail(agent) {
  const dialog = document.getElementById('teacher-agent-detail-dialog')
  const body = document.getElementById('teacher-agent-detail-body')
  if (!dialog || !body || !agent) return
  const encodedId = encodeURIComponent(agent.id)
  body.innerHTML = `<header><div class="teacher-agent-avatar">${iconLetter(agent)}</div><div><span>${escapeHtml(agent.category)} · ${escapeHtml(sourceLabel(agent))}</span><h3>${escapeHtml(agent.name)}</h3></div><button type="button" data-teacher-agent-close aria-label="关闭">×</button></header><p>${escapeHtml(agent.description)}</p><h4>适用能力</h4><div class="teacher-agent-detail-tags">${agent.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div><aside>调用时将继续执行课程、教学班与知识库权限校验，不会越权读取教学数据。</aside><footer><button type="button" data-teacher-agent-close>返回广场</button><button type="button" class="primary" data-teacher-agent-use="${encodedId}">在教师 AI 中调用</button></footer>`
  dialog.showModal()
}

function requestedAgentId(params) {
  const query = window.location.hash.split('?')[1] || ''
  const fromQuery = new URLSearchParams(query).get('agentId')
  if (fromQuery) return fromQuery
  return params?.id ? `marketplace:${params.id}` : ''
}

function bindEvents(params) {
  const page = document.querySelector('.teacher-agent-market-page')
  const search = document.getElementById('teacher-agent-search')
  search?.addEventListener('input', () => { state.search = search.value; renderCards() }, { signal: state.lifecycle.signal })
  page?.addEventListener('click', event => {
    const category = event.target.closest('[data-teacher-agent-category]')
    if (category) {
      state.category = category.dataset.teacherAgentCategory
      page.querySelectorAll('[data-teacher-agent-category]').forEach(button => button.classList.toggle('active', button === category))
      renderCards()
      return
    }
    const detail = event.target.closest('[data-teacher-agent-detail]')
    if (detail) openDetail(state.agents.find(agent => agent.id === decodeURIComponent(detail.dataset.teacherAgentDetail)))
    const use = event.target.closest('[data-teacher-agent-use]')
    if (use) window.location.hash = `#/teacher/ai?agentId=${encodeURIComponent(decodeURIComponent(use.dataset.teacherAgentUse))}`
    if (event.target.closest('[data-teacher-agent-close]')) document.getElementById('teacher-agent-detail-dialog')?.close()
  }, { signal: state.lifecycle.signal })

  const targetId = requestedAgentId(params)
  if (targetId) openDetail(state.agents.find(agent => agent.id === targetId))
}

export async function renderTeacherAgentMarketplace(app, params = {}) {
  state.lifecycle?.abort()
  state.lifecycle = new AbortController()
  state.agents = []
  state.category = '全部'
  state.search = ''
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }
  renderDashboardLayout(app, { title: '教师智能体广场', menuItems: TEACHER_MENU_ITEMS, contentHTML: renderShell(), user })
  try {
    const response = await getTeacherAiContextOptions()
    state.agents = uniqueTeacherAgents(response.data?.agents)
    const total = document.getElementById('teacher-agent-total')
    if (total) total.textContent = state.agents.length
    renderCards()
    bindEvents(params)
  } catch (error) {
    const grid = document.getElementById('teacher-agent-grid')
    if (grid) grid.innerHTML = '<div class="teacher-agent-empty"><b>暂时无法读取智能体</b><span>请稍后重试。</span></div>'
    showToast(error.message || '教师智能体加载失败', 'error')
    bindEvents(params)
  }
}
