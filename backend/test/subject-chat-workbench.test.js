const test = require('node:test');
const assert = require('node:assert/strict');

const { TASK_DEFINITIONS } = require('../src/modules/subject-chat/subject-chat-run.service');
const { extractQuestion, buildExecutionMessages } = require('../src/modules/subject-chat/subject-chat-orchestrator.service');
const { queryTerms } = require('../src/modules/subject-chat/subject-chat-source.service');

test('subject chat uses the stable nine-step backend task queue', () => {
  assert.equal(TASK_DEFINITIONS.length, 9);
  assert.deepEqual(TASK_DEFINITIONS.map((item) => item[0]), [
    'analyze_question',
    'identify_scope',
    'load_learning_context',
    'load_student_profile',
    'retrieve_knowledge',
    'invoke_subject_agent',
    'organize_sources',
    'quality_check',
    'finalize_answer',
  ]);
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

test('local retrieval terms stay bounded and include the identified knowledge point', () => {
  const terms = queryTerms('请解释 Transformer 的注意力机制，并给一个例子', '注意力机制');
  assert.equal(terms[0], '注意力机制');
  assert.ok(terms.length <= 8);
  assert.equal(new Set(terms).size, terms.length);
});
