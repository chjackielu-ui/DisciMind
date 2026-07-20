// 课程型智能体广场种子。
// 只保留与学生端六门主课程匹配的公开助手；旧的验收、阶段和文件生成测试记录会软删除。

const CATEGORIES = [
  ['课程学习', 'course-learning'],
  ['学科答疑', 'subject-qa'],
  ['概念讲解', 'concept-explain'],
  ['编程学习', 'programming'],
  ['考试复习', 'exam-review'],
];

const CURATED_AGENTS = [
  { key: 'machine-learning', courseCode: 'ML001', name: '机器学习学习教练', category: '课程学习', description: '围绕数据、模型、评估与知识图谱，帮助定位前置知识并制定练习路径。', tags: ['机器学习', '循序渐进', '本科生'], usageCount: 128 },
  { key: 'data-structures', courseCode: 'DS001', name: '数据结构与算法助教', category: '课程学习', description: '用复杂度、可视化步骤和边界案例辅助理解线性结构、树、图与排序。', tags: ['数据结构', '代码推演', '本科生'], usageCount: 116 },
  { key: 'operating-systems', courseCode: 'OS001', name: '操作系统实验答疑', category: '学科答疑', description: '解释进程、并发、内存、文件与 I/O，优先定位概念边界和实验现象。', tags: ['操作系统', '原理分析', '本科生'], usageCount: 104 },
  { key: 'database', courseCode: 'DB001', name: '数据库设计辅导', category: '学科答疑', description: '辅助 ER 建模、规范化、SQL、事务与索引设计，强调可验证的设计理由。', tags: ['数据库', '设计推理', '本科生'], usageCount: 96 },
  { key: 'computer-networks', courseCode: 'NET001', name: '计算机网络协议分析助手', category: '概念讲解', description: '沿 TCP/IP 协议栈拆解封装、寻址、路由、可靠传输和应用层交互。', tags: ['计算机网络', '协议分析', '本科生'], usageCount: 112 },
  { key: 'python', courseCode: 'PY001', name: 'Python 编程练习伙伴', category: '编程学习', description: '通过问题分解、代码阅读、调试提示和小练习支持 Python 基础学习。', tags: ['Python', '调试引导', '初学者'], usageCount: 121 },
];
const { ensureSystemFileAgents } = require('../../src/modules/file-generator/system-file-agents.service');

function splitTags(tags) {
  return { purpose: [tags[0]], style: [tags[1]], audience: [tags[2]] };
}

function promptFor(agent) {
  return `你是“${agent.name}”，面向本科生提供${agent.description}先确认课程知识点与前置条件，再给出可执行的学习步骤、例子或练习建议。不要伪造学习成绩、知识库引用、文件或外部操作；不替代教师评价。`;
}

async function ensureVersionTags(prisma, versionId, tags) {
  await prisma.agentVersionTag.deleteMany({ where: { agentVersionId: versionId } });
  for (const [groupName, names] of Object.entries(splitTags(tags))) {
    for (const name of names) {
      const tag = await prisma.agentTag.upsert({
        where: { name_groupName: { name, groupName } },
        update: { isCustom: false },
        create: { name, groupName, isCustom: false },
      });
      await prisma.agentVersionTag.create({ data: { agentVersionId: versionId, tagId: tag.id } });
    }
  }
}

async function ensureCourseAgent(prisma, creatorUserId, definition) {
  const course = await prisma.course.findUnique({ where: { course_code: definition.courseCode } });
  if (!course) throw new Error(`课程智能体缺少课程：${definition.courseCode}`);
  const category = await prisma.agentCategory.findUnique({ where: { name: definition.category } });
  const operationId = `seed-agent-marketplace-course-${definition.key}`;
  let agent = await prisma.userAgent.findUnique({ where: { operationId } });
  const agentData = {
    creatorUserId,
    status: 'PUBLIC', visibility: 'PUBLIC', agentType: 'CHAT', subjectScope: 'COURSE', courseId: course.course_id,
    subjectCode: definition.courseCode, allowedCourseIdsJson: [course.course_id], isCrossSubjectUtility: false,
    categoryId: category?.id || null, usageCount: definition.usageCount, iconKey: 'book-open', iconColor: '#2F6690', iconBackground: '#E7F2F7', deletedAt: null,
  };
  agent = agent
    ? await prisma.userAgent.update({ where: { id: agent.id }, data: agentData })
    : await prisma.userAgent.create({ data: { operationId, ...agentData } });
  const version = await prisma.userAgentVersion.upsert({
    where: { agentId_versionNumber: { agentId: agent.id, versionNumber: 1 } },
    update: {
      name: definition.name, shortDescription: definition.description, systemPrompt: promptFor(definition),
      welcomeMessage: `你好，我是${definition.name}。你想从哪个知识点开始？`,
      suggestedQuestionsJson: [`帮我梳理${course.course_name}的知识图谱`, `我在${course.course_name}的薄弱点应该怎样复习？`],
      capabilitiesJson: ['课程答疑', '知识图谱导航', '学习建议'], limitationsJson: ['不替代教师评价', '不伪造学习记录'],
      responseMode: 'DEFAULT', reviewStatus: 'APPROVED', reviewReason: null, publishedAt: new Date('2026-07-20T00:00:00+08:00'),
    },
    create: {
      agentId: agent.id, versionNumber: 1, name: definition.name, shortDescription: definition.description, systemPrompt: promptFor(definition),
      welcomeMessage: `你好，我是${definition.name}。你想从哪个知识点开始？`,
      suggestedQuestionsJson: [`帮我梳理${course.course_name}的知识图谱`, `我在${course.course_name}的薄弱点应该怎样复习？`],
      capabilitiesJson: ['课程答疑', '知识图谱导航', '学习建议'], limitationsJson: ['不替代教师评价', '不伪造学习记录'],
      responseMode: 'DEFAULT', reviewStatus: 'APPROVED', publishedAt: new Date('2026-07-20T00:00:00+08:00'),
    },
  });
  await ensureVersionTags(prisma, version.id, definition.tags);
  await prisma.userAgent.update({ where: { id: agent.id }, data: { currentPublicVersionId: version.id, currentDraftVersionId: null } });
  return agent.id;
}

async function hideNoise(prisma, keepAgentIds) {
  const staleAgents = await prisma.userAgent.findMany({
    // 只隐藏验收、阶段与无关测试记录；课程学习助手以及讲义/试卷生成器
    // 都是学生端的正式学习能力，应保留在广场中。
    where: { deletedAt: null, id: { notIn: keepAgentIds } },
    select: { id: true },
  });
  const staleIds = staleAgents.map((item) => item.id);
  if (!staleIds.length) return { agents: 0, artifacts: 0 };
  const now = new Date();
  const [artifactResult] = await prisma.$transaction([
    prisma.generatedArtifact.updateMany({ where: { agentId: { in: staleIds }, deletedAt: null }, data: { deletedAt: now, status: 'DELETED' } }),
    prisma.agentReviewRecord.deleteMany({ where: { agentId: { in: staleIds } } }),
    prisma.agentReport.deleteMany({ where: { agentId: { in: staleIds } } }),
    prisma.agentFavorite.deleteMany({ where: { agentId: { in: staleIds } } }),
    prisma.agentRating.deleteMany({ where: { agentId: { in: staleIds } } }),
    prisma.agentMemory.deleteMany({ where: { agentId: { in: staleIds } } }),
    prisma.userAgent.updateMany({ where: { id: { in: staleIds } }, data: { status: 'OFFLINE', visibility: 'PRIVATE', deletedAt: now } }),
  ]);
  return { agents: staleIds.length, artifacts: artifactResult.count };
}

async function seedHotAnswers(prisma, studentUserId, agentIds) {
  const now = Date.now();
  for (let agentIndex = 0; agentIndex < agentIds.length; agentIndex += 1) {
    const agentId = agentIds[agentIndex];
    const agent = await prisma.userAgent.findUnique({ where: { id: agentId }, select: { id: true, currentPublicVersionId: true } });
    if (!agent?.currentPublicVersionId) continue;
    const operationId = `seed-hot-conversation-${agentId}`;
    const createdAt = new Date(now - (agentIndex + 1) * 3 * 60 * 60 * 1000);
    const conversation = await prisma.marketplaceAgentConversation.upsert({
      where: { operationId },
      update: { deletedAt: null, agentVersionId: agent.currentPublicVersionId, updatedAt: createdAt },
      create: { userId: studentUserId, agentId, agentVersionId: agent.currentPublicVersionId, title: '课程学习与资料生成', operationId, mode: 'AGENT', createdAt, updatedAt: createdAt },
    });
    const answerCount = 5 + ((agentIndex * 3) % 5);
    await prisma.marketplaceAgentMessage.upsert({
      where: { operationId: `seed-hot-question-${agentId}` },
      update: { content: '请结合当前课程给出下一步可执行的学习建议。', createdAt },
      create: { conversationId: conversation.id, role: 'USER', content: '请结合当前课程给出下一步可执行的学习建议。', generationStatus: 'COMPLETED', operationId: `seed-hot-question-${agentId}`, createdAt },
    });
    for (let index = 0; index < answerCount; index += 1) {
      const answerAt = new Date(createdAt.getTime() + (index + 1) * 7 * 60_000);
      const messageOperation = `seed-hot-answer-${agentId}-${index + 1}`;
      await prisma.marketplaceAgentMessage.upsert({
        where: { operationId: messageOperation },
        update: { content: `已完成第 ${index + 1} 条学习建议：先定位前置知识，再完成一个小练习并记录复盘。`, generationStatus: 'COMPLETED', createdAt: answerAt },
        create: { conversationId: conversation.id, role: 'ASSISTANT', content: `已完成第 ${index + 1} 条学习建议：先定位前置知识，再完成一个小练习并记录复盘。`, answerSource: 'seed', generationStatus: 'COMPLETED', operationId: messageOperation, createdAt: answerAt },
      });
    }
    await prisma.userAgent.update({ where: { id: agentId }, data: { usageCount: 90 + answerCount * 8, ratingAverage: 4.8, ratingCount: 18 + answerCount } });
  }
  require('../../src/modules/agent-marketplace/agent-ranking.service').invalidateRankingCache();
}

async function seedAgentMarketplace({ prisma, adminUser, studentUser, log = () => {} }) {
  log('--- 收敛智能体广场为课程学习助手 ---');
  for (let index = 0; index < CATEGORIES.length; index += 1) {
    const [name, slug] = CATEGORIES[index];
    await prisma.agentCategory.upsert({ where: { name }, update: { slug, sortOrder: index + 1 }, create: { name, slug, sortOrder: index + 1 } });
  }
  const curatedIds = [];
  for (const definition of CURATED_AGENTS) curatedIds.push(await ensureCourseAgent(prisma, studentUser.user_id, definition));
  const systemAgents = await ensureSystemFileAgents({ prisma, creatorUserId: adminUser.user_id, strictKnowledgeBinding: false });
  const systemIds = systemAgents.map((item) => item.agentId);
  const retainedIds = [...curatedIds, ...systemIds];
  const hidden = await hideNoise(prisma, retainedIds);
  await seedHotAnswers(prisma, studentUser.user_id, retainedIds);
  await prisma.user.update({ where: { user_id: adminUser.user_id }, data: { status: 'ACTIVE' } });
  log(`  已保留 ${curatedIds.length} 个课程智能体与 ${systemIds.length} 个学习文件智能体；隐藏 ${hidden.agents} 个无关/测试智能体及 ${hidden.artifacts} 个关联产物。`);
}

module.exports = { CURATED_AGENTS, seedAgentMarketplace, seedHotAnswers };
