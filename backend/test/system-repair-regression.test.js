const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('@ knowledge-base detection supports empty and Chinese queries without entering protected syntax', async () => {
  const composer = await import(pathToFileURL(path.join(root, 'frontend/src/components/unified-composer.js')).href)
  assert.deepEqual(composer.activeComposerMention('@', 1), { type: 'knowledge', query: '', start: 0, end: 1 })
  const chinese = '请结合 @机器学习'
  assert.deepEqual(composer.activeComposerMention(chinese, chinese.length), { type: 'knowledge', query: '机器学习', start: 4, end: chinese.length })
  assert.equal(composer.activeComposerMention('x@机器学习', 6), null)
  assert.equal(composer.activeComposerMention('`@机器学习`', 6), null)
})

test('@ knowledge-base structured selection supports multiple values and de-duplicates by stable id', async () => {
  const composer = await import(pathToFileURL(path.join(root, 'frontend/src/components/unified-composer.js')).href)
  let refs = composer.appendUniqueKnowledgeBaseRef([], { id: 7, name: '机器学习' })
  refs = composer.appendUniqueKnowledgeBaseRef(refs, { id: 8, name: '高等数学' })
  refs = composer.appendUniqueKnowledgeBaseRef(refs, { id: 7, name: '重复名称不覆盖' })
  assert.deepEqual(refs, [
    { knowledgeBaseId: 7, name: '机器学习' },
    { knowledgeBaseId: 8, name: '高等数学' },
  ])
})

test('composer defers mention parsing during IME composition and preserves keyboard controls', () => {
  const source = read('frontend/src/components/unified-composer.js')
  assert.match(source, /compositionstart[\s\S]*state\.composing\s*=\s*true/)
  assert.match(source, /compositionend[\s\S]*state\.composing\s*=\s*false[\s\S]*updateMention/)
  assert.match(source, /event\.isComposing\s*\|\|\s*state\.composing/)
  for (const key of ['ArrowDown', 'ArrowUp', 'Escape', 'Tab', 'Enter']) assert.match(source, new RegExp(key))
})

test('knowledge-base references are re-authorized and require a usable Dify dataset', () => {
  const context = require('../src/modules/agent-chat/agent-context.service')
  const scope = { role: 'STUDENT', courseIds: new Set([2]), teachingClassIds: new Set([3]) }
  assert.equal(context.canAccessKnowledgeBase({ owner_user_id: 11 }, 11, scope), true)
  assert.equal(context.canAccessKnowledgeBase({ owner_user_id: 12, marketplace_visibility: 'PRIVATE' }, 11, scope), false)
  assert.equal(context.isKnowledgeBaseAvailable({ dify_dataset_id: 'dataset-1', marketplace_status: 'READY' }), true)
  assert.equal(context.isKnowledgeBaseAvailable({ dify_dataset_id: null, marketplace_status: 'READY' }), false)
  assert.equal(context.isKnowledgeBaseAvailable({ dify_dataset_id: 'dataset-1', marketplace_status: 'FAILED' }), false)
  const source = read('backend/src/modules/agent-chat/agent-context.service.js')
  assert.match(source, /resolveKnowledgeBaseRefs[\s\S]*canAccessKnowledgeBase[\s\S]*isKnowledgeBaseAvailable/)
  assert.match(source, /retrieveFromMultipleDatasets/)
})

test('all three learning-plan creation modes validate into one schema', () => {
  const { createSchema } = require('../src/modules/student-learning-plan/student-learning-plan.schemas')
  const base = { courseId: 1, knowledgePointId: 2, workflowTemplateId: 3, workflowVersionId: 4, status: 'ready' }
  assert.equal(createSchema.safeParse({ ...base, creationMode: 'goal_based', learningGoalId: 5 }).success, true)
  assert.equal(createSchema.safeParse({ ...base, creationMode: 'ai_generated', goalText: '理解决策树' }).success, true)
  assert.equal(createSchema.safeParse({ ...base, creationMode: 'custom', goalText: '自定义学习目标' }).success, true)
  assert.equal(createSchema.safeParse({ ...base, creationMode: 'unknown', goalText: '非法模式' }).success, false)
})

test('learning-plan status transitions are explicit and reject invalid shortcuts', () => {
  const { STATUS_TRANSITIONS } = require('../src/modules/student-learning-plan/student-learning-plan.service')
  assert.deepEqual(STATUS_TRANSITIONS.DRAFT, ['READY', 'ARCHIVED'])
  assert.ok(STATUS_TRANSITIONS.READY.includes('RUNNING'))
  assert.ok(STATUS_TRANSITIONS.RUNNING.includes('PAUSED'))
  assert.ok(STATUS_TRANSITIONS.RUNNING.includes('COMPLETED'))
  assert.ok(STATUS_TRANSITIONS.FAILED.includes('READY'))
  assert.deepEqual(STATUS_TRANSITIONS.ARCHIVED, [])
  assert.equal(STATUS_TRANSITIONS.READY.includes('COMPLETED'), false)
})

test('goal rematch and historical repair use stable ids and frozen workflow snapshots', () => {
  const service = read('backend/src/modules/student-learning-plan/student-learning-plan.service.js')
  assert.match(service, /courseId:[\s\S]*knowledgePointId:[\s\S]*workflowVersionId:/)
  assert.match(service, /graphSnapshot:[\s\S]*settingsSnapshot:/)
  assert.match(service, /materializeLegacy[\s\S]*workflow_version_id/)
  assert.match(service, /needsRematch:\s*true[\s\S]*当前计划需要重新匹配学习流/)
  assert.doesNotMatch(service, /normalized_title\s*===\s*.*title/)
})

test('learning preparation is plan-scoped and does not rematch a template', () => {
  const service = read('backend/src/modules/student-learning-plan/student-learning-plan.service.js')
  const prepare = service.slice(service.indexOf('async function prepare'), service.indexOf('async function findGoalSession'))
  assert.match(prepare, /ownedRecord/)
  assert.match(prepare, /learningPlanId:\s*plan\.id/)
  assert.doesNotMatch(prepare, /listTemplates|recommendTemplate|title/)
  const routes = read('backend/src/modules/student-learning-plan/student-learning-plan.routes.js')
  assert.match(routes, /router\.use\(auth,\s*roles\(\['student'\]\)\)/)
  assert.match(routes, /router\.post\('\/:id\/prepare'/)
  assert.match(routes, /router\.post\('\/current\/rematch'/)
})

test('canvas ports, zoom/pan conversion, graph restoration and node deletion remain consistent', async () => {
  const canvas = await import(pathToFileURL(path.join(root, 'frontend/src/utils/learning-flow-canvas.js')).href)
  const node = { id: 'a', position: { x: 120, y: 80 } }
  assert.deepEqual(canvas.nodePortPoint(node, 'input'), { x: 120, y: 130 })
  assert.deepEqual(canvas.nodePortPoint(node, 'output'), { x: 320, y: 130 })
  assert.deepEqual(canvas.nodePortPoint(node, 'pass'), { x: 320, y: 114 })
  assert.deepEqual(canvas.canvasPointFromClient(410, 260, { left: 10, top: 20 }, 100, 40, 2), { x: 150, y: 100 })
  const zoomed = canvas.zoomAroundCanvasPoint(300, 200, 100, 50, 1, 2)
  assert.deepEqual(canvas.canvasPointFromClient(300, 200, { left: 0, top: 0 }, zoomed.panX, zoomed.panY, zoomed.scale), { x: 200, y: 150 })

  const graph = canvas.normalizeGraphPorts({
    entryNodeId: 'a', nodes: [node, { id: 'b', position: { x: 400, y: 80 } }],
    edges: [{ sourceNodeId: 'a', targetNodeId: 'b', condition: { type: 'mastery_gte' } }],
  })
  const restored = canvas.normalizeGraphPorts(JSON.parse(JSON.stringify(graph)))
  assert.deepEqual(restored, graph)
  assert.equal(restored.edges[0].sourcePort, 'pass')
  assert.equal(restored.edges[0].targetPort, 'input')
  const removed = canvas.removeNodeFromGraph(restored, 'a')
  assert.deepEqual(removed.nodes.map((item) => item.id), ['b'])
  assert.equal(removed.edges.length, 0)
  assert.equal(removed.entryNodeId, 'b')
  assert.equal(canvas.horizontalEdgePath({ x: 100, y: 100 }, { x: 400, y: 160 }), 'M100 100 C235 100, 265 160, 400 160')
  const reversePath = canvas.horizontalEdgePath({ x: 400, y: 160 }, { x: 100, y: 300 })
  assert.match(reversePath, /^M400 160 C[\s\S]*250 80 C[\s\S]*100 300$/)
})

test('automatic layout preserves topological left-to-right order without overlap', async () => {
  const canvas = await import(pathToFileURL(path.join(root, 'frontend/src/utils/learning-flow-canvas.js')).href)
  const graph = canvas.autoLayoutGraph({
    entryNodeId: 'a',
    nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, position: { x: 0, y: 0 } })),
    edges: [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'b', target: 'd' }, { source: 'c', target: 'd' }],
  })
  const byId = new Map(graph.nodes.map((node) => [node.id, node.position]))
  assert.ok(byId.get('a').x < byId.get('b').x)
  assert.equal(byId.get('b').x, byId.get('c').x)
  assert.notEqual(byId.get('b').y, byId.get('c').y)
  assert.ok(byId.get('b').x < byId.get('d').x)
})

test('damaged historical knowledge-base names are marked without mutating healthy names', () => {
  const { textIntegrity, serializeKnowledgeBase } = require('../src/modules/knowledge-base/knowledge-base.service')
  assert.equal(textIntegrity('机器学习知识库'), 'ok')
  assert.equal(textIntegrity('锟斤拷知识库'), 'damaged')
  assert.equal(textIntegrity('????????'), 'damaged')
  const record = serializeKnowledgeBase({ knowledge_base_id: 9, name: '锟斤拷', description: '', marketplace_visibility: 'PRIVATE', marketplace_status: 'READY', document_count: 0, total_size_bytes: 0, owner_user_id: 1, created_at: new Date(), updated_at: new Date() }, 1)
  assert.equal(record.nameRepairRequired, true)
  assert.equal(record.name, '锟斤拷')
})

test('long-term memory is a closed overlay drawer and repaired pages include responsive guards', () => {
  const chat = read('frontend/src/pages/agent/AgentChatPage.js')
  const marketplaceCss = read('frontend/src/styles/agent-marketplace.css')
  const studentCss = read('frontend/src/styles/student.css')
  assert.match(chat, /agent-memory-backdrop[\s\S]*agent-memory-drawer/)
  assert.match(chat, /setMemoryOpen\(false\)/)
  assert.match(marketplaceCss, /\.agent-memory-drawer\{[\s\S]*transform:translateX\(102%\)/)
  assert.match(marketplaceCss, /\.agent-memory-drawer\.open\{[\s\S]*translateX\(0\)/)
  assert.match(marketplaceCss, /@media\(max-width:720px\)/)
  assert.match(marketplaceCss, /\.knowledge-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(studentCss, /@media\(max-width:900px\)/)
  assert.match(studentCss, /\.lf-plan-entry-grid\{grid-template-columns:1fr\}/)
})
