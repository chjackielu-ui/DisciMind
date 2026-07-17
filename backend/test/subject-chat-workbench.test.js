const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const { TASK_DEFINITIONS, definitionsForPlan } = require('../src/modules/subject-chat/subject-chat-run.service');
const { createPlan } = require('../src/modules/ai-assistant/workflow-planner');
const {
  extractQuestion,
  buildExecutionMessages,
  dynamicKnowledgeBaseIds,
  assistantKnowledgeSources,
} = require('../src/modules/subject-chat/subject-chat-orchestrator.service');
const { queryTerms } = require('../src/modules/subject-chat/subject-chat-source.service');
const stateMachine = require('../src/modules/subject-chat/subject-chat-state-machine');

test('subject chat fallback is minimal and persisted task queues follow the dynamic plan', () => {
  assert.deepEqual(TASK_DEFINITIONS.map((item) => item[0]), ['understand_request', 'generate_response']);
  const greeting = createPlan({ query: '你好', role: 'student' });
  const chart = createPlan({ query: '请以图表形式分析我的学习状态', role: 'student' });
  assert.equal(definitionsForPlan(greeting).length, 2);
  assert.ok(definitionsForPlan(chart).length > definitionsForPlan(greeting).length);
  assert.deepEqual(definitionsForPlan(chart), chart.taskDefinitions);
});

test('question extraction supports regular and multimodal model messages', () => {
  assert.equal(extractQuestion({ userMessage: { content: '解释注意力机制' }, messages: [] }), '解释注意力机制');
  assert.equal(extractQuestion({
    userMessage: null,
    messages: [{ role: 'user', content: [{ type: 'text', text: '分析这张题目截图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }],
  }), '分析这张题目截图');
});

test('execution prompt labels real sources and explicitly forbids fabricated citations', () => {
  const messages = buildExecutionMessages([{ role: 'system', content: 'base' }, { role: 'user', content: '问题' }], {
    scope: { course: { course_name: '机器学习' }, knowledgePoint: { knowledge_point_name: '注意力机制' } },
    learningContext: { summary: '最近学习记录 2 条' },
    profile: { summary: '当前知识点掌握度 55%' },
    sources: [{ title: '课程讲义', summary: '真实检索片段' }],
  });
  assert.match(messages[0].content, /\[1\] 课程讲义/);
  assert.match(messages[0].content, /不得编造/);
  assert.equal(messages[1].content, '问题');
});

test('explicit @ knowledge selection keeps entity ids and enforces retrieval-only answering', () => {
  const turn = {
    knowledgeBaseRefs: [{ knowledgeBaseId: 11, name: '2024学生手册' }],
    resolvedKnowledgeBases: [{ knowledge_base_id: 11, name: '2024学生手册' }],
  };
  assert.deepEqual(dynamicKnowledgeBaseIds(turn), [11]);
  const withoutHits = buildExecutionMessages([{ role: 'system', content: 'base' }], {
    scope: {}, learningContext: { summary: '无' }, profile: { summary: '无' }, sources: [],
    explicitKnowledgeRequired: true, explicitKnowledgeNames: ['2024学生手册'],
  });
  assert.match(withoutHits[0].content, /不得绕过检索直接使用通用知识作答/);
  const prefetched = assistantKnowledgeSources([{ title: '学生手册', summary: '学分模块正文', documentId: 220, relevanceScore: 0.88, metadata: { knowledgeBaseId: 11, knowledgeBaseName: '2024学生手册', segmentId: 'seg-1' } }]);
  assert.equal(prefetched[0].knowledgeBaseId, 11);
  assert.equal(prefetched[0].snippet, '学分模块正文');
});

test('local retrieval terms stay bounded and include the identified knowledge point', () => {
  const terms = queryTerms('请解释 Transformer 的注意力机制，并给一个例子', '注意力机制');
  assert.equal(terms[0], '注意力机制');
  assert.ok(terms.length <= 8);
  assert.equal(new Set(terms).size, terms.length);
});

test('subject chat state machine normalizes legacy rows and protects terminal runs', () => {
  assert.equal(stateMachine.normalizeRunStatus('pending'), 'queued');
  assert.equal(stateMachine.normalizeRunStatus('success'), 'completed');
  assert.equal(stateMachine.normalizeTaskStatus('success'), 'completed');
  assert.equal(stateMachine.assertRunTransition('waiting_agent', 'generating'), 'generating');
  assert.throws(() => stateMachine.assertRunTransition('completed', 'running'), /终态/);
});

test('student workbench fixes the root crash and keeps a server-clock timer alive', async () => {
  const page = await fs.readFile(path.resolve(__dirname, '../../frontend/src/pages/student-ai-chat.js'), 'utf8');
  assert.doesNotMatch(page, /root\.querySelectorAll\?\.\('\[data-ai-artifact-download\]'/);
  assert.match(page, /host\.querySelectorAll\?\.\('\[data-ai-artifact-download\]'/);
  assert.match(page, /serverTimeOffsetMs/);
  assert.match(page, /setInterval\(\(\) => refreshRunWorkbench\(\), 1000\)/);
  assert.match(page, /sequence && sequence <= state\.lastRunSequence/);
});

test('student AI exposes one course selector, one effective stop action and an integrated search toolbar', async () => {
  const page = await fs.readFile(path.resolve(__dirname, '../../frontend/src/pages/student-ai-chat.js'), 'utf8');
  const composer = await fs.readFile(path.resolve(__dirname, '../../frontend/src/components/unified-composer.js'), 'utf8');
  assert.equal((page.match(/id="ai-course-select"/g) || []).length, 1);
  assert.doesNotMatch(page, /id="ai-subject-select"/);
  assert.doesNotMatch(page, /id="btn-stop-generation"/);
  assert.match(composer, /data-composer-stop/);
  assert.match(composer, /!state\.value\.trim\(\) && !state\.attachments\.length/);
  assert.match(composer, /data-composer-toolbar-extension/);
  assert.match(page, /mountToolbarExtension/);
  assert.doesNotMatch(page, /id="student-ai-search-controls"/);
});

test('subject orchestrator batches deltas, emits heartbeats and stalls on timeout', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../src/modules/subject-chat/subject-chat-orchestrator.service.js'), 'utf8');
  assert.match(source, /protocolDeltaBuffer\.length >= 64/);
  assert.match(source, /}, 3000\);/);
  assert.match(source, /runService\.stallRun/);
  assert.match(source, /runService\.markFirstDelta/);
});
