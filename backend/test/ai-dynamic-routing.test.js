const test = require('node:test');
const assert = require('node:assert/strict');

const { createPlan } = require('../src/modules/ai-assistant/workflow-planner');
const { INTENTS, EXECUTION_MODES } = require('../src/modules/ai-assistant/intent-router.service');
const { mentionedKnowledgeTerms } = require('../src/modules/agent-chat/agent-context.service');

const CASES = [
  ['你好。', INTENTS.GREETING, EXECUTION_MODES.DIRECT_RESPONSE, [], 2],
  ['您好', INTENTS.GREETING, EXECUTION_MODES.DIRECT_RESPONSE, [], 2],
  ['谢谢', INTENTS.GREETING, EXECUTION_MODES.DIRECT_RESPONSE, [], 2],
  ['帮我制定一个学习建议', INTENTS.QA, EXECUTION_MODES.DIRECT_RESPONSE, [], 2],
  ['什么是逻辑回归', INTENTS.CONCEPT, EXECUTION_MODES.SINGLE_AGENT, [], 3],
  ['解释机器学习的基本原理', INTENTS.CONCEPT, EXECUTION_MODES.SINGLE_AGENT, [], 3],
  ['结合机器学习知识库解释逻辑回归', INTENTS.KNOWLEDGE, EXECUTION_MODES.SINGLE_AGENT, [], 4],
  ['根据教材解释注意力机制', INTENTS.KNOWLEDGE, EXECUTION_MODES.SINGLE_AGENT, [], 4],
  ['讲解一道逻辑回归例题', INTENTS.CONCEPT, EXECUTION_MODES.SINGLE_AGENT, [], 3],
  ['查看我最近的错题', INTENTS.WRONG, EXECUTION_MODES.TOOL_ONLY, ['get_student_wrong_questions'], 3],
  ['分析我最近一个月的学习成绩', INTENTS.SCORE, EXECUTION_MODES.TOOL_ONLY, ['get_student_score_trend'], 3],
  ['我的知识点掌握情况怎么样', INTENTS.MASTERY, EXECUTION_MODES.TOOL_ONLY, ['get_student_mastery'], 3],
  ['最近学习时长是多少', INTENTS.TIME, EXECUTION_MODES.TOOL_ONLY, ['get_student_learning_time'], 3],
  ['我的任务完成率', INTENTS.TASKS, EXECUTION_MODES.TOOL_ONLY, ['get_student_task_completion'], 3],
  ['查看最近学习会话', INTENTS.SESSIONS, EXECUTION_MODES.TOOL_ONLY, ['get_student_recent_sessions'], 3],
  ['查看我的学习记录', INTENTS.RECORDS, EXECUTION_MODES.TOOL_ONLY, ['get_student_learning_records'], 3],
  ['当前课程和知识点是什么', INTENTS.CONTEXT, EXECUTION_MODES.TOOL_ONLY, ['get_current_student_context'], 3],
  ['请以图表形式分析我的学习状态', INTENTS.ANALYTICS, EXECUTION_MODES.LEARNING_ANALYTICS, ['get_student_mastery'], 6],
  ['以图表展示我的掌握度', INTENTS.MASTERY, EXECUTION_MODES.LEARNING_ANALYTICS, ['get_student_mastery'], 6],
  ['分析最近一个月成绩趋势', INTENTS.SCORE, EXECUTION_MODES.LEARNING_ANALYTICS, ['get_student_score_trend'], 6],
  ['用图表展示任务完成情况', INTENTS.TASKS, EXECUTION_MODES.LEARNING_ANALYTICS, ['get_student_task_completion'], 6],
  ['帮我生成一份逻辑回归试卷 DOCX', INTENTS.FILE, EXECUTION_MODES.ARTIFACT_GENERATION, [], 2],
  ['生成机器学习讲义 PDF', INTENTS.FILE, EXECUTION_MODES.ARTIFACT_GENERATION, [], 2],
  ['导出一份学习数据 Excel 文件', INTENTS.FILE, EXECUTION_MODES.ARTIFACT_GENERATION, [], 2],
  ['在对话中给我出五道题，不生成文件', INTENTS.CHAT_QUESTIONS, EXECUTION_MODES.DIRECT_RESPONSE, [], 3],
  ['只在这里给我出三道练习题，不要生成文件', INTENTS.CHAT_QUESTIONS, EXECUTION_MODES.DIRECT_RESPONSE, [], 3],
  ['给我五道题，只在对话中展示', INTENTS.CHAT_QUESTIONS, EXECUTION_MODES.DIRECT_RESPONSE, [], 3],
  ['今天 AI 领域有什么新闻', INTENTS.WEB, EXECUTION_MODES.WEB_SEARCH, [], 4],
  ['查询最新 Qwen 版本发布', INTENTS.WEB, EXECUTION_MODES.WEB_SEARCH, [], 4],
  ['今天北京天气怎么样', INTENTS.WEB, EXECUTION_MODES.WEB_SEARCH, [], 4],
  ['总结我上传的 PDF', INTENTS.ATTACHMENT, EXECUTION_MODES.DIRECT_RESPONSE, [], 2],
  ['分析附件中的课程内容', INTENTS.ATTACHMENT, EXECUTION_MODES.DIRECT_RESPONSE, [], 2],
];

test(`dynamic planner routes ${CASES.length} deterministic request cases without a fixed template`, () => {
  for (const [query, intent, mode, tools, stepCount] of CASES) {
    const plan = createPlan({ query, role: 'student', searchOptions: { mode: 'auto' } });
    assert.equal(plan.intent.kind, intent, query);
    assert.equal(plan.executionMode, mode, query);
    assert.deepEqual(plan.intent.tools, tools, query);
    assert.equal(plan.steps.length, stepCount, query);
    assert.equal(plan.taskDefinitions.length, plan.steps.length, query);
    assert.equal(new Set(plan.steps.map(step => step.taskType)).size, plan.steps.length, query);
    if (![INTENTS.CONCEPT, INTENTS.KNOWLEDGE].includes(intent)) assert.equal(plan.steps.some(step => step.type === 'agent'), false, query);
  }
});

test('explicit knowledge-base and manual Agent inputs override semantic fallback deterministically', () => {
  const knowledge = createPlan({ query: '解释逻辑回归', role: 'student', knowledgeBaseIds: [7], searchOptions: { mode: 'auto' } });
  assert.equal(knowledge.intent.kind, INTENTS.KNOWLEDGE);
  assert.equal(knowledge.steps.filter(step => step.type === 'agent').length, 1);
  const manual = createPlan({ query: '分析这个问题', role: 'student', manualAgentRefs: [{ agentId: 1 }], searchOptions: { mode: 'auto' } });
  assert.equal(manual.intent.kind, INTENTS.MANUAL_AGENT);
  assert.equal(manual.executionMode, EXECUTION_MODES.SINGLE_AGENT);
  const multi = createPlan({ query: '协作分析这个问题', role: 'student', manualAgentRefs: [{ agentId: 1 }, { agentId: 2 }], searchOptions: { mode: 'auto' } });
  assert.equal(multi.executionMode, EXECUTION_MODES.MULTI_AGENT);
  assert.equal(multi.steps.filter(step => step.type === 'agent').length, 2);
});

test('manually selected file generators use the controlled file route', () => {
  const plan = createPlan({
    query: '开始生成',
    role: 'student',
    manualAgentRefs: [{ agentId: 42, agent: { agentType: 'FILE_GENERATOR' }, version: { fileGeneratorConfigJson: { documentType: 'EXAM_PAPER' } } }],
    searchOptions: { mode: 'auto' },
  });
  assert.equal(plan.intent.kind, INTENTS.FILE);
  assert.equal(plan.executionMode, EXECUTION_MODES.ARTIFACT_GENERATION);
  assert.equal(plan.intent.file.artifactType, 'EXAM_PAPER');
  assert.deepEqual(plan.steps.map(step => step.type), ['planning', 'confirmation']);
});

test('high-confidence owner-bound and chart routes never contain an automatic subject Agent step', () => {
  for (const query of ['查看我最近的错题', '分析我最近一个月的学习成绩', '请以图表形式分析我的学习状态']) {
    const plan = createPlan({ query, role: 'student', searchOptions: { mode: 'auto' } });
    assert.equal(plan.intent.subjectAgentAllowed, false);
    assert.equal(plan.steps.some(step => step.type === 'agent'), false);
    assert.equal(plan.intent.search.enabled, false);
  }
});

test('natural language knowledge-base mention extracts the specific library term', () => {
  assert.deepEqual(mentionedKnowledgeTerms('结合机器学习知识库解释逻辑回归。'), ['机器学习']);
  assert.deepEqual(mentionedKnowledgeTerms('请使用高等数学知识库讲解极限'), ['高等数学']);
  assert.deepEqual(mentionedKnowledgeTerms('解释逻辑回归'), []);
});
