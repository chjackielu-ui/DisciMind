// KgMindMap.js - mind-elixir course learning tree wrapper

import MindElixir from 'mind-elixir'
import 'mind-elixir/style'
import { escapeHtml, masteryLabel } from '../../utils/format.js'

const STATUS_META = {
  mastered: { label: '已掌握', className: 'status-mastered' },
  learning: { label: '学习中', className: 'status-learning' },
  unstarted: { label: '未学习', className: 'status-unstarted' },
  weak: { label: '薄弱', className: 'status-weak' },
}

function safeId(prefix, id) {
  const value = id == null ? 'unknown' : String(id).replace(/[^\w-]/g, '-')
  return `${prefix}-${value}`
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim()
}

function clampPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function learningStatus(kp) {
  const level = String(kp?.mastery_level || '').toLowerCase()
  const score = Number(kp?.mastery_score || 0)
  if (!kp?.last_study_at && score <= 0 && (!level || level === 'weak')) return 'unstarted'
  if (level === 'excellent' || level === 'good') return 'mastered'
  if (level === 'general') return 'learning'
  if (level === 'weak') return 'weak'
  return 'unstarted'
}

function countMastered(kps = []) {
  return kps.filter((kp) => learningStatus(kp) === 'mastered').length
}

function renderCourseNode(courseName, progress) {
  const title = escapeHtml(courseName || '课程知识图谱')
  return `
    <div class="kg-node-card kg-node-course-card" title="${title}">
      <span class="kg-node-mark kg-node-mark-course" aria-hidden="true"></span>
      <span class="kg-node-main">${title}</span>
      <span class="kg-node-sub">完成度 ${clampPercent(progress)}%</span>
    </div>`
}

function renderChapterNode(chapter) {
  const title = escapeHtml(chapter.chapter_name || `章节 ${chapter.chapter_id || ''}`)
  const done = countMastered(chapter.kps || [])
  const total = (chapter.kps || []).length
  return `
    <div class="kg-node-card kg-node-chapter-card" title="${title}">
      <span class="kg-node-main">${title}</span>
      <span class="kg-node-sub">${done}/${total} 个知识点</span>
    </div>`
}

function renderKnowledgeNode(kp) {
  const title = escapeHtml(kp.knowledge_point_name || '知识点')
  const status = learningStatus(kp)
  const meta = STATUS_META[status] || STATUS_META.unstarted
  const score = Number(kp.mastery_score || 0)
  const scoreText = score > 0 ? `${score}分` : meta.label
  return `
    <div class="kg-node-card kg-node-kp-card ${meta.className}" title="${title}">
      <span class="kg-status-dot" aria-hidden="true"></span>
      <span class="kg-node-main">${title}</span>
      <span class="kg-node-sub">${escapeHtml(scoreText)}</span>
    </div>`
}

function sortByCourseOrder(list = []) {
  return [...list].sort((a, b) => {
    const orderA = Number(a?.sort_order ?? a?.chapter_order ?? 0)
    const orderB = Number(b?.sort_order ?? b?.chapter_order ?? 0)
    if (orderA !== orderB) return orderA - orderB
    return Number(a?.chapter_id ?? a?.knowledge_point_id ?? 0) - Number(b?.chapter_id ?? b?.knowledge_point_id ?? 0)
  })
}

export function getKnowledgeStatus(kp) {
  return learningStatus(kp)
}

export function buildMindData(courseArg, chapters = []) {
  const course = typeof courseArg === 'object' && courseArg ? courseArg : { course_name: courseArg }
  const courseName = normalizeText(course.course_name || course.name, '课程知识图谱')
  const progress = clampPercent(course.learning_progress ?? course.progress)
  const chapterNodes = sortByCourseOrder(chapters).map((chapter) => {
    const chapterName = normalizeText(chapter.chapter_name || chapter.title, `章节 ${chapter.chapter_id || ''}`)
    const chapterId = safeId('chapter', chapter.chapter_id)
    const kps = sortByCourseOrder(chapter.kps || chapter.knowledgePoints || [])

    return {
      id: chapterId,
      topic: chapterName,
      dangerouslySetInnerHTML: renderChapterNode({ ...chapter, chapter_name: chapterName, kps }),
      expanded: true,
      metadata: {
        type: 'chapter',
        chapterId: chapter.chapter_id,
        chapterName,
        keyword: [courseName, chapterName].filter(Boolean).join(' '),
        total: kps.length,
        mastered: countMastered(kps),
      },
      children: kps.map((kp) => {
        const kpName = normalizeText(kp.knowledge_point_name || kp.name, '知识点')
        return {
          id: safeId('kp', kp.knowledge_point_id),
          topic: kpName,
          dangerouslySetInnerHTML: renderKnowledgeNode({ ...kp, knowledge_point_name: kpName }),
          expanded: true,
          metadata: {
            type: 'knowledgePoint',
            kpId: kp.knowledge_point_id,
            knowledgePointId: kp.knowledge_point_id,
            knowledgePointName: kpName,
            chapterId: chapter.chapter_id,
            chapterName,
            keyword: [courseName, chapterName, kpName].filter(Boolean).join(' '),
            shortKeyword: [courseName, kpName].filter(Boolean).join(' '),
            masteryLevel: kp.mastery_level || null,
            masteryScore: kp.mastery_score ?? 0,
            status: learningStatus(kp),
          },
        }
      }),
    }
  })

  return {
    nodeData: {
      id: safeId('course', course.course_id || course.id || 'root'),
      topic: courseName,
      dangerouslySetInnerHTML: renderCourseNode(courseName, progress),
      expanded: true,
      metadata: {
        type: 'course',
        courseId: course.course_id || course.id || null,
        courseName,
        progress,
        keyword: courseName,
      },
      children: chapterNodes,
    },
  }
}

function getNodeElement(mind, nodeId) {
  if (!nodeId) return null
  try {
    return MindElixir.E(nodeId)
  } catch {
    const escaped = typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(nodeId)
      : String(nodeId).replace(/"/g, '\\"')
    return mind?.el?.querySelector(`[data-nodeid="${escaped}"]`)
  }
}

function collectNodeIds(node, ids = []) {
  if (!node) return ids
  ids.push(node.id)
  ;(node.children || []).forEach((child) => collectNodeIds(child, ids))
  return ids
}

function getAncestors(nodeObj) {
  const ids = []
  let cursor = nodeObj?.parent
  while (cursor) {
    ids.push(cursor.id)
    cursor = cursor.parent
  }
  return ids
}

function nodeFocusScale(metadata = {}, currentScale = 1) {
  const type = metadata.type || ''
  const target = type === 'knowledgePoint' ? 1.18 : type === 'chapter' ? 1.08 : 1
  return Math.max(Number(currentScale) || 1, target)
}

export function createMindMap(containerEl, mindData, _kpList = [], onSelect = () => {}) {
  if (!containerEl) throw new Error('知识图谱容器不存在')

  const nodeIds = collectNodeIds(mindData?.nodeData)
  const rootId = mindData?.nodeData?.id
  const kpIdToNodeId = new Map()
  const chapterIdToNodeId = new Map()
  let activeNodeId = null
  let resizeTimer = null

  function indexNodes(node) {
    if (!node) return
    if (node.metadata?.type === 'knowledgePoint') kpIdToNodeId.set(String(node.metadata.kpId), node.id)
    if (node.metadata?.type === 'chapter') chapterIdToNodeId.set(String(node.metadata.chapterId), node.id)
    ;(node.children || []).forEach(indexNodes)
  }
  indexNodes(mindData?.nodeData)

  const mind = new MindElixir({
    el: containerEl,
    direction: MindElixir.RIGHT,
    draggable: true,
    editable: false,
    contextMenu: false,
    toolBar: false,
    nodeMenu: false,
    keypress: false,
    allowUndo: false,
    overflowHidden: false,
    alignment: 'nodes',
    compact: false,
    scaleMin: 0.35,
    scaleMax: 1.6,
    handleWheel: () => {},
    theme: {
      name: 'DisciMindLight',
      type: 'light',
      palette: ['#2F6690', '#3A7CA5', '#58A4B0', '#4CAF84', '#F0B85E'],
      cssVar: {
        '--node-gap-x': '74px',
        '--node-gap-y': '30px',
        '--main-gap-x': '92px',
        '--main-gap-y': '42px',
        '--main-color': '#2F6690',
        '--main-bgcolor': '#ffffff',
        '--main-bgcolor-transparent': 'rgba(255,255,255,0.82)',
        '--color': '#243447',
        '--bgcolor': '#ffffff',
        '--selected': '#2F6690',
        '--accent-color': '#2F6690',
        '--root-color': '#ffffff',
        '--root-bgcolor': '#2F6690',
        '--root-border-color': '#2F6690',
        '--root-radius': '18px',
        '--main-radius': '14px',
        '--topic-padding': '0',
        '--panel-color': '36, 52, 71',
        '--panel-bgcolor': '255, 255, 255',
        '--panel-border-color': '#dbe8ef',
        '--map-padding': '56px',
      },
    },
  })

  const err = mind.init(mindData)
  if (err) throw err

  function decorateNodes() {
    nodeIds.forEach((nodeId) => {
      const el = getNodeElement(mind, nodeId)
      if (!el?.nodeObj) return
      const metadata = el.nodeObj.metadata || {}
      el.dataset.kgType = metadata.type || ''
      if (metadata.kpId) el.dataset.kpId = metadata.kpId
      if (metadata.chapterId) el.dataset.chapterId = metadata.chapterId
      if (metadata.status) el.dataset.status = metadata.status
      el.title = metadata.knowledgePointName || metadata.chapterName || metadata.courseName || el.nodeObj.topic || ''
      const card = el.querySelector?.('.kg-node-card')
      if (card) {
        card.dataset.nodeId = nodeId
        card.dataset.kgType = metadata.type || ''
        if (metadata.kpId) card.dataset.kpId = metadata.kpId
        if (metadata.chapterId) card.dataset.chapterId = metadata.chapterId
      }
    })
    applySelection(activeNodeId)
  }

  function fit() {
    requestAnimationFrame(() => {
      try {
        mind.scaleFit()
        mind.toCenter()
      } catch {
        try { mind.toCenter() } catch {}
      }
      decorateNodes()
    })
  }

  function applySelection(nodeId) {
    const selected = nodeId ? getNodeElement(mind, nodeId) : null
    const selectedObj = selected?.nodeObj || null
    const related = new Set([nodeId, ...getAncestors(selectedObj)])
    ;(selectedObj?.children || []).forEach((child) => related.add(child.id))

    nodeIds.forEach((id) => {
      const el = getNodeElement(mind, id)
      if (!el) return
      const isActive = id === nodeId
      el.classList.toggle('kg-node-selected', isActive)
      el.classList.toggle('kg-node-dimmed', Boolean(nodeId) && !related.has(id))
    })
  }

  function centerNodeInViewport(el) {
    if (!el || !mind?.container) return
    try {
      const containerRect = mind.container.getBoundingClientRect()
      const nodeRect = el.getBoundingClientRect()
      const dx = (containerRect.left + containerRect.width / 2) - (nodeRect.left + nodeRect.width / 2)
      const dy = (containerRect.top + containerRect.height / 2) - (nodeRect.top + nodeRect.height / 2)
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mind.move(dx, dy, true)
    } catch {}
  }

  function focusNodeElement(el, { zoom = true } = {}) {
    if (!el) return
    try {
      if (zoom) {
        const rect = mind.container?.getBoundingClientRect?.()
        const nextScale = Math.min(mind.scaleMax || 1.6, nodeFocusScale(el.nodeObj?.metadata || {}, mind.scaleVal))
        mind.scale(nextScale, rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined)
      }
      requestAnimationFrame(() => {
        try { mind.scrollIntoView(el, true) } catch {}
        requestAnimationFrame(() => centerNodeInViewport(el))
      })
    } catch {
      try { mind.scrollIntoView(el, true) } catch {}
    }
  }

  function emitSelection(nodeObj) {
    const metadata = nodeObj?.metadata || {}
    activeNodeId = nodeObj?.id || null
    decorateNodes()
    applySelection(activeNodeId)
    onSelect({
      ...metadata,
      id: nodeObj?.id || null,
      name: metadata.knowledgePointName || metadata.chapterName || metadata.courseName || nodeObj?.topic || '',
      nodeId: nodeObj?.id || null,
    })
  }

  function selectNodeById(nodeId, shouldCenter = true) {
    const el = getNodeElement(mind, nodeId)
    if (!el) return false
    activeNodeId = nodeId
    try { mind.selectNode(el, false) } catch {}
    if (shouldCenter) focusNodeElement(el)
    emitSelection(el.nodeObj)
    return true
  }

  mind.bus.addListener('selectNewNode', (nodeObj) => {
    if (nodeObj?.metadata?.type === 'chapter') {
      const el = getNodeElement(mind, nodeObj.id)
      if (el) {
        try { mind.expandNode(el) } catch {}
      }
    }
    focusNodeElement(getNodeElement(mind, nodeObj?.id))
    emitSelection(nodeObj)
  })

  function handleNodeCardClick(event) {
    const card = event.target?.closest?.('.kg-node-card')
    if (!card || !containerEl.contains(card)) return
    const nodeId = card.dataset.nodeId || card.closest?.('[data-nodeid]')?.dataset.nodeid
    if (nodeId && nodeId !== activeNodeId) selectNodeById(nodeId)
  }

  containerEl.addEventListener('click', handleNodeCardClick)

  requestAnimationFrame(() => {
    try {
      const root = getNodeElement(mind, rootId)
      if (root) mind.expandNodeAll(root, true)
    } catch {}
    decorateNodes()
    fit()
  })

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(fit, 120)
    })
    : null
  resizeObserver?.observe(containerEl)

  return {
    mind,
    fit,
    zoomIn() {
      const next = Math.min(1.6, Number((mind.scaleVal + 0.12).toFixed(2)))
      mind.scale(next)
    },
    zoomOut() {
      const next = Math.max(0.35, Number((mind.scaleVal - 0.12).toFixed(2)))
      mind.scale(next)
    },
    centerRoot() {
      selectNodeById(rootId, false)
      try { mind.toCenter() } catch {}
    },
    expandAll() {
      const root = getNodeElement(mind, rootId)
      if (root) mind.expandNodeAll(root, true)
      requestAnimationFrame(() => { decorateNodes(); fit() })
    },
    collapseAll() {
      const root = getNodeElement(mind, rootId)
      if (root) mind.expandNodeAll(root, false)
      requestAnimationFrame(() => { decorateNodes(); fit() })
    },
    selectKnowledgePoint(kpId) {
      return selectNodeById(kpIdToNodeId.get(String(kpId)))
    },
    selectChapter(chapterId) {
      return selectNodeById(chapterIdToNodeId.get(String(chapterId)))
    },
    selectRoot() {
      return selectNodeById(rootId)
    },
    dispose() {
      containerEl.removeEventListener('click', handleNodeCardClick)
      resizeObserver?.disconnect()
      clearTimeout(resizeTimer)
      try { mind.destroy?.() } catch {}
    },
    getNodeIdByKpId(kpId) {
      return kpIdToNodeId.get(String(kpId)) || null
    },
    getNodeIdByChapterId(chapterId) {
      return chapterIdToNodeId.get(String(chapterId)) || null
    },
    getStatus(kp) {
      return learningStatus(kp)
    },
    getStatusLabel(kp) {
      return STATUS_META[learningStatus(kp)]?.label || masteryLabel(kp?.mastery_level)
    },
  }
}
