const FILE_NOUN_RE = /(?:试卷|考卷|练习卷|测验卷|讲义|复习资料|学习资料|word|docx|pdf|excel|xlsx|文件|文档)/iu;
const FILE_ACTION_RE = /(?:生成|制作|创建|导出|下载|做一份|出一份|整理成|保存为|给我一份|帮我(?:做|生成|制作))/iu;
const FILE_CAPABILITY_RE = /(?:(?:你|系统|助手|平台)?\s*(?:可以|能否|能不能|能|会不会|会|是否支持|支持|有没有|具备).{0,16}(?:生成|制作|创建|导出|下载).{0,16}(?:文件|文档|word|docx|pdf|excel|xlsx)|(?:支持|可以|能).{0,12}(?:哪些|什么).{0,8}(?:文件|文档|格式)|(?:文件|文档).{0,8}(?:生成|导出).{0,8}(?:能力|功能))/iu;
const EXPLICIT_FILE_REQUEST_RE = /(?:帮我|替我|为我|给我).{0,16}(?:生成|制作|创建|导出|做|出|整理)|^(?:请|现在|立即|马上|开始|直接)?\s*(?:给我)?\s*(?:生成|制作|创建|导出|做一份|出一份|整理成|保存为)/iu;
const CHAT_ONLY_RE = /(?:不|不要|无需|不需要|禁止)(?:再)?(?:生成|导出|创建|保存)?(?:任何)?(?:文件|文档|word|docx|pdf)|(?:仅|只)(?:在)?对话(?:中|里)(?:回答|展示|预览|出题)|不要下载|不生成文件/iu;
const EXAM_RE = /(?:试卷|考卷|练习卷|测验卷|期末|期中|考试题)/iu;
const HANDOUT_RE = /(?:讲义|复习资料|学习资料|知识梳理)/iu;
const GREETING_RE = /^(?:你好|您好|嗨|哈喽|hello|hi|早上好|下午好|晚上好|在吗|谢谢|多谢)[。！？!?.\s]*$/iu;
const CHAT_QUESTION_RE = /(?:在对话中|不要生成文件|不生成文件|只(?:在)?这里).*(?:出|生成|给).*(?:道|个)?(?:题|练习)|(?:出|生成|给)(?:我)?\s*[一二三四五六七八九十\d]+\s*道?(?:题|练习).*(?:不要生成文件|不生成文件|在对话中)/iu;
const KNOWLEDGE_RE = /(?:知识库|课程资料|教材|讲义内容|引用资料|根据资料|结合.*资料)/iu;
const CONCEPT_RE = /(?:是什么|什么是|解释|原理|为什么|如何理解|举例|例题|推导|证明|区别|逻辑回归|线性回归|神经网络|注意力机制|机器学习)/iu;
const REALTIME_RE = /(?:今天|刚刚|最新|实时|新闻|热点|天气|价格|汇率|版本发布|近况)/iu;
const UPLOAD_RE = /(?:上传|附件|这份|这个).*(?:pdf|文档|文件|图片|截图).*(?:总结|概括|分析|提取|解释)|(?:总结|概括|分析|提取).*(?:上传|附件|pdf|文档)/iu;

const EXECUTION_MODES = Object.freeze({
  DIRECT_RESPONSE: 'DIRECT_RESPONSE', TOOL_ONLY: 'TOOL_ONLY', KNOWLEDGE_ONLY: 'KNOWLEDGE_ONLY',
  WEB_SEARCH: 'WEB_SEARCH', SINGLE_AGENT: 'SINGLE_AGENT', MULTI_AGENT: 'MULTI_AGENT',
  ARTIFACT_GENERATION: 'ARTIFACT_GENERATION', LEARNING_ANALYTICS: 'LEARNING_ANALYTICS',
  COMPLEX_WORKFLOW: 'COMPLEX_WORKFLOW',
});

const INTENTS = Object.freeze({
  GREETING: 'direct_conversation', CONTEXT: 'student_context', WRONG: 'student_wrong_questions',
  RECORDS: 'student_learning_records', SCORE: 'student_score_trend', MASTERY: 'student_mastery',
  SESSIONS: 'student_recent_sessions', TIME: 'student_learning_time', TASKS: 'student_task_completion',
  ANALYTICS: 'student_learning_analytics', FILE: 'file_generation', CHAT_QUESTIONS: 'chat_question_generation',
  FILE_CAPABILITY: 'file_generation_capability',
  CARDS: 'knowledge_cards', KNOWLEDGE: 'course_knowledge_qa', CONCEPT: 'course_concept_qa',
  WEB: 'realtime_research', ATTACHMENT: 'attachment_summary', MANUAL_AGENT: 'manual_agent', QA: 'learning_qa',
});

function detectFileIntent(query) {
  const text = String(query || '');
  const negative = CHAT_ONLY_RE.test(text);
  const noun = FILE_NOUN_RE.test(text);
  const action = FILE_ACTION_RE.test(text);
  const capabilityQuestion = FILE_CAPABILITY_RE.test(text) && !EXPLICIT_FILE_REQUEST_RE.test(text);
  const exam = EXAM_RE.test(text);
  const handout = HANDOUT_RE.test(text);
  const confidence = negative || capabilityQuestion ? 0 : noun && action ? 0.99 : exam && /(?:生成|出题|来一份|帮我)/iu.test(text) ? 0.94 : 0;
  return {
    matched: confidence >= 0.9,
    confidence,
    negative,
    artifactType: exam ? 'EXAM_PAPER' : handout ? 'STUDY_HANDOUT' : /(?:excel|xlsx|表格)/iu.test(text) ? 'AI_SPREADSHEET' : 'AI_DOCUMENT',
    outputFormats: [/(?:pdf)/iu.test(text) ? 'PDF' : /(?:excel|xlsx)/iu.test(text) ? 'XLSX' : 'DOCX'],
    capabilityQuestion,
    evidence: { noun, action, exam, handout, chatOnly: negative, capabilityQuestion, explicitRequest: EXPLICIT_FILE_REQUEST_RE.test(text) },
  };
}

function route(kind, confidence, file, options = {}) {
  return {
    kind, confidence, file, tools: options.tools || [], skillIds: options.skillIds || [],
    executionMode: options.executionMode || EXECUTION_MODES.DIRECT_RESPONSE,
    deterministic: options.deterministic !== false,
    subjectAgentAllowed: options.subjectAgentAllowed === true,
    requiresKnowledgeBase: options.requiresKnowledgeBase === true,
    attachmentRequired: options.attachmentRequired === true,
    chartRequested: options.chartRequested === true,
    reason: options.reason || kind,
  };
}

function classifyLearningIntent(query, role, context = {}) {
  const text = String(query || '').trim();
  const normalizedRole = String(role || '').toLowerCase();
  const file = detectFileIntent(text);
  const manualAgentCount = Math.max(0, Number(context.manualAgentCount || context.manualAgents?.length || 0));
  const attachmentCount = Math.max(0, Number(context.attachmentCount || context.attachments?.length || 0));
  const knowledgeBaseCount = Math.max(0, Number(context.knowledgeBaseCount || context.knowledgeBaseIds?.length || 0));
  const chartRequested = shouldCreateChart(text, { kind: null });

  if (file.capabilityQuestion) return route(INTENTS.FILE_CAPABILITY, 0.99, file, {
    executionMode: EXECUTION_MODES.DIRECT_RESPONSE, reason: 'file_capability_question',
  });
  if (manualAgentCount > 0) return route(INTENTS.MANUAL_AGENT, 1, file, {
    executionMode: manualAgentCount > 1 ? EXECUTION_MODES.MULTI_AGENT : EXECUTION_MODES.SINGLE_AGENT,
    skillIds: [], subjectAgentAllowed: true, reason: 'manual_agent_selection',
  });
  if (file.matched) return route(INTENTS.FILE, file.confidence, file, {
    executionMode: EXECUTION_MODES.ARTIFACT_GENERATION, skillIds: ['artifact_generation'], reason: 'explicit_downloadable_artifact',
  });
  if (CHAT_QUESTION_RE.test(text) || (file.negative && /(?:出题|道题|练习题|问题)/iu.test(text))) {
    return route(INTENTS.CHAT_QUESTIONS, 0.99, file, {
      executionMode: EXECUTION_MODES.DIRECT_RESPONSE, skillIds: ['chat_question_generation'], reason: 'chat_only_question_generation',
    });
  }
  if (attachmentCount > 0 || UPLOAD_RE.test(text)) return route(INTENTS.ATTACHMENT, attachmentCount > 0 ? 0.99 : 0.86, file, {
    executionMode: EXECUTION_MODES.DIRECT_RESPONSE, skillIds: ['attachment_summary'], attachmentRequired: attachmentCount === 0,
    reason: attachmentCount > 0 ? 'uploaded_attachment_available' : 'attachment_reference_without_attachment',
  });
  if (GREETING_RE.test(text)) return route(INTENTS.GREETING, 0.99, file, { reason: 'simple_greeting' });

  if (normalizedRole === 'student') {
    if (/(?:错题|错题本|做错|错误题)/iu.test(text)) return route(INTENTS.WRONG, 0.99, file, {
      tools: ['get_student_wrong_questions'], skillIds: ['student_learning_analytics'], executionMode: EXECUTION_MODES.TOOL_ONLY,
    });
    if (/(?:成绩|得分|分数|正确率|考试表现)/iu.test(text)) return route(INTENTS.SCORE, 0.98, file, {
      tools: ['get_student_score_trend'], skillIds: ['student_learning_analytics'],
      executionMode: chartRequested ? EXECUTION_MODES.LEARNING_ANALYTICS : EXECUTION_MODES.TOOL_ONLY, chartRequested,
    });
    if (/(?:掌握度|知识点掌握|薄弱知识点|薄弱点|掌握情况)/iu.test(text)) return route(INTENTS.MASTERY, 0.98, file, {
      tools: ['get_student_mastery'], skillIds: ['student_learning_analytics'],
      executionMode: chartRequested ? EXECUTION_MODES.LEARNING_ANALYTICS : EXECUTION_MODES.TOOL_ONLY, chartRequested,
    });
    if (/(?:学习时长|学习时间|学了多久|投入时间)/iu.test(text)) return route(INTENTS.TIME, 0.98, file, {
      tools: ['get_student_learning_time'], skillIds: ['student_learning_analytics'],
      executionMode: chartRequested ? EXECUTION_MODES.LEARNING_ANALYTICS : EXECUTION_MODES.TOOL_ONLY, chartRequested,
    });
    if (/(?:任务完成|完成率|作业完成|未完成任务|待完成任务)/iu.test(text)) return route(INTENTS.TASKS, 0.98, file, {
      tools: ['get_student_task_completion'], skillIds: ['student_learning_analytics'],
      executionMode: chartRequested ? EXECUTION_MODES.LEARNING_ANALYTICS : EXECUTION_MODES.TOOL_ONLY, chartRequested,
    });
    if (/(?:最近|近期).*(?:学习会话|学习流|练习记录|练习会话)|(?:学习会话|学习流).*(?:最近|近期)/iu.test(text)) return route(INTENTS.SESSIONS, 0.96, file, {
      tools: ['get_student_recent_sessions'], skillIds: ['student_learning_analytics'], executionMode: EXECUTION_MODES.TOOL_ONLY,
    });
    if (/(?:学习记录|学习行为|学习轨迹|最近学了什么)/iu.test(text)) return route(INTENTS.RECORDS, 0.96, file, {
      tools: ['get_student_learning_records'], skillIds: ['student_learning_analytics'], executionMode: EXECUTION_MODES.TOOL_ONLY,
    });
    if (/(?:当前课程|我的课程|当前知识点|学习上下文)/iu.test(text)) return route(INTENTS.CONTEXT, 0.95, file, {
      tools: ['get_current_student_context'], skillIds: ['student_learning_analytics'], executionMode: EXECUTION_MODES.TOOL_ONLY,
    });
    if (/(?:学习状态|学习情况|学习表现|学习数据|学情)/iu.test(text)) return route(INTENTS.ANALYTICS, 0.96, file, {
      tools: ['get_student_mastery'], skillIds: ['student_learning_analytics'],
      executionMode: chartRequested ? EXECUTION_MODES.LEARNING_ANALYTICS : EXECUTION_MODES.TOOL_ONLY, chartRequested,
    });
  }

  if (knowledgeBaseCount > 0 || KNOWLEDGE_RE.test(text)) return route(INTENTS.KNOWLEDGE, 0.96, file, {
    executionMode: EXECUTION_MODES.SINGLE_AGENT, skillIds: ['knowledge_explain'], subjectAgentAllowed: true,
    requiresKnowledgeBase: true, reason: knowledgeBaseCount ? 'selected_knowledge_base' : 'explicit_knowledge_base_request',
  });
  if (REALTIME_RE.test(text)) return route(INTENTS.WEB, 0.97, file, {
    executionMode: EXECUTION_MODES.WEB_SEARCH, skillIds: ['realtime_research'], reason: 'realtime_information_request',
  });
  if (/(?:知识卡片|闪卡|复习卡)/iu.test(text)) return route(INTENTS.CARDS, 0.94, file, {
    executionMode: EXECUTION_MODES.ARTIFACT_GENERATION, skillIds: ['knowledge_cards'],
  });
  if (CONCEPT_RE.test(text)) return route(INTENTS.CONCEPT, 0.82, file, {
    executionMode: EXECUTION_MODES.SINGLE_AGENT, skillIds: ['knowledge_explain'], subjectAgentAllowed: true,
    reason: 'course_concept_question',
  });
  return route(INTENTS.QA, 0.5, file, { deterministic: false, reason: 'semantic_planning_required' });
}

function shouldCreateChart(query, intent = {}) {
  const text = String(query || '');
  if (/(?:不要|无需|不需要)(?:图表|可视化)|只要文字/iu.test(text)) return false;
  return /(?:图表|可视化|趋势|变化|分布|对比|走势)/iu.test(text)
    || [INTENTS.SCORE, INTENTS.MASTERY, INTENTS.ANALYTICS].includes(intent.kind);
}

module.exports = {
  FILE_NOUN_RE, FILE_ACTION_RE, FILE_CAPABILITY_RE, EXPLICIT_FILE_REQUEST_RE, CHAT_ONLY_RE, EXAM_RE, HANDOUT_RE, GREETING_RE,
  EXECUTION_MODES, INTENTS, detectFileIntent, classifyLearningIntent, shouldCreateChart,
};
