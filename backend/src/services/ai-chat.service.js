// 学科答疑小助手服务：百炼 qwen3.7-plus 多轮、多模态与流式生成。

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../config/prisma');
const {
  MISSING_API_KEY_MESSAGE,
  getBailianConfig,
  getBailianClient,
  buildChatCompletionParams,
  mapBailianError,
} = require('./bailian-openai.service');
const agentContextService = require('../modules/agent-chat/agent-context.service');
const attachmentService = require('./ai-chat-attachment.service');

const REFUSAL_REPLY = '我当前还没有掌握这个方面的知识哦，换个学习相关的问题试试吧。';
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
const CHAT_UPLOAD_DIR = path.resolve(__dirname, '../../storage/uploads/ai-chat');
const IMAGE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

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
    attachments: (Array.isArray(message.attachments) ? message.attachments : []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: `/api/ai-chat/conversations/${message.conversationId}/messages/${message.id}/attachments/${attachment.id}`,
    })),
    knowledgeBaseRefs: Array.isArray(message.knowledgeBaseRefsJson) ? message.knowledgeBaseRefsJson : [],
    agentRefs: Array.isArray(message.agentRefsJson) ? message.agentRefsJson : [],
    sources: Array.isArray(message.sourcesJson) ? message.sourcesJson : [],
    agentInvocations: (Array.isArray(message.marketplaceAgentInvocations) ? message.marketplaceAgentInvocations : []).map((invocation) => ({
      id: invocation.id,
      agentId: invocation.agentId,
      agentName: invocation.agent?.currentDraftVersion?.name || invocation.agent?.currentPublicVersion?.name || `智能体 ${invocation.agentId}`,
      sequence: invocation.sequence,
      status: invocation.status,
      output: preview ? undefined : invocation.outputText,
      errorMessage: invocation.errorMessage,
      durationMs: invocation.durationMs,
      taskIds: Array.isArray(invocation.taskIdsJson) ? invocation.taskIdsJson : [],
      artifactIds: Array.isArray(invocation.artifactIdsJson) ? invocation.artifactIdsJson : [],
      artifacts: Array.isArray(invocation.artifacts) ? invocation.artifacts : [],
      startedAt: invocation.startedAt,
      completedAt: invocation.completedAt,
    })),
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

function validateContent(content, { allowEmpty = false } = {}) {
  const text = String(content || '').trim();
  if (!text && !allowEmpty) {
    throw Object.assign(new Error('消息内容不能为空'), { code: 40001 });
  }
  if (text.length > 2000) {
    throw Object.assign(new Error('单次输入不能超过 2000 字'), { code: 40001 });
  }
  return text;
}

function normalizeImageInputs(images) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw Object.assign(new Error('图片参数格式不合法'), { code: 40001 });
  if (images.length > MAX_IMAGE_COUNT) throw Object.assign(new Error(`单次最多上传 ${MAX_IMAGE_COUNT} 张图片`), { code: 40001 });

  let totalBytes = 0;
  return images.map((image, index) => {
    const dataUrl = String(image?.dataUrl || image?.data_url || '');
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw Object.assign(new Error(`第 ${index + 1} 张图片格式不支持`), { code: 40001 });
    const mimeType = match[1].toLowerCase();
    if (!IMAGE_TYPES[mimeType]) throw Object.assign(new Error(`第 ${index + 1} 张图片格式不支持`), { code: 40001 });
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error(`每张图片不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB`), { code: 40001 });
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw Object.assign(new Error('图片总大小不能超过 12MB'), { code: 40001 });
    return {
      id: crypto.randomUUID(),
      name: String(image?.name || `image-${index + 1}.${IMAGE_TYPES[mimeType]}`).slice(0, 180),
      mimeType,
      extension: IMAGE_TYPES[mimeType],
      size: buffer.length,
      buffer,
    };
  });
}

async function persistImageInputs(images) {
  const normalized = normalizeImageInputs(images);
  if (!normalized.length) return [];
  await fs.mkdir(CHAT_UPLOAD_DIR, { recursive: true });
  const saved = [];
  try {
    for (const image of normalized) {
      const fileName = `${Date.now()}_${crypto.randomBytes(12).toString('hex')}.${image.extension}`;
      await fs.writeFile(path.join(CHAT_UPLOAD_DIR, fileName), image.buffer, { flag: 'wx' });
      saved.push({ id: image.id, name: image.name, mimeType: image.mimeType, size: image.size, fileName });
    }
    return saved;
  } catch (error) {
    await Promise.all(saved.map((item) => fs.unlink(path.join(CHAT_UPLOAD_DIR, item.fileName)).catch(() => null)));
    throw error;
  }
}

async function removePersistedAttachments(attachments) {
  await Promise.all((attachments || []).map((item) => fs.unlink(path.join(CHAT_UPLOAD_DIR, item.fileName)).catch(() => null)));
}

async function attachmentToDataUrl(attachment) {
  try {
    const data = await fs.readFile(path.join(CHAT_UPLOAD_DIR, path.basename(String(attachment.fileName || ''))));
    return `data:${attachment.mimeType};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
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
    take: 16,
  });

  // 只重复加载最近四张图片，控制视觉 token 和首字延迟；文本历史仍完整保留。
  let imageBudget = 4;
  const includedAttachmentIds = new Set();
  for (const message of recent) {
    for (const attachment of (Array.isArray(message.attachments) ? message.attachments : [])) {
      if (imageBudget <= 0) break;
      includedAttachmentIds.add(attachment.id);
      imageBudget -= 1;
    }
  }
  const uploadedIds = [...new Set(recent.flatMap(message => (Array.isArray(message.attachments) ? message.attachments : []).map(item => item.id)).filter(Boolean))];
  const uploadedRows = uploadedIds.length ? await prisma.aiChatAttachment.findMany({ where: { id: { in: uploadedIds }, userId: conversation.userId, status: 'READY' } }) : [];
  const uploadedById = new Map(uploadedRows.map(row => [row.id, row]));
  const history = await Promise.all(recent.reverse().map(async (message) => {
    const attachments = (Array.isArray(message.attachments) ? message.attachments : [])
      .filter((attachment) => includedAttachmentIds.has(attachment.id));
    if (toLower(message.role) !== 'user' || !attachments.length) {
      return { role: toLower(message.role), content: message.content };
    }
    const uploaded = attachments.map(item => uploadedById.get(item.id)).filter(Boolean);
    const textContext = uploaded.filter(item => item.extractedText).map(item => `\n\n[附件：${item.fileName}]\n${item.extractedText}`).join('');
    const imageParts = (await Promise.all(attachments.filter(item => {
      const record = uploadedById.get(item.id);
      return record ? record.mimeType.startsWith('image/') : true;
    }).map(async (attachment) => {
      const record = uploadedById.get(attachment.id);
      let url;
      if (record) {
        const data = await fs.readFile(attachmentService.absolutePath(record)).catch(() => null);
        url = data ? `data:${record.mimeType};base64,${data.toString('base64')}` : null;
      } else url = await attachmentToDataUrl(attachment);
      return url ? { type: 'image_url', image_url: { url } } : null;
    }))).filter(Boolean);
    return {
      role: 'user',
      content: [
        { type: 'text', text: `${message.content || '请分析这些附件。'}${textContext}` },
        ...imageParts,
      ],
    };
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

  // 建议问题是固定教学入口，直接返回经过策划的本地内容，避免页面加载时额外等待一次模型调用。
  return {
    questions: normalizeStarterQuestions([], fallback),
    mode: payload.modeLower,
    subject: payload.subject,
    agent_type: payload.agentType,
    generated_by: 'curated',
  };
}

async function listConversations(userId, query = {}) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.page_size, 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 30;
  if (pageSize > 100) pageSize = 100;

  const where = { userId };
  if (query.mode) where.mode = toPrismaMode(query.mode);
  if (query.subject) where.subject = String(query.subject);
  if (query.agentType || query.agent_type) where.agentType = String(query.agentType || query.agent_type);
  if (query.search || query.q) where.title = { contains: String(query.search || query.q).trim() };
  if (query.dateFrom || query.date_from || query.dateTo || query.date_to) {
    where.updatedAt = {};
    const from = new Date(query.dateFrom || query.date_from || '');
    const to = new Date(query.dateTo || query.date_to || '');
    if (!Number.isNaN(from.getTime())) where.updatedAt.gte = from;
    if (!Number.isNaN(to.getTime())) where.updatedAt.lte = to;
    if (!Object.keys(where.updatedAt).length) delete where.updatedAt;
  }

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
    include: {
      marketplaceAgentInvocations: {
        orderBy: { sequence: 'asc' },
        include: { agent: { include: { currentDraftVersion: true, currentPublicVersion: true } } },
      },
    },
  });
  const artifactIds = [...new Set(messages.flatMap(message => (message.marketplaceAgentInvocations || [])
    .flatMap(invocation => Array.isArray(invocation.artifactIdsJson) ? invocation.artifactIdsJson.map(Number) : [])).filter(Number.isInteger))];
  const artifacts = artifactIds.length ? await prisma.generatedArtifact.findMany({
    where: { ownerUserId: Number(userId), deletedAt: null, OR: [{ id: { in: artifactIds } }, { parentArtifactId: { in: artifactIds } }] },
    include: { exports: { where: { deletedAt: null } } },
  }) : [];
  const artifactById = new Map(artifacts.map(artifact => [artifact.id, {
    id: artifact.id,
    parentArtifactId: artifact.parentArtifactId,
    artifactRole: artifact.artifactRole,
    title: artifact.title,
    artifactType: artifact.artifactType,
    fileName: artifact.fileName,
    fileFormat: artifact.fileFormat,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.fileSizeBytes == null ? null : Number(artifact.fileSizeBytes),
    status: artifact.status,
    createdAt: artifact.createdAt,
    previewable: Boolean(artifact.previewHtml || artifact.status === 'READY'),
    downloads: artifact.exports.filter(item => item.status === 'READY' && item.storagePath).map(item => ({
      format: item.format, sizeBytes: item.fileSizeBytes == null ? null : Number(item.fileSizeBytes),
    })),
  }]));
  messages.forEach(message => (message.marketplaceAgentInvocations || []).forEach(invocation => {
    const roots = (Array.isArray(invocation.artifactIdsJson) ? invocation.artifactIdsJson : []).map(Number);
    invocation.artifacts = artifacts.filter(artifact => roots.includes(artifact.id) || roots.includes(artifact.parentArtifactId)).map(artifact => artifactById.get(artifact.id)).filter(Boolean);
  }));

  return {
    conversation: toApiConversation(conversation, null, messages.length),
    messages: messages.map((message) => toApiMessage(message)),
  };
}

async function prepareTurn(userId, conversationId, body = {}) {
  const regenerate = Boolean(body.regenerate);
  const assistantSurface = body.assistantSurface === 'floating' ? 'floating' : 'full';
  const maxOutputTokens = assistantSurface === 'floating'
    ? Math.max(128, Number(process.env.FLOATING_ASSISTANT_MAX_OUTPUT_TOKENS || 800))
    : Math.max(512, Number(process.env.FULL_ASSISTANT_MAX_OUTPUT_TOKENS || 2200));
  let conversation = await ensureConversation(userId, conversationId);
  let userMessage = null;
  let resolvedKnowledgeBases = [];
  let resolvedAgentRefs = [];
  const agentCallOptions = {
    allowFileGenerator: true,
    assistantMode: body.assistantMode || toLower(conversation.mode),
    courseId: body.courseId || body.course_id || body.learningContext?.courseId,
    subjectCode: body.subjectCode || body.subject || conversation.subject,
  };

  if (regenerate) {
    userMessage = await prisma.aiMessage.findFirst({
      where: { conversationId, role: 'USER' },
      orderBy: { id: 'desc' },
    });
    if (!userMessage) {
      throw Object.assign(new Error('当前会话没有可重新生成的问题'), { code: 40001 });
    }
    [resolvedKnowledgeBases, resolvedAgentRefs] = await Promise.all([
      agentContextService.resolveKnowledgeBaseRefs(userId, userMessage.knowledgeBaseRefsJson || []),
      agentContextService.resolveAgentRefs(userId, userMessage.agentRefsJson || [], agentCallOptions),
    ]);
    await prisma.aiMessage.deleteMany({
      where: {
        conversationId,
        role: 'ASSISTANT',
        id: { gt: userMessage.id },
      },
    });
  } else {
    const images = Array.isArray(body.images) ? body.images : [];
    const uploaded = await attachmentService.resolveForTurn(userId, conversationId, Array.isArray(body.attachments) ? body.attachments : []);
    const content = validateContent(body.content, { allowEmpty: images.length > 0 || uploaded.length > 0 });
    if (!content && !images.length && !uploaded.length) throw Object.assign(new Error('请输入文字或添加附件'), { code: 40001 });
    [resolvedKnowledgeBases, resolvedAgentRefs] = await Promise.all([
      agentContextService.resolveKnowledgeBaseRefs(userId, body.knowledgeBaseRefs || []),
      agentContextService.resolveAgentRefs(userId, body.agentRefs || [], agentCallOptions),
    ]);
    const previousUserCount = await prisma.aiMessage.count({
      where: { conversationId, role: 'USER' },
    });
    const attachments = [
      ...await persistImageInputs(images),
      ...uploaded.map(item => attachmentService.api(item)),
    ];
    try {
      userMessage = await prisma.aiMessage.create({
        data: {
          conversationId,
          role: 'USER',
          content,
          attachments: attachments.length ? attachments : undefined,
          knowledgeBaseRefsJson: agentContextService.normalizedKnowledgeRefs(resolvedKnowledgeBases),
          agentRefsJson: agentContextService.normalizedAgentRefs(resolvedAgentRefs),
        },
      });
      await attachmentService.bindMessage(uploaded.map(item => item.id), userMessage.id);
    } catch (error) {
      await removePersistedAttachments(attachments);
      throw error;
    }
    const updateData = { updatedAt: new Date() };
    if (previousUserCount === 0 && (!conversation.title || conversation.title === '新对话')) {
      updateData.title = buildTitle(content || '图片问答');
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
    knowledgeBaseRefs: agentContextService.normalizedKnowledgeRefs(resolvedKnowledgeBases),
    resolvedKnowledgeBases,
    resolvedAgentRefs,
    assistantSurface,
    maxOutputTokens,
  };
}

async function callCompletion(messages, options = {}) {
  const { client } = getBailianClient();
  try {
    const completion = await client.chat.completions.create(buildChatCompletionParams({
      messages, stream: false, temperature: 0.55, maxTokens: options.maxOutputTokens || 2200,
    }));
    return completion.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[ai-chat.service] 百炼非流式调用失败:', err.message);
    throw mapBailianError(err);
  }
}

async function createCompletionStream(messages, signal, options = {}) {
  const { client } = getBailianClient();
  try {
    return await client.chat.completions.create(
      buildChatCompletionParams({ messages, stream: true, temperature: 0.55, maxTokens: options.maxOutputTokens || 2200 }),
      { signal },
    );
  } catch (err) {
    console.error('[ai-chat.service] 百炼流式调用失败:', err.message);
    throw mapBailianError(err);
  }
}

async function getAttachment(userId, conversationId, messageId, attachmentId) {
  await ensureConversation(userId, conversationId);
  const message = await prisma.aiMessage.findFirst({
    where: { id: Number(messageId), conversationId: Number(conversationId) },
  });
  if (!message) throw Object.assign(new Error('消息不存在'), { code: 40002 });
  const attachment = (Array.isArray(message.attachments) ? message.attachments : [])
    .find((item) => item.id === String(attachmentId));
  if (!attachment) throw Object.assign(new Error('图片不存在'), { code: 40002 });
  const uploaded = await prisma.aiChatAttachment.findFirst({ where: { id: String(attachmentId), userId: Number(userId), conversationId: Number(conversationId), messageId: Number(messageId), status: 'READY' } });
  if (uploaded) {
    const filePath = attachmentService.absolutePath(uploaded);
    await fs.access(filePath).catch(() => { throw Object.assign(new Error('附件文件不存在'), { code: 40002 }); });
    return { filePath, mimeType: uploaded.mimeType, name: uploaded.fileName };
  }
  const filePath = path.join(CHAT_UPLOAD_DIR, path.basename(String(attachment.fileName || '')));
  await fs.access(filePath).catch(() => { throw Object.assign(new Error('图片文件不存在'), { code: 40002 }); });
  return { filePath, mimeType: attachment.mimeType, name: attachment.name };
}

async function finalizeAssistantMessage(conversationId, content, options = {}) {
  const safeContent = String(content || '').trim() || 'AI 没有返回有效内容，请稍后重试。';
  const normalizedConversationId = Number(conversationId);
  const clientRequestId = String(options.clientRequestId || '').trim().slice(0, 80) || null;
  let assistantMessage;
  try {
    const data = {
      conversationId: normalizedConversationId,
      clientRequestId,
      role: 'ASSISTANT',
      content: safeContent,
      sourcesJson: Array.isArray(options.sources) && options.sources.length ? options.sources : undefined,
    };
    assistantMessage = clientRequestId
      ? await prisma.aiMessage.upsert({
        where: { conversationId_clientRequestId: { conversationId: normalizedConversationId, clientRequestId } },
        create: data,
        update: { content: safeContent, sourcesJson: data.sourcesJson },
      })
      : await prisma.aiMessage.create({ data });
  } catch (cause) {
    console.error('[ai-chat.service] assistant message persistence failed:', cause);
    const error = new Error('回答已生成，但暂时未能保存。你可以直接重试保存，不必重新生成。');
    error.code = 50001;
    error.publicCode = 'AI_MESSAGE_SAVE_FAILED';
    error.retryable = true;
    error.expose = true;
    error.clientRequestId = clientRequestId;
    error.generatedContent = safeContent;
    error.cause = cause;
    throw error;
  }
  const conversation = await prisma.aiConversation.update({
    where: { id: normalizedConversationId },
    data: { updatedAt: new Date() },
  }).catch(async (error) => {
    console.error('[ai-chat.service] conversation timestamp update failed after message save:', error);
    return prisma.aiConversation.findUnique({ where: { id: normalizedConversationId } });
  });

  return {
    assistantMessage: toApiMessage(assistantMessage),
    conversation: toApiConversation(conversation),
  };
}

async function sendMessage(userId, conversationId, body = {}) {
  getBailianConfig();
  const turn = await prepareTurn(userId, conversationId, body);
  const content = await callCompletion(turn.messages, turn);
  const result = await finalizeAssistantMessage(conversationId, content);

  return {
    conversation: result.conversation,
    user_message: toApiMessage(turn.userMessage),
    assistant_message: result.assistantMessage,
  };
}

async function quiesceSubjectRuns(userId, conversationIds) {
  const ids = [...new Set((Array.isArray(conversationIds) ? conversationIds : [conversationIds])
    .map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return;
  const runs = await prisma.subjectChatRun.findMany({
    where: {
      userId,
      conversationId: { in: ids },
      status: { in: ['pending', 'running'] },
    },
    select: { id: true },
  });
  if (!runs.length) return;

  // Lazy load avoids the ai-chat <-> subject-chat orchestrator module cycle at startup.
  const orchestrator = require('../modules/subject-chat/subject-chat-orchestrator.service');
  await Promise.all(runs.map((run) => orchestrator.cancel(userId, run.id)));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (runs.every((run) => !orchestrator.isActive(run.id))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Object.assign(new Error('会话仍在停止生成，请稍后重试该操作'), { code: 40901 });
}

async function clearMessages(userId, conversationId) {
  await ensureConversation(userId, conversationId);
  await quiesceSubjectRuns(userId, conversationId);
  const messageAttachments = await prisma.aiMessage.findMany({
    where: { conversationId }, select: { attachments: true },
  });
  // 运行记录与消息一起清理，保持“清空当前对话”的既有语义；旧会话本身不受影响。
  await prisma.$transaction([
    prisma.marketplaceAgentInvocation.deleteMany({ where: { aiConversationId: conversationId, userId } }),
    prisma.subjectChatRun.deleteMany({ where: { conversationId } }),
    prisma.aiMessage.deleteMany({ where: { conversationId } }),
  ]);
  await attachmentService.removeForConversations(userId, conversationId);
  await removePersistedAttachments(messageAttachments.flatMap((item) => Array.isArray(item.attachments) ? item.attachments : []));
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
  await quiesceSubjectRuns(userId, conversationId);
  const messageAttachments = await prisma.aiMessage.findMany({
    where: { conversationId }, select: { attachments: true },
  });
  await prisma.aiConversation.delete({ where: { id: conversationId } });
  await attachmentService.removeForConversations(userId, conversationId);
  await removePersistedAttachments(messageAttachments.flatMap((item) => Array.isArray(item.attachments) ? item.attachments : []));
  return { deleted: true, conversation_id: conversationId, id: conversationId };
}

async function renameConversation(userId, conversationId, title) {
  await ensureConversation(userId, conversationId);
  const safeTitle = String(title || '').trim();
  if (!safeTitle || safeTitle.length > 200) throw Object.assign(new Error('会话名称长度应为 1-200 个字符'), { code: 40001 });
  const conversation = await prisma.aiConversation.update({ where: { id: conversationId }, data: { title: safeTitle } });
  return toApiConversation(conversation);
}

async function bulkManageConversations(userId, body = {}) {
  const ids = [...new Set((Array.isArray(body.conversationIds) ? body.conversationIds : body.ids || [])
    .map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const action = String(body.action || '').toUpperCase();
  if (!ids.length || ids.length > 100) throw Object.assign(new Error('请选择 1-100 条会话'), { code: 40001 });
  if (!['DELETE', 'CLEAR_MESSAGES'].includes(action)) throw Object.assign(new Error('批量操作类型不合法'), { code: 40001 });
  const owned = await prisma.aiConversation.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
  if (owned.length !== ids.length) throw Object.assign(new Error('部分会话不存在或无权操作'), { code: 40301 });
  await quiesceSubjectRuns(userId, ids);
  const messageAttachments = await prisma.aiMessage.findMany({
    where: { conversationId: { in: ids } }, select: { attachments: true },
  });
  await prisma.$transaction(async (tx) => {
    if (action === 'DELETE') {
      await tx.aiConversation.deleteMany({ where: { id: { in: ids }, userId } });
      return;
    }
    await tx.marketplaceAgentInvocation.deleteMany({ where: { aiConversationId: { in: ids }, userId } });
    await tx.subjectChatRun.deleteMany({ where: { conversationId: { in: ids }, userId } });
    await tx.aiMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await tx.aiConversation.updateMany({ where: { id: { in: ids }, userId }, data: { title: '新对话', updatedAt: new Date() } });
  });
  await attachmentService.removeForConversations(userId, ids);
  await removePersistedAttachments(messageAttachments.flatMap((item) => Array.isArray(item.attachments) ? item.attachments : []));
  return { action, affected: ids.length, conversationIds: ids };
}

module.exports = {
  SUBJECT_PROMPTS,
  AGENT_PROMPTS,
  MISSING_API_KEY_MESSAGE,
  REFUSAL_REPLY,
  toApiConversation,
  toApiMessage,
  getBailianConfig,
  createConversation,
  generateStarterQuestions,
  listConversations,
  getMessages,
  prepareTurn,
  createCompletionStream,
  finalizeAssistantMessage,
  getAttachment,
  normalizeImageInputs,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
  sendMessage,
  clearMessages,
  deleteConversation,
  renameConversation,
  bulkManageConversations,
};
