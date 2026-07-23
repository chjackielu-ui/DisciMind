const { z } = require('zod');
const prisma = require('../../config/prisma');
const agentContext = require('../agent-chat/agent-context.service');
const agentRuntime = require('../agent-chat/agent-runtime.service');
const teacherAnalytics = require('../../services/teacher-analytics-workbench.service');
const { DashScopeSearchClient } = require('./dashscope-search.client');
const artifactService = require('./artifact.service');
const { ToolRegistry } = require('./tool-registry');
const { staticCapabilities } = require('./capability.service');
const { getBailianConfig } = require('../../services/bailian-openai.service');
const studentLearningData = require('./student-learning-data.service');
const { chartToolInputSchema, normalizeChartArguments } = require('./chart-spec');

const objectParameters = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

function standardizeKnowledgeSources(records = []) {
  return (Array.isArray(records) ? records : []).map((record, index) => ({
    index: index + 1,
    title: String(record.documentName || record.knowledgeBaseName || '知识库资料'),
    url: record.externalUrl || null,
    siteName: String(record.knowledgeBaseName || '课程知识库'),
    sourceType: 'knowledge_base',
    snippet: String(record.content || '').slice(0, 2000) || null,
    knowledgeBaseId: record.knowledgeBaseId || null,
    knowledgeBaseName: record.knowledgeBaseName || null,
    documentId: record.documentId || null,
    segmentId: record.segmentId || null,
    pageNumber: record.pageNumber || null,
    score: Number.isFinite(Number(record.score)) ? Number(record.score) : null,
    retrievedAt: new Date().toISOString(),
  }));
}

const chartSpecParameters = objectParameters({
  spec: objectParameters({
    version: { type: 'string', enum: ['1.0'] },
    chart: objectParameters({
      type: { type: 'string', enum: ['line', 'bar', 'pie', 'radar', 'scatter'] },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      subtitle: { type: ['string', 'null'], maxLength: 300 },
      xAxis: { type: 'array', items: { type: 'string' }, maxItems: 366 },
      series: {
        type: 'array', minItems: 1, maxItems: 20,
        items: objectParameters({ name: { type: 'string', minLength: 1 }, data: { type: 'array', items: { type: 'number' }, maxItems: 366 } }, ['name', 'data']),
      },
      unit: { type: ['string', 'null'], maxLength: 30 },
    }, ['type', 'title', 'xAxis', 'series']),
    table: objectParameters({
      columns: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
      rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] }, maxItems: 20 }, maxItems: 1000 },
    }, ['columns', 'rows']),
    insights: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    source: objectParameters({ type: { type: 'string', minLength: 1 }, range: { type: ['string', 'null'] } }, ['type']),
  }, ['version', 'chart', 'table', 'insights', 'source']),
}, ['spec']);

async function studentScope(context, studentUserId) {
  const requester = Number(context.user.user_id); const role = String(context.user.role).toLowerCase();
  const target = Number(studentUserId || requester);
  if (role === 'student' && target !== requester) throw Object.assign(new Error('学生只能读取自己的学习数据'), { code: 40301, status: 403 });
  if (role === 'teacher' && target !== requester) {
    const enrollment = await prisma.studentCourseEnrollment.findFirst({
      where: { student_user_id: target, enrollment_status: 'active', teachingClass: { OR: [{ teacher_user_id: requester }, { teacher_authorizations: { some: { teacher_user_id: requester, status: 'active' } } }] } },
      select: { enrollment_id: true },
    });
    if (!enrollment) throw Object.assign(new Error('无权读取该学生的学习数据'), { code: 40301, status: 403 });
  }
  return target;
}

function buildRegistry(options = {}) {
  const registry = new ToolRegistry();
  registry.register({
    name: 'web_search', description: '通过 DashScope 原生联网搜索获取实时网页信息，并返回可验证来源。', roles: ['student', 'teacher', 'admin'],
    riskLevel: 'low', timeoutMs: 180000, maxRetries: 1, inputSchema: z.object({ query: z.string().min(2).max(4000), strategy: z.enum(['turbo', 'max']).default('turbo') }),
    parameters: objectParameters({ query: { type: 'string', description: '需要检索的完整问题' }, strategy: { type: 'string', enum: ['turbo', 'max'] } }),
    handler: async (input, context) => {
      const capabilities = context.capabilities || staticCapabilities(getBailianConfig().model);
      return (options.searchClient || new DashScopeSearchClient()).complete({ messages: [{ role: 'user', content: input.query }], searchOptions: { mode: 'force', strategy: input.strategy }, capabilities, signal: context.signal });
    },
  });
  registry.register({
    name: 'knowledge_retrieve', description: '检索当前用户已授权的 DisciMind 知识库资料。', roles: ['student', 'teacher', 'admin'], riskLevel: 'low', timeoutMs: 90000, maxRetries: 1,
    inputSchema: z.object({ query: z.string().min(1).max(4000), knowledgeBaseIds: z.array(z.number().int().positive()).max(10).default([]) }),
    parameters: objectParameters({ query: { type: 'string' }, knowledgeBaseIds: { type: 'array', items: { type: 'integer' } } }),
    handler: async (input, context) => {
      const bases = await agentContext.resolveKnowledgeBaseRefs(context.user.user_id, input.knowledgeBaseIds);
      return agentContext.retrieveFromKnowledgeBases(bases, input.query, { topK: 6, scoreThreshold: 0.2, maxContextChars: 10000 });
    },
  });
  const learningToolDefinitions = [
    { name: 'get_current_student_context', description: '读取当前登录学生本人的课程、教学班、知识点与活动学习上下文；不接收学号或学生 ID。', inputSchema: z.object({}).strict(), parameters: objectParameters({}) },
    { name: 'get_student_wrong_questions', description: '读取当前登录学生本人的错题明细和状态分布；课程范围来自已校验 UserContext。', inputSchema: z.object({ status: z.enum(['UNRESOLVED', 'MASTERED', 'REMOVED']).optional(), limit: z.number().int().min(1).max(100).default(20) }).strict(), parameters: objectParameters({ status: { type: 'string', enum: ['UNRESOLVED', 'MASTERED', 'REMOVED'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } }) },
    { name: 'get_student_learning_records', description: '读取当前登录学生本人的学习行为记录；可指定最近天数，不接收学生身份参数。', inputSchema: z.object({ days: z.number().int().min(1).max(366).optional(), limit: z.number().int().min(1).max(200).default(50) }).strict(), parameters: objectParameters({ days: { type: 'integer', minimum: 1, maximum: 366 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }) },
    { name: 'get_student_score_trend', description: '基于当前登录学生已评分的练习和课程任务计算真实得分率趋势；无记录时明确返回 no_data。', inputSchema: z.object({ days: z.number().int().min(1).max(366).optional() }).strict(), parameters: objectParameters({ days: { type: 'integer', minimum: 1, maximum: 366 } }) },
    { name: 'get_student_mastery', description: '读取当前登录学生本人的知识点掌握度及统计口径；不接收学号或学生 ID。', inputSchema: z.object({}).strict(), parameters: objectParameters({}) },
    { name: 'get_student_recent_sessions', description: '读取当前登录学生本人的最近学习流与练习会话。', inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }).strict(), parameters: objectParameters({ limit: { type: 'integer', minimum: 1, maximum: 50 } }) },
    { name: 'get_student_learning_time', description: '汇总当前登录学生学习记录和练习会话中真实保存的时长；可指定最近天数。', inputSchema: z.object({ days: z.number().int().min(1).max(366).optional() }).strict(), parameters: objectParameters({ days: { type: 'integer', minimum: 1, maximum: 366 } }) },
    { name: 'get_student_task_completion', description: '汇总当前登录学生收到的课程任务及提交完成率；可指定最近天数。', inputSchema: z.object({ days: z.number().int().min(1).max(366).optional() }).strict(), parameters: objectParameters({ days: { type: 'integer', minimum: 1, maximum: 366 } }) },
  ];
  for (const definition of learningToolDefinitions) registry.register({
    ...definition, roles: ['student'], riskLevel: 'low', timeoutMs: 30_000, maxRetries: 0,
    handler: (input, context) => studentLearningData.execute(definition.name, input, context),
  });
  registry.register({
    name: 'student_learning_profile', description: '读取教师授权范围内学生的课程、掌握度和学习画像。学生本人查询使用 owner-bound 学习数据 Tool。', roles: ['teacher', 'admin'], riskLevel: 'medium', timeoutMs: 30000,
    inputSchema: z.object({ studentUserId: z.number().int().positive().optional(), courseId: z.number().int().positive().optional() }),
    parameters: objectParameters({ studentUserId: { type: 'integer' }, courseId: { type: 'integer' } }),
    handler: async (input, context) => {
      const userId = await studentScope(context, input.studentUserId);
      const where = { student_user_id: userId, ...(input.courseId ? { course_id: input.courseId } : {}) };
      const [enrollments, mastery, wrongCount] = await Promise.all([
        prisma.studentCourseEnrollment.findMany({ where: { ...where, enrollment_status: 'active' }, include: { course: { select: { course_id: true, course_name: true } }, teachingClass: { select: { teaching_class_id: true, teaching_class_name: true } } }, take: 20 }),
        prisma.studentMasteryRecord.findMany({ where, include: { knowledge_point: { select: { knowledge_point_name: true } } }, orderBy: { mastery_score: 'asc' }, take: 20 }),
        prisma.wrongQuestion.count({ where: { student_user_id: userId, ...(input.courseId ? { course_id: input.courseId } : {}) } }),
      ]);
      return { studentUserId: userId, courses: enrollments.map(item => ({ id: item.course_id, name: item.course.course_name, teachingClassId: item.teaching_class_id, teachingClassName: item.teachingClass.teaching_class_name })), weakPoints: mastery.map(item => ({ name: item.knowledge_point?.knowledge_point_name, mastery: item.mastery_score })), wrongQuestionCount: wrongCount };
    },
  });
  registry.register({
    name: 'wrong_question_summary', description: '供教师在授权范围内按课程汇总学生错题状态和高频知识点。', roles: ['teacher', 'admin'], riskLevel: 'medium', timeoutMs: 30000,
    inputSchema: z.object({ studentUserId: z.number().int().positive().optional(), courseId: z.number().int().positive().optional() }),
    parameters: objectParameters({ studentUserId: { type: 'integer' }, courseId: { type: 'integer' } }),
    handler: async (input, context) => {
      const userId = await studentScope(context, input.studentUserId);
      const rows = await prisma.wrongQuestion.findMany({ where: { student_user_id: userId, ...(input.courseId ? { course_id: input.courseId } : {}) }, include: { knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } } }, take: 500 });
      const points = new Map(); rows.forEach(row => { const key = row.knowledge_point_id || 0; const current = points.get(key) || { id: key || null, name: row.knowledge_point?.knowledge_point_name || '未归类', count: 0 }; current.count += 1; points.set(key, current); });
      return { total: rows.length, statusCounts: rows.reduce((out, row) => ({ ...out, [row.status]: (out[row.status] || 0) + 1 }), {}), topKnowledgePoints: [...points.values()].sort((a, b) => b.count - a.count).slice(0, 10) };
    },
  });
  registry.register({
    name: 'teacher_class_analytics', description: '读取教师授权课程或教学班的真实学情分析。', roles: ['teacher', 'admin'], riskLevel: 'medium', timeoutMs: 60000,
    inputSchema: z.object({ courseId: z.number().int().positive(), teachingClassId: z.number().int().positive().optional(), range: z.enum(['7d', '30d', 'semester']).default('7d') }),
    parameters: objectParameters({ courseId: { type: 'integer' }, teachingClassId: { type: 'integer' }, range: { type: 'string', enum: ['7d', '30d', 'semester'] } }),
    handler: (input, context) => teacherAnalytics.buildWorkbench(context.user, { course_id: input.courseId, teaching_class_id: input.teachingClassId, range: input.range }),
  });
  registry.register({
    name: 'execute_agent', description: '通过后端 LangChain 运行时执行已选择或自动匹配且通过权限校验的 Agent。', roles: ['student', 'teacher', 'admin'], riskLevel: 'medium',
    timeoutMs: Math.max(30_000, Number(process.env.AI_AGENT_TIMEOUT_MS) || 150_000), idempotent: true, maxRetries: 1,
    inputSchema: z.object({ agentId: z.number().int().positive(), query: z.string().min(1).max(8000), knowledgeBaseIds: z.array(z.number().int().positive()).max(10).default([]) }),
    parameters: objectParameters({ agentId: { type: 'integer' }, query: { type: 'string' }, knowledgeBaseIds: { type: 'array', items: { type: 'integer' } } }),
    handler: async (input, context) => {
      const [resolved] = await agentContext.resolveAgentRefs(context.user.user_id, [{ agentId: input.agentId }], { assistantMode: context.assistantMode || 'general', courseId: context.courseId, subjectCode: context.subjectCode });
      const runtimeProvider = String(resolved.version.runtimeProvider || 'MODEL').toUpperCase();
      if (!new Set(['MODEL', 'DIFY_CHATFLOW', 'DIFY_WORKFLOW']).has(runtimeProvider)) throw Object.assign(new Error('该 Agent 运行时不支持从统一 AI 任务中心调用'), { code: 40301, status: 403 });
      const retrieval = await agentContext.resolveRetrieval(context.user.user_id, resolved.version, input.query, input.knowledgeBaseIds);
      const result = await agentRuntime.runAgent({
        version: resolved.version,
        userId: context.user.user_id,
        conversation: { difyConversationId: null },
        history: [],
        memories: [],
        question: input.query,
        records: retrieval.records || [],
        signal: context.signal,
        timeout: Math.max(30_000, Number(process.env.AI_AGENT_TIMEOUT_MS) || 150_000),
      });
      return { agentId: resolved.agent.id, agentName: resolved.version.name, content: String(result.content || ''), sources: standardizeKnowledgeSources(retrieval.records) };
    },
  });
  registry.register({
    name: 'create_docx_artifact', description: '将确认后的结构化内容生成真实 DOCX 文件并登记为成果。', roles: ['student', 'teacher', 'admin'], riskLevel: 'high', requiresConfirmation: true, idempotent: false, timeoutMs: 60000,
    inputSchema: z.object({ title: z.string().min(1).max(200), sections: z.array(z.object({ heading: z.string().max(200).default(''), content: z.string().max(30000) })).min(1).max(60) }),
    parameters: objectParameters({ title: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, content: { type: 'string' } }, required: ['content'], additionalProperties: false } } }),
    handler: async (input, context) => artifactService.serialize(await artifactService.createDocx(context, input)),
  });
  registry.register({
    name: 'create_xlsx_artifact', description: '将确认后的二维数据生成真实 XLSX 工作簿并登记为成果。', roles: ['student', 'teacher', 'admin'], riskLevel: 'high', requiresConfirmation: true, idempotent: false, timeoutMs: 60000,
    inputSchema: z.object({ title: z.string().min(1).max(200), sheetName: z.string().max(31).default('数据'), columns: z.array(z.string().max(200)).min(1).max(100), rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(100)).max(10000) }),
    parameters: objectParameters({ title: { type: 'string' }, sheetName: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: {} } } }),
    handler: async (input, context) => artifactService.serialize(await artifactService.createSpreadsheet(context, input)),
  });
  registry.register({
    name: 'create_chart_artifact', description: '把真实分析数据保存为可渲染的 ECharts 成果卡片。', roles: ['student', 'teacher', 'admin'], riskLevel: 'medium', idempotent: false,
    requiredInputs: ['spec.version', 'spec.chart.type', 'spec.chart.title', 'spec.chart.xAxis', 'spec.chart.series', 'spec.table', 'spec.source.type'],
    optionalInputs: ['spec.chart.subtitle', 'spec.chart.unit', 'spec.insights', 'spec.source.range'], outputTypes: ['chart_artifact', 'chart_spec', 'table'],
    inputSchema: chartToolInputSchema,
    normalizeInput: normalizeChartArguments,
    parameters: chartSpecParameters,
    handler: async (input, context) => artifactService.serialize(await artifactService.createChart(context, input)),
  });
  registry.register({
    name: 'create_knowledge_cards', description: '调用 Qwen3.7 Plus 基于课程来源生成严格 LearningCard 1.0 成果，而不是普通问答文本。', roles: ['student', 'teacher', 'admin'], riskLevel: 'medium', idempotent: false, timeoutMs: 150000,
    inputSchema: z.object({
      title: z.string().min(1).max(200), topic: z.string().min(2).max(500).optional(),
      count: z.number().int().min(1).max(8).default(5),
      cardTypes: z.array(z.enum(['CONCEPT', 'FORMULA', 'PITFALL', 'EXAMPLE', 'COMPARISON', 'WRONG_QUESTION', 'TASK', 'PROGRESS', 'REVIEW'])).min(1).max(8).optional(),
      courseId: z.number().int().positive().optional(), knowledgePointId: z.number().int().positive().optional(),
      includeChart: z.boolean().default(false),
      cards: z.array(z.object({ front: z.string().min(1).max(1000), back: z.string().min(1).max(5000) })).min(1).max(8).optional(),
    }).refine(value => value.topic || value.cards?.length, '必须提供卡片主题'),
    parameters: objectParameters({
      title: { type: 'string' }, topic: { type: 'string', description: '需要整理成学习卡片的主题' },
      count: { type: 'integer', minimum: 1, maximum: 8 },
      cardTypes: { type: 'array', items: { type: 'string', enum: ['CONCEPT', 'FORMULA', 'PITFALL', 'EXAMPLE', 'COMPARISON', 'WRONG_QUESTION', 'TASK', 'PROGRESS', 'REVIEW'] } },
      courseId: { type: 'integer' }, knowledgePointId: { type: 'integer' }, includeChart: { type: 'boolean' },
    }, ['title', 'topic', 'count']),
    handler: async (input, context) => {
      const learningCards = require('../learning-card/learning-card-ai.service');
      const generated = await learningCards.generateArtifact(context.user, {
        topic: input.topic || input.cards.map(card => card.front).join('、'), title: input.title,
        count: input.count || input.cards?.length || 5,
        cardTypes: input.cardTypes,
        courseId: input.courseId || context.courseId || undefined,
        knowledgePointId: input.knowledgePointId || context.knowledgePointId || undefined,
        learningGoal: context.query || '整理为可复习、可练习的学习卡片',
        includeChart: input.includeChart || /曲线|坐标轴|图表|sigmoid/i.test(input.topic || ''),
      }, { signal: context.signal });
      return { ...generated.artifact, cards: generated.cards, model: generated.model, promptVersion: generated.promptVersion };
    },
  });
  return registry;
}

module.exports = { buildRegistry, studentScope, objectParameters, chartSpecParameters, standardizeKnowledgeSources };
