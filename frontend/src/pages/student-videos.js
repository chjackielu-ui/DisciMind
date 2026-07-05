import { getMe } from '../api/auth.js'
import { getStudentCourses, getStudentCourseKnowledgePoints, getStudentVideoRecommendations, createVideoWatchRecord } from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDuration, videoSourceLabel, toLower } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts, bindResize, renderRingChart, renderBarChart, CHART_COLORS } from '../utils/echarts.js'

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return null
    }
  }
  return user
}

function buildLoading() {
  return `<div class="complex-shell"><div class="complex-loading"><div class="complex-spinner"></div><p>正在加载视频推荐...</p></div></div>`
}

function normalizeVideoList(data) {
  return data?.list || data?.videos || []
}

function buildStats(videos) {
  const sourceSet = new Set(videos.map(v => v.knowledge_point?.knowledge_point_id || v.knowledge_point_id).filter(Boolean))
  return {
    total: videos.length,
    kp: sourceSet.size,
    bilibili: videos.filter(v => toLower(v.source) === 'bilibili').length,
    pending: videos.filter(v => toLower(v.status) === 'pending_search' || !v.video_id).length,
  }
}

function buildPage(state) {
  if (state.loading) return buildLoading()
  if (state.error) {
    return `<div class="complex-shell"><div class="complex-error"><h3>视频资源加载失败</h3><p>${escapeHtml(state.error)}</p><button class="complex-btn" id="btn-retry-videos">重新加载</button></div></div>`
  }
  const stats = buildStats(state.videos)
  return `
    <div class="complex-shell">
      <section class="complex-hero">
        <div>
          <h1>视频讲解推荐</h1>
          <p>根据你的薄弱知识点和学习任务，推荐适合的视频讲解资源。</p>
        </div>
      </section>

      <section class="complex-card">
        <div class="filter-panel">
          <select class="complex-select" id="video-course-filter">
            <option value="">全部课程</option>
            ${state.courses.map(c => `<option value="${c.course_id}" ${String(state.filters.course_id || '') === String(c.course_id) ? 'selected' : ''}>${escapeHtml(c.course_name)}</option>`).join('')}
          </select>
          <select class="complex-select" id="video-kp-filter">
            <option value="">全部知识点</option>
            ${state.knowledgePoints.map(k => `<option value="${k.knowledge_point_id}" ${String(state.filters.knowledge_point_id || '') === String(k.knowledge_point_id) ? 'selected' : ''}>${escapeHtml(k.knowledge_point_name)}</option>`).join('')}
          </select>
          <select class="complex-select" id="video-source-filter">
            <option value="">全部来源</option>
            <option value="bilibili" ${state.filters.source === 'bilibili' ? 'selected' : ''}>B 站</option>
            <option value="external" ${state.filters.source === 'external' ? 'selected' : ''}>外部资源</option>
            <option value="self_generated" ${state.filters.source === 'self_generated' ? 'selected' : ''}>自建资源</option>
            <option value="pending_search" ${state.filters.source === 'pending_search' ? 'selected' : ''}>待检索</option>
          </select>
          <select class="complex-select" id="video-type-filter">
            <option value="">全部推荐类型</option>
            <option value="weak" ${state.filters.recommend_type === 'weak' ? 'selected' : ''}>薄弱知识点</option>
            <option value="course" ${state.filters.recommend_type === 'course' ? 'selected' : ''}>课程相关</option>
          </select>
          <button class="complex-btn" id="btn-apply-video-filter">筛选</button>
        </div>
      </section>

      <section class="complex-metric-grid">
        <div class="complex-metric"><b>${stats.total}</b><span>推荐视频数</span></div>
        <div class="complex-metric"><b>${stats.kp}</b><span>关联知识点</span></div>
        <div class="complex-metric"><b>${stats.bilibili}</b><span>B站资源数</span></div>
        <div class="complex-metric"><b>${stats.pending}</b><span>待检索资源</span></div>
      </section>

      <section class="report-charts">
        <div class="complex-card"><h3 class="complex-section-title">视频来源占比</h3><div class="chart-container-sm" id="video-source-chart"></div></div>
        <div class="complex-card"><h3 class="complex-section-title">知识点视频数量</h3><div class="chart-container-sm" id="video-kp-chart"></div></div>
      </section>

      <section>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
          <h3 class="complex-section-title" style="margin:0;">推荐资源</h3>
          <button class="complex-btn-secondary" id="btn-refresh-videos">刷新推荐</button>
        </div>
        ${state.videos.length ? `<div class="video-grid">${state.videos.map(buildVideoCard).join('')}</div>` : `<div class="complex-empty"><h3>暂无已收录视频，系统已为你生成外部搜索建议。</h3><p>当系统发现薄弱知识点后，会展示可继续探索的搜索建议。</p></div>`}
      </section>
    </div>`
}

function buildVideoCard(video) {
  const kpName = video.knowledge_point?.knowledge_point_name || video.knowledge_point_name || '关联知识点'
  const source = toLower(video.status) === 'pending_search' ? 'pending_search' : toLower(video.source)
  const pending = !video.video_id || toLower(video.status) === 'pending_search'
  const searchKeyword = video.search_keyword || `${kpName} 视频讲解`
  return `
    <article class="video-card" data-video-id="${video.video_id || ''}" data-course-id="${video.course_id || video.knowledge_point?.course_id || ''}" data-kp-id="${video.knowledge_point?.knowledge_point_id || video.knowledge_point_id || ''}">
      <div class="video-cover">
        ${video.cover_url ? `<img src="${escapeHtml(video.cover_url)}" alt="${escapeHtml(video.title || '')}">` : ''}
        <span class="status-pill video-source">${videoSourceLabel(source)}</span>
        <div class="video-play-mark">${pending ? '?' : '▶'}</div>
      </div>
      <div class="video-body">
        <h3 class="video-title">${escapeHtml(video.title || searchKeyword)}</h3>
        <div style="display:flex;gap:7px;flex-wrap:wrap;">
          <span class="complex-tag">${escapeHtml(kpName)}</span>
          <span class="complex-tag">${video.duration ? formatDuration(video.duration) : '时长待补充'}</span>
          ${pending ? '<span class="status-pill warning">待检索</span>' : '<span class="status-pill success">可观看</span>'}
        </div>
        <div class="video-reason">${escapeHtml(video.recommend_reason || '根据你的学习情况推荐观看。')}</div>
        ${pending ? `<div class="doc-meta">搜索关键词：${escapeHtml(searchKeyword)}</div>` : ''}
        <div class="doc-action-row">
          ${buildPrimaryAction(video, pending, searchKeyword)}
          <button class="complex-btn-secondary btn-record-watch" ${!video.video_id ? 'disabled' : ''}>记录已观看</button>
          <button class="complex-btn-ghost btn-view-kp" ${!(video.knowledge_point?.knowledge_point_id || video.knowledge_point_id) ? 'disabled' : ''}>查看知识点</button>
        </div>
      </div>
    </article>`
}

function buildPrimaryAction(video, pending, searchKeyword) {
  if (pending) {
    return `<button class="complex-btn btn-search-bilibili" data-keyword="${escapeHtml(searchKeyword)}">去 B 站搜索</button>`
  }
  if (video.embed_url) return `<button class="complex-btn btn-play-video" data-embed="${escapeHtml(video.embed_url)}" data-title="${escapeHtml(video.title || '视频讲解')}">观看视频</button>`
  if (video.external_url) return `<button class="complex-btn btn-open-external" data-url="${escapeHtml(video.external_url)}">观看视频</button>`
  return `<button class="complex-btn btn-search-bilibili" data-keyword="${escapeHtml(searchKeyword)}">去 B 站搜索</button>`
}

function renderVideoCharts(videos) {
  bindResize()
  const sourceMap = new Map()
  const kpMap = new Map()
  videos.forEach(v => {
    const source = toLower(v.status) === 'pending_search' || !v.video_id ? 'pending_search' : toLower(v.source || 'external')
    sourceMap.set(source, (sourceMap.get(source) || 0) + 1)
    const kpName = v.knowledge_point?.knowledge_point_name || v.knowledge_point_name || '未关联'
    kpMap.set(kpName, (kpMap.get(kpName) || 0) + 1)
  })
  renderRingChart('video-source-chart', [...sourceMap.entries()].map(([name, value]) => ({
    name: videoSourceLabel(name),
    value,
    itemStyle: { color: name === 'pending_search' ? CHART_COLORS.softYellow : name === 'bilibili' ? CHART_COLORS.primary : CHART_COLORS.light },
  })), '')
  const kpRows = [...kpMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  renderBarChart('video-kp-chart', kpRows.map(r => r[0]), kpRows.map(r => r[1]), '')
}

function buildPlayerModal(videoId, title, embedUrl, courseId, kpId) {
  return `
    <div class="video-modal-mask" id="video-modal-mask" data-video-id="${videoId || ''}" data-course-id="${courseId || ''}" data-kp-id="${kpId || ''}">
      <div class="video-modal">
        <div class="video-modal-head">
          <h3 class="complex-section-title" style="margin:0;">${escapeHtml(title || '视频讲解')}</h3>
          <button class="complex-btn-ghost" id="btn-close-video">关闭</button>
        </div>
        <iframe class="video-frame" src="${escapeHtml(embedUrl)}" allowfullscreen></iframe>
      </div>
    </div>`
}

export async function renderStudentVideos(app) {
  disposeAllCharts()
  const user = await getAuthedUser()
  if (!user) return

  const state = {
    loading: true,
    error: '',
    courses: [],
    knowledgePoints: [],
    videos: [],
    filters: { course_id: '', knowledge_point_id: '', source: '', recommend_type: '' },
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildPage(state), user })

  async function loadCourses() {
    try {
      const res = await getStudentCourses()
      state.courses = res.data?.list || []
    } catch {
      state.courses = []
    }
  }

  async function loadKnowledgePoints(courseId) {
    if (!courseId) {
      state.knowledgePoints = []
      return
    }
    try {
      const res = await getStudentCourseKnowledgePoints(courseId)
      state.knowledgePoints = res.data?.list || []
    } catch {
      state.knowledgePoints = []
    }
  }

  async function loadVideos() {
    state.loading = true
    state.error = ''
    rerender()
    try {
      const params = {}
      if (state.filters.course_id) params.course_id = state.filters.course_id
      if (state.filters.knowledge_point_id) params.knowledge_point_id = state.filters.knowledge_point_id
      const res = await getStudentVideoRecommendations(params)
      let videos = normalizeVideoList(res.data)
      if (state.filters.source) {
        videos = videos.filter(v => {
          const source = !v.video_id || toLower(v.status) === 'pending_search' ? 'pending_search' : toLower(v.source)
          return source === state.filters.source
        })
      }
      state.videos = videos
    } catch (err) {
      state.error = err.message || '视频资源加载失败'
      showToast('视频资源加载失败', 'error')
    } finally {
      state.loading = false
      rerender()
    }
  }

  async function syncFiltersAndLoad() {
    const courseId = document.getElementById('video-course-filter')?.value || ''
    const kpId = document.getElementById('video-kp-filter')?.value || ''
    state.filters.source = document.getElementById('video-source-filter')?.value || ''
    state.filters.recommend_type = document.getElementById('video-type-filter')?.value || ''
    if (courseId !== state.filters.course_id) {
      state.filters.course_id = courseId
      state.filters.knowledge_point_id = ''
      await loadKnowledgePoints(courseId)
    } else {
      state.filters.knowledge_point_id = kpId
    }
    await loadVideos()
  }

  async function recordWatch(card, finished = true) {
    const videoId = card?.dataset.videoId
    if (!videoId) {
      showToast('搜索建议无需记录观看', 'info')
      return
    }
    try {
      await createVideoWatchRecord(videoId, {
        course_id: card.dataset.courseId || undefined,
        knowledge_point_id: card.dataset.kpId || undefined,
        watch_duration_seconds: finished ? 300 : 30,
        is_finished: finished,
        progress_percent: finished ? 100 : 10,
      })
      showToast('观看记录已保存。', 'success')
    } catch (err) {
      showToast(err.message || '观看记录保存失败', 'error')
    }
  }

  function openPlayer(card, embedUrl, title) {
    document.getElementById('video-modal-mask')?.remove()
    document.body.insertAdjacentHTML('beforeend', buildPlayerModal(card.dataset.videoId, title, embedUrl, card.dataset.courseId, card.dataset.kpId))
    const close = () => {
      const mask = document.getElementById('video-modal-mask')
      if (!mask) return
      const fakeCard = { dataset: { videoId: mask.dataset.videoId, courseId: mask.dataset.courseId, kpId: mask.datasetKpId } }
      if (mask.dataset.videoId) {
        createVideoWatchRecord(mask.dataset.videoId, {
          course_id: mask.dataset.courseId || undefined,
          knowledge_point_id: mask.dataset.kpId || undefined,
          watch_duration_seconds: 300,
          is_finished: false,
        }).catch(() => {})
      }
      mask.remove()
    }
    document.getElementById('btn-close-video')?.addEventListener('click', close)
    document.getElementById('video-modal-mask')?.addEventListener('click', e => { if (e.target.id === 'video-modal-mask') close() })
  }

  function rerender() {
    const main = document.getElementById('student-main')
    if (!main) return
    main.innerHTML = buildPage(state)
    bindEvents()
    if (!state.loading && !state.error) requestAnimationFrame(() => renderVideoCharts(state.videos))
  }

  function bindEvents() {
    document.getElementById('btn-retry-videos')?.addEventListener('click', loadVideos)
    document.getElementById('btn-refresh-videos')?.addEventListener('click', loadVideos)
    document.getElementById('btn-apply-video-filter')?.addEventListener('click', syncFiltersAndLoad)
    document.getElementById('video-course-filter')?.addEventListener('change', async (e) => {
      state.filters.course_id = e.target.value
      state.filters.knowledge_point_id = ''
      await loadKnowledgePoints(e.target.value)
      rerender()
    })
    document.querySelectorAll('.video-card').forEach(card => {
      card.querySelector('.btn-record-watch')?.addEventListener('click', () => recordWatch(card, true))
      card.querySelector('.btn-view-kp')?.addEventListener('click', () => {
        const kpId = card.dataset.kpId
        if (kpId) window.location.hash = `#/student/knowledge-points/${kpId}`
      })
      card.querySelector('.btn-play-video')?.addEventListener('click', e => openPlayer(card, e.currentTarget.dataset.embed, e.currentTarget.dataset.title))
      card.querySelector('.btn-open-external')?.addEventListener('click', e => {
        window.open(e.currentTarget.dataset.url, '_blank', 'noopener,noreferrer')
        recordWatch(card, false)
      })
      card.querySelector('.btn-search-bilibili')?.addEventListener('click', e => {
        const keyword = e.currentTarget.dataset.keyword || '机器学习 视频讲解'
        window.open(`https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`, '_blank', 'noopener,noreferrer')
      })
    })
  }

  await loadCourses()
  await loadVideos()
}
