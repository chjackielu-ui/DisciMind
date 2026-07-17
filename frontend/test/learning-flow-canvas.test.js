import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canvasPointFromClient,
  nodesInSelectionRect,
  normalizeGraphPorts,
  normalizeSelectionRect,
  removeNodeFromGraph,
  zoomAroundCanvasPoint,
} from '../src/utils/learning-flow-canvas.js'

test('zoom keeps the world point below the pointer stable', () => {
  const before = canvasPointFromClient(320, 180, { left: 0, top: 0 }, 80, 40, 1)
  const zoomed = zoomAroundCanvasPoint(320, 180, 80, 40, 1, 1.75)
  const after = canvasPointFromClient(320, 180, { left: 0, top: 0 }, zoomed.panX, zoomed.panY, zoomed.scale)
  assert.deepEqual(after, before)
})

test('selection rectangles work in either drag direction and honor pan/zoom', () => {
  const reversed = normalizeSelectionRect({ startX: 500, startY: 300, currentX: 100, currentY: 50 })
  assert.deepEqual(reversed, { left: 100, top: 50, right: 500, bottom: 300 })
  const nodes = [
    { id: 'inside', position: { x: 100, y: 80 } },
    { id: 'overlap', position: { x: 260, y: 80 } },
    { id: 'outside', position: { x: 600, y: 600 } },
  ]
  assert.deepEqual(nodesInSelectionRect(nodes, { left: 190, top: 130, right: 600, bottom: 330 }, 20, 10, 1.5), ['inside', 'overlap'])
})

test('port normalization rejects dangling, self and duplicate connections', () => {
  const graph = normalizeGraphPorts({
    entryNodeId: 'a', nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [
      { id: 'ok', source: 'a', target: 'b' },
      { id: 'duplicate', sourceNodeId: 'a', targetNodeId: 'b' },
      { id: 'self', source: 'a', target: 'a' },
      { id: 'missing', source: 'a', target: 'c' },
    ],
  })
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].sourcePort, 'output')
  assert.equal(graph.edges[0].targetPort, 'input')
})

test('deleting a node removes its edges and repairs the entry node', () => {
  const result = removeNodeFromGraph({
    entryNodeId: 'a', nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
  }, 'a')
  assert.deepEqual(result.nodes.map(node => node.id), ['b', 'c'])
  assert.deepEqual(result.edges.map(edge => `${edge.source}->${edge.target}`), ['b->c'])
  assert.equal(result.entryNodeId, 'b')
})
