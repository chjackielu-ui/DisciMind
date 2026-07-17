const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

// The mastery-gate fixture deliberately exercises the deterministic runtime
// path so the API lifecycle test never depends on an external model provider.
process.env.AGENT_MODE = 'dify';
process.env.LANGGRAPH_ENABLED = 'false';

const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { signToken } = require('../src/utils/jwt');
const knowledgeCards = require('../src/modules/learning-flow-preload/knowledge-card.service');
const originalCardPrepare = knowledgeCards.fireAndRecord;

let server;
let api;
let templateId;
let sessionId;
let marker;
let uploadedFilePath;
const trace = (message) => { if (process.env.DEBUG_FLOW_E2E === '1') process.stderr.write(`[flow-e2e] ${message}\n`); };

async function request(method, route, token, body) {
  const response = await fetch(`${api}${route}`, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => ({})) };
}

function expectSuccess(result, status = 200) {
  assert.equal(result.response.status, status, JSON.stringify(result.body));
  assert.equal(result.body.success, true, JSON.stringify(result.body));
  assert.equal(result.body.code, 0, JSON.stringify(result.body));
  return result.body.data;
}

async function cleanupFixture() {
  if (uploadedFilePath) {
    await fs.unlink(uploadedFilePath).catch(() => null);
    uploadedFilePath = null;
  }
  if (sessionId) {
    await prisma.learningSession.deleteMany({ where: { session_id: Number(sessionId) } }).catch(() => null);
    sessionId = null;
  }
  if (templateId) {
    await prisma.learningWorkflowTemplate.deleteMany({ where: { template_id: Number(templateId) } }).catch(() => null);
    templateId = null;
  }
  if (marker) {
    const exactTemplates = await prisma.learningWorkflowTemplate.findMany({
      where: { title: { contains: marker } }, select: { template_id: true },
    });
    const exactIds = exactTemplates.map((item) => item.template_id);
    if (exactIds.length) {
      await prisma.learningSession.deleteMany({ where: { workflow_template_id: { in: exactIds } } });
      await prisma.learningWorkflowTemplate.deleteMany({ where: { template_id: { in: exactIds } } });
    }
    const leaked = await prisma.learningWorkflowTemplate.count({ where: { title: { contains: marker } } });
    assert.equal(leaked, 0, `learning-flow fixture leaked for ${marker}`);
  }
}

test.before(async () => {
  knowledgeCards.fireAndRecord = () => {};
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  try {
    await cleanupFixture();
  } finally {
    knowledgeCards.fireAndRecord = originalCardPrepare;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});

test('learning flow closes create, save, reload, validate, execute, idempotent replay and cleanup against the real database', { timeout: 90_000 }, async (t) => {
  marker = `CODEX-HARDENING-${crypto.randomUUID()}`;
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { enrollment_status: 'active', student: { role: 'STUDENT' } },
    include: { student: true, course: { include: { chapters: { include: { knowledge_points: true } } } } },
  });
  assert.ok(enrollment, 'student fixture must have an active course');
  const token = signToken({ user_id: enrollment.student_user_id, role: 'student' });
  const knowledgePoint = enrollment.course.chapters.flatMap((chapter) => chapter.knowledge_points)[0];
  assert.ok(knowledgePoint, 'course fixture must have a knowledge point');
  trace('fixture scope resolved');

  const graph = {
    entryNodeId: 'gate',
    nodes: [{ id: 'gate', type: 'mastery_gate', title: `${marker}-掌握度判断`, config: {}, position: { x: 120, y: 160 } }],
    edges: [],
  };
  const settings = { completion_mode: 'flow_complete', target_mastery: 80, adjustment_mode: 'strict_original', estimated_minutes: 3 };
  const created = expectSuccess(await request('POST', '/learning-workflows/templates', token, {
    title: marker,
    description: 'live API/database lifecycle fixture',
    course_id: enrollment.course_id,
    knowledge_point_id: knowledgePoint.knowledge_point_id,
    graph_json: graph,
    settings_json: settings,
  }));
  templateId = created.template_id;
  trace(`template ${templateId} created`);
  t.diagnostic(`created workflow template ${templateId}`);
  assert.equal(created.latestVersion.version_number, 1);

  const updatedGraph = JSON.parse(JSON.stringify(graph));
  updatedGraph.nodes[0].position = { x: 360, y: 240 };
  const updated = expectSuccess(await request('PUT', `/learning-workflows/templates/${templateId}`, token, {
    title: `${marker}-saved`,
    graph_json: updatedGraph,
    settings_json: settings,
    change_summary: `${marker}-position-save`,
  }));
  assert.equal(updated.latestVersion.version_number, 2);
  assert.deepEqual(updated.latestVersion.graph_json.nodes[0].position, { x: 360, y: 240 });
  trace('template updated');

  const reloaded = expectSuccess(await request('GET', `/learning-workflows/templates/${templateId}`, token));
  assert.equal(reloaded.title, `${marker}-saved`);
  assert.deepEqual(reloaded.latestVersion.graph_json.nodes[0].position, { x: 360, y: 240 });
  const versions = expectSuccess(await request('GET', `/learning-workflows/templates/${templateId}/versions`, token));
  assert.equal(versions.length, 2);

  const invalidGraph = JSON.parse(JSON.stringify(updatedGraph));
  invalidGraph.edges.push({ id: 'self', source: 'gate', target: 'gate', condition: { type: 'always', params: {} } });
  const invalid = await request('PUT', `/learning-workflows/templates/${templateId}`, token, {
    graph_json: invalidGraph,
    settings_json: settings,
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.message, /循环路径/);
  assert.equal((expectSuccess(await request('GET', `/learning-workflows/templates/${templateId}/versions`, token))).length, 2);

  const session = expectSuccess(await request('POST', '/learning-workflows/sessions', token, {
    courseId: enrollment.course_id,
    knowledgePointId: knowledgePoint.knowledge_point_id,
    templateId,
  }));
  sessionId = session.session_id;
  t.diagnostic(`created learning session ${sessionId}`);
  const started = expectSuccess(await request('POST', `/learning-workflows/sessions/${sessionId}/start`, token));
  assert.equal(started.status, 'RUNNING');
  assert.equal(started.currentNodeId || started.current_node_id, 'gate');

  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  const uploadForm = new FormData();
  uploadForm.append('files', new Blob([pngBytes], { type: 'image/png' }), `${marker}.png`);
  const uploadResponse = await fetch(`${api}/learning-workflows/sessions/${sessionId}/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: uploadForm,
  });
  const upload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 200, JSON.stringify(upload));
  assert.match(upload.data.files[0].fileUrl, new RegExp(`^/api/learning-workflows/sessions/${sessionId}/files/learning_`));
  const filename = upload.data.files[0].fileUrl.split('/').pop();
  uploadedFilePath = path.resolve(__dirname, '../storage/uploads/learning', filename);
  await fs.access(uploadedFilePath);
  assert.equal((await fetch(`${api}/learning-workflows/sessions/${sessionId}/files/${filename}`)).status, 401);
  const otherStudent = await prisma.user.findFirst({ where: { role: 'STUDENT', user_id: { not: enrollment.student_user_id } }, select: { user_id: true } });
  if (otherStudent) {
    const otherToken = signToken({ user_id: otherStudent.user_id, role: 'student' });
    assert.equal((await fetch(`${api}/learning-workflows/sessions/${sessionId}/files/${filename}`, { headers: { Authorization: `Bearer ${otherToken}` } })).status, 403);
  }
  const ownerDownload = await fetch(`${api}/learning-workflows/sessions/${sessionId}/files/${filename}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(ownerDownload.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await ownerDownload.arrayBuffer()), pngBytes), 0);

  const executed = expectSuccess(await request('POST', `/learning-workflows/sessions/${sessionId}/execute-current`, token, { nodeId: 'gate' }));
  t.diagnostic('executed deterministic mastery gate');
  assert.equal(executed.nodeCompleted, true);
  const afterExecute = expectSuccess(await request('GET', `/learning-workflows/sessions/${sessionId}`, token));
  const executionId = afterExecute.currentNodeExecutionId;
  assert.ok(executionId);

  const actionId = `${marker}-complete-gate`;
  const completed = expectSuccess(await request('POST', `/learning-workflows/sessions/${sessionId}/complete-node`, token, {
    nodeId: 'gate', expectedNodeExecutionId: executionId, clientActionId: actionId, result: { verified: true },
  }));
  assert.equal(completed.isFlowCompleted, true);
  assert.equal(completed.session.status, 'COMPLETED');
  assert.equal(completed.session.current_node_id, null);
  t.diagnostic('completed workflow');

  const replay = expectSuccess(await request('POST', `/learning-workflows/sessions/${sessionId}/complete-node`, token, {
    nodeId: 'gate', expectedNodeExecutionId: executionId, clientActionId: actionId, result: { verified: true },
  }));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.isFlowCompleted, true);

  const deleted = expectSuccess(await request('DELETE', `/learning-workflows/templates/${templateId}`, token));
  assert.equal(deleted.deletedCount, 1);
  assert.equal(deleted.archivedCount, 1);
  assert.equal((await request('GET', `/learning-workflows/templates/${templateId}`, token)).response.status, 404);

  await cleanupFixture();
  t.diagnostic('cleaned exact workflow and session ids');
});
