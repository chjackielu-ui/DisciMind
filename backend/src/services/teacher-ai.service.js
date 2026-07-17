const fs = require('fs/promises');
const prisma = require('../config/prisma');
const aiChatService = require('./ai-chat.service');
const attachmentService = require('./ai-chat-attachment.service');
const analyticsService = require('./teacher-analytics-workbench.service');
const marketplaceService = require('../modules/agent-marketplace/agent-marketplace.service');
const agentContextService = require('../modules/agent-chat/agent-context.service');
const agentRuntimeService = require('../modules/agent-chat/agent-runtime.service');
const assistantOrchestrator = require('../modules/ai-assistant/assistant-orchestrator.service');
const {
  ensureCourseAccess,
  ensureTeachingClassAccess,
  getAccessibleCourseIds,
  getAccessibleTeachingClassIds,
} = require('./teacher-access.service');

const MODES = new Set(['general', 'analytics', 'preparation', 'agent']);
const ALLOWED_AGENT_REFS = new Set(['learning_analysis', 'preparation', 'question_generation', 'document_generation']);
const TEACHER_INPUT_MAX_CHARS = Math.max(500, Number(process.env.TEACHER_IMMERSIVE_INPUT_MAX_CHARS) || 5000);
const PREPARATION_CONTEXT_MAX_CHARS = Math.max(4000, Number(process.env.TEACHER_PREPARATION_CONTEXT_MAX_CHARS) || 18000);

function bad(message, code = 40001) {
  throw Object.assign(new Error(message), { code });
}

function teacherMode(conversation) {
  return String(conversation?.agentType || 'teacher_general').replace(/^teacher_/, '');
}

function toConversation(record, lastMessage = null, messageCount = null) {
  return {
    id: record.id,
    conversation_id: record.id,
    title: record.title,
    mode: teacherMode(record),
    context: record.agentRuntimeStateJson || {},
    last_message: lastMessage ? toMessage(lastMessage, true) : null,
    message_count: messageCount,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toMessage(record, preview = false) {
  const content = String(record.content || '');
  const sources = Array.isArray(record.sourcesJson) ? record.sourcesJson : [];
  return {
    id: record.id,
    message_id: record.id,
    role: String(record.role || '').toLowerCase(),
    content: preview ? `${content.slice(0, 100)}${content.length > 100 ? '…' : ''}` : content,
    attachments: (Array.isArray(record.attachments) ? record.attachments : []).map((item) => ({
      ...item,
      url: `/api/teacher/ai/conversations/${record.conversationId}/messages/${record.id}/attachments/${item.id}`,
    })),
    knowledge_base_refs: Array.isArray(record.knowledgeBaseRefsJson) ? record.knowledgeBaseRefsJson : [],
    sources,
    artifacts: sources.filter((item) => item?.type === 'artifact' && item.artifact).map((item) => item.artifact),
    created_at: record.createdAt,
  };
}

async function ensureConversation(user, conversationId) {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: Number(conversationId), userId: user.user_id, agentType: { startsWith: 'teacher_' } },
  });
  if (!conversation) bad('教师 AI 会话不存在或无权访问', 40301);
  return conversation;
}

async function createConversation(user, body = {}) {
  const mode = String(body.mode || 'general').toLowerCase();
  if (!MODES.has(mode)) bad('AI 助手模式不合法');
  const context = await resolveEntityContext(user, String(body.prompt || ''), body.context || body);
  const record = await prisma.aiConversation.create({
    data: {
      userId: user.user_id,
      title: String(body.title || '新教学对话').trim().slice(0, 200) || '新教学对话',
      mode: mode === 'agent' ? 'AGENT' : 'GENERAL',
      agentType: `teacher_${mode}`,
      agentRuntimeStateJson: context,
    },
  });
  return toConversation(record, null, 0);
}

const FORBIDDEN_STUDENT_AGENT_CONTENT = /复习|考研|学习规划|英语写作|高等数学答疑|学生助手|作业辅导/i;
const TEACHER_AGENT_CONTENT = /教学|教师|备课|课程|学情|题目|试卷|批改|教案|文档|科研|论文|研究|知识|实验|课堂|评估|评价|分析|概念/i;

function isTeacherFacingMarketplaceAgent(agent) {
  const text = `${agent?.version?.name || ''} ${agent?.version?.shortDescription || ''}`;
  return !FORBIDDEN_STUDENT_AGENT_CONTENT.test(text) && (agent?.isOwner || TEACHER_AGENT_CONTENT.test(text));
}

async function getContextOptions(user) {
  const [courseIds, classIds] = await Promise.all([getAccessibleCourseIds(user), getAccessibleTeachingClassIds(user, { status: 'active' })]);
  const [courses, classes, knowledgeBases, callableAgents] = await Promise.all([
    prisma.course.findMany({ where: courseIds === null ? {} : { course_id: { in: courseIds } }, select: { course_id: true, course_name: true, course_code: true }, orderBy: { course_name: 'asc' } }),
    classIds.length ? prisma.teachingClass.findMany({ where: { teaching_class_id: { in: classIds } }, select: { teaching_class_id: true, teaching_class_name: true, code: true, course_id: true }, orderBy: { teaching_class_name: 'asc' } }) : [],
    prisma.knowledgeBase.findMany({
      where: {
        deleted_at: null,
        status: 'active',
        OR: [
          { owner_user_id: user.user_id },
          ...(courseIds === null ? [{}] : [{ course_id: { in: courseIds } }]),
          { teaching_class_id: { in: classIds } },
          { scope_type: 'PLATFORM' },
          { marketplace_visibility: 'PUBLIC' },
        ],
      },
      select: { knowledge_base_id: true, name: true, course_id: true, teaching_class_id: true },
      orderBy: { updated_at: 'desc' },
      take: 100,
    }),
    marketplaceService.listCallableAgents(user.user_id, { includeFileGenerators: false }),
  ]);
  return {
    courses,
    teaching_classes: classes,
    knowledge_bases: knowledgeBases,
    agents: [
      { id: 'learning_analysis', name: '学情分析 Agent', source: 'system', agent_type: 'SYSTEM' },
      { id: 'preparation', name: '智慧备课 Agent', source: 'system', agent_type: 'SYSTEM' },
      { id: 'question_generation', name: '题目生成 Agent', source: 'system', agent_type: 'SYSTEM' },
      { id: 'document_generation', name: '文档生成 Agent', source: 'system', agent_type: 'SYSTEM' },
      ...(callableAgents.list || []).filter(isTeacherFacingMarketplaceAgent).map((agent) => ({
        id: `marketplace:${agent.id}`,
        agent_id: agent.id,
        name: agent.version?.name || `Agent ${agent.id}`,
        description: agent.version?.shortDescription || '',
        source: agent.isOwner ? 'mine' : 'marketplace',
        agent_type: agent.agentType || 'CHAT',
      })),
    ],
    ranges: ['7d', '30d', 'semester'],
  };
}

async function resolveAgentRefs(user, refs = []) {
  const values = [...new Set((Array.isArray(refs) ? refs : []).map((item) => String(item?.id || item).trim()).filter(Boolean))];
  if (values.length > 6) bad('单次最多选择 6 个 Agent');
  const internal = values.filter((value) => ALLOWED_AGENT_REFS.has(value));
  const marketplaceIds = values.map((value) => {
    const matched = value.match(/^marketplace:(\d+)$/);
    return matched ? Number(matched[1]) : null;
  }).filter(Number.isInteger);
  const unknown = values.filter((value) => !ALLOWED_AGENT_REFS.has(value) && !/^marketplace:\d+$/.test(value));
  if (unknown.length) bad('部分 Agent 引用不合法');
  const registered = marketplaceIds.length
    ? await agentContextService.resolveAgentRefs(user.user_id, marketplaceIds, { assistantMode: 'general', allowFileGenerator: false })
    : [];
  return {
    normalized: [
      ...internal.map((id) => ({ id, name: ({
        learning_analysis: '学情分析 Agent', preparation: '智慧备课 Agent',
        question_generation: '题目生成 Agent', document_generation: '文档生成 Agent',
      })[id], source: 'system' })),
      ...registered.map(({ agent, version }) => ({ id: `marketplace:${agent.id}`, agent_id: agent.id, name: version.name, source: 'marketplace', agent_type: agent.agentType })),
    ],
    registered,
  };
}

async function listConversations(user, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 30));
  const where = {
    userId: user.user_id,
    agentType: query.mode ? `teacher_${String(query.mode).toLowerCase()}` : { startsWith: 'teacher_' },
    ...(query.search ? { title: { contains: String(query.search).trim() } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { messages: { orderBy: { id: 'desc' }, take: 1 } },
    }),
    prisma.aiConversation.count({ where }),
  ]);
  const counts = rows.length ? await prisma.aiMessage.groupBy({
    by: ['conversationId'],
    where: { conversationId: { in: rows.map((row) => row.id) } },
    _count: { _all: true },
  }) : [];
  const countMap = new Map(counts.map((row) => [row.conversationId, row._count._all]));
  return {
    list: rows.map((row) => toConversation(row, row.messages[0], countMap.get(row.id) || 0)),
    total,
    page,
    page_size: pageSize,
  };
}

async function getMessages(user, conversationId) {
  const conversation = await ensureConversation(user, conversationId);
  const messages = await prisma.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { id: 'asc' } });
  return { conversation: toConversation(conversation, null, messages.length), messages: messages.map((row) => toMessage(row)) };
}

async function resolveEntityContext(user, text, supplied = {}, previous = {}) {
  let courseId = Number(supplied.course_id || supplied.courseId || previous.course_id) || null;
  let classId = Number(supplied.teaching_class_id || supplied.teachingClassId || previous.teaching_class_id) || null;
  let range = String(supplied.range || previous.range || '').toLowerCase();
  const classIds = await getAccessibleTeachingClassIds(user, { status: 'active' });
  const courseIds = await getAccessibleCourseIds(user);
  const classes = classIds.length ? await prisma.teachingClass.findMany({
    where: { teaching_class_id: { in: classIds } },
    include: { course: true },
  }) : [];
  if (classId) {
    const selected = await ensureTeachingClassAccess(user, classId);
    courseId = selected.course_id;
  } else {
    const matched = classes.find((item) => [item.teaching_class_name, item.code]
      .filter(Boolean).some((name) => String(text).toLowerCase().includes(String(name).toLowerCase())));
    if (matched) {
      classId = matched.teaching_class_id;
      courseId = matched.course_id;
    }
  }
  if (courseId) await ensureCourseAccess(user, courseId);
  if (!courseId) {
    const courses = await prisma.course.findMany({
      where: courseIds === null ? {} : { course_id: { in: courseIds } },
      select: { course_id: true, course_name: true, course_code: true },
    });
    const matched = courses.find((item) => [item.course_name, item.course_code]
      .some((name) => String(text).toLowerCase().includes(String(name).toLowerCase())));
    if (matched) courseId = matched.course_id;
  }
  if (!range) {
    if (/近?7天|最近一周|本周/.test(text)) range = '7d';
    else if (/近?30天|最近一个月|本月/.test(text)) range = '30d';
    else if (/本学期|学期/.test(text)) range = 'semester';
  }
  if (!range) range = '7d';
  if (!['7d', '30d', 'semester', 'custom'].includes(range)) range = '7d';
  const selectedClass = classId ? classes.find((item) => item.teaching_class_id === classId) : null;
  const selectedCourse = courseId
    ? selectedClass?.course || await prisma.course.findUnique({ where: { course_id: courseId } })
    : null;
  return {
    course_id: courseId,
    course_name: selectedCourse?.course_name || null,
    teaching_class_id: classId,
    teaching_class_name: selectedClass?.teaching_class_name || null,
    range,
    chapter_id: Number(supplied.chapter_id || previous.chapter_id) || null,
    knowledge_point_id: Number(supplied.knowledge_point_id || previous.knowledge_point_id) || null,
  };
}

async function resolveKnowledgeBases(user, refs = []) {
  const ids = [...new Set((Array.isArray(refs) ? refs : []).map((item) => Number(item?.id || item)).filter(Number.isInteger))];
  if (ids.length > 8) bad('单次最多引用 8 个知识库');
  if (!ids.length) return [];
  const bases = await prisma.knowledgeBase.findMany({
    where: { knowledge_base_id: { in: ids }, deleted_at: null, status: 'active' },
    include: {
      documents: {
        where: { deleted_at: null, parse_status: { in: ['PARSED', 'CHUNKED', 'EMBEDDED'] } },
        select: { document_id: true, title: true, cleaned_text: true },
        take: 6,
      },
    },
  });
  if (bases.length !== ids.length) bad('部分知识库不存在或不可用', 40002);
  for (const base of bases) {
    if (base.owner_user_id === user.user_id) continue;
    if (base.teaching_class_id) await ensureTeachingClassAccess(user, base.teaching_class_id);
    else if (base.course_id) await ensureCourseAccess(user, base.course_id);
    else if (base.scope_type !== 'PLATFORM' && base.marketplace_visibility !== 'PUBLIC') bad('无权访问所选知识库', 40301);
  }
  return bases;
}

function chartSources(analytics) {
  if (!analytics) return [];
  return [
    {
      type: 'chart_spec',
      chart: {
        chartType: 'line', title: '学习活跃趋势', unit: '次',
        xAxis: analytics.learning_trend.map((item) => item.date),
        series: [
          { name: '学习活动', data: analytics.learning_trend.map((item) => item.activities) },
          { name: '学生疑问', data: analytics.learning_trend.map((item) => item.questions) },
        ],
      },
    },
    {
      type: 'chart_spec',
      chart: {
        chartType: 'bar', title: '班级掌握度分布', unit: '人',
        xAxis: analytics.mastery_distribution.map((item) => item.label),
        series: [{ name: '学生人数', data: analytics.mastery_distribution.map((item) => item.count) }],
      },
    },
    {
      type: 'chart_spec',
      chart: {
        chartType: 'bar', title: '薄弱知识点', unit: '%',
        categories: analytics.weak_knowledge_points.slice(0, 5).map((item) => item.name),
        xAxis: analytics.weak_knowledge_points.slice(0, 5).map((item) => item.name),
        series: [{ name: '平均掌握度', data: analytics.weak_knowledge_points.slice(0, 5).map((item) => item.mastery) }],
      },
    },
  ];
}

function analyticsFallback(analytics, context) {
  if (!analytics) return 'AI 模型当前不可用。你仍可选择课程和教学班后使用学情分析、备课与任务发布等确定性功能。';
  const overview = analytics.overview || {};
  const weak = analytics.weak_knowledge_points?.slice(0, 3).map((item) => item.name).join('、') || '暂无';
  const risks = analytics.risk_students?.slice(0, 3).map((item) => item.student_name).join('、') || '暂无';
  return `已基于真实教学数据完成分析。\n\n- 范围：${context.course_name || '所选课程'} / ${context.teaching_class_name || '全部授权教学班'} / ${context.range}\n- 学生人数：${overview.student_count || 0}\n- 平均掌握度：${overview.average_mastery || 0}%\n- 作业完成率：${overview.task_completion_rate || 0}%\n- 薄弱知识点：${weak}\n- 需重点关注学生：${risks}\n\n建议先围绕薄弱知识点安排一次诊断练习，并对风险学生进行分层干预。图表和数据来源已随回答返回。`;
}

async function buildTurn(user, conversationId, body = {}) {
  let conversation = await ensureConversation(user, conversationId);
  const content = String(body.content || '').trim();
  const attachments = await attachmentService.resolveForTurn(user.user_id, conversation.id, body.attachments || []);
  if (!content && !attachments.length) bad('请输入文字或添加附件');
  const userInputChars = Array.from(content).length;
  if (userInputChars > TEACHER_INPUT_MAX_CHARS) bad(`教师当前输入不能超过 ${TEACHER_INPUT_MAX_CHARS} 字（教学上下文和附件不计入此限制）`);
  let preparationContextText = '';
  if (body.preparation_context && typeof body.preparation_context === 'object') {
    const serialized = JSON.stringify(body.preparation_context);
    if (serialized.length > PREPARATION_CONTEXT_MAX_CHARS * 6) bad('备课上下文过长，请缩小 Word 选区或仅保留当前 PPT/PDF 页', 40002);
    preparationContextText = serialized.length > PREPARATION_CONTEXT_MAX_CHARS
      ? `${serialized.slice(0, PREPARATION_CONTEXT_MAX_CHARS)}\n[系统已裁剪过长的备课上下文；教师输入未超限]`
      : serialized;
  }
  const mode = teacherMode(conversation);
  const context = await resolveEntityContext(user, content, body.context || body, conversation.agentRuntimeStateJson || {});
  const [knowledgeBases, history, selectedAgents] = await Promise.all([
    resolveKnowledgeBases(user, body.knowledge_base_refs || body.knowledgeBaseRefs || []),
    prisma.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { id: 'desc' }, take: 12 }),
    resolveAgentRefs(user, body.agent_refs || body.agentRefs || []),
  ]);
  const agentRefs = selectedAgents.normalized;
  const needsAnalytics = mode === 'analytics' || /学情|掌握|薄弱|风险|完成率|高频|疑问|错题|学习情况|班级分析/.test(content);
  let analytics = null;
  if (needsAnalytics) {
    if (!context.course_id) bad('请先选择或在问题中明确课程，AI 数据工具不会跨权限猜测课程');
    analytics = await analyticsService.buildWorkbench(user, {
      course_id: context.course_id,
      teaching_class_id: context.teaching_class_id || undefined,
      range: context.range,
      chapter_id: context.chapter_id || undefined,
      knowledge_point_id: context.knowledge_point_id || undefined,
    });
  }
  const apiAttachments = attachments.map((item) => attachmentService.api(item));
  const userMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content,
      attachments: apiAttachments.length ? apiAttachments : undefined,
      knowledgeBaseRefsJson: knowledgeBases.map((base) => ({ id: base.knowledge_base_id, name: base.name })),
    },
  });
  await attachmentService.bindMessage(attachments.map((item) => item.id), userMessage.id);
  const firstUserMessage = !history.some((message) => message.role === 'USER');
  conversation = await prisma.aiConversation.update({
    where: { id: conversation.id },
    data: {
      ...(firstUserMessage ? { title: content.slice(0, 32) || '文件分析' } : {}),
      agentRuntimeStateJson: context,
      updatedAt: new Date(),
    },
  });
  const kbContext = knowledgeBases.flatMap((base) => base.documents.map((doc) => (
    `[知识库：${base.name} / ${doc.title}]\n${String(doc.cleaned_text || '').slice(0, 3000)}`
  ))).join('\n\n');
  const attachmentContext = attachments.filter((item) => item.extractedText)
    .map((item) => `[附件：${item.fileName}]\n${String(item.extractedText).slice(0, 12000)}`).join('\n\n');
  const sourceList = [
    ...(analytics ? [{ type: 'analytics', label: '教师授权范围内实时聚合数据', generated_at: analytics.data_sources.generated_at, counts: analytics.data_sources.counts, filters: analytics.filters }] : []),
    ...knowledgeBases.map((base) => ({ type: 'knowledge_base', id: base.knowledge_base_id, label: base.name })),
    ...agentRefs.map((agent) => ({ type: 'agent', id: agent.id, label: agent.name, source: agent.source, status: agent.source === 'marketplace' ? 'pending' : 'available' })),
    ...attachments.map((item) => ({ type: 'attachment', id: item.id, label: item.fileName, mime_type: item.mimeType })),
    ...(preparationContextText ? [{ type: 'preparation_context', label: '沉浸式备课当前页与教案选区', user_input_chars: userInputChars, context_chars: preparationContextText.length }] : []),
    ...chartSources(analytics),
  ];
  const system = `你是 DisciMind 教师教学助手。当前模式：${mode}。只使用系统提供的真实数据和教师有权访问的上下文，不得假装查询数据库，不得编造人数、成绩或来源。需要图表时只描述结论，图表规范由后端受控生成，绝不输出可执行 JavaScript。回答使用清晰 Markdown，数学公式可使用 LaTeX。沉浸式备课回答必须先作为建议供教师确认，不得声称已修改 Word/PPT/PDF。\n当前上下文：${JSON.stringify(context)}\n${preparationContextText ? `受控沉浸式备课上下文（已独立于教师输入计数并按当前页/选区裁剪）：${preparationContextText}` : ''}\n当前选择的受控 Agent：${JSON.stringify(agentRefs)}。只有“已完成”的注册 Agent 结果可以作为协作意见；失败或未运行的 Agent 不得假装已执行。\n${analytics ? `受控学情工具结果：${JSON.stringify({ overview: analytics.overview, weak_knowledge_points: analytics.weak_knowledge_points.slice(0, 8), risk_students: analytics.risk_students.slice(0, 8), dialogue: analytics.dialogue, homework: analytics.homework, exams: analytics.exams, teaching_focus: analytics.teaching_focus })}` : ''}\n${kbContext}\n${attachmentContext}`;
  const imageParts = (await Promise.all(attachments
    .filter((item) => String(item.mimeType || '').startsWith('image/'))
    .slice(0, 4)
    .map(async (item) => {
      const bytes = await fs.readFile(attachmentService.absolutePath(item)).catch(() => null);
      return bytes ? { type: 'image_url', image_url: { url: `data:${item.mimeType};base64,${bytes.toString('base64')}` } } : null;
    }))).filter(Boolean);
  const currentUserContent = imageParts.length
    ? [{ type: 'text', text: content || '请结合图片内容进行分析。' }, ...imageParts]
    : (content || '请分析附件内容。');
  const messages = [
    { role: 'system', content: system },
    ...history.reverse().map((message) => ({ role: String(message.role).toLowerCase(), content: message.content })),
    { role: 'user', content: currentUserContent },
  ];
  return {
    conversation,
    userMessage,
    messages,
    sources: sourceList,
    charts: sourceList.filter((item) => item.type === 'chart_spec').map((item) => item.chart),
    context,
    agentRefs,
    registeredAgents: selectedAgents.registered,
    agentQuestion: content || '请分析附件内容。',
    knowledgeBaseRefs: knowledgeBases.map((base) => base.knowledge_base_id),
    userId: user.user_id,
    fallback: analyticsFallback(analytics, context),
    assistantClientRequestId: String(body.client_request_id || `teacher-ai-${userMessage.id}`).slice(0, 80),
    maxOutputTokens: body.assistant_surface === 'floating' ? 900 : 2600,
    user,
    searchOptions: body.search_options || body.searchOptions || {},
    autoAgent: body.auto_agent !== false && body.autoAgent !== false,
    agentExecutionMode: body.agent_execution_mode || body.agentExecutionMode || null,
    confirmed: body.confirmed === true,
  };
}

async function runRegisteredAgentCollaboration(turn) {
  if (!turn.registeredAgents?.length) return [];
  const settled = await Promise.allSettled(turn.registeredAgents.map(async ({ agent, version }) => {
    const retrieval = await agentContextService.resolveRetrieval(turn.userId, version, turn.agentQuestion, []);
    const result = await agentRuntimeService.runAgent({
      version,
      history: [],
      memories: [],
      question: turn.agentQuestion,
      records: retrieval.records || [],
    });
    return {
      id: `marketplace:${agent.id}`,
      name: version.name,
      content: String(result.content || '').trim().slice(0, 5000),
      source_count: retrieval.records?.length || 0,
    };
  }));
  return settled.map((result, index) => {
    const selected = turn.registeredAgents[index];
    const id = `marketplace:${selected.agent.id}`;
    const source = turn.sources.find((item) => item.type === 'agent' && item.id === id);
    if (result.status === 'fulfilled' && result.value.content) {
      if (source) Object.assign(source, { status: 'completed', source_count: result.value.source_count });
      return result.value;
    }
    console.error('[TeacherAI] registered agent degraded', {
      conversationId: turn.conversation.id,
      agentId: selected.agent.id,
      error: result.status === 'rejected' ? result.reason?.message : 'empty response',
    });
    if (source) Object.assign(source, { status: 'degraded' });
    return { id, name: selected.version.name, content: '', degraded: true };
  });
}

async function completeTurn(turn, signal, onDelta = () => {}, onEvent = () => {}) {
  let content = '';
  let providerDegraded = false;
  let orchestration = null;
  try {
    orchestration = await assistantOrchestrator.run({
      user: turn.user,
      query: turn.agentQuestion,
      messages: turn.messages,
      conversationId: turn.conversation.id,
      messageId: turn.userMessage.id,
      courseId: turn.context.course_id,
      teachingClassId: turn.context.teaching_class_id,
      assistantMode: teacherMode(turn.conversation),
      knowledgeBaseIds: turn.knowledgeBaseRefs,
      resolvedAgents: turn.registeredAgents.map(item => ({ ...item, selection: 'manual', score: 1000 })),
      autoAgent: turn.registeredAgents.length ? false : turn.autoAgent,
      agentExecutionMode: turn.agentExecutionMode,
      searchOptions: turn.searchOptions,
      confirmed: turn.confirmed,
      maxTokens: turn.maxOutputTokens,
      signal,
      entryPoint: 'teacher-ai',
      scene: teacherMode(turn.conversation),
      context: turn.context,
      onDelta,
      onEvent,
    });
    content = orchestration.content;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (['AI_SEARCH_NOT_TRIGGERED', 'AI_SEARCH_UNSUPPORTED', 'AI_TOOL_VALIDATION_FAILED', 'AI_AGENT_FORBIDDEN'].includes(error.publicCode)) throw error;
    providerDegraded = true;
    content = turn.fallback;
    onDelta(content);
  }
  const webSources = (orchestration?.sources || []).map((source) => ({
    type: 'web', label: source.title, title: source.title, url: source.url,
    index: source.index, site_name: source.siteName, icon: source.icon,
    retrieved_at: source.retrievedAt, search_strategy: source.searchStrategy,
    cited: source.cited === true,
  }));
  const artifactSources = (orchestration?.artifacts || []).map(artifact => ({ type: 'artifact', label: artifact.title, artifact }));
  const combinedSources = [...webSources, ...turn.sources, ...artifactSources];
  try {
    const saved = await aiChatService.finalizeAssistantMessage(turn.conversation.id, content, {
      sources: combinedSources,
      clientRequestId: turn.assistantClientRequestId,
    });
    return { ...saved, content, sources: combinedSources, charts: turn.charts, artifacts: orchestration?.artifacts || [], pendingAction: orchestration?.pendingAction || null, traceId: orchestration?.traceId || null, confirmationRequired: orchestration?.confirmationRequired === true, provider: { degraded: providerDegraded }, persistence: { saved: true } };
  } catch (error) {
    if (error.publicCode !== 'AI_MESSAGE_SAVE_FAILED') throw error;
    return {
      conversation: turn.conversation,
      assistantMessage: {
        id: null,
        conversationId: turn.conversation.id,
        role: 'ASSISTANT',
        content,
        sourcesJson: turn.sources,
        createdAt: new Date(),
      },
      content,
      sources: combinedSources,
      charts: turn.charts,
      artifacts: orchestration?.artifacts || [],
      pendingAction: orchestration?.pendingAction || null,
      traceId: orchestration?.traceId || null,
      confirmationRequired: orchestration?.confirmationRequired === true,
      provider: { degraded: providerDegraded },
      persistence: {
        saved: false,
        code: error.publicCode,
        message: error.message,
        retryable: true,
        client_request_id: turn.assistantClientRequestId,
      },
    };
  }
}

async function sendMessage(user, conversationId, body = {}) {
  const turn = await buildTurn(user, conversationId, body);
  const result = await completeTurn(turn, undefined);
  return {
    conversation: toConversation(result.conversation),
    user_message: toMessage(turn.userMessage),
    assistant_message: toMessage({ ...result.assistantMessage, sourcesJson: result.sources }),
    charts: result.charts,
    context: turn.context,
    provider: result.provider,
    persistence: result.persistence,
  };
}

async function retrySave(user, conversationId, body = {}) {
  const conversation = await ensureConversation(user, conversationId);
  const content = String(body.content || '').trim();
  const clientRequestId = String(body.client_request_id || '').trim().slice(0, 80);
  if (!content) bad('没有可保存的回答内容');
  if (!clientRequestId) bad('缺少保存重试标识');
  if (content.length > 1_000_000) bad('回答内容过长，无法保存');
  const saved = await aiChatService.finalizeAssistantMessage(conversation.id, content, {
    sources: Array.isArray(body.sources) ? body.sources : [],
    clientRequestId,
  });
  return {
    assistant_message: toMessage(saved.assistantMessage),
    conversation: toConversation(saved.conversation),
    persistence: { saved: true },
  };
}

async function rename(user, conversationId, title) {
  const conversation = await ensureConversation(user, conversationId);
  const safe = String(title || '').trim();
  if (!safe || safe.length > 200) bad('会话标题长度应为 1-200 字');
  return toConversation(await prisma.aiConversation.update({ where: { id: conversation.id }, data: { title: safe } }));
}

async function clear(user, conversationId) {
  const conversation = await ensureConversation(user, conversationId);
  await prisma.aiMessage.deleteMany({ where: { conversationId: conversation.id } });
  return { cleared: true };
}

async function remove(user, conversationId) {
  const conversation = await ensureConversation(user, conversationId);
  await prisma.aiConversation.delete({ where: { id: conversation.id } });
  await attachmentService.removeForConversations(user.user_id, conversation.id);
  return { deleted: true };
}

async function getAttachment(user, conversationId, messageId, attachmentId) {
  await ensureConversation(user, conversationId);
  const row = await prisma.aiChatAttachment.findFirst({
    where: { id: String(attachmentId), userId: user.user_id, conversationId: Number(conversationId), messageId: Number(messageId), status: 'READY' },
  });
  if (!row) bad('附件不存在或无权访问', 40301);
  const filePath = attachmentService.absolutePath(row);
  await fs.access(filePath).catch(() => bad('附件文件不存在', 40002));
  return { filePath, mimeType: row.mimeType, name: row.fileName };
}

module.exports = {
  createConversation,
  getContextOptions,
  listConversations,
  getMessages,
  buildTurn,
  completeTurn,
  sendMessage,
  retrySave,
  rename,
  clear,
  remove,
  getAttachment,
  toConversation,
  toMessage,
};
