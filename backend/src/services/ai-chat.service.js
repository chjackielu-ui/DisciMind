// 学科答疑小助手服务
// 独立于原有课程知识库问答，负责 DeepSeek 多轮会话与流式生成

const OpenAI = require('openai');
const prisma = require('../config/prisma');

const MISSING_API_KEY_MESSAGE = 'DeepSeek API Key 未配置，请先在 backend/.env 中填写 DEEPSEEK_API_KEY。';
const REFUSAL_REPLY = '我当前还没有掌握这个方面的知识哦，换个学习相关的问题试试吧。';

const SUBJECT_PROMPTS = {
  machine_learning: {
    label: '机器学习',
    prompt: '当前模式是“学科专属助手”，当前学科是“机器学习”。你需要优先围绕机器学习课程回答，包括监督学习、无监督学习、模型评估、特征工程、过拟合与欠拟合、决策树、逻辑回归、聚类、神经网络等内容。回答要适合课程学习和考试复习。',
  },
  operating_system: {
    label: '操作系统',
    prompt: '当前模式是“学科专属助手”，当前学科是“操作系统”。你需要优先围绕进程管理、线程、调度算法、死锁、PV 操作、内存管理、页面置换、文件系统、I/O 系统等内容回答。回答要适合考试复习，步骤清晰，易错点明确。',
  },
  web_frontend: {
    label: 'Web 前端',
    prompt: '当前模式是“学科专属助手”，当前学科是“Web 前端”。你需要围绕 HTML、CSS、JavaScript、DOM、事件、表单、布局、响应式页面和前端项目实践回答。解释代码时要适合初学者理解。',
  },
  probability: {
    label: '概率论',
    prompt: '当前模式是“学科专属助手”，当前学科是“概率论”。你需要围绕随机事件、条件概率、随机变量、常见分布、数字特征、大数定律、中心极限定理、参数估计和假设检验等内容回答。推导要分步骤，例题要说明考点。',
  },
  database: {
    label: '数据库',
    prompt: '当前模式是“学科专属助手”，当前学科是“数据库”。你需要围绕关系模型、SQL、范式、事务、并发控制、索引、查询优化、ER 图和数据库设计等内容回答。回答要兼顾课程考试和项目实践。',
  },
  computer_network: {
    label: '计算机网络',
    prompt: '当前模式是“学科专属助手”，当前学科是“计算机网络”。你需要围绕分层模型、TCP/IP、HTTP、DNS、拥塞控制、可靠传输、路由、交换、网络安全基础等内容回答。解释协议时要说明流程和易混点。',
  },
  software_engineering: {
    label: '软件工程',
    prompt: '当前模式是“学科专属助手”，当前学科是“软件工程”。你需要围绕需求分析、概要设计、详细设计、UML、测试、项目管理、敏捷开发、质量保障和维护等内容回答。回答要适合课程学习和项目实践。',
  },
};

const AGENT_PROMPTS = {
  knowledge_explain: {
    label: '知识点讲解 Agent',
    prompt: '当前 Agent 是“知识点讲解 Agent”。你的任务是把用户输入的知识点讲清楚。输出格式必须包含：\n1. 知识点定义\n2. 通俗解释\n3. 关键考点\n4. 示例说明\n5. 易错点\n6. 记忆方法',
  },
  wrong_question_analysis: {
    label: '错题解析 Agent',
    prompt: '当前 Agent 是“错题解析 Agent”。你的任务是帮助学生分析错题。输出格式必须包含：\n1. 本题考点\n2. 正确思路\n3. 详细解析\n4. 错误原因\n5. 易错提醒\n6. 举一反三',
  },
  study_path_planning: {
    label: '学习路径规划 Agent',
    prompt: '当前 Agent 是“学习路径规划 Agent”。你的任务是根据学生目标生成学习路径。输出格式必须包含：\n1. 当前学习目标\n2. 前置知识\n3. 学习顺序\n4. 每阶段任务\n5. 推荐练习\n6. 阶段检查方式',
  },
  review_plan: {
    label: '复习计划 Agent',
    prompt: '当前 Agent 是“复习计划 Agent”。你的任务是生成可执行复习计划。输出格式必须包含：\n1. 复习目标\n2. 重点内容\n3. 时间安排\n4. 每日任务\n5. 自测方式\n6. 复习建议',
  },
  coding_learning: {
    label: '编程学习 Agent',
    prompt: '当前 Agent 是“编程学习 Agent”。你的任务是帮助学生理解代码和编程题。输出格式必须包含：\n1. 题目理解\n2. 解题思路\n3. 关键代码\n4. 代码解释\n5. 复杂度分析\n6. 常见错误',
  },
};

const GENERAL_STARTER_QUESTIONS = [
  '帮我把今天学的知识整理成复习提纲',
  '用一个例子解释这个概念的核心思想',
  '这类题常见易错点有哪些？',
  '帮我制定一份本周学习计划',
];

const SUBJECT_STARTER_QUESTIONS = {
  machine_learning: [
    '用通俗例子解释过拟合和欠拟合',
    'PCA 降维的计算步骤是什么？',
    '如何选择模型评估指标？',
    '决策树剪枝为什么能缓解过拟合？',
  ],
  operating_system: [
    '进程和线程的区别是什么？',
    '银行家算法如何判断安全状态？',
    '页面置换算法有哪些易错点？',
    '死锁产生的四个必要条件是什么？',
  ],
  web_frontend: [
    '事件冒泡和事件捕获有什么区别？',
    'Flex 布局常用属性怎么记？',
    '为什么这段 JavaScript 输出 undefined？',
    '响应式页面设计要注意哪些断点？',
  ],
  probability: [
    '条件概率和贝叶斯公式怎么区分？',
    '常见分布的适用场景有哪些？',
    '中心极限定理应该怎么理解？',
    '数学期望和方差的题怎么做？',
  ],
  database: [
    '三大范式分别解决什么问题？',
    '事务 ACID 特性如何理解？',
    '索引为什么能提升查询效率？',
    'SQL 多表连接题怎么分析？',
  ],
  computer_network: [
    'TCP 三次握手每一步做什么？',
    'HTTP 和 HTTPS 的区别是什么？',
    '拥塞控制和流量控制怎么区分？',
    'DNS 查询过程如何描述？',
  ],
  software_engineering: [
    '需求分析阶段要产出哪些内容？',
    'UML 用例图应该怎么画？',
    '黑盒测试和白盒测试怎么区分？',
    '敏捷开发适合什么项目场景？',
  ],
};

const AGENT_STARTER_QUESTIONS = {
  knowledge_explain: [
    '请讲清楚这个知识点的定义和例子',
    '这个概念考试通常怎么考？',
    '帮我总结这个知识点的易错点',
    '用类比方式解释这个难点',
  ],
  wrong_question_analysis: [
    '帮我分析这道错题的考点',
    '这道题的正确解题思路是什么？',
    '我错在了哪一步？',
    '请给我一道同类巩固题',
  ],
  study_path_planning: [
    '帮我规划两周入门学习路线',
    '学这个主题需要哪些前置知识？',
    '每天应该完成哪些学习任务？',
    '如何检查每个阶段是否掌握？',
  ],
  review_plan: [
    '帮我制定一周期末复习计划',
    '哪些内容应该优先复习？',
    '如何安排错题和知识点复盘？',
    '每天如何做自测最有效？',
  ],
  coding_learning: [
    '请解释这段代码的执行过程',
    '这道编程题的解题思路是什么？',
    '代码报错的原因可能有哪些？',
    '如何优化这段代码的复杂度？',
  ],
};

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function toPrismaMode(mode) {
  const normalized = String(mode || 'general').toLowerCase();
  if (normalized === 'subject') return 'SUBJECT';
  if (normalized === 'agent') return 'AGENT';
  return 'GENERAL';
}

function toApiConversation(conversation, lastMessage = null, messageCount = null) {
  if (!conversation) return null;
  return {
    id: conversation.id,
    conversation_id: conversation.id,
    title: conversation.title || '新对话',
    mode: toLower(conversation.mode),
    subject: conversation.subject,
    subject_label: conversation.subject ? SUBJECT_PROMPTS[conversation.subject]?.label || conversation.subject : null,
    agent_type: conversation.agentType,
    agentType: conversation.agentType,
    agent_label: conversation.agentType ? AGENT_PROMPTS[conversation.agentType]?.label || conversation.agentType : null,
    last_message: lastMessage ? toApiMessage(lastMessage, true) : null,
    message_count: messageCount,
    created_at: conversation.createdAt ? conversation.createdAt.toISOString() : null,
    updated_at: conversation.updatedAt ? conversation.updatedAt.toISOString() : null,
  };
}

function toApiMessage(message, preview = false) {
  if (!message) return null;
  const content = message.content || '';
  return {
    id: message.id,
    message_id: message.id,
    role: toLower(message.role),
    content: preview ? content.slice(0, 100) + (content.length > 100 ? '...' : '') : content,
    content_preview: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
    created_at: message.createdAt ? message.createdAt.toISOString() : null,
  };
}

function normalizePayload(body = {}) {
  const mode = toPrismaMode(body.mode);
  const modeLower = toLower(mode);
  const title = String(body.title || '').trim() || '新对话';

  let subject = body.subject ? String(body.subject).trim() : null;
  let agentType = body.agentType || body.agent_type;
  agentType = agentType ? String(agentType).trim() : null;

  if (mode === 'SUBJECT') {
    if (!subject) subject = 'machine_learning';
    if (!SUBJECT_PROMPTS[subject]) {
      throw Object.assign(new Error('请选择有效的学科'), { code: 40001 });
    }
    agentType = null;
  } else if (mode === 'AGENT') {
    if (!agentType) agentType = 'knowledge_explain';
    if (!AGENT_PROMPTS[agentType]) {
      throw Object.assign(new Error('请选择有效的 Agent'), { code: 40001 });
    }
    subject = null;
  } else {
    subject = null;
    agentType = null;
  }

  return { mode, modeLower, subject, agentType, title };
}

function validateContent(content) {
  const text = String(content || '').trim();
  if (!text) {
    throw Object.assign(new Error('消息内容不能为空'), { code: 40001 });
  }
  if (text.length > 2000) {
    throw Object.assign(new Error('单次输入不能超过 2000 字'), { code: 40001 });
  }
  return text;
}

function normalizeStarterQuestions(list, fallback = GENERAL_STARTER_QUESTIONS) {
  const merged = [
    ...(Array.isArray(list) ? list : []),
    ...fallback,
  ];
  const seen = new Set();
  return merged
    .map((item) => String(item || '').replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter((item) => item.length >= 4 && item.length <= 80)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function parseStarterQuestions(content, fallback) {
  const text = String(content || '').trim();
  if (!text) return normalizeStarterQuestions([], fallback);

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : text;
  const candidates = [raw];
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const list = Array.isArray(parsed) ? parsed : parsed.questions;
      const questions = normalizeStarterQuestions(list, fallback);
      if (questions.length) return questions;
    } catch {
      // 继续尝试下一种解析方式
    }
  }

  const lineQuestions = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  return normalizeStarterQuestions(lineQuestions, fallback);
}

function getStarterFallback(payload) {
  if (payload.mode === 'SUBJECT') {
    return SUBJECT_STARTER_QUESTIONS[payload.subject] || GENERAL_STARTER_QUESTIONS;
  }
  if (payload.mode === 'AGENT') {
    return AGENT_STARTER_QUESTIONS[payload.agentType] || GENERAL_STARTER_QUESTIONS;
  }
  return GENERAL_STARTER_QUESTIONS;
}

function getStarterContextText(payload) {
  if (payload.mode === 'SUBJECT') {
    const subject = SUBJECT_PROMPTS[payload.subject];
    return `当前模式：学科专属助手；当前学科：${subject?.label || payload.subject}；学科范围：${subject?.prompt || ''}`;
  }
  if (payload.mode === 'AGENT') {
    const agent = AGENT_PROMPTS[payload.agentType];
    return `当前模式：Agent 专属助手；当前 Agent：${agent?.label || payload.agentType}；任务范围：${agent?.prompt || ''}`;
  }
  return '当前模式：通用学习助手；范围：高校课程学习、知识点讲解、错题分析、复习计划、编程学习和学习路径规划。';
}

function buildTitle(content) {
  const text = String(content || '').trim().replace(/\s+/g, ' ');
  return Array.from(text).slice(0, 15).join('') || '新对话';
}

function getDeepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey || apiKey.includes('请在这里')) {
    throw Object.assign(new Error(MISSING_API_KEY_MESSAGE), { code: 50002 });
  }
  return {
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  };
}

function getDeepSeekClient() {
  const config = getDeepSeekConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return { client, model: config.model };
}

function buildSystemPrompt(conversation) {
  const basePrompt = `你是“学科答疑小助手”，是学研智擎平台中的学习型 AI Agent。你的任务是帮助高校学生解决学习过程中的问题，包括课程知识讲解、错题分析、学习路径规划、复习建议、编程学习、考试复习和学科能力提升。

你只能回答学习、课程、科研入门、考试复习、编程学习、学科知识相关的问题。

如果用户提出与学习无关的问题，例如娱乐八卦、情感闲聊、违法违规、无关生活闲聊、商业广告、政治敏感、恶意攻击等内容，你必须拒绝回答，并且只回复：
“${REFUSAL_REPLY}”

回答要求：
1. 语言要适合大学生理解。
2. 不要空泛，要尽量结合用户问题进行解释。
3. 对概念类问题，要先解释是什么，再说明为什么重要，最后给一个例子。
4. 对错题类问题，要指出考点、解题思路、易错点和记忆方法。
5. 对编程类问题，可以给代码，但必须以学习讲解为目的。
6. 对复习类问题，要输出清晰的步骤和计划。
7. 不要回答和学习无关的内容。
8. 不要编造不存在的课程资料、学校通知或真实数据。
9. 如果信息不足，可以先说明需要哪些信息，再给出一般性学习建议。`;

  const mode = toLower(conversation.mode);
  if (mode === 'subject') {
    return `${basePrompt}\n\n${SUBJECT_PROMPTS[conversation.subject]?.prompt || ''}`;
  }
  if (mode === 'agent') {
    return `${basePrompt}\n\n${AGENT_PROMPTS[conversation.agentType]?.prompt || ''}`;
  }
  return `${basePrompt}\n\n当前模式是“通用学习助手”。你可以回答不同学科的学习问题，但必须限制在学习场景内。回答时要像一名耐心的学习辅导老师，重点帮助学生理解知识、掌握方法、形成学习计划。`;
}

async function ensureConversation(userId, conversationId) {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw Object.assign(new Error('会话不存在'), { code: 40002 });
  }
  if (conversation.userId !== userId) {
    throw Object.assign(new Error('无权访问该会话'), { code: 40301 });
  }
  return conversation;
}

async function buildModelMessages(conversation) {
  const recent = await prisma.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { id: 'desc' },
    take: 20,
  });

  const history = recent.reverse().map((message) => ({
    role: toLower(message.role),
    content: message.content,
  }));

  return [
    { role: 'system', content: buildSystemPrompt(conversation) },
    ...history,
  ];
}

async function createConversation(userId, body = {}) {
  const payload = normalizePayload(body);
  const conversation = await prisma.aiConversation.create({
    data: {
      userId,
      title: payload.title,
      mode: payload.mode,
      subject: payload.subject,
      agentType: payload.agentType,
    },
  });
  return toApiConversation(conversation, null, 0);
}

async function generateStarterQuestions(userId, query = {}) {
  if (!userId) {
    throw Object.assign(new Error('无法获取用户身份'), { code: 40101 });
  }

  const payload = normalizePayload({
    title: '建议问题',
    mode: query.mode,
    subject: query.subject,
    agentType: query.agentType || query.agent_type,
  });
  const fallback = getStarterFallback(payload);

  try {
    const { client, model } = getDeepSeekClient();
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.45,
      stream: false,
      messages: [
        {
          role: 'system',
          content: '你是“学科答疑小助手”的建议问题生成器。只输出 JSON 数组，不要解释，不要使用 Markdown 代码块。',
        },
        {
          role: 'user',
          content: `${getStarterContextText(payload)}

请生成 4 个中文建议提问，供学生直接点击发送。
要求：
1. 每个问题聚焦当前模式或学科内容。
2. 覆盖概念理解、易错点、练习方法、复习或应用。
3. 句子自然，长度不超过 32 个中文字符。
4. 只返回 JSON 数组，例如 ["问题1","问题2","问题3","问题4"]。`,
        },
      ],
    });
    const content = completion.choices?.[0]?.message?.content || '';
    return {
      questions: parseStarterQuestions(content, fallback),
      mode: payload.modeLower,
      subject: payload.subject,
      agent_type: payload.agentType,
      generated_by: 'ai',
    };
  } catch (err) {
    console.warn('[ai-chat.service] 建议问题生成失败，使用兜底问题:', err.message);
    return {
      questions: normalizeStarterQuestions([], fallback),
      mode: payload.modeLower,
      subject: payload.subject,
      agent_type: payload.agentType,
      generated_by: 'fallback',
    };
  }
}

async function listConversations(userId, query = {}) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.page_size, 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 30;
  if (pageSize > 100) pageSize = 100;

  const where = { userId };
  if (query.mode) where.mode = toPrismaMode(query.mode);

  const [conversations, total] = await Promise.all([
    prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        messages: {
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.aiConversation.count({ where }),
  ]);

  let countMap = new Map();
  if (conversations.length) {
    const counts = await prisma.aiMessage.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: conversations.map((item) => item.id) } },
      _count: { _all: true },
    });
    countMap = new Map(counts.map((item) => [item.conversationId, item._count._all]));
  }

  return {
    list: conversations.map((conversation) => toApiConversation(
      conversation,
      conversation.messages[0] || null,
      countMap.get(conversation.id) || 0,
    )),
    total,
    page,
    page_size: pageSize,
  };
}

async function getMessages(userId, conversationId) {
  const conversation = await ensureConversation(userId, conversationId);
  const messages = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { id: 'asc' },
  });

  return {
    conversation: toApiConversation(conversation, null, messages.length),
    messages: messages.map((message) => toApiMessage(message)),
  };
}

async function prepareTurn(userId, conversationId, body = {}) {
  const regenerate = Boolean(body.regenerate);
  let conversation = await ensureConversation(userId, conversationId);
  let userMessage = null;

  if (regenerate) {
    userMessage = await prisma.aiMessage.findFirst({
      where: { conversationId, role: 'USER' },
      orderBy: { id: 'desc' },
    });
    if (!userMessage) {
      throw Object.assign(new Error('当前会话没有可重新生成的问题'), { code: 40001 });
    }
    await prisma.aiMessage.deleteMany({
      where: {
        conversationId,
        role: 'ASSISTANT',
        id: { gt: userMessage.id },
      },
    });
  } else {
    const content = validateContent(body.content);
    const previousUserCount = await prisma.aiMessage.count({
      where: { conversationId, role: 'USER' },
    });
    userMessage = await prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'USER',
        content,
      },
    });
    const updateData = { updatedAt: new Date() };
    if (previousUserCount === 0 && (!conversation.title || conversation.title === '新对话')) {
      updateData.title = buildTitle(content);
    }
    conversation = await prisma.aiConversation.update({
      where: { id: conversationId },
      data: updateData,
    });
  }

  const messages = await buildModelMessages(conversation);
  return {
    conversation,
    userMessage: regenerate ? null : userMessage,
    messages,
  };
}

async function callCompletion(messages) {
  const { client, model } = getDeepSeekClient();
  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      stream: false,
      temperature: 0.7,
    });
    return completion.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[ai-chat.service] DeepSeek 非流式调用失败:', err.message);
    throw Object.assign(new Error('AI 服务调用失败，请稍后再试'), { code: 50002 });
  }
}

async function createCompletionStream(messages, signal) {
  const { client, model } = getDeepSeekClient();
  try {
    return await client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
        temperature: 0.7,
      },
      { signal },
    );
  } catch (err) {
    console.error('[ai-chat.service] DeepSeek 流式调用失败:', err.message);
    throw Object.assign(new Error('AI 服务调用失败，请稍后再试'), { code: 50002 });
  }
}

async function finalizeAssistantMessage(conversationId, content) {
  const safeContent = String(content || '').trim() || 'AI 没有返回有效内容，请稍后重试。';
  const assistantMessage = await prisma.aiMessage.create({
    data: {
      conversationId,
      role: 'ASSISTANT',
      content: safeContent,
    },
  });
  const conversation = await prisma.aiConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return {
    assistantMessage: toApiMessage(assistantMessage),
    conversation: toApiConversation(conversation),
  };
}

async function sendMessage(userId, conversationId, body = {}) {
  getDeepSeekConfig();
  const turn = await prepareTurn(userId, conversationId, body);
  const content = await callCompletion(turn.messages);
  const result = await finalizeAssistantMessage(conversationId, content);

  return {
    conversation: result.conversation,
    user_message: toApiMessage(turn.userMessage),
    assistant_message: result.assistantMessage,
  };
}

async function clearMessages(userId, conversationId) {
  await ensureConversation(userId, conversationId);
  await prisma.aiMessage.deleteMany({ where: { conversationId } });
  const conversation = await prisma.aiConversation.update({
    where: { id: conversationId },
    data: {
      title: '新对话',
      updatedAt: new Date(),
    },
  });
  return toApiConversation(conversation, null, 0);
}

async function deleteConversation(userId, conversationId) {
  await ensureConversation(userId, conversationId);
  await prisma.aiConversation.delete({ where: { id: conversationId } });
  return { deleted: true, conversation_id: conversationId, id: conversationId };
}

module.exports = {
  SUBJECT_PROMPTS,
  AGENT_PROMPTS,
  MISSING_API_KEY_MESSAGE,
  REFUSAL_REPLY,
  toApiConversation,
  toApiMessage,
  getDeepSeekConfig,
  createConversation,
  generateStarterQuestions,
  listConversations,
  getMessages,
  prepareTurn,
  createCompletionStream,
  finalizeAssistantMessage,
  sendMessage,
  clearMessages,
  deleteConversation,
};
