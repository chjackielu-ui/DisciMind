// KgVideoPanel.js — 知识图谱右侧视频讲解面板

import { searchVideos } from '../../api/student.js'
import { escapeHtml } from '../../utils/format.js'

export function buildVideoPanelHTML() {
  return `
    <div style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;padding-left:4px;">🎬 视频讲解</div>
    <div class="kg-video-area" style="flex:1;border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;">
      <div class="kg-video-player" style="flex:0 0 260px;background:#000;display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center;color:rgba(255,255,255,0.5);font-size:0.9rem;padding:20px;">
          <div style="font-size:2.5rem;margin-bottom:8px;">👆</div>
          <p>从左侧选择知识点查看视频</p>
        </div>
      </div>
      <div class="kg-video-title" style="font-size:0.85rem;color:var(--text-muted);padding:8px 14px;text-align:center;border-bottom:1px solid var(--border);">&nbsp;</div>
      <div class="kg-video-list" style="flex:1;overflow-y:auto;padding:10px;"></div>
    </div>`
}

export async function loadKpVideosToPanel(kpId, keyword, container, cache) {
  const listEl = container.querySelector('.kg-video-list')
  const playerEl = container.querySelector('.kg-video-player')
  const titleEl = container.querySelector('.kg-video-title')
  if (!listEl) return

  listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">
    <div style="display:inline-block;width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:6px;"></div>
    <p>搜索视频中...</p>
  </div>`

  try {
    let data
    if (cache[kpId]) { data = cache[kpId] }
    else {
      const res = await searchVideos({ keyword: keyword || '视频讲解', limit: 8 })
      data = res.data || { list: [], suggestion: null }
      cache[kpId] = data
    }
    const { list, suggestion } = data

    if (list.length > 0) {
      playerEl.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.5);font-size:0.85rem;padding:20px;">
        <div style="font-size:2rem;margin-bottom:6px;">🎬</div><p>请从下方选择一个视频播放</p></div>`
      titleEl.textContent = ''
      listEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;">${list.map((v, i) => {
        const isBili = (v.source || '').toLowerCase() === 'bilibili'
        const iconSvg = isBili
          ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.77 1.56-3.774C2.564 4.21 3.823 3.69 5.333 3.653h.534l-1.066-1.12a1.2 1.2 0 0 1-.347-.853c0-.338.116-.622.347-.853.23-.231.515-.347.853-.347.339 0 .623.116.854.347L7.947 3.64h8.106l1.44-1.813c.231-.231.515-.347.854-.347.338 0 .622.116.853.347.231.23.347.515.347.853a1.2 1.2 0 0 1-.347.854l-1.387 1.12zM5.333 6.4c-.8 0-1.48.283-2.04.853-.56.57-.84 1.25-.84 2.04v7.68c0 .789.28 1.469.84 2.04.56.57 1.24.853 2.04.853h13.334c.8 0 1.48-.283 2.04-.853.56-.571.84-1.251.84-2.04v-7.68c0-.79-.28-1.47-.84-2.04-.56-.57-1.24-.853-2.04-.853H5.333zm5.334 2.773v3.094h-2.56V9.173h2.56zm5.333 0v3.094h-2.56V9.173h2.56z"/></svg>'
          : '<span style="font-size:0.75rem;">▶</span>'
        return `<div class="kv-item" data-embed="${escapeHtml(v.embed_url || '')}" data-title="${escapeHtml(v.title)}" data-url="${escapeHtml(v.video_url || '')}" style="cursor:pointer;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:#fff;display:flex;align-items:center;gap:10px;transition:all 0.15s;${i === 0 ? 'border-color:#2563eb;background:#eff6ff;' : ''}">
          <div style="flex-shrink:0;width:32px;height:32px;border-radius:6px;background:${isBili ? '#fb7299' : 'var(--primary)'};color:#fff;display:flex;align-items:center;justify-content:center;">${iconSvg}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(v.title)}</div>
            ${v.author ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px;">${escapeHtml(v.author)}</div>` : ''}
          </div>
          ${v.embed_url ? '<span style="flex-shrink:0;padding:3px 10px;border-radius:6px;font-size:0.75rem;background:var(--primary);color:#fff;">播放</span>' : '<a href="' + escapeHtml(v.video_url || '#') + '" target="_blank" rel="noopener noreferrer" style="flex-shrink:0;padding:3px 10px;border-radius:6px;font-size:0.75rem;background:rgba(0,0,0,0.05);color:var(--text-muted);text-decoration:none;">观看</a>'}
        </div>`
      }).join('')}</div>`

      listEl.querySelectorAll('.kv-item').forEach((item) => {
        item.addEventListener('click', () => {
          listEl.querySelectorAll('.kv-item').forEach(el => { el.style.borderColor = 'var(--border)'; el.style.background = '#fff' })
          item.style.borderColor = '#2563eb'; item.style.background = '#eff6ff'
          const embed = item.dataset.embed; const title = item.dataset.title
          if (embed) {
            playerEl.innerHTML = `<iframe src="${escapeHtml(embed)}" style="width:100%;height:100%;border:none;" allowfullscreen allow="autoplay;fullscreen"></iframe>`
            titleEl.textContent = title || ''
          } else {
            playerEl.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.5);padding:20px;"><div style="font-size:1.5rem;">⚠️</div><p style="font-size:0.82rem;">暂无可用播放地址</p></div>`
            titleEl.textContent = title || ''
          }
        })
      })
      const first = listEl.querySelector('.kv-item')
      if (first) first.click()
    } else if (suggestion) {
      listEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.85rem;">
        <div style="font-size:2rem;margin-bottom:6px;">📺</div><p>暂无相关视频</p>
        <p style="font-size:0.78rem;margin-top:4px;">${escapeHtml(suggestion.note || '')}</p>
        <a href="${escapeHtml(suggestion.search_url || '#')}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;padding:6px 16px;border-radius:8px;background:#fb7299;color:#fff;text-decoration:none;font-size:0.82rem;">去 B 站搜索</a></div>`
      playerEl.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.5);font-size:0.85rem;padding:20px;"><div style="font-size:2rem;margin-bottom:6px;">📺</div><p>暂无视频可播放</p></div>`
      titleEl.textContent = ''
    } else {
      listEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.85rem;"><div style="font-size:2rem;margin-bottom:6px;">📺</div><p>暂无相关视频</p></div>`
      playerEl.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.5);font-size:0.85rem;padding:20px;"><div style="font-size:2rem;margin-bottom:6px;">📺</div><p>暂无视频可播放</p></div>`
      titleEl.textContent = ''
    }
  } catch (err) {
    listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;"><p>⚠️ 视频搜索失败</p></div>`
  }
}
