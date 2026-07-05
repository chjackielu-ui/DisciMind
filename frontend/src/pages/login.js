// 登录页 — 企业官网级首页（液态玻璃风格身份选择登录界面）

import { login, register } from '../api/auth.js'
import { setAuth } from '../utils/auth.js'
import { navigateTo } from '../utils/router.js'

// 角色 → 默认首页路由
const ROLE_HOME = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

// 动态标题列表
const titleList = [
  '学研智擎',
  '一起探索知识',
  '开启智慧学习',
  '开启智慧学习新体验',
  '连接教学与科研',
]

// 每个标题对应的独立纯色数组（按字符索引循环使用）
const titleColorPalettes = [
  ['#2563EB', '#0EA5E9', '#06B6D4', '#3B82F6'],
  ['#3B82F6', '#38BDF8', '#14B8A6', '#6366F1', '#8B5CF6', '#2563EB'],
  ['#F59E0B', '#F97316', '#EAB308', '#FB923C', '#D97706', '#FACC15'],
  ['#8B5CF6', '#A855F7', '#EC4899', '#6366F1', '#D946EF', '#7C3AED', '#C084FC', '#9333EA', '#A855F7'],
  ['#0F766E', '#0891B2', '#2563EB', '#4F46E5', '#7C3AED', '#0EA5E9', '#6366F1'],
]

// 工具：根据标题索引和字符索引获取纯色
function getTitleCharColor(titleIndex, charIndex) {
  const palette = titleColorPalettes[titleIndex]
  if (!palette || palette.length === 0) return '#2563EB'
  return palette[charIndex % palette.length]
}

// 工具：获取当前标题的光标颜色（使用调色盘第一个颜色）
function getCursorColor(titleIndex) {
  const palette = titleColorPalettes[titleIndex]
  if (!palette || palette.length === 0) return '#2563EB'
  return palette[0]
}

// 身份选项配置（含主题色、光晕色、标题渐变色）
const roleOptions = [
  {
    key: 'student',
    label: '学生登录',
    color: '#3B82F6',
    alpha: 'rgba(59,130,246,0.05)',
    titleGradient: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 50%, #0EA5E9 100%)',
  },
  {
    key: 'teacher',
    label: '教师登录',
    color: '#F59E0B',
    alpha: 'rgba(245,158,11,0.05)',
    titleGradient: 'linear-gradient(135deg, #D97706 0%, #F59E0B 50%, #F97316 100%)',
  },
  {
    key: 'admin',
    label: '管理员登录',
    color: '#8B5CF6',
    alpha: 'rgba(139,92,246,0.05)',
    titleGradient: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)',
  },
]

// 不同身份的账号 placeholder
const accountPlaceholders = {
  student: '请输入学生账号',
  teacher: '请输入教师账号',
  admin: '请输入管理员账号',
}

// 使用场景数据
const scenarioData = [
  { icon: '📖', title: '智能学习辅导', desc: '围绕课程知识点进行问答、讲解与个性化学习支持，让每一位学生都能获得专属学习体验。' },
  { icon: '🔬', title: '科研知识问答', desc: '结合学科知识库，辅助师生快速检索、理解和追踪科研资料，加速科研进程。' },
  { icon: '📊', title: '学科资源整合', desc: '整合课程资料、论文文献与教学资源，形成统一知识入口，告别信息孤岛。' },
  { icon: '📈', title: '个性化学习分析', desc: '基于学习行为和答题情况，生成学习画像与薄弱点分析，实现精准教学干预。' },
  { icon: '🎓', title: '智能教学辅助', desc: '辅助教师完成备课、题目生成、知识点梳理与课堂支持，减轻教学负担。' },
  { icon: '✨', title: '多模态内容生成', desc: '支持文本、图片、视频等多模态内容生成，丰富教学表达方式，提升学习兴趣。' },
]

// 智能体数据
const agentData = [
  {
    tag: '学生端',
    title: '学习助手智能体',
    desc: '面向学生提供课程问答、知识点讲解、错题分析和学习路径建议，打造 7×24 小时专属 AI 导师。',
    videoFirst: true,
  },
  {
    tag: '科研端',
    title: '科研问答智能体',
    desc: '面向科研场景提供论文检索、文献理解、研究方向分析和资料追溯，让科研不再迷失在海量文献中。',
    videoFirst: false,
  },
  {
    tag: '教师端',
    title: '课程分析智能体',
    desc: '辅助教师分析课程内容、学生掌握情况和教学资源使用效果，以数据驱动教学质量持续提升。',
    videoFirst: true,
  },
  {
    tag: '创作端',
    title: '多模态生成智能体',
    desc: '支持讲解视频、图文材料、知识卡片等多模态学习内容生成，让教学内容创作更高效、更生动。',
    videoFirst: false,
  },
]

// 平台能力数据
const capabilityData = [
  { icon: '📚', title: '权威可信知识库', desc: '围绕学科资料构建专属知识库，提升回答准确性与可信度，让 AI 回答有据可依。' },
  { icon: '💬', title: '自然语言多轮交互', desc: '支持连续问答、上下文理解和任务式对话，降低使用门槛，像聊天一样使用 AI。' },
  { icon: '🔗', title: '内容可追溯', desc: '回答结果关联来源材料，便于师生核验和进一步学习，确保知识传递的严谨性。' },
  { icon: '⚡', title: '智能工作流', desc: '通过智能体协同完成复杂教学科研任务，提升平台实用价值，让 AI 真正融入日常工作流。' },
]

// ========== 状态 ==========
let currentRole = 'student'
let themeColor = '#3B82F6'
let themeAlpha = 'rgba(59,130,246,0.05)'
let activePanel = 'none' // 'none' | 'login' | 'register'
let loginSubmitting = false
let showScrollHint = true

// ========== 面板切换 ==========
function showPanel(panelName) {
  activePanel = panelName

  const loginEntryBtn = document.getElementById('btn-show-login')
  const registerEntryBtn = document.getElementById('btn-show-register')
  const loginPanel = document.getElementById('login-panel')
  const registerPanel = document.getElementById('register-panel')

  // 重置入口按钮高亮
  if (loginEntryBtn) loginEntryBtn.classList.remove('active')
  if (registerEntryBtn) registerEntryBtn.classList.remove('active')

  if (panelName === 'login') {
    if (loginEntryBtn) loginEntryBtn.classList.add('active')
    if (loginPanel) {
      loginPanel.style.display = 'block'
      void loginPanel.offsetHeight
      loginPanel.classList.add('visible')
      // 面板显示后重新计算身份胶囊高亮位置
      requestAnimationFrame(() => {
        updateHighlightPosition()
      })
    }
    if (registerPanel) {
      registerPanel.classList.remove('visible')
      registerPanel.style.display = 'none'
    }
  } else if (panelName === 'register') {
    if (registerEntryBtn) registerEntryBtn.classList.add('active')
    if (registerPanel) {
      registerPanel.style.display = 'block'
      void registerPanel.offsetHeight
      registerPanel.classList.add('visible')
    }
    if (loginPanel) {
      loginPanel.classList.remove('visible')
      loginPanel.style.display = 'none'
    }
  } else {
    // 'none'：隐藏所有面板
    if (loginPanel) {
      loginPanel.classList.remove('visible')
      loginPanel.style.display = 'none'
    }
    if (registerPanel) {
      registerPanel.classList.remove('visible')
      registerPanel.style.display = 'none'
    }
  }

  // 面板打开时隐藏滚动提示
  updateScrollHintVisibility()
}

// ========== 滚动提示可见性 ==========
function updateScrollHintVisibility() {
  const hint = document.getElementById('scroll-hint')
  if (!hint) return

  const shouldHide = !showScrollHint || activePanel !== 'none'

  if (shouldHide) {
    hint.classList.add('is-hidden')
  } else {
    hint.classList.remove('is-hidden')
  }
}

// ========== 工具函数 ==========
function getThemeByRole(role) {
  return roleOptions.find((r) => r.key === role) || roleOptions[0]
}

function applyTheme(role) {
  const theme = getThemeByRole(role)
  currentRole = role
  themeColor = theme.color
  themeAlpha = theme.alpha
  const page = document.querySelector('.hero-section')
  if (page) {
    page.style.setProperty('--theme-color', theme.color)
    page.style.setProperty('--theme-alpha', theme.alpha)
    page.style.setProperty('--title-gradient', theme.titleGradient)
  }
}

// 锁死 / 解锁身份切换胶囊
function lockIdentityCapsule() {
  const capsule = document.getElementById('identity-capsule')
  if (capsule) capsule.classList.add('locked')
}

function unlockIdentityCapsule() {
  const capsule = document.getElementById('identity-capsule')
  if (capsule) capsule.classList.remove('locked')
}

// ========== 中心展开打字机标题动画 ==========
let titleTimer = null

function startTitleAnimation() {
  const titleEl = document.getElementById('login-main-title')
  if (!titleEl) return

  let listIndex = 0
  let expandStep = 1
  let phase = 'expand'

  function buildVisibleHTML(text, step, paletteIndex) {
    const chars = Array.from(text)
    const len = chars.length
    const palette = titleColorPalettes[paletteIndex]

    const centerLeft = Math.floor((len - 1) / 2)
    const centerRight = len % 2 === 0 ? centerLeft + 1 : centerLeft

    const left = Math.max(0, centerLeft - step)
    const right = Math.min(len - 1, centerRight + step)

    return chars
      .map((char, i) => {
        if (i >= left && i <= right) {
          const color = palette[i % palette.length]
          return `<span class="title-char" style="color:${color}">${char}</span>`
        }
        return ''
      })
      .join('')
  }

  function isComplete(text, step) {
    const len = Array.from(text).length
    const centerLeft = Math.floor((len - 1) / 2)
    const centerRight = len % 2 === 0 ? centerLeft + 1 : centerLeft
    return (centerLeft - step <= 0) && (centerRight + step >= len - 1)
  }

  function renderTitle(text, step, paletteIndex) {
    const cursorColor = getCursorColor(paletteIndex)
    const visibleHTML = buildVisibleHTML(text, step, paletteIndex)
    titleEl.innerHTML =
      '<span class="title-text-run">' +
      visibleHTML +
      '<span class="title-cursor" style="color:' + cursorColor + '">|</span>' +
      '</span>'
  }

  function tick() {
    const text = titleList[listIndex]

    if (phase === 'expand') {
      renderTitle(text, expandStep, listIndex)
      expandStep++

      if (isComplete(text, expandStep - 1)) {
        phase = 'hold'
        titleTimer = setTimeout(tick, 1600)
        return
      }
      titleTimer = setTimeout(tick, 80)
    } else if (phase === 'hold') {
      phase = 'clear'
      renderTitle(text, -1, listIndex)
      titleTimer = setTimeout(tick, 350)
    } else if (phase === 'clear') {
      listIndex = (listIndex + 1) % titleList.length
      expandStep = 1
      phase = 'expand'
      tick()
    }
  }

  renderTitle(titleList[0], 0, 0)
  titleTimer = setTimeout(tick, 600)
}

// ========== 身份胶囊高亮定位 ==========
function updateHighlightPosition() {
  const capsule = document.getElementById('identity-capsule')
  const highlight = document.getElementById('identity-highlight')
  if (!capsule || !highlight) return

  const activeOption = capsule.querySelector('.identity-option.active')
  if (!activeOption) return

  const capsuleRect = capsule.getBoundingClientRect()
  const optionRect = activeOption.getBoundingClientRect()

  highlight.style.left = optionRect.left - capsuleRect.left + 'px'
  highlight.style.width = optionRect.width + 'px'
}

// ========== 生成场景卡片 HTML ==========
function renderScenarioCards() {
  return scenarioData
    .map(
      (item, i) => `
    <div class="scenario-card reveal" style="transition-delay:${i * 0.06}s">
      <div class="scenario-media">
        <span class="scenario-media-icon">${item.icon}</span>
      </div>
      <div class="scenario-content">
        <h3>${item.title}</h3>
        <p>${item.desc}</p>
      </div>
    </div>`
    )
    .join('')
}

// ========== 生成智能体展示 HTML ==========
function renderAgentShowcases() {
  return agentData
    .map(
      (item, i) => `
    <div class="agent-showcase reveal">
      ${item.videoFirst
        ? `
      <div class="agent-video">
        <div class="agent-video-inner">
          <div class="agent-video-icon">▶</div>
          <span class="agent-video-label">视频演示区域<br>Demo Video</span>
        </div>
      </div>
      <div class="agent-content">
        <span class="agent-tag">${item.tag}</span>
        <h3>${item.title}</h3>
        <p>${item.desc}</p>
      </div>`
        : `
      <div class="agent-content">
        <span class="agent-tag">${item.tag}</span>
        <h3>${item.title}</h3>
        <p>${item.desc}</p>
      </div>
      <div class="agent-video">
        <div class="agent-video-inner">
          <div class="agent-video-icon">▶</div>
          <span class="agent-video-label">视频演示区域<br>Demo Video</span>
        </div>
      </div>`
      }
    </div>`
    )
    .join('')
}

// ========== 生成能力卡片 HTML ==========
function renderCapabilityCards() {
  return capabilityData
    .map(
      (item, i) => `
    <div class="capability-card reveal" style="transition-delay:${i * 0.06}s">
      <div class="capability-icon">${item.icon}</div>
      <div class="capability-text">
        <h3>${item.title}</h3>
        <p>${item.desc}</p>
      </div>
    </div>`
    )
    .join('')
}

// ========== 渲染页面 ==========
export function renderLoginPage(app) {
  // 重置状态为默认（学生）
  currentRole = 'student'
  const defaultTheme = roleOptions[0]
  themeColor = defaultTheme.color
  themeAlpha = defaultTheme.alpha
  activePanel = 'none'
  loginSubmitting = false
  showScrollHint = true

  // 清除之前的 title 动画定时器
  if (titleTimer) clearTimeout(titleTimer)

  app.innerHTML = `
    <div class="landing-page">
      <!-- ===== 顶部导航栏 ===== -->
      <nav class="site-navbar" id="site-navbar">
        <div class="site-brand">
          <img src="/logo.png" alt="DisciMind Logo" class="site-logo" />
          <div class="site-brand-text">
            <span class="brand-cn">学研智擎</span>
            <span class="brand-en">DisciMind</span>
          </div>
        </div>
        <div class="site-nav">
          <button class="nav-link" data-scroll-to="scenarios" type="button">使用场景</button>
          <button class="nav-link" data-scroll-to="agents" type="button">智能体</button>
          <button class="nav-link" data-scroll-to="more" type="button">了解更多</button>
        </div>
      </nav>

      <!-- ===== Hero 首屏区 ===== -->
      <section class="hero-section" id="hero-section" style="--theme-color: ${themeColor}; --theme-alpha: ${themeAlpha}; --title-gradient: ${defaultTheme.titleGradient};">
        <!-- 背景装饰层 -->
        <div class="hero-background">
          <!-- 纵深第1层：远景大气光斑（大而模糊） -->
          <div class="hero-glow hero-glow--tl"></div>
          <div class="hero-glow hero-glow--br"></div>
          <div class="hero-glow hero-glow--center"></div>
          <div class="hero-glow hero-glow--far"></div>

          <!-- 纵深第2层：中景柔光 -->
          <div class="hero-glow hero-glow--mid-left"></div>
          <div class="hero-glow hero-glow--mid-right"></div>

          <!-- 纵深第3层：科技网格（后景） -->
          <div class="hero-grid"></div>

          <!-- 纵深第4层：透视地面网格（空间纵深感核心） -->
          <div class="hero-depth-floor"></div>

          <!-- 纵深第5层：流动线条 SVG -->
          <svg class="hero-lines" viewBox="0 0 1440 900" preserveAspectRatio="none">
            <path class="flow-line" d="M-100,300 C300,200 500,500 800,280 C1100,60 1300,350 1600,200" />
            <path class="flow-line" d="M-100,500 C200,600 400,300 700,520 C1000,740 1200,450 1600,550" />
            <path class="flow-line" d="M-100,700 C250,450 450,700 750,600 C1050,500 1300,700 1600,600" />
          </svg>

          <!-- 纵深第6层：柔和光束 -->
          <div class="hero-light-beams">
            <div class="light-beam light-beam--1"></div>
            <div class="light-beam light-beam--2"></div>
            <div class="light-beam light-beam--3"></div>
          </div>

          <!-- 纵深第7层：漂浮几何图形（前景点缀） -->
          <div class="hero-geo-shapes">
            <div class="geo-shape geo-ring geo-ring--1"></div>
            <div class="geo-shape geo-ring geo-ring--2"></div>
            <div class="geo-shape geo-square geo-square--1"></div>
            <div class="geo-shape geo-square geo-square--2"></div>
            <div class="geo-shape geo-diamond geo-diamond--1"></div>
            <div class="geo-shape geo-hex geo-hex--1"></div>
          </div>

          <!-- 纵深第8层：漂浮粒子光点 -->
          <div class="hero-particles">
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
            <div class="hero-particle"></div>
          </div>
        </div>

        <!-- 主内容区 -->
        <div class="hero-content" id="hero-content">
          <!-- 顶部：大号动态标题 -->
          <div class="login-hero-area">
            <div class="main-title-fixed-box">
              <h1 class="login-main-title" id="login-main-title"></h1>
            </div>
            <p class="login-subtitle">面向一流学科建设的垂类大模型教学科研创新应用平台</p>
            <p class="login-brand">DisciMind</p>
          </div>

          <!-- 入口按钮：登录 / 注册 -->
          <div class="auth-entry-area" id="auth-entry-area">
            <button class="auth-entry-btn login-entry-btn" id="btn-show-login" type="button">登录</button>
            <button class="auth-entry-btn register-entry-btn" id="btn-show-register" type="button">注册</button>
          </div>

          <!-- 登录面板（初始隐藏） -->
          <div class="auth-panel login-panel" id="login-panel" style="display:none;">
            <div class="identity-selector">
              <div class="identity-capsule" id="identity-capsule">
                <div class="identity-highlight" id="identity-highlight"></div>
                <button class="identity-option active" data-role="student" type="button">学生登录</button>
                <button class="identity-option" data-role="teacher" type="button">教师登录</button>
                <button class="identity-option" data-role="admin" type="button">管理员登录</button>
              </div>
            </div>

            <form class="login-form-area" id="login-form">
              <div class="input-row">
                <div class="input-underline">
                  <input
                    type="text"
                    id="login-account"
                    placeholder="${accountPlaceholders.student}"
                    autocomplete="username"
                  />
                  <span class="input-glow"></span>
                </div>
                <div class="input-underline">
                  <input
                    type="password"
                    id="login-password"
                    placeholder="请输入密码"
                    autocomplete="current-password"
                  />
                  <span class="input-glow"></span>
                </div>
              </div>
              <div id="login-error" class="login-error-msg" style="display:none;"></div>
              <button type="submit" class="login-btn" id="login-submit">登 录</button>
            </form>

            <p class="panel-toggle">还没有账号？<a id="link-to-register">立即注册</a></p>

            <div class="demo-section">
              <p class="demo-hint">🔑 演示账号</p>
              <div class="demo-tags">
                <button type="button" class="demo-tag" data-role="admin" data-account="admin_demo" data-password="123456">管理员 admin_demo / 123456</button>
                <button type="button" class="demo-tag" data-role="teacher" data-account="teacher_demo" data-password="123456">教师 teacher_demo / 123456</button>
                <button type="button" class="demo-tag" data-role="student" data-account="student_demo" data-password="123456">学生 student_demo / 123456</button>
              </div>
            </div>
          </div>

          <!-- 注册面板（初始隐藏） -->
          <div class="auth-panel register-panel" id="register-panel" style="display:none;">
            <form id="register-form" class="register-form-inline">
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
                    <option value="teacher">教师</option>
                    <option value="admin">管理员</option>
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

              <div class="form-row">
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
                <div class="form-group">
                  <label for="reg-student-no">学号</label>
                  <input type="text" id="reg-student-no" placeholder="学生请填写学号" />
                </div>
                <div class="form-group">
                  <label for="reg-teacher-no">教师工号</label>
                  <input type="text" id="reg-teacher-no" placeholder="教师请填写工号" />
                </div>
              </div>

              <div id="reg-error" class="form-error" style="display:none;"></div>
              <div id="reg-success" class="form-success" style="display:none;"></div>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary" id="reg-submit">注 册</button>
              </div>
            </form>

            <p class="panel-toggle">已有账号？<a id="link-to-login">立即登录</a></p>
          </div>
        </div>

        <!-- 向下滑动提示 -->
        <div class="scroll-hint" id="scroll-hint">
          <span class="scroll-hint-text">向下滑动，了解更多</span>
          <div class="scroll-hint-arrow"></div>
        </div>
      </section>

      <!-- ===== 使用场景 Section ===== -->
      <section id="scenarios" class="section-block">
        <div class="section-header reveal">
          <h2 class="section-title">使用场景</h2>
          <p class="section-subtitle">覆盖教学、科研、学习分析与内容生成等典型应用场景</p>
        </div>
        <div class="scenario-grid">
          ${renderScenarioCards()}
        </div>
      </section>

      <!-- ===== 智能体 Section ===== -->
      <section id="agents" class="section-block">
        <div class="section-header reveal">
          <h2 class="section-title">智能体</h2>
          <p class="section-subtitle">以多智能体协同能力支撑教学、科研与知识服务</p>
        </div>
        <div class="agents-list">
          ${renderAgentShowcases()}
        </div>
      </section>

      <!-- ===== 了解更多 Section ===== -->
      <section id="more" class="section-block more-section">
        <div class="section-header reveal">
          <h2 class="section-title">了解更多</h2>
          <p class="section-subtitle">面向一流学科建设，构建可信、可追溯、可协同的教学科研智能平台</p>
        </div>
        <div class="capability-grid">
          ${renderCapabilityCards()}
        </div>
        <div class="cta-area reveal">
          <button class="cta-btn" id="cta-login-btn" type="button">立即登录体验</button>
        </div>
      </section>

      <!-- ===== Footer ===== -->
      <footer class="landing-footer">
        © 2025 学研智擎 DisciMind — 面向一流学科建设的垂类大模型教学科研创新应用平台
      </footer>
    </div>
  `

  // ========== 初始化 ==========
  startTitleAnimation()

  requestAnimationFrame(() => {
    updateHighlightPosition()
  })

  // 页面进入动画
  const heroContent = document.getElementById('hero-content')
  requestAnimationFrame(() => {
    if (heroContent) heroContent.classList.add('visible')
  })

  // ========== 导航栏平滑滚动 ==========
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      const targetId = link.dataset.scrollTo
      const target = document.getElementById(targetId)
      if (target) {
        const navbarHeight = document.getElementById('site-navbar')?.offsetHeight || 68
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navbarHeight - 16
        window.scrollTo({ top: targetPosition, behavior: 'smooth' })
      }
    })
  })

  // ========== 导航栏滚动效果 ==========
  function handleNavScroll() {
    const navbar = document.getElementById('site-navbar')
    if (!navbar) return

    if (window.scrollY > 20) {
      navbar.classList.add('nav-scrolled')
    } else {
      navbar.classList.remove('nav-scrolled')
    }

    // 滚动提示隐藏
    if (window.scrollY > 20) {
      showScrollHint = false
    } else if (activePanel === 'none') {
      showScrollHint = true
    }
    updateScrollHintVisibility()

    // 更新导航 active 状态
    updateActiveNavLink()
  }

  function updateActiveNavLink() {
    const sections = ['scenarios', 'agents', 'more']
    const navbarHeight = document.getElementById('site-navbar')?.offsetHeight || 68
    const navLinks = document.querySelectorAll('.nav-link')

    let currentSection = ''
    for (const id of sections) {
      const section = document.getElementById(id)
      if (section) {
        const rect = section.getBoundingClientRect()
        if (rect.top <= navbarHeight + 100) {
          currentSection = id
        }
      }
    }

    navLinks.forEach((link) => {
      if (link.dataset.scrollTo === currentSection) {
        link.classList.add('active')
      } else {
        link.classList.remove('active')
      }
    })
  }

  window.addEventListener('scroll', handleNavScroll, { passive: true })

  // ========== Intersection Observer — 入场动画 ==========
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
        }
      })
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  )

  document.querySelectorAll('.reveal').forEach((el) => {
    revealObserver.observe(el)
  })

  // ========== 入口按钮事件（登录 / 注册） ==========
  const loginEntryBtn = document.getElementById('btn-show-login')
  const registerEntryBtn = document.getElementById('btn-show-register')

  loginEntryBtn.addEventListener('click', () => {
    if (activePanel === 'login') {
      showPanel('none')
    } else {
      showPanel('login')
    }
  })

  registerEntryBtn.addEventListener('click', () => {
    if (activePanel === 'register') {
      showPanel('none')
    } else {
      showPanel('register')
    }
  })

  // ========== CTA 按钮 — 滚动回 Hero 并触发登录 ==========
  const ctaBtn = document.getElementById('cta-login-btn')
  if (ctaBtn) {
    ctaBtn.addEventListener('click', () => {
      const heroSection = document.getElementById('hero-section')
      if (heroSection) {
        heroSection.scrollIntoView({ behavior: 'smooth' })
      }
      // 延迟打开登录面板，等滚动到位后再打开
      setTimeout(() => {
        showPanel('login')
      }, 600)
    })
  }

  // ========== 登录表单事件 ==========
  const capsule = document.getElementById('identity-capsule')
  const accountInput = document.getElementById('login-account')
  const loginErrorEl = document.getElementById('login-error')
  const submitBtn = document.getElementById('login-submit')

  // 身份切换（登录提交中锁死，不可切换）
  capsule.addEventListener('click', (e) => {
    if (loginSubmitting) return

    const option = e.target.closest('.identity-option')
    if (!option) return

    const role = option.dataset.role
    if (role === currentRole) return

    capsule.querySelectorAll('.identity-option').forEach((opt) => opt.classList.remove('active'))
    option.classList.add('active')

    applyTheme(role)
    accountInput.placeholder = accountPlaceholders[role]
    updateHighlightPosition()
  })

  // 登录表单提交
  const loginForm = document.getElementById('login-form')

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault()

    const account = accountInput.value.trim()
    const password = document.getElementById('login-password').value

    if (!account || !password) {
      showLoginError('请输入账号和密码')
      return
    }

    submitBtn.disabled = true
    submitBtn.textContent = '登录中...'
    hideLoginError()

    // 锁死身份切换条，防止登录过程中切换角色
    loginSubmitting = true
    lockIdentityCapsule()

    try {
      const result = await login({ account, password })
      const { accessToken, token, user, sessionId } = result.data

      setAuth(accessToken || token, user, sessionId)

      const home = ROLE_HOME[user.role] || '/student/dashboard'
      navigateTo(`#${home}`)
    } catch (err) {
      showLoginError(err.message || '登录失败，请稍后重试')
      unlockIdentityCapsule()
      loginSubmitting = false
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = '登 录'
    }
  })

  // ========== 注册表单事件 ==========
  const regForm = document.getElementById('register-form')
  const regErrorEl = document.getElementById('reg-error')
  const regSuccessEl = document.getElementById('reg-success')
  const regSubmitBtn = document.getElementById('reg-submit')

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault()

    const data = {
      username: document.getElementById('reg-username').value.trim(),
      password: document.getElementById('reg-password').value,
      role: document.getElementById('reg-role').value,
      real_name: document.getElementById('reg-real-name').value.trim(),
      gender: document.getElementById('reg-gender').value,
      phone: document.getElementById('reg-phone').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      college: document.getElementById('reg-college').value.trim(),
      major: document.getElementById('reg-major').value.trim(),
      grade: document.getElementById('reg-grade').value.trim(),
      student_no: document.getElementById('reg-student-no').value.trim(),
      teacher_no: document.getElementById('reg-teacher-no').value.trim(),
    }

    if (!data.username || !data.password || !data.role) {
      showRegError('用户名、密码、角色为必填项')
      return
    }

    if (data.password.length < 6) {
      showRegError('密码长度不能少于6位')
      return
    }

    regSubmitBtn.disabled = true
    regSubmitBtn.textContent = '注册中...'
    hideRegError()
    hideRegSuccess()

    try {
      await register(data)
      showRegSuccess('注册成功！请登录')
      setTimeout(() => {
        showPanel('login')
        const loginAccountInput = document.getElementById('login-account')
        if (loginAccountInput) {
          loginAccountInput.value = data.username
        }
      }, 1500)
    } catch (err) {
      showRegError(err.message || '注册失败，请稍后重试')
    } finally {
      regSubmitBtn.disabled = false
      regSubmitBtn.textContent = '注 册'
    }
  })

  // ========== 面板切换链接 ==========
  document.getElementById('link-to-register').addEventListener('click', () => {
    showPanel('register')
  })

  document.getElementById('link-to-login').addEventListener('click', () => {
    showPanel('login')
  })

  // ========== 演示账号标签点击自动填入 ==========
  document.querySelectorAll('.demo-tag').forEach((tag) => {
    tag.addEventListener('click', () => {
      if (loginSubmitting) return

      const role = tag.dataset.role
      const account = tag.dataset.account
      const password = tag.dataset.password

      capsule.querySelectorAll('.identity-option').forEach((opt) => opt.classList.remove('active'))
      const targetOption = capsule.querySelector(`.identity-option[data-role="${role}"]`)
      if (targetOption) {
        targetOption.classList.add('active')
        applyTheme(role)
        accountInput.placeholder = accountPlaceholders[role]
        updateHighlightPosition()
      }

      accountInput.value = account
      document.getElementById('login-password').value = password

      showPanel('login')
    })
  })

  // ========== 窗口大小变化时重新定位高亮 ==========
  window.addEventListener('resize', updateHighlightPosition)

  // ========== 辅助函数 ==========
  function showLoginError(msg) {
    loginErrorEl.textContent = msg
    loginErrorEl.style.display = 'block'
  }

  function hideLoginError() {
    loginErrorEl.style.display = 'none'
  }

  function showRegError(msg) {
    regErrorEl.textContent = msg
    regErrorEl.style.display = 'block'
  }

  function hideRegError() {
    regErrorEl.style.display = 'none'
  }

  function showRegSuccess(msg) {
    regSuccessEl.textContent = msg
    regSuccessEl.style.display = 'block'
  }

  function hideRegSuccess() {
    regSuccessEl.style.display = 'none'
  }
}
