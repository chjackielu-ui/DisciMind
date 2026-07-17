export const LEARNING_FLOW_NODE_WIDTH = 200
export const LEARNING_FLOW_NODE_HEIGHT = 100

export function edgeSource(edge) {
  return String(edge?.source ?? edge?.sourceNodeId ?? '')
}

export function edgeTarget(edge) {
  return String(edge?.target ?? edge?.targetNodeId ?? '')
}

export function defaultSourcePort(edge) {
  if (edge?.sourcePort) return edge.sourcePort
  if (edge?.condition?.type === 'mastery_gte') return 'pass'
  if (edge?.condition?.type === 'mastery_lt') return 'fail'
  return 'output'
}

export function normalizeGraphPorts(graph) {
  const safe = graph && Array.isArray(graph.nodes) ? graph : { entryNodeId: '', nodes: [], edges: [] }
  const nodeIds = new Set((safe.nodes || []).map((node) => String(node.id)))
  const edgeKeys = new Set()
  safe.edges = (safe.edges || []).map((edge, index) => {
    const source = edgeSource(edge)
    const target = edgeTarget(edge)
    return {
      ...edge,
      id: String(edge.id || `edge_${source}_${target}_${index}`),
      source,
      target,
      sourceNodeId: source,
      targetNodeId: target,
      sourcePort: defaultSourcePort(edge),
      targetPort: edge.targetPort || 'input',
    }
  }).filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) return false
    const key = `${edge.source}:${edge.sourcePort}->${edge.target}:${edge.targetPort}`
    if (edgeKeys.has(key)) return false
    edgeKeys.add(key)
    return true
  })
  return safe
}

export function nodePortPoint(node, port = 'output', width = LEARNING_FLOW_NODE_WIDTH, height = LEARNING_FLOW_NODE_HEIGHT) {
  const x = node.position?.x || 0
  const y = node.position?.y || 0
  if (port === 'input') return { x, y: y + height / 2 }
  if (port === 'pass') return { x: x + width, y: y + height * 0.34 }
  if (port === 'fail') return { x: x + width, y: y + height * 0.68 }
  return { x: x + width, y: y + height / 2 }
}

export function canvasPointFromClient(clientX, clientY, rect, panX = 0, panY = 0, scale = 1) {
  const zoom = Number(scale) > 0 ? Number(scale) : 1
  return {
    x: (Number(clientX) - Number(rect?.left || 0) - Number(panX || 0)) / zoom,
    y: (Number(clientY) - Number(rect?.top || 0) - Number(panY || 0)) / zoom,
  }
}

export function zoomAroundCanvasPoint(localX, localY, panX, panY, fromScale, toScale) {
  const world = canvasPointFromClient(localX, localY, { left: 0, top: 0 }, panX, panY, fromScale)
  return { scale: toScale, panX: Number(localX) - world.x * toScale, panY: Number(localY) - world.y * toScale }
}

export function normalizeSelectionRect(rect) {
  const x1 = Number(rect?.startX ?? rect?.left ?? 0)
  const y1 = Number(rect?.startY ?? rect?.top ?? 0)
  const x2 = Number(rect?.currentX ?? rect?.right ?? x1)
  const y2 = Number(rect?.currentY ?? rect?.bottom ?? y1)
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) }
}

export function nodesInSelectionRect(nodes, rect, panX = 0, panY = 0, scale = 1, width = LEARNING_FLOW_NODE_WIDTH, height = LEARNING_FLOW_NODE_HEIGHT) {
  const box = normalizeSelectionRect(rect)
  const zoom = Number(scale) > 0 ? Number(scale) : 1
  return (Array.isArray(nodes) ? nodes : []).filter((node) => {
    const left = Number(panX) + Number(node?.position?.x || 0) * zoom
    const top = Number(panY) + Number(node?.position?.y || 0) * zoom
    const right = left + Number(width) * zoom
    const bottom = top + Number(height) * zoom
    return left <= box.right && right >= box.left && top <= box.bottom && bottom >= box.top
  }).map((node) => String(node.id))
}

export function horizontalEdgePath(source, target, lane = 0) {
  const sx = Number(source?.x || 0)
  const sy = Number(source?.y || 0)
  const tx = Number(target?.x || 0)
  const ty = Number(target?.y || 0)
  const distance = tx - sx
  if (distance > 0) {
    const bend = Math.max(30, Math.min(160, distance * 0.45))
    return `M${sx} ${sy} C${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`
  }
  const clearance = 80 + Math.max(0, Number(lane) || 0) * 18
  const routeY = Math.min(sy, ty) - clearance
  const approach = Math.max(70, Math.min(140, Math.abs(distance) * 0.35 + 70))
  const middleX = (sx + tx) / 2
  return `M${sx} ${sy} C${sx + approach} ${sy}, ${sx + approach} ${routeY}, ${middleX} ${routeY} C${tx - approach} ${routeY}, ${tx - approach} ${ty}, ${tx} ${ty}`
}

export function removeNodeFromGraph(graph, nodeId) {
  const id = String(nodeId)
  const nodes = (graph?.nodes || []).filter((node) => String(node.id) !== id)
  const edges = (graph?.edges || []).filter((edge) => edgeSource(edge) !== id && edgeTarget(edge) !== id)
  return { ...graph, nodes, edges, entryNodeId: String(graph?.entryNodeId || '') === id ? (nodes[0]?.id || '') : graph?.entryNodeId }
}

export function autoLayoutGraph(graph) {
  const next = {
    ...graph,
    nodes: (graph?.nodes || []).map((node) => ({ ...node, position: { ...(node.position || {}) } })),
    edges: (graph?.edges || []).map((edge) => ({ ...edge })),
  }
  if (!next.nodes.length) return next
  const nodeIds = new Set(next.nodes.map((node) => String(node.id)))
  const adjacent = Object.fromEntries([...nodeIds].map((id) => [id, []]))
  const indegree = Object.fromEntries([...nodeIds].map((id) => [id, 0]))
  for (const edge of next.edges) {
    const source = edgeSource(edge)
    const target = edgeTarget(edge)
    if (nodeIds.has(source) && nodeIds.has(target)) {
      adjacent[source].push(target)
      indegree[target] += 1
    }
  }
  const layers = []
  const remaining = new Set(nodeIds)
  while (remaining.size) {
    const layer = [...remaining].filter((id) => (indegree[id] || 0) === 0)
    if (!layer.length) layer.push(remaining.values().next().value)
    layers.push(layer)
    for (const id of layer) {
      remaining.delete(id)
      for (const target of adjacent[id]) indegree[target] = Math.max(0, (indegree[target] || 0) - 1)
    }
  }
  const spacingX = 290
  const spacingY = 150
  const startX = 80
  const centerY = 260
  layers.forEach((layer, column) => layer.forEach((id, row) => {
    const node = next.nodes.find((item) => String(item.id) === id)
    if (node) node.position = { x: startX + column * spacingX, y: centerY + (row - (layer.length - 1) / 2) * spacingY }
  }))
  return next
}
