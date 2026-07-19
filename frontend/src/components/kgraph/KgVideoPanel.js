// KgVideoPanel.js - knowledge graph video learning panel

import { fetchStudentGeneratedMedia, getKnowledgePointVideos, searchVideos } from '../../api/student.js'
import { BASE_URL } from '../../api/request.js'
import { escapeHtml, videoSourceLabel } from '../../utils/format.js'

function formatDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  const minutes = Math.floor(value / 60)
  const rest = Math.floor(value % 60)
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}:${String(mins).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function buildEmptyPlayer(message = '请选择知识点查看相关视频讲解') {
  return `
    <div class="kg-video-placeholder">
      <div class="kg-video-placeholder-icon" aria-hidden="true"></div>
      <p>${escapeHtml(message)}</p>
    </div>`
}

function buildSkeletonPlayer() {
  return `
    <div class="kg-video-skeleton">
      <div class="kg-video-skeleton-line wide"></div>
      <div class="kg-video-skeleton-line"></div>
    </div>`
}

function getProxyCoverUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/\/student\/videos\/cover-proxy\?/i.test(value)) {
    if (/^https?:\/\//i.test(value)) return value
    return `${BASE_URL}${value.startsWith('/') ? value.replace(/^\/api/, '') : '/' + value}`
  }
  return `${BASE_URL}/student/videos/cover-proxy?url=${encodeURIComponent(value)}`
}

function getVideoCoverUrl(video) {
  return getProxyCoverUrl(video?.cover_proxy_url || video?.cover_url)
}

function normalizeVideo(video = {}) {
  return {
    ...video,
    video_url: video.video_url || video.external_url || video.original_url || '',
    duration: video.duration ?? video.duration_seconds ?? null,
  }
}

function normalizeKnowledgePointVideoData(data = {}) {
  const list = Array.isArray(data.videos) ? data.videos.map(normalizeVideo) : []
  return {
    list,
    total: list.length,
    keyword: data.knowledge_point?.knowledge_point_name || '',
    suggestion: data.search_suggestion
      ? {
          title: data.search_suggestion.title,
          search_url: data.search_suggestion.search_keyword
            ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(data.search_suggestion.search_keyword)}`
            : '',
          source: data.search_suggestion.source,
          note: '当前知识点暂无已绑定视频，可前往 B 站搜索相关讲解。',
        }
      : null,
    knowledge_point: data.knowledge_point || null,
  }
}

function setupFullscreen(container) {
  const shell = container.querySelector('.kg-video-player-shell')
  const btn = container.querySelector('.kg-video-fullscreen-btn')
  const tip = container.querySelector('.kg-video-fullscreen-tip')
  if (!shell || !btn || btn.dataset.bound === '1') return
  btn.dataset.bound = '1'
  if (typeof window !== 'undefined' && window.__discimindKgFullscreenCleanup) {
    window.__discimindKgFullscreenCleanup()
  }

  function setTip(text) {
    if (!tip) return
    tip.textContent = text
    tip.hidden = !text
    if (text) setTimeout(() => { tip.hidden = true }, 2200)
  }

  function updateState() {
    const active = document.fullscreenElement === shell
    shell.classList.toggle('is-fullscreen', active)
    btn.classList.toggle('is-active', active)
    btn.title = active ? '退出全屏' : '全屏播放'
    btn.setAttribute('aria-label', active ? '退出全屏' : '全屏播放')
  }

  btn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenEnabled || !shell.requestFullscreen) {
        setTip('当前浏览器不支持全屏播放')
        return
      }
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen()
      } else {
        await shell.requestFullscreen()
      }
    } catch {
      setTip('全屏操作失败，请稍后再试')
    }
  })

  document.addEventListener('fullscreenchange', updateState)
  if (typeof window !== 'undefined') {
    window.__discimindKgFullscreenCleanup = () => document.removeEventListener('fullscreenchange', updateState)
  }
  updateState()
}

function updateContext(container, context = {}) {
  const contextEl = container.querySelector('#course-video-context')
  if (!contextEl) return
  const title = context.knowledgePointName || context.chapterName || context.courseName || '课程视频'
  const chapter = context.chapterName ? `<span>${escapeHtml(context.chapterName)}</span>` : ''
  const status = context.statusLabel ? `<span>${escapeHtml(context.statusLabel)}</span>` : ''
  const course = context.courseName && title !== context.courseName ? `<span>${escapeHtml(context.courseName)}</span>` : ''
  contextEl.innerHTML = `
    <div class="course-video-context-kicker">当前学习对象</div>
    <div class="course-video-context-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
    <div class="course-video-context-meta">${course}${chapter}${status}</div>`
}

function setPlayer(container, video, searchKey, cache) {
  const playerEl = container.querySelector('.kg-video-player')
  const titleEl = container.querySelector('.kg-video-title')
  const shell = container.querySelector('.kg-video-player-shell')
  if (!playerEl || !titleEl) return

  const title = video?.title || '视频讲解'
  const embed = video?.embed_url || ''
  const isGenerated = String(video?.source || '').toLowerCase() === 'self_generated' && Boolean(video?.video_url)
  const previousObjectUrl = container.dataset.generatedVideoObjectUrl
  if (previousObjectUrl) {
    URL.revokeObjectURL(previousObjectUrl)
    delete container.dataset.generatedVideoObjectUrl
  }
  const playbackToken = `${Date.now()}-${Math.random()}`
  container.dataset.generatedVideoPlaybackToken = playbackToken
  if (isGenerated) {
    playerEl.innerHTML = buildSkeletonPlayer()
    titleEl.innerHTML = `<div class="kg-video-title-main">${escapeHtml(title)}</div><div class="kg-video-title-sub">正在读取自生成讲解视频</div>`
    shell?.classList.remove('has-error')
    cache.__selectedVideoByKey = cache.__selectedVideoByKey || {}
    cache.__selectedVideoByKey[searchKey] = video.video_url || title
    fetchStudentGeneratedMedia(video.video_url).then((blob) => {
      const objectUrl = URL.createObjectURL(blob)
      if (container.dataset.generatedVideoPlaybackToken !== playbackToken) {
        URL.revokeObjectURL(objectUrl)
        return
      }
      container.dataset.generatedVideoObjectUrl = objectUrl
      playerEl.innerHTML = `<video src="${escapeHtml(objectUrl)}" title="${escapeHtml(title)}" controls playsinline preload="metadata"></video>`
      titleEl.innerHTML = `<div class="kg-video-title-main" title="${escapeHtml(title)}">${escapeHtml(title)}</div><div class="kg-video-title-sub">平台自生成 · PPT语音讲解</div>`
    }).catch((error) => {
      if (container.dataset.generatedVideoPlaybackToken !== playbackToken) return
      playerEl.innerHTML = `<div class="kg-video-placeholder"><p>${escapeHtml(error.message || '自生成视频读取失败')}</p></div>`
      shell?.classList.add('has-error')
    })
    return
  }
  if (embed) {
    playerEl.innerHTML = `
      <iframe
        src="${escapeHtml(embed)}"
        title="${escapeHtml(title)}"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        frameborder="0"
        scrolling="no"></iframe>`
    titleEl.innerHTML = `
      <div class="kg-video-title-main" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="kg-video-title-sub">${escapeHtml(videoSourceLabel(video.source || 'bilibili'))}${video.author ? ` · ${escapeHtml(video.author)}` : ''}</div>`
    shell?.classList.remove('has-error')
    cache.__selectedVideoByKey = cache.__selectedVideoByKey || {}
    cache.__selectedVideoByKey[searchKey] = video.bvid || video.video_url || video.embed_url || title
  } else {
    playerEl.innerHTML = `
      <div class="kg-video-placeholder">
        <p>该视频暂无可嵌入播放地址</p>
        ${video?.video_url ? `<a class="kg-video-open-link" href="${escapeHtml(video.video_url)}" target="_blank" rel="noopener noreferrer">打开原页面</a>` : ''}
      </div>`
    titleEl.innerHTML = `<div class="kg-video-title-main">${escapeHtml(title)}</div>`
    shell?.classList.add('has-error')
  }
}

function renderVideoList(container, list, searchKey, cache) {
  const listEl = container.querySelector('.kg-video-list')
  if (!listEl) return

  const selectedValue = cache.__selectedVideoByKey?.[searchKey]
  listEl.innerHTML = list.map((video, index) => {
    const key = video.bvid || video.video_url || video.embed_url || video.title || String(index)
    const active = selectedValue ? key === selectedValue : index === 0
    const duration = formatDuration(video.duration)
    const coverUrl = getVideoCoverUrl(video)
    return `
      <button class="kg-video-item${active ? ' is-active' : ''}" type="button" data-video-index="${index}">
        ${coverUrl ? `<img class="kg-video-cover" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="kg-video-cover kg-video-cover-fallback" aria-hidden="true"></span>'}
        <span class="kg-video-item-body">
          <span class="kg-video-item-title" title="${escapeHtml(video.title || '视频讲解')}">${escapeHtml(video.title || '视频讲解')}</span>
          <span class="kg-video-item-meta">
            ${video.author ? `<span>${escapeHtml(video.author)}</span>` : ''}
            ${duration ? `<span>${escapeHtml(duration)}</span>` : ''}
            ${video.source ? `<span>${escapeHtml(videoSourceLabel(video.source))}</span>` : ''}
          </span>
        </span>
        <span class="kg-video-item-action">${video.embed_url ? '播放' : '打开'}</span>
      </button>`
  }).join('')

  listEl.querySelectorAll('img.kg-video-cover').forEach((img) => {
    img.addEventListener('error', () => {
      const fallback = document.createElement('span')
      fallback.className = 'kg-video-cover kg-video-cover-fallback'
      fallback.setAttribute('aria-hidden', 'true')
      img.replaceWith(fallback)
    }, { once: true })
  })

  function selectVideo(item, shouldOpenExternal = false) {
      const index = Number(item.dataset.videoIndex || 0)
      const video = list[index]
      listEl.querySelectorAll('.kg-video-item').forEach((el) => el.classList.remove('is-active'))
      item.classList.add('is-active')
      setPlayer(container, video, searchKey, cache)
      if (shouldOpenExternal && !video?.embed_url && video?.video_url) {
        window.open(video.video_url, '_blank', 'noopener,noreferrer')
      }
  }

  listEl.querySelectorAll('.kg-video-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectVideo(item, true)
    })
  })

  const firstPlayable = list.findIndex((video) => {
    const key = video.bvid || video.video_url || video.embed_url || video.title
    return selectedValue ? key === selectedValue : Boolean(video.embed_url)
  })
  const selected = listEl.querySelector(`.kg-video-item[data-video-index="${Math.max(0, firstPlayable)}"]`)
    || listEl.querySelector('.kg-video-item')
  if (selected) selectVideo(selected, false)
}

export function buildVideoPanelHTML() {
  return `
    <div class="kg-video-area">
      <div class="kg-video-player-shell">
        <div class="kg-video-player">${buildEmptyPlayer()}</div>
        <button class="kg-video-fullscreen-btn" type="button" title="全屏播放" aria-label="全屏播放">
          <span class="kg-video-fullscreen-icon" aria-hidden="true"></span>
        </button>
        <div class="kg-video-fullscreen-tip" hidden></div>
      </div>
      <div class="kg-video-title">
        <div class="kg-video-title-main">等待选择知识点</div>
        <div class="kg-video-title-sub">选择图谱节点后自动搜索视频</div>
      </div>
      <details class="kg-video-list-wrap">
        <summary class="kg-video-list-head">
          <span>搜索结果</span>
          <span class="kg-video-list-count" id="kg-video-list-count">0 条</span>
          <span class="kg-video-list-toggle" aria-hidden="true">
            <span class="kg-video-list-toggle-open">展开</span>
            <span class="kg-video-list-toggle-close">收起</span>
            <i></i>
          </span>
        </summary>
        <div class="kg-video-list">${buildEmptyPlayer('暂无搜索结果')}</div>
      </details>
    </div>`
}

export async function loadKpVideosToPanel(searchKey, keyword, container, cache = {}, options = {}) {
  const listEl = container.querySelector('.kg-video-list')
  const playerEl = container.querySelector('.kg-video-player')
  const titleEl = container.querySelector('.kg-video-title')
  const countEl = container.querySelector('#kg-video-list-count')
  if (!listEl) return { list: [] }

  setupFullscreen(container)
  updateContext(container, options.context || {})
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true

  const finalKeyword = String(keyword || '').replace(/\s+/g, ' ').trim()
  if (!finalKeyword) {
    listEl.innerHTML = buildEmptyPlayer('请输入关键词后再搜索')
    if (countEl) countEl.textContent = '0 条'
    return { list: [] }
  }

  listEl.innerHTML = `
    <div class="kg-video-list-loading">
      <span class="kg-video-spinner" aria-hidden="true"></span>
      <span>搜索视频中...</span>
    </div>`
  playerEl.innerHTML = buildSkeletonPlayer()
  titleEl.innerHTML = '<div class="kg-video-title-main">正在检索讲解视频</div><div class="kg-video-title-sub">播放器会在找到可播放视频后自动载入</div>'

  try {
    const cacheKey = String(searchKey || finalKeyword)
    let data = cache[cacheKey]
    if (!data) {
      const kpId = options.knowledgePointId
      if (kpId) {
        try {
          const kpRes = await getKnowledgePointVideos(kpId)
          const kpData = normalizeKnowledgePointVideoData(kpRes.data || {})
          if (kpData.list.length > 0) data = kpData
        } catch (kpErr) {
          console.warn('[kg-video] knowledge point video lookup failed:', kpErr.message)
        }
      }
      if (!data) {
        const res = await searchVideos({
          keyword: finalKeyword,
          course_id: options.courseId,
          knowledge_point_id: options.knowledgePointId,
          limit: options.limit || 10,
        })
        data = res.data || { list: [], suggestion: null }
      }
      cache[cacheKey] = data
    }
    if (!isCurrent()) return { list: [], stale: true }

    const list = Array.isArray(data.list) ? data.list.map(normalizeVideo) : []
    const suggestion = data.suggestion || null
    if (countEl) countEl.textContent = `${list.length} 条`

    if (list.length > 0) {
      renderVideoList(container, list, cacheKey, cache)
      return data
    }

    listEl.innerHTML = `
      <div class="kg-video-empty">
        <p>暂未找到相关视频</p>
        ${suggestion?.search_url ? `<a href="${escapeHtml(suggestion.search_url)}" target="_blank" rel="noopener noreferrer">前往 B 站搜索</a>` : ''}
      </div>`
    if (!playerEl.querySelector('iframe')) {
      playerEl.innerHTML = buildEmptyPlayer('暂未找到可播放视频')
      titleEl.innerHTML = '<div class="kg-video-title-main">暂无视频</div><div class="kg-video-title-sub">可以调整关键词重新搜索</div>'
    }
    return data
  } catch (err) {
    if (!isCurrent()) return { list: [], stale: true }
    listEl.innerHTML = `
      <div class="kg-video-error">
        <p>视频搜索失败</p>
        <span>${escapeHtml(err.message || '请稍后重试')}</span>
      </div>`
    if (countEl) countEl.textContent = '搜索失败'
    if (!playerEl.querySelector('iframe')) {
      playerEl.innerHTML = buildEmptyPlayer('视频暂时无法加载')
      titleEl.innerHTML = '<div class="kg-video-title-main">搜索失败</div><div class="kg-video-title-sub">已保留当前播放状态</div>'
    }
    return { list: [], error: err }
  }
}
