// 学生端 AI 问答服务
// 负责创建会话、发送消息、获取历史、删除会话

const prisma = require('../config/prisma');
const aiService = require('./ai.service');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

/**
 * 校验学生是否已加入指定课程
 */
async function ensureStudentInCourse(userId, courseId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: userId,
      course_id: courseId,
      enrollment_status: 'active',
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('未加入该课程或课程不存在'), { code: 40301 });
  }
  return enrollment;
}

function parsePagination(query) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.page_size, 10);
  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 50) pageSize = 50;
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}

// ========================
// 1. 创建 AI 会话
// ========================

async function createConversation(userId, body) {
  const { course_id, teaching_class_id, agent_type, title } = body;

  // 校验课程权限
  if (course_id) {
    const cid = parseInt(course_id, 10);
    if (isNaN(cid) || cid < 1) {
      throw Object.assign(new Error('course_id 参数不合法'), { code: 40001 });
    }
    await ensureStudentInCourse(userId, cid);
  }

  // 确定 agent_type
  const prismaAgentType = agent_type ? agent_type.toUpperCase() : 'COURSE_QA';
  const validAgentTypes = ['COURSE_QA', 'LEARNING_ANALYSIS', 'PERSONALIZED_RECOMMENDATION', 'QUESTION_GENERATION', 'DOCUMENT_SUMMARY'];
  if (!validAgentTypes.includes(prismaAgentType)) {
    throw Object.assign(new Error('无效的 agent_type'), { code: 40001 });
  }

  const conversation = await prisma.chatConversation.create({
    data: {
      user_id: userId,
      course_id: course_id ? parseInt(course_id, 10) : null,
      teaching_class_id: teaching_class_id ? parseInt(teaching_class_id, 10) : null,
      agent_type: prismaAgentType,
      title: title || '新对话',
    },
  });

  return {
    conversation_id: conversation.conversation_id,
    title: conversation.title,
    course_id: conversation.course_id,
    agent_type: toLower(conversation.agent_type),
    created_at: conversation.created_at ? conversation.created_at.toISOString() : null,
  };
}

// ========================
// 2. 获取 AI 会话列表
// ========================

async function listConversations(userId, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const { course_id } = query;

  const where = { user_id: userId };
  if (course_id) {
    where.course_id = parseInt(course_id, 10);
  }

  const [conversations, total] = await Promise.all([
    prisma.chatConversation.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: true,
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.chatConversation.count({ where }),
  ]);

  const list = conversations.map((conv) => {
    const lastMessage = conv.messages[0];
    return {
      conversation_id: conv.conversation_id,
      title: conv.title,
      course_id: conv.course_id,
      course_name: conv.course?.course_name || null,
      agent_type: toLower(conv.agent_type),
      last_message: lastMessage
        ? {
            message_id: lastMessage.message_id,
            role: toLower(lastMessage.role),
            content_preview: lastMessage.content
              ? lastMessage.content.slice(0, 100) + (lastMessage.content.length > 100 ? '...' : '')
              : '',
            created_at: lastMessage.created_at ? lastMessage.created_at.toISOString() : null,
          }
        : null,
      created_at: conv.created_at ? conv.created_at.toISOString() : null,
      updated_at: conv.updated_at ? conv.updated_at.toISOString() : null,
    };
  });

  return { list, total, page, page_size: pageSize };
}

// ========================
// 3. 发送消息并获取 AI 回答
// ========================

async function sendMessage(userId, conversationId, body) {
  const { content, knowledge_point_id } = body;

  if (!content || !String(content).trim()) {
    throw Object.assign(new Error('消息内容不能为空'), { code: 40001 });
  }

  // 校验会话
  const conversation = await prisma.chatConversation.findUnique({
    where: { conversation_id: conversationId },
    include: { course: true },
  });

  if (!conversation) {
    throw Object.assign(new Error('会话不存在'), { code: 40002 });
  }

  if (conversation.user_id !== userId) {
    throw Object.assign(new Error('无权访问该会话'), { code: 40301 });
  }

  const trimmedContent = content.trim();

  // 1. 保存用户消息
  const userMessage = await prisma.chatMessage.create({
    data: {
      conversation_id: conversationId,
      user_id: userId,
      role: 'USER',
      content: trimmedContent,
    },
  });

  // 2. 知识库检索（简单的关键词匹配）
  let sources = [];
  let matchedKnowledgePoints = [];

  try {
    // 匹配知识点
    if (knowledge_point_id) {
      const kp = await prisma.knowledgePoint.findUnique({
        where: { knowledge_point_id: parseInt(knowledge_point_id, 10) },
      });
      if (kp) {
        matchedKnowledgePoints.push({
          knowledge_point_id: kp.knowledge_point_id,
          knowledge_point_name: kp.knowledge_point_name,
        });
      }
    } else if (conversation.course_id) {
      // 按关键词匹配知识点
      const allKps = await prisma.knowledgePoint.findMany({
        where: { course_id: conversation.course_id },
      });

      for (const kp of allKps) {
        if (trimmedContent.includes(kp.knowledge_point_name)) {
          matchedKnowledgePoints.push({
            knowledge_point_id: kp.knowledge_point_id,
            knowledge_point_name: kp.knowledge_point_name,
          });
        }
      }
    }

    // 检索文档 chunks（关键词 like 匹配）
    if (conversation.course_id) {
      const keywords = trimmedContent.split(/[\s，。！？,.\!?]+/).filter((k) => k.length >= 2);
      if (keywords.length > 0) {
        const orConditions = keywords.map((kw) => ({
          chunk_text: { contains: kw },
        }));

        const relevantChunks = await prisma.knowledgeDocumentChunk.findMany({
          where: {
            document: {
              course_id: conversation.course_id,
              review_status: 'APPROVED',
            },
            OR: orConditions.length > 0 ? orConditions : undefined,
          },
          include: {
            document: true,
          },
          take: 3,
        });

        sources = relevantChunks.map((chunk) => ({
          source_type: 'document_chunk',
          document_id: chunk.document_id,
          chunk_id: chunk.chunk_id,
          title: chunk.document.title || chunk.document.original_filename,
          content_preview: chunk.chunk_text
            ? chunk.chunk_text.slice(0, 200) + (chunk.chunk_text.length > 200 ? '...' : '')
            : '',
          page_number: chunk.page_number,
          score: 0.5, // 简单相似度
        }));
      }
    }
  } catch (retrievalErr) {
    console.error('[student-chat.service] 知识检索失败:', retrievalErr.message);
  }

  // 3. 构建对话上下文
  const recentMessages = await prisma.chatMessage.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'asc' },
    take: 20,
  });

  const contextMessages = recentMessages.map((m) => ({
    role: toLower(m.role),
    content: m.content,
  }));

  // 添加系统 prompt
  let systemPrompt = '你是一个学习辅助 AI 助手，名为"学研智擎"。请用简洁清晰的中文回答学生的问题。';
  if (conversation.course_id && conversation.course) {
    systemPrompt += ` 当前课程是"${conversation.course.course_name}"。`;
    if (matchedKnowledgePoints.length > 0) {
      systemPrompt += ` 学生可能正在学习：${matchedKnowledgePoints.map((kp) => kp.knowledge_point_name).join('、')}。`;
    }
  }
  if (sources.length > 0) {
    systemPrompt += ` 以下是从知识库检索到的相关内容片段：\n${sources.map((s, i) => `[${i + 1}] ${s.content_preview}`).join('\n')}`;
  }
  systemPrompt += '\n\n重要：你的回答应基于检索到的知识库内容。不要编造来源。如果问题超出你的知识范围，请诚实告知学生。在回答末尾添加免责声明："以下内容由 AI 生成，仅供学习参考，请结合课程资料核对。"';

  const aiMessages = [
    { role: 'system', content: systemPrompt },
    ...contextMessages,
  ];

  // 4. 调用 AI 服务
  const aiResult = await aiService.callAI({
    usageType: 'qa',
    userId,
    messages: aiMessages,
    options: { temperature: 0.7 },
  });

  // 5. 保存 AI 回复
  const assistantMessage = await prisma.chatMessage.create({
    data: {
      conversation_id: conversationId,
      user_id: userId,
      role: 'ASSISTANT',
      content: aiResult.content,
      is_ai_generated: true,
      ai_provider: aiResult.provider,
      model_name: aiResult.model,
      agent_type: conversation.agent_type,
    },
  });

  // 6. 保存消息来源
  if (sources.length > 0) {
    const sourceRecords = sources.map((s) => ({
      message_id: assistantMessage.message_id,
      document_id: s.document_id || null,
      chunk_id: s.chunk_id || null,
      document_title: s.title || null,
      page_number: s.page_number || null,
      chunk_text: s.content_preview || null,
      similarity: s.score || 0,
    }));

    await prisma.messageSource.createMany({ data: sourceRecords });
  }

  // 7. 记录学生问题（用于后续分析）
  try {
    const studentQuestion = await prisma.studentQuestionRecord.create({
      data: {
        student_user_id: userId,
        course_id: conversation.course_id,
        conversation_id: conversationId,
        message_id: userMessage.message_id,
        raw_question: trimmedContent,
      },
    });

    // 如果有匹配的知识点，创建分析记录
    if (matchedKnowledgePoints.length > 0) {
      await prisma.questionAnalysisRecord.create({
        data: {
          student_question_id: studentQuestion.student_question_id,
          raw_question: trimmedContent,
          question_summary: trimmedContent.slice(0, 100),
          knowledge_point_id: matchedKnowledgePoints[0].knowledge_point_id,
          normalized_question_type: 'concept_explanation',
          confidence: 0.7,
          need_teacher_review: false,
        },
      });
    }
  } catch (analysisErr) {
    console.error('[student-chat.service] 记录问题分析失败:', analysisErr.message);
  }

  // 8. 更新会话更新时间
  await prisma.chatConversation.update({
    where: { conversation_id: conversationId },
    data: { updated_at: new Date() },
  });

  return {
    user_message: {
      message_id: userMessage.message_id,
      role: 'user',
      content: userMessage.content,
      created_at: userMessage.created_at ? userMessage.created_at.toISOString() : null,
    },
    assistant_message: {
      message_id: assistantMessage.message_id,
      role: 'assistant',
      content: assistantMessage.content,
      is_ai_generated: assistantMessage.is_ai_generated,
      ai_provider: assistantMessage.ai_provider,
      model_name: assistantMessage.model_name,
      created_at: assistantMessage.created_at ? assistantMessage.created_at.toISOString() : null,
    },
    sources,
    analysis: {
      matched_knowledge_points: matchedKnowledgePoints,
      question_type: matchedKnowledgePoints.length > 0 ? 'concept_explanation' : 'general_qa',
    },
  };
}

// ========================
// 4. 获取会话消息
// ========================

async function getMessages(userId, conversationId, query) {
  // 校验会话
  const conversation = await prisma.chatConversation.findUnique({
    where: { conversation_id: conversationId },
  });

  if (!conversation) {
    throw Object.assign(new Error('会话不存在'), { code: 40002 });
  }

  if (conversation.user_id !== userId) {
    throw Object.assign(new Error('无权访问该会话'), { code: 40301 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'asc' },
    include: {
      sources: true,
    },
  });

  const list = messages.map((msg) => ({
    message_id: msg.message_id,
    role: toLower(msg.role),
    content: msg.content,
    is_ai_generated: msg.is_ai_generated,
    ai_provider: msg.ai_provider,
    model_name: msg.model_name,
    sources: msg.sources.map((s) => ({
      source_type: 'document_chunk',
      document_id: s.document_id,
      chunk_id: s.chunk_id,
      title: s.document_title,
      content_preview: s.chunk_text ? s.chunk_text.slice(0, 150) : null,
      page_number: s.page_number,
      score: s.similarity,
    })),
    created_at: msg.created_at ? msg.created_at.toISOString() : null,
  }));

  return {
    conversation: {
      conversation_id: conversation.conversation_id,
      title: conversation.title,
      course_id: conversation.course_id,
      agent_type: toLower(conversation.agent_type),
      created_at: conversation.created_at ? conversation.created_at.toISOString() : null,
    },
    messages: list,
  };
}

// ========================
// 5. 删除会话
// ========================

async function deleteConversation(userId, conversationId) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { conversation_id: conversationId },
  });

  if (!conversation) {
    throw Object.assign(new Error('会话不存在'), { code: 40002 });
  }

  if (conversation.user_id !== userId) {
    throw Object.assign(new Error('无权操作该会话'), { code: 40301 });
  }

  // 删除关联的消息、消息来源、学生问题记录，然后删除会话
  await prisma.$transaction(async (tx) => {
    // 查找关联的消息 ID
    const messageIds = await tx.chatMessage.findMany({
      where: { conversation_id: conversationId },
      select: { message_id: true },
    });
    const ids = messageIds.map((m) => m.message_id);

    // 删除消息来源
    if (ids.length > 0) {
      await tx.messageSource.deleteMany({
        where: { message_id: { in: ids } },
      });
    }

    // 删除学生问题记录
    await tx.studentQuestionRecord.deleteMany({
      where: { conversation_id: conversationId },
    });

    // 删除问题分析记录
    if (ids.length > 0) {
      const questionRecords = await tx.studentQuestionRecord.findMany({
        where: { conversation_id: conversationId },
        select: { student_question_id: true },
      });
      const qIds = questionRecords.map((q) => q.student_question_id);
      if (qIds.length > 0) {
        await tx.questionAnalysisRecord.deleteMany({
          where: { student_question_id: { in: qIds } },
        });
      }
    }

    // 删除消息
    await tx.chatMessage.deleteMany({
      where: { conversation_id: conversationId },
    });

    // 删除会话
    await tx.chatConversation.delete({
      where: { conversation_id: conversationId },
    });
  });

  return { deleted: true, conversation_id: conversationId };
}

module.exports = {
  createConversation,
  listConversations,
  sendMessage,
  getMessages,
  deleteConversation,
};
