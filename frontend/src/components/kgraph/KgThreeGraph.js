// 课程知识图谱的轻量三维投影渲染器。
// 不依赖 WebGL：节点在真实的 x/y/z 空间中布局，再投影到 SVG；因此可以旋转、缩放和按层级展开。

const SVG_NS = 'http://www.w3.org/2000/svg'

const STATUS_COLORS = {
  mastered: '#3f9b78',
  learning: '#3b82b6',
  weak: '#d97745',
  unstarted: '#8a9cab',
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function svg(tag, attributes = {}) {
  const el = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, String(value)))
  return el
}
function text(value, fallback = '') { return String(value ?? fallback).replace(/\s+/g, ' ').trim() || fallback }
function statusOf(point = {}) {
  const status = String(point.learning_status || point.status || '').toLowerCase()
  if (STATUS_COLORS[status]) return status
  const level = String(point.mastery_level || '').toLowerCase()
  const score = Number(point.mastery_score ?? point.mastery_progress ?? 0)
  if (!point.last_study_at && score <= 0) return 'unstarted'
  if (level === 'excellent' || level === 'good' || score >= 75) return 'mastered'
  if (level === 'weak' || score < 60) return 'weak'
  return 'learning'
}
function angleAt(index, total, offset = -Math.PI / 2) { return offset + (Math.PI * 2 * index / Math.max(1, total)) }

function buildNodes(course, chapters, points) {
  const rootId = `course-${course.course_id || course.id || 'root'}`
  const nodes = new Map([[rootId, {
    id: rootId, type: 'course', label: text(course.course_name || course.name, '课程知识图谱'),
    x: 0, y: 0, z: 0, parentId: null, children: [], metadata: {
      type: 'course', courseId: course.course_id || course.id || null, courseName: course.course_name || course.name,
      keyword: course.course_name || course.name,
    },
  }]])
  const pointMap = new Map((points || []).map((item) => [String(item.knowledge_point_id), item]))
  const childrenByParent = new Map()
  for (const point of points || []) {
    const parentId = point.parent_id != null && pointMap.has(String(point.parent_id)) ? `kp-${point.parent_id}` : null
    if (parentId) {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
      childrenByParent.get(parentId).push(point)
    }
  }
  const chapterNodes = []
  for (const [chapterIndex, chapter] of (chapters || []).entries()) {
    const angle = angleAt(chapterIndex, chapters.length)
    const chapterId = `chapter-${chapter.chapter_id}`
    const node = {
      id: chapterId, type: 'chapter', label: text(chapter.chapter_name, '未命名章节'),
      x: Math.cos(angle) * 220, y: Math.sin(angle) * 150, z: ((chapterIndex % 3) - 1) * 55,
      parentId: rootId, children: [], metadata: {
        type: 'chapter', chapterId: chapter.chapter_id, chapterName: chapter.chapter_name,
        total: Number(chapter.knowledge_point_count || 0), keyword: `${course.course_name || ''} ${chapter.chapter_name || ''}`,
      },
    }
    nodes.set(chapterId, node); nodes.get(rootId).children.push(chapterId); chapterNodes.push(node)
  }
  const rootsByChapter = new Map()
  for (const point of points || []) {
    const parentExists = point.parent_id != null && pointMap.has(String(point.parent_id))
    if (!parentExists) {
      const chapterId = `chapter-${point.chapter_id}`
      if (!rootsByChapter.has(chapterId)) rootsByChapter.set(chapterId, [])
      rootsByChapter.get(chapterId).push(point)
    }
  }
  function appendPoint(point, parentNode, index, total, depth) {
    const id = `kp-${point.knowledge_point_id}`
    const branchAngle = angleAt(index, total, Math.atan2(parentNode.y, parentNode.x) - Math.PI / 4)
    const radius = Math.max(86, 155 - depth * 18)
    const node = {
      id, type: 'knowledgePoint', label: text(point.knowledge_point_name, '知识点'),
      x: parentNode.x + Math.cos(branchAngle) * radius,
      y: parentNode.y + Math.sin(branchAngle) * radius * 0.7,
      z: parentNode.z + (((index % 4) - 1.5) * 38) + depth * 24,
      parentId: parentNode.id, children: [], metadata: {
        type: 'knowledgePoint', kpId: point.knowledge_point_id, knowledgePointId: point.knowledge_point_id,
        knowledgePointName: point.knowledge_point_name, chapterId: point.chapter_id, chapterName: point.chapter_name,
        parentId: point.parent_id || null, masteryScore: Number(point.mastery_score ?? point.mastery_progress ?? 0),
        masteryLevel: point.mastery_level, status: statusOf(point), learningAdvice: point.learning_advice || '',
        resources: point.resources || [], relatedKnowledgePointIds: point.related_knowledge_point_ids || [],
        keyword: `${course.course_name || ''} ${point.chapter_name || ''} ${point.knowledge_point_name || ''}`,
        shortKeyword: `${course.course_name || ''} ${point.knowledge_point_name || ''}`,
      },
    }
    nodes.set(id, node); parentNode.children.push(id)
    const children = childrenByParent.get(id) || []
    children.forEach((child, childIndex) => appendPoint(child, node, childIndex, children.length, depth + 1))
  }
  for (const chapter of chapterNodes) {
    const roots = rootsByChapter.get(chapter.id) || []
    roots.forEach((point, index) => appendPoint(point, chapter, index, roots.length, 1))
  }
  return { rootId, nodes }
}

function project(node, rotationX, rotationY, zoom, width, height) {
  const cosY = Math.cos(rotationY); const sinY = Math.sin(rotationY)
  const x1 = node.x * cosY - node.z * sinY; const z1 = node.x * sinY + node.z * cosY
  const cosX = Math.cos(rotationX); const sinX = Math.sin(rotationX)
  const y1 = node.y * cosX - z1 * sinX; const z2 = node.y * sinX + z1 * cosX
  const perspective = 620 / (620 + z2)
  return { x: width / 2 + x1 * perspective * zoom, y: height / 2 + y1 * perspective * zoom, depth: z2, scale: perspective * zoom }
}

export function createThreeKnowledgeGraph(container, course, chapters, points, onSelect = () => {}) {
  if (!container) throw new Error('三维知识图谱容器不存在')
  const { rootId, nodes } = buildNodes(course || {}, chapters || [], points || [])
  const visible = new Set([rootId, ...(nodes.get(rootId)?.children || [])])
  const expanded = new Set([rootId])
  const kpNodeIds = new Map(); const chapterNodeIds = new Map()
  nodes.forEach((node) => {
    if (node.type === 'knowledgePoint') kpNodeIds.set(String(node.metadata.kpId), node.id)
    if (node.type === 'chapter') chapterNodeIds.set(String(node.metadata.chapterId), node.id)
  })
  let rotationX = -0.32; let rotationY = 0.55; let zoom = 1; let selectedId = rootId; let drag = null
  let animationFrame = 0
  const stage = document.createElement('div'); stage.className = 'kg-three-stage'; stage.tabIndex = 0
  const hint = document.createElement('div'); hint.className = 'kg-three-hint'; hint.textContent = '拖拽旋转 · 滚轮缩放 · 点击节点展开'
  const svgEl = svg('svg', { class: 'kg-three-svg', role: 'img', 'aria-label': `${course?.course_name || '课程'}三维知识图谱` })
  stage.append(svgEl, hint); container.replaceChildren(stage)

  function syncVisibility() {
    visible.clear(); visible.add(rootId)
    function visit(nodeId) {
      const node = nodes.get(nodeId); if (!node) return
      if (!expanded.has(nodeId)) return
      node.children.forEach((childId) => { visible.add(childId); visit(childId) })
    }
    visit(rootId)
  }
  function draw() {
    animationFrame = 0
    const rect = stage.getBoundingClientRect(); const width = Math.max(300, rect.width || 760); const height = Math.max(360, rect.height || 520)
    svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`); svgEl.replaceChildren()
    const projected = [...visible].map((id) => ({ node: nodes.get(id), ...project(nodes.get(id), rotationX, rotationY, zoom, width, height) })).sort((a, b) => a.depth - b.depth)
    const projectionMap = new Map(projected.map((item) => [item.node.id, item]))
    const edgeLayer = svg('g', { class: 'kg-three-edges' }); const nodeLayer = svg('g', { class: 'kg-three-nodes' })
    for (const item of projected) {
      if (!item.node.parentId || !projectionMap.has(item.node.parentId)) continue
      const parent = projectionMap.get(item.node.parentId)
      edgeLayer.append(svg('line', { x1: parent.x, y1: parent.y, x2: item.x, y2: item.y, opacity: clamp(0.18 + item.scale * 0.18, 0.2, 0.48) }))
    }
    for (const item of projected) {
      const node = item.node; const isSelected = node.id === selectedId; const hasChildren = node.children.length > 0
      const group = svg('g', { class: `kg-three-node kg-three-node--${node.type}${isSelected ? ' is-selected' : ''}${hasChildren ? ' is-expandable' : ''}`, transform: `translate(${item.x} ${item.y}) scale(${clamp(item.scale, 0.58, 1.75)})`, tabindex: '0', role: 'button', 'aria-label': `${node.label}${hasChildren ? (expanded.has(node.id) ? '，收起子节点' : '，展开子节点') : ''}` })
      const radius = node.type === 'course' ? 38 : node.type === 'chapter' ? 30 : 22
      const color = node.type === 'course' ? '#1f587a' : node.type === 'chapter' ? '#3a7ca5' : STATUS_COLORS[node.metadata.status] || '#3a7ca5'
      group.append(svg('circle', { class: 'kg-three-node-shadow', cx: 4, cy: 7, r: radius }))
      group.append(svg('circle', { class: 'kg-three-node-body', cx: 0, cy: 0, r: radius, fill: color }))
      group.append(svg('circle', { class: 'kg-three-node-orbit', cx: 0, cy: 0, r: radius + 5, stroke: color }))
      const label = svg('text', { class: 'kg-three-node-label', x: 0, y: radius + 17, 'text-anchor': 'middle' }); label.textContent = node.label.length > 11 ? `${node.label.slice(0, 10)}…` : node.label; group.append(label)
      if (node.type === 'knowledgePoint') { const score = svg('text', { class: 'kg-three-node-score', x: 0, y: 4, 'text-anchor': 'middle' }); score.textContent = `${Math.round(node.metadata.masteryScore || 0)}%`; group.append(score) }
      else if (hasChildren) { const marker = svg('text', { class: 'kg-three-node-marker', x: radius - 2, y: -radius + 7, 'text-anchor': 'middle' }); marker.textContent = expanded.has(node.id) ? '−' : '+'; group.append(marker) }
      const select = () => selectNode(node.id, { toggle: hasChildren })
      group.addEventListener('click', (event) => { event.stopPropagation(); select() })
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } })
      nodeLayer.append(group)
    }
    svgEl.append(edgeLayer, nodeLayer)
  }
  function scheduleDraw() { if (!animationFrame) animationFrame = requestAnimationFrame(draw) }
  function selectionPayload(node) { return { ...node.metadata, id: node.id, nodeId: node.id, name: node.label } }
  function selectNode(id, { toggle = false, silent = false } = {}) {
    const node = nodes.get(id); if (!node) return false
    selectedId = id
    if (toggle && node.children.length) {
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id)
      syncVisibility()
    }
    scheduleDraw()
    if (!silent) onSelect(selectionPayload(node))
    return true
  }
  function expandAncestors(id) { let cursor = nodes.get(id); while (cursor?.parentId) { expanded.add(cursor.parentId); cursor = nodes.get(cursor.parentId) } syncVisibility() }
  function fit() { rotationX = -0.32; rotationY = 0.55; zoom = 1; scheduleDraw() }
  function expandAll() { nodes.forEach((node) => { if (node.children.length) expanded.add(node.id) }); syncVisibility(); scheduleDraw() }
  function collapseAll() { expanded.clear(); expanded.add(rootId); syncVisibility(); selectedId = rootId; scheduleDraw(); onSelect(selectionPayload(nodes.get(rootId))) }
  const onPointerDown = (event) => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; stage.setPointerCapture?.(event.pointerId); stage.classList.add('is-rotating') }
  const onPointerMove = (event) => { if (!drag || drag.id !== event.pointerId) return; rotationY += (event.clientX - drag.x) * 0.008; rotationX = clamp(rotationX + (event.clientY - drag.y) * 0.007, -1.1, 1.1); drag.x = event.clientX; drag.y = event.clientY; scheduleDraw() }
  const onPointerUp = (event) => { if (!drag || drag.id !== event.pointerId) return; drag = null; stage.classList.remove('is-rotating'); stage.releasePointerCapture?.(event.pointerId) }
  const onWheel = (event) => { event.preventDefault(); zoom = clamp(zoom + (event.deltaY < 0 ? 0.09 : -0.09), 0.55, 1.85); scheduleDraw() }
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleDraw) : null
  stage.addEventListener('pointerdown', onPointerDown); stage.addEventListener('pointermove', onPointerMove); stage.addEventListener('pointerup', onPointerUp); stage.addEventListener('pointercancel', onPointerUp); stage.addEventListener('wheel', onWheel, { passive: false }); observer?.observe(stage)
  scheduleDraw(); onSelect(selectionPayload(nodes.get(rootId)))
  return {
    fit, zoomIn() { zoom = clamp(zoom + 0.12, 0.55, 1.85); scheduleDraw() }, zoomOut() { zoom = clamp(zoom - 0.12, 0.55, 1.85); scheduleDraw() }, centerRoot() { selectedId = rootId; fit(); onSelect(selectionPayload(nodes.get(rootId))) }, expandAll, collapseAll,
    selectKnowledgePoint(kpId) { const id = kpNodeIds.get(String(kpId)); if (!id) return false; expandAncestors(id); return selectNode(id) },
    selectChapter(chapterId) { const id = chapterNodeIds.get(String(chapterId)); if (!id) return false; return selectNode(id, { toggle: true }) },
    selectRoot() { return selectNode(rootId) },
    dispose() { if (animationFrame) cancelAnimationFrame(animationFrame); observer?.disconnect(); stage.removeEventListener('pointerdown', onPointerDown); stage.removeEventListener('pointermove', onPointerMove); stage.removeEventListener('pointerup', onPointerUp); stage.removeEventListener('pointercancel', onPointerUp); stage.removeEventListener('wheel', onWheel); container.replaceChildren() },
  }
}

