// KgMindMap.js — mind-elixir 思维导图封装 v4
// 5.13.0  ✅ import from 'mind-elixir'
// style    ✅ import 'mind-elixir/style'
// draggable ✅ 可拖拽平移
// 视频下拉  ✅ 每个知识点后 B站图标点击展开视频列表下拉

import MindElixir from 'mind-elixir'
import 'mind-elixir/style'
import { searchVideos } from '../../api/student.js'
import { escapeHtml } from '../../utils/format.js'

export function buildMindData(courseName, chapters) {
  return {
    nodeData: {
      topic: courseName || '课程知识图谱',
      children: (chapters || []).map((ch) => ({
        topic: ch.chapter_name || `章节 ${ch.chapter_id}`,
        children: (ch.kps || []).map((kp) => ({
          topic: kp.knowledge_point_name || '知识点',
          _data: { kpId: kp.knowledge_point_id },
        })),
      })),
    },
  }
}

export function createMindMap(containerEl, mindData, kpList, onVideoClick) {
  const mind = new MindElixir({
    el: containerEl,
    direction: MindElixir.SIDE,
    draggable: true,
    contextMenu: false,
    toolBar: false,
    nodeMenu: false,
    keypress: false,
  })
  const err = mind.init(mindData)
  if (err) throw err

  // 展开所有节点
  try {
    const root = MindElixir.E.bind(mind)('root')
    if (root) mind.expandNodeAll(root, true)
  } catch {}

  // 建立 kpName → kpId 映射
  const nameMap = {}
  for (const kp of kpList) {
    if (kp.knowledge_point_name) nameMap[kp.knowledge_point_name] = kp.knowledge_point_id
  }

  // 全局只允许一个下拉展开
  let activeDropdown = null

  // 为每个叶子节点追加 B站视频按钮 + 下拉
  function addBtns() {
    const c = mind.el || mind.container
    if (!c) return
    const nodes = c.querySelectorAll('[data-nodeid]')
    for (const el of nodes) {
      if (el.getAttribute('data-nodeid') === 'meroot') continue
      if (el.querySelector('.children')) continue
      if (el.querySelector('.kg-video-btn')) continue

      const text = (el.textContent || '').trim()
      const kpId = nameMap[text]
      if (!kpId) continue

      el.dataset.kpId = kpId

      // B站图标按钮
      const btn = document.createElement('span')
      btn.className = 'kg-video-btn'
      btn.title = '查看视频讲解'
      btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;background:#fb7299;color:#fff;cursor:pointer;font-size:11px;margin-left:6px;vertical-align:middle;flex-shrink:0;transition:transform .15s;position:relative;'
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.77 1.56-3.774C2.564 4.21 3.823 3.69 5.333 3.653h.534l-1.066-1.12a1.2 1.2 0 0 1-.347-.853c0-.338.116-.622.347-.853.23-.231.515-.347.853-.347.339 0 .623.116.854.347L7.947 3.64h8.106l1.44-1.813c.231-.231.515-.347.854-.347.338 0 .622.116.853.347.231.23.347.515.347.853a1.2 1.2 0 0 1-.347.854l-1.387 1.12zM5.333 6.4c-.8 0-1.48.283-2.04.853-.56.57-.84 1.25-.84 2.04v7.68c0 .789.28 1.469.84 2.04.56.57 1.24.853 2.04.853h13.334c.8 0 1.48-.283 2.04-.853.56-.571.84-1.251.84-2.04v-7.68c0-.79-.28-1.47-.84-2.04-.56-.57-1.24-.853-2.04-.853H5.333zm5.334 2.773v3.094h-2.56V9.173h2.56zm5.333 0v3.094h-2.56V9.173h2.56z"/></svg>'

      // 创建下拉容器
      const dropdown = document.createElement('div')
      dropdown.className = 'kg-video-dropdown'
      dropdown.style.cssText = 'display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;z-index:999;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);min-width:260px;max-width:320px;max-height:240px;overflow-y:auto;padding:6px;'
      btn.appendChild(dropdown)

      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        // 点击缩放动画
        btn.style.transform = 'scale(1.15)'
        setTimeout(() => { btn.style.transform = '' }, 200)

        // 如果当前下拉已展开且是同一个，则收起
        if (activeDropdown === dropdown && dropdown.style.display === 'block') {
          dropdown.style.display = 'none'
          activeDropdown = null
          return
        }

        // 收起其他
        if (activeDropdown && activeDropdown !== dropdown) {
          activeDropdown.style.display = 'none'
        }

        // 如果还没加载过视频，则加载
        if (!dropdown.hasChildNodes() || dropdown.children.length === 0 || !dropdown.dataset.loaded) {
          dropdown.style.display = 'block'
          dropdown.innerHTML = '<div style="text-align:center;padding:12px;"><div style="display:inline-block;width:16px;height:16px;border:2px solid #e2e8f0;border-top-color:#7c3aed;border-radius:50%;animation:spin 0.8s linear infinite;"></div><p style="font-size:0.78rem;color:#94a3b8;margin-top:6px;">加载中...</p></div>'
          activeDropdown = dropdown

          try {
            const res = await searchVideos({ keyword: text, limit: 8 })
            const data = res.data || { list: [], suggestion: null }
            dropdown.dataset.loaded = '1'
            renderDropdown(dropdown, data, kpId, onVideoClick)
          } catch (err) {
            dropdown.innerHTML = '<div style="text-align:center;padding:12px;font-size:0.78rem;color:#94a3b8;"><p>加载失败</p></div>'
          }
        } else {
          dropdown.style.display = 'block'
          activeDropdown = dropdown
        }
      })

      // 插入按钮
      const topicText = el.querySelector('.topic-text') || el.querySelector('.topic')
      if (topicText) topicText.after(btn)
      else el.appendChild(btn)
    }
  }

  // 渲染下拉视频列表（参考错题本视频讲解格式）
  function renderDropdown(dropdownEl, data, kpId, callback) {
    const list = data.list || []
    const suggestion = data.suggestion || null

    if (list.length > 0) {
      dropdownEl.innerHTML = list.map((v) => {
        const isBili = (v.source || '').toLowerCase() === 'bilibili'
        const iconSvg = isBili
          ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.77 1.56-3.774C2.564 4.21 3.823 3.69 5.333 3.653h.534l-1.066-1.12a1.2 1.2 0 0 1-.347-.853c0-.338.116-.622.347-.853.23-.231.515-.347.853-.347.339 0 .623.116.854.347L7.947 3.64h8.106l1.44-1.813c.231-.231.515-.347.854-.347.338 0 .622.116.853.347.231.23.347.515.347.853a1.2 1.2 0 0 1-.347.854l-1.387 1.12zM5.333 6.4c-.8 0-1.48.283-2.04.853-.56.57-.84 1.25-.84 2.04v7.68c0 .789.28 1.469.84 2.04.56.57 1.24.853 2.04.853h13.334c.8 0 1.48-.283 2.04-.853.56-.571.84-1.251.84-2.04v-7.68c0-.79-.28-1.47-.84-2.04-.56-.57-1.24-.853-2.04-.853H5.333zm5.334 2.773v3.094h-2.56V9.173h2.56zm5.333 0v3.094h-2.56V9.173h2.56z"/></svg>'
          : '<span style="font-size:0.65rem;">▶</span>'
        const title = escapeHtml(v.title || '视频')
        const embed = escapeHtml(v.embed_url || '')
        const vidUrl = escapeHtml(v.video_url || '')
        return `<div class="kg-vid-item" data-embed="${embed}" data-title="${title}" data-url="${vidUrl}" data-kp-id="${kpId}" style="cursor:pointer;padding:6px 8px;border-radius:8px;display:flex;align-items:center;gap:8px;transition:background 0.15s;font-size:0.78rem;">
          <span style="flex-shrink:0;width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:${isBili ? '#fb7299' : 'var(--primary)'};color:#fff;font-size:0.55rem;">${iconSvg}</span>
          <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);">${title}</span>
          <span style="flex-shrink:0;font-size:0.65rem;color:${v.embed_url ? '#2563eb' : '#94a3b8'};">${v.embed_url ? '播放' : '链接'}</span>
        </div>`
      }).join('')

      // 视频项点击 → 右侧播放 + 高亮
      dropdownEl.querySelectorAll('.kg-vid-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation()
          dropdownEl.querySelectorAll('.kg-vid-item').forEach(el => el.style.background = 'transparent')
          item.style.background = '#eff6ff'
          callback(kpId)
        })
      })
    } else if (suggestion) {
      dropdownEl.innerHTML = `<div style="padding:8px;font-size:0.75rem;color:#94a3b8;text-align:center;">
        <p style="margin-bottom:4px;">暂无相关视频</p>
        <a href="${(suggestion.search_url || '#')}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:3px 10px;border-radius:5px;background:#fb7299;color:#fff;text-decoration:none;font-size:0.72rem;">去B站搜索</a>
      </div>`
    } else {
      dropdownEl.innerHTML = '<div style="padding:8px;font-size:0.75rem;color:#94a3b8;text-align:center;">暂无视频</div>'
    }
  }

  requestAnimationFrame(() => { addBtns() })

  // 节点选中 → 从 nodeObj._data 读取 kpId → 右侧更新
  mind.bus.addListener('selectNewNode', (nodeObj) => {
    // mind-elixir 的 selectNewNode 直接将 nodeObj 作为参数
    const kpId = nodeObj?._data?.kpId
    if (!kpId) {
      // 如果 _data 不存在，尝试通过 DOM 回退
      const topicEl = nodeObj?.parentElement || nodeObj
      if (topicEl?.dataset?.kpId) return callback(parseInt(topicEl.dataset.kpId, 10))
      return
    }
    callback(parseInt(kpId, 10))
  })

  function callback(kpId) {
    // 收起所有下拉
    if (activeDropdown) {
      activeDropdown.style.display = 'none'
      activeDropdown = null
    }
    onVideoClick(kpId)
  }

  return mind
}
