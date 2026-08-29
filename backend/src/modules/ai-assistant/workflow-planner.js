const { randomUUID } = require('crypto');
const { selectSkills } = require('./skill-registry');
const { decideSearch, parseSearchOptions } = require('./search-policy');
const { classifyLearningIntent, shouldCreateChart, EXECUTION_MODES, INTENTS } = require('./intent-router.service');

const COMPLEX_TASK_RE = /(?:分析|诊断|生成|制作|创建|导出|对比|规划|备课|教案|试卷|表格|图表|卡片|协作|agent)/iu;

function uniqueSkills(primary = [], detected = []) {
  const seen = new Set();
  return [...primary, ...detected].filter(item => item && !seen.has(item.id) && seen.add(item.id));
}

function detectIntent(query, role, searchOptions, context = {}) {
  const routed = classifyLearningIntent(query, role, context);
  const searchDecision = decideSearch(query, searchOptions);
  const ownerBound = (routed.tools || []).length > 0;
  const allowCompositeSearch = routed.kind === INTENTS.FILE && searchDecision.enabled;
  const search = ownerBound || (routed.deterministic && routed.kind !== INTENTS.WEB && !allowCompositeSearch)
    ? { ...searchDecision, enabled: false, reason: ownerBound ? 'owner_bound_data_route' : 'deterministic_local_route' }
    : searchDecision;
  return {
    ...routed,
    query: String(query || '').trim().slice(0, 4000),
    role: String(role || '').toLowerCase(),
    realtime: search.realtime,
    search,
    complex: routed.executionMode === EXECUTION_MODES.COMPLEX_WORKFLOW || (!routed.deterministic && COMPLEX_TASK_RE.test(String(query || ''))),
  };
}

function makeStep(taskType, title, description, extra = {}) {
  return { id: randomUUID(), taskType, type: extra.type || 'workflow', title, description, status: 'pending', ...extra };
}

function dataToolTitle(tool) {
  return ({
    get_current_student_context: '读取登录用户上下文',
    get_student_wrong_questions: '查询本人错题',
    get_student_learning_records: '查询本人学习记录',
    get_student_score_trend: '查询本人学习成绩',
    get_student_mastery: '查询本人知识点掌握度',
    get_student_recent_sessions: '查询本人最近学习会话',
    get_student_learning_time: '查询本人学习时长',
    get_student_task_completion: '查询本人任务完成情况',
  })[tool] || `执行 ${tool}`;
}

function buildSteps(intent, context = {}) {
  const steps = [];
  const add = (...args) => steps.push(makeStep(...args));
  const primaryTool = intent.tools?.[0];

  if (intent.executionMode === EXECUTION_MODES.ARTIFACT_GENERATION && intent.kind === INTENTS.FILE) {
    if (intent.search.enabled) add('web_search', '检索实时资料', '仅检索当前文件任务明确要求的实时公开信息', { type: 'search' });
    add('identify_file_intent', '识别文件意图', '识别文件类型、课程范围和必要生成参数', { type: 'planning' });
    add('await_file_confirmation', '等待生成确认', '创建可恢复的文件确认；确认前不写入成果', { type: 'confirmation' });
    return steps;
  }
  if (intent.executionMode === EXECUTION_MODES.LEARNING_ANALYTICS) {
    add('load_user_context', '读取登录用户上下文', '绑定当前登录学生与已授权课程范围', { type: 'context' });
    add('query_learning_data', dataToolTitle(primaryTool), '查询本人真实学习数据，不接收学号或其他学生 ID', { type: 'tool', tool: primaryTool });
    add('compute_metrics', '计算统计指标', '按工具定义的统计口径计算真实指标', { type: 'transform' });
    add('build_chart_spec', '构建 ChartSpec', '把结构化指标转换为 ChartSpec 1.0', { type: 'transform' });
    add('create_chart_artifact', '创建图表成果', '参数预检通过后保存可渲染图表、表格和来源', { type: 'tool', tool: 'create_chart_artifact' });
    add('generate_insights', '生成文字洞察', '基于同一份学习数据生成可核对的文字结论', { type: 'response' });
    return steps;
  }
  if (intent.executionMode === EXECUTION_MODES.TOOL_ONLY) {
    add('load_user_context', '读取登录用户上下文', '绑定当前登录学生与已授权课程范围', { type: 'context' });
    add(`query_${String(primaryTool || 'data').replace(/^get_student_/, '')}`, dataToolTitle(primaryTool), '查询本人真实学习数据', { type: 'tool', tool: primaryTool });
    add('generate_analysis', '生成分析', '按真实查询结果和统计口径形成回答', { type: 'response' });
    return steps;
  }
  if (intent.kind === INTENTS.KNOWLEDGE) {
    add('identify_scope', '识别课程与知识点', '识别请求中的课程、知识点和指定知识库', { type: 'context' });
    add('retrieve_knowledge', '检索指定知识库', '只检索当前用户有权访问的知识库资料', { type: 'tool', tool: 'knowledge_retrieve' });
    add('invoke_subject_agent', '调用匹配的学科答疑 Agent', '仅调用能力与课程问题匹配的学科 Agent', { type: 'agent', agentIndex: 0 });
    add('generate_cited_response', '生成带来源回答', '使用实际命中的资料生成回答并核验引用', { type: 'response' });
    return steps;
  }
  if (intent.kind === INTENTS.CONCEPT) {
    add('understand_course_question', '理解课程问题', '识别概念、例题或学科推理诉求', { type: 'planning' });
    add('invoke_subject_agent', '调用匹配的学科答疑 Agent', '只在能力与问题匹配时调用学科 Agent', { type: 'agent', agentIndex: 0 });
    add('generate_response', '生成课程回答', '生成可理解的课程解释；Agent 不可用时安全降级到主模型', { type: 'response' });
    return steps;
  }
  if (intent.executionMode === EXECUTION_MODES.WEB_SEARCH) {
    add('understand_request', '理解实时问题', '确认问题需要实时公开信息', { type: 'planning' });
    add('web_search', '联网检索', '执行原生联网搜索并保存可验证来源', { type: 'search' });
    add('verify_sources', '核验来源', '去重并检查来源和引用编号', { type: 'transform' });
    add('generate_response', '生成带来源回答', '基于实际搜索结果生成回答', { type: 'response' });
    return steps;
  }
  if (intent.kind === INTENTS.ATTACHMENT) {
    add('validate_attachment', '校验上传文件', intent.attachmentRequired ? '当前消息缺少可处理附件，需要用户补充' : '确认附件属于当前用户且已完成解析', { type: 'context' });
    if (!intent.attachmentRequired) add('summarize_attachment', '总结上传文件', '只根据已提取的附件正文生成摘要', { type: 'model' });
    add('generate_response', intent.attachmentRequired ? '提示补充附件' : '生成文件总结', '返回可理解的总结或明确的补充提示', { type: 'response' });
    return steps;
  }
  if (intent.kind === INTENTS.CHAT_QUESTIONS) {
    add('understand_request', '理解出题要求', '确认题量、范围以及仅在对话中输出', { type: 'planning' });
    add('generate_questions', '生成对话练习题', '生成结构清楚的题目，不创建文件', { type: 'model' });
    add('quality_check', '检查题目质量', '检查题量、范围、答案与文件否定约束', { type: 'transform' });
    return steps;
  }
  if (intent.kind === INTENTS.MANUAL_AGENT) {
    const count = Math.max(1, Number(context.manualAgentCount || 1));
    add('validate_manual_agents', '校验所选 Agent', '校验用户选择、角色权限和运行时能力', { type: 'context' });
    for (let index = 0; index < count; index += 1) add(`invoke_manual_agent_${index + 1}`, `调用所选 Agent ${index + 1}`, '按用户指定顺序执行已授权 Agent', { type: 'agent', agentIndex: index });
    add('synthesize_agent_results', count > 1 ? '汇总多 Agent 结果' : '生成 Agent 回答', '保留真实 Agent 输出并形成最终回答', { type: 'response' });
    return steps;
  }
  if (intent.kind === INTENTS.CARDS) {
    add('understand_request', '理解卡片要求', '确认卡片主题与范围', { type: 'planning' });
    add('create_knowledge_cards', '创建知识卡片', '参数预检通过后保存结构化知识卡片', { type: 'tool', tool: 'create_knowledge_cards' });
    add('generate_response', '返回卡片结果', '返回已保存成果或可恢复错误', { type: 'response' });
    return steps;
  }
  if (intent.complex) {
    add('understand_request', '理解复合任务', '拆分模糊或复合请求', { type: 'planning' });
    add('semantic_planning', '生成语义计划', '由主模型在 Registry 约束内规划必要调用', { type: 'model' });
    add('validate_execution', '执行前验证', '校验 Skill、Agent、Tool、权限与参数契约', { type: 'validation' });
    add('generate_response', '生成回答', '汇总实际执行结果', { type: 'response' });
    return steps;
  }
  add('understand_request', '理解问题', '识别简单对话诉求', { type: 'planning' });
  add('generate_response', '生成回答', '直接生成简洁回答，不调用无关 Tool 或 Agent', { type: 'response' });
  return steps;
}

function createPlan(input = {}) {
  const options = parseSearchOptions(input.searchOptions || {});
  const context = {
    manualAgentCount: Number(input.manualAgentCount || input.manualAgentRefs?.length || input.resolvedAgents?.length || 0),
    manualFileGeneratorCount: (input.manualAgentRefs || input.resolvedAgents || []).filter(item => (
      String(item?.agent?.agentType || item?.agentType || '').toUpperCase() === 'FILE_GENERATOR'
    )).length,
    manualFileGeneratorType: (input.manualAgentRefs || input.resolvedAgents || []).map(item => (
      item?.version?.fileGeneratorConfigJson?.documentType || item?.fileGeneratorConfig?.documentType
    )).find(type => type === 'EXAM_PAPER' || type === 'STUDY_HANDOUT') || null,
    attachmentCount: Number(input.attachmentCount || input.attachments?.length || 0),
    knowledgeBaseCount: Number(input.knowledgeBaseCount || input.knowledgeBaseIds?.length || 0),
  };
  const intent = detectIntent(input.query, input.role, options, context);
  const requested = selectSkills(input.query, input.role, 5, intent.skillIds);
  const detected = selectSkills(input.query, input.role, 5);
  const skills = uniqueSkills(requested, detected).filter(value => value.intents.includes(intent.kind) || intent.kind === INTENTS.FILE && value.intents.includes(INTENTS.FILE) || value.id === 'realtime_research' && intent.search.enabled);
  if (intent.executionMode === EXECUTION_MODES.LEARNING_ANALYTICS) {
    const visual = detected.find(value => value.id === 'visual_analysis');
    if (visual && !skills.some(value => value.id === visual.id)) skills.push(visual);
  }
  const steps = buildSteps(intent, context);
  return {
    version: '2.0',
    dynamic: true,
    executionMode: intent.executionMode,
    intent,
    skills,
    steps,
    taskDefinitions: steps.map(step => [step.taskType, step.title, step.description]),
    searchOptions: options,
    validation: { deterministicLocked: intent.deterministic && intent.confidence >= 0.9, preflightRequired: true, maxReplans: 1 },
  };
}

module.exports = { COMPLEX_TASK_RE, detectIntent, buildSteps, createPlan, makeStep };
