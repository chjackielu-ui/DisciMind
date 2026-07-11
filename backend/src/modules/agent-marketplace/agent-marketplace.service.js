const prisma = require('../../config/prisma');
const { TAG_GROUPS } = require('./agent-marketplace.constants');
const { assert } = require('./agent-marketplace.errors');
const { scopedOperationId } = require('./operation-id');
const { generateAgentConfig } = require('./agent-prompt.service');

const versionInclude = {
  tags: { include: { tag: true } },
  knowledgeBases: { include: { knowledgeBase: { include: { category: true, _count: { select: { documents: true } } } } } },
};

function publicUser(user) {
  return user ? { id: user.user_id, username: user.username, name: user.profile?.real_name || user.username, avatarUrl: user.profile?.avatar_url || null } : null;
}

function serializeKnowledgeBase(kb) {
  return {
    id: kb.knowledge_base_id,
    name: kb.name,
    description: kb.description || '',
    visibility: kb.marketplace_visibility,
    status: kb.marketplace_status,
    category: kb.category?.name || null,
    documentCount: kb.document_count ?? kb._count?.documents ?? 0,
    updatedAt: kb.updated_at,
  };
}

function serializeVersion(version, { includePrompt = false } = {}) {
  if (!version) return null;
  const tags = { purpose: [], style: [], audience: [] };
  for (const item of version.tags || []) {
    if (tags[item.tag.groupName]) tags[item.tag.groupName].push(item.tag.name);
  }
  const data = {
    id: version.id,
    versionNumber: version.versionNumber,
    name: version.name,
    shortDescription: version.shortDescription,
    avatarUrl: version.avatarUrl,
    welcomeMessage: version.welcomeMessage,
    suggestedQuestions: version.suggestedQuestionsJson || [],
    capabilities: version.capabilitiesJson || [],
    limitations: version.limitationsJson || [],
    responseMode: version.responseMode,
    topK: version.topK,
    scoreThreshold: version.scoreThreshold,
    maxOutputTokens: version.maxOutputTokens,
    memoryEnabledByDefault: version.memoryEnabledByDefault,
    fileGeneratorConfig: version.fileGeneratorConfigJson || null,
    reviewStatus: version.reviewStatus,
    reviewReason: version.reviewReason,
    changeSummary: version.changeSummary,
    tags,
    knowledgeBases: (version.knowledgeBases || []).map((item) => serializeKnowledgeBase(item.knowledgeBase)),
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
  };
  if (includePrompt) data.systemPrompt = version.systemPrompt;
  return data;
}

function serializeAgent(agent, userId, { detail = false } = {}) {
  const own = Number(agent.creatorUserId) === Number(userId);
  const activeVersion = own && agent.currentDraftVersion ? agent.currentDraftVersion : agent.currentPublicVersion;
  return {
    id: agent.id,
    agentType: agent.agentType || 'CHAT',
    status: agent.status,
    visibility: agent.visibility,
    category: agent.category?.name || null,
    usageCount: agent.usageCount,
    favoriteCount: agent.favoriteCount,
    ratingAverage: agent.ratingAverage,
    ratingCount: agent.ratingCount,
    copiedFromAgentId: agent.copiedFromAgentId,
    creator: publicUser(agent.creator),
    isOwner: own,
    isFavorite: Boolean(agent.favorites?.length),
    myRating: agent.ratings?.[0]?.rating || null,
    version: serializeVersion(activeVersion, { includePrompt: own || detail && own }),
    publicVersion: own ? serializeVersion(agent.currentPublicVersion) : undefined,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

async function loadBindingKnowledgeBases(userId, ids) {
  if (!ids.length) return [];
  const records = await prisma.knowledgeBase.findMany({
    where: { knowledge_base_id: { in: ids }, deleted_at: null },
    include: { category: true, _count: { select: { documents: true } } },
  });
  assert(records.length === ids.length, '部分知识库不存在或已删除');
  for (const kb of records) {
    const accessible = kb.owner_user_id === userId || (kb.marketplace_visibility === 'PUBLIC' && kb.marketplace_status === 'PUBLIC');
    assert(accessible, `无权绑定知识库“${kb.name}”`, 40301, 403);
  }
  return records;
}

async function saveVersionRelations(tx, versionId, tags, knowledgeBases) {
  for (const [groupName, names] of Object.entries(tags)) {
    for (const name of names) {
      const tag = await tx.agentTag.upsert({
        where: { name_groupName: { name, groupName } },
        update: {},
        create: { name, groupName, isCustom: !(TAG_GROUPS[groupName] || []).includes(name) },
      });
      await tx.agentVersionTag.create({ data: { agentVersionId: versionId, tagId: tag.id } });
    }
  }
  if (knowledgeBases.length) {
    await tx.agentKnowledgeBase.createMany({
      data: knowledgeBases.map((kb, index) => ({ agentVersionId: versionId, knowledgeBaseId: kb.knowledge_base_id, priority: index })),
    });
  }
}

async function createAgent(userId, input) {
  const operationId = scopedOperationId(userId, input.operationId, 'create-agent');
  const existing = await prisma.userAgent.findUnique({ where: { operationId } });
  if (existing) return getAgent(userId, existing.id);
  const knowledgeBases = await loadBindingKnowledgeBases(userId, input.knowledgeBaseIds);
  const config = await generateAgentConfig(input, knowledgeBases);
  const category = await prisma.agentCategory.upsert({
    where: { name: input.category }, update: {}, create: { name: input.category, slug: `category-${Buffer.from(input.category).toString('hex').slice(0, 40)}` },
  });

  const created = await prisma.$transaction(async (tx) => {
    const agent = await tx.userAgent.create({
      data: { creatorUserId: userId, agentType: input.agentType, status: 'PRIVATE', visibility: 'PRIVATE', categoryId: category.id, operationId },
    });
    const version = await tx.userAgentVersion.create({
      data: {
        agentId: agent.id, versionNumber: 1, name: config.name, shortDescription: config.shortDescription,
        systemPrompt: config.systemPrompt, welcomeMessage: config.welcomeMessage,
        suggestedQuestionsJson: config.suggestedQuestions, capabilitiesJson: config.capabilities, limitationsJson: config.limitations,
        responseMode: input.responseMode, topK: input.topK, scoreThreshold: input.scoreThreshold,
        maxOutputTokens: input.maxOutputTokens, memoryEnabledByDefault: input.memoryEnabledByDefault, reviewStatus: 'DRAFT',
        fileGeneratorConfigJson: input.agentType === 'FILE_GENERATOR' ? input.fileGeneratorConfig : null,
      },
    });
    await saveVersionRelations(tx, version.id, input.tags, knowledgeBases);
    await tx.userAgent.update({ where: { id: agent.id }, data: { currentDraftVersionId: version.id } });
    return agent.id;
  });
  return getAgent(userId, created);
}

async function listAgents(userId, query = {}, mode = 'public') {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(30, Math.max(1, Number(query.pageSize || 12)));
  const where = { deletedAt: null };
  if (mode === 'mine') where.creatorUserId = userId;
  else if (mode === 'favorites') where.favorites = { some: { userId } };
  else Object.assign(where, { status: 'PUBLIC', visibility: 'PUBLIC', currentPublicVersionId: { not: null } });
  if (query.category) where.category = { name: query.category };
  if (query.search) {
    const versionField = mode === 'public' ? 'currentPublicVersion' : 'currentDraftVersion';
    where[versionField] = { OR: [{ name: { contains: String(query.search) } }, { shortDescription: { contains: String(query.search) } }] };
  }
  const include = {
    creator: { include: { profile: true } }, category: true,
    currentPublicVersion: { include: versionInclude }, currentDraftVersion: { include: versionInclude },
    favorites: { where: { userId }, take: 1 }, ratings: { where: { userId }, take: 1 },
  };
  const [items, total] = await Promise.all([
    prisma.userAgent.findMany({ where, include, orderBy: mode === 'public' ? [{ usageCount: 'desc' }, { updatedAt: 'desc' }] : { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.userAgent.count({ where }),
  ]);
  return { list: items.map((item) => serializeAgent(item, userId)), total, page, pageSize };
}

async function listAvailableChatAgents(userId) {
  const records = await prisma.userAgent.findMany({
    where: {
      deletedAt: null, status: { notIn: ['PUBLIC_PENDING', 'REJECTED', 'OFFLINE', 'DELETED'] },
      agentType: 'CHAT',
      creator: { status: 'ACTIVE' },
      OR: [
        { creatorUserId: userId, currentDraftVersionId: { not: null } },
        { status: 'PUBLIC', visibility: 'PUBLIC', currentPublicVersion: { reviewStatus: 'APPROVED' } },
        { favorites: { some: { userId } }, status: 'PUBLIC', visibility: 'PUBLIC', currentPublicVersion: { reviewStatus: 'APPROVED' } },
      ],
    },
    include: { creator: { include: { profile: true } }, category: true, currentPublicVersion: { include: versionInclude }, currentDraftVersion: { include: versionInclude }, favorites: { where: { userId }, take: 1 }, ratings: { where: { userId }, take: 1 } },
    orderBy: [{ favoriteCount: 'desc' }, { updatedAt: 'desc' }],
  });
  return { list: records.map(item => serializeAgent(item, userId)) };
}

async function getAgent(userId, agentId) {
  const agent = await prisma.userAgent.findFirst({
    where: { id: Number(agentId), deletedAt: null },
    include: {
      creator: { include: { profile: true } }, category: true,
      currentPublicVersion: { include: versionInclude }, currentDraftVersion: { include: versionInclude },
      favorites: { where: { userId }, take: 1 }, ratings: { where: { userId }, take: 1 },
    },
  });
  assert(agent, '智能体不存在', 40002, 404);
  assert(agent.creatorUserId === userId || agent.status === 'PUBLIC', '无权查看该智能体', 40301, 403);
  return serializeAgent(agent, userId, { detail: true });
}

async function updateAgent(userId, agentId, input) {
  const operationId = scopedOperationId(userId, input.operationId, `update-agent-${agentId}`);
  const existingVersion = await prisma.userAgentVersion.findUnique({ where: { operationId } });
  if (existingVersion) return getAgent(userId, agentId);
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), creatorUserId: userId, deletedAt: null }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } } });
  assert(agent, '智能体不存在或无权编辑', 40301, 403);
  assert(agent.agentType === input.agentType, '不能修改既有智能体类型');
  const knowledgeBases = await loadBindingKnowledgeBases(userId, input.knowledgeBaseIds);
  const config = await generateAgentConfig(input, knowledgeBases);
  const category = await prisma.agentCategory.findUnique({ where: { name: input.category } });
  assert(category, '分类不存在');
  const nextVersion = (agent.versions[0]?.versionNumber || 0) + 1;
  await prisma.$transaction(async (tx) => {
    const version = await tx.userAgentVersion.create({ data: {
      agentId: agent.id, versionNumber: nextVersion, name: config.name, shortDescription: config.shortDescription,
      systemPrompt: config.systemPrompt, welcomeMessage: config.welcomeMessage, suggestedQuestionsJson: config.suggestedQuestions,
      capabilitiesJson: config.capabilities, limitationsJson: config.limitations, responseMode: input.responseMode,
      topK: input.topK, scoreThreshold: input.scoreThreshold, maxOutputTokens: input.maxOutputTokens,
      memoryEnabledByDefault: input.memoryEnabledByDefault, reviewStatus: 'DRAFT', changeSummary: input.changeSummary || null, operationId,
      fileGeneratorConfigJson: input.agentType === 'FILE_GENERATOR' ? input.fileGeneratorConfig : null,
    } });
    await saveVersionRelations(tx, version.id, input.tags, knowledgeBases);
    await tx.userAgent.update({ where: { id: agent.id }, data: { currentDraftVersionId: version.id, categoryId: category.id } });
  });
  return getAgent(userId, agent.id);
}

async function deleteAgent(userId, agentId) {
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), creatorUserId: userId, deletedAt: null } });
  assert(agent, '智能体不存在或无权删除', 40301, 403);
  await prisma.userAgent.update({ where: { id: agent.id }, data: { status: 'DELETED', visibility: 'PRIVATE', deletedAt: new Date() } });
  return { deleted: true, id: agent.id };
}

async function applyPublic(userId, agentId, operationId) {
  assert(String(operationId || '').length >= 8, 'operationId 不合法');
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), creatorUserId: userId, deletedAt: null }, include: { currentDraftVersion: { include: { knowledgeBases: { include: { knowledgeBase: { include: { documents: { where: { deleted_at: null } } } } } } } } } });
  const scoped = agent ? scopedOperationId(userId, operationId, `apply-agent-${agent.id}`) : null;
  if (agent) {
    const previous = await prisma.agentReviewRecord.findUnique({ where: { operationId: scoped } });
    if (previous) return getAgent(userId, agent.id);
  }
  assert(agent?.currentDraftVersion, '没有可提交的草稿版本');
  assert(agent.currentDraftVersion.reviewStatus !== 'PENDING', '该版本已在审核中');
  for (const binding of agent.currentDraftVersion.knowledgeBases) {
    const kb = binding.knowledgeBase;
    assert(kb.marketplace_visibility === 'PUBLIC' && kb.marketplace_status === 'PUBLIC', `知识库“${kb.name}”尚未公开，暂时不能申请公开智能体。`);
    const notReady = kb.documents.find((doc) => doc.marketplace_status !== 'READY');
    assert(!notReady, `知识库“${kb.name}”中仍有文档未完成索引。`);
  }
  await prisma.$transaction([
    prisma.userAgentVersion.update({ where: { id: agent.currentDraftVersion.id }, data: { reviewStatus: 'PENDING', reviewReason: null } }),
    prisma.userAgent.update({ where: { id: agent.id }, data: { status: agent.currentPublicVersionId ? 'PUBLIC' : 'PUBLIC_PENDING' } }),
    prisma.agentReviewRecord.create({ data: { agentId: agent.id, agentVersionId: agent.currentDraftVersion.id, action: 'SUBMITTED', operationId: scoped } }),
  ]);
  return getAgent(userId, agent.id);
}

async function copyAgent(userId, agentId, operationId) {
  assert(String(operationId || '').length >= 8, 'operationId 不合法');
  const operationKey = scopedOperationId(userId, operationId, `copy-agent-${agentId}`);
  const existing = await prisma.userAgent.findUnique({ where: { operationId: operationKey } });
  if (existing) return getAgent(userId, existing.id);
  const source = await prisma.userAgent.findFirst({ where: { id: Number(agentId), status: 'PUBLIC', deletedAt: null }, include: { currentPublicVersion: { include: versionInclude }, category: true } });
  assert(source?.currentPublicVersion, '公开智能体不存在', 40002, 404);
  const publicKbs = source.currentPublicVersion.knowledgeBases.filter((item) => item.knowledgeBase.marketplace_visibility === 'PUBLIC' && item.knowledgeBase.marketplace_status === 'PUBLIC').map((item) => item.knowledgeBase);
  const omittedPrivateKnowledgeBases = source.currentPublicVersion.knowledgeBases.length - publicKbs.length;
  const createdId = await prisma.$transaction(async (tx) => {
    const agent = await tx.userAgent.create({ data: { creatorUserId: userId, agentType: source.agentType, status: 'PRIVATE', visibility: 'PRIVATE', categoryId: source.categoryId, copiedFromAgentId: source.id, operationId: operationKey } });
    const v = source.currentPublicVersion;
    const version = await tx.userAgentVersion.create({ data: {
      agentId: agent.id, versionNumber: 1, name: `${v.name}（副本）`.slice(0, 100), shortDescription: v.shortDescription,
      avatarUrl: v.avatarUrl, systemPrompt: v.systemPrompt, welcomeMessage: v.welcomeMessage,
      suggestedQuestionsJson: v.suggestedQuestionsJson, capabilitiesJson: v.capabilitiesJson, limitationsJson: v.limitationsJson,
      responseMode: publicKbs.length ? v.responseMode : 'DEFAULT', topK: v.topK, scoreThreshold: v.scoreThreshold,
      fileGeneratorConfigJson: v.fileGeneratorConfigJson,
      maxOutputTokens: v.maxOutputTokens, memoryEnabledByDefault: false, reviewStatus: 'DRAFT',
    } });
    for (const item of v.tags) await tx.agentVersionTag.create({ data: { agentVersionId: version.id, tagId: item.tagId } });
    if (publicKbs.length) await tx.agentKnowledgeBase.createMany({ data: publicKbs.map((kb, i) => ({ agentVersionId: version.id, knowledgeBaseId: kb.knowledge_base_id, priority: i })) });
    await tx.userAgent.update({ where: { id: agent.id }, data: { currentDraftVersionId: version.id } });
    return agent.id;
  });
  const result = await getAgent(userId, createdId);
  result.copyNotice = omittedPrivateKnowledgeBases ? '部分私有知识库未复制，请绑定你自己的知识库。' : null;
  return result;
}

async function favorite(userId, agentId, enabled) {
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), status: 'PUBLIC', deletedAt: null } });
  assert(agent, '公开智能体不存在', 40002, 404);
  await prisma.$transaction(async (tx) => {
    if (enabled) await tx.agentFavorite.upsert({ where: { userId_agentId: { userId, agentId: agent.id } }, update: {}, create: { userId, agentId: agent.id } });
    else await tx.agentFavorite.deleteMany({ where: { userId, agentId: agent.id } });
    const count = await tx.agentFavorite.count({ where: { agentId: agent.id } });
    await tx.userAgent.update({ where: { id: agent.id }, data: { favoriteCount: count } });
  });
  require('./agent-ranking.service').invalidateRankingCache();
  return { favorite: enabled };
}

async function rate(userId, agentId, rating) {
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), status: 'PUBLIC', deletedAt: null } });
  assert(agent, '公开智能体不存在', 40002, 404);
  assert(agent.creatorUserId !== userId, '不能给自己的智能体评分');
  await prisma.$transaction(async (tx) => {
    await tx.agentRating.upsert({ where: { userId_agentId: { userId, agentId: agent.id } }, update: { rating }, create: { userId, agentId: agent.id, rating } });
    const stats = await tx.agentRating.aggregate({ where: { agentId: agent.id }, _avg: { rating: true }, _count: { rating: true } });
    await tx.userAgent.update({ where: { id: agent.id }, data: { ratingAverage: stats._avg.rating || 0, ratingCount: stats._count.rating } });
  });
  require('./agent-ranking.service').invalidateRankingCache();
  return { rating };
}

async function report(userId, agentId, input) {
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), status: 'PUBLIC', deletedAt: null } });
  assert(agent, '公开智能体不存在', 40002, 404);
  const operationId = scopedOperationId(userId, input.operationId, `report-agent-${agent.id}`);
  const record = await prisma.agentReport.upsert({ where: { operationId }, update: {}, create: { userId, agentId: agent.id, reason: input.reason, detail: input.detail || null, operationId } });
  require('./agent-ranking.service').invalidateRankingCache();
  return { id: record.id, status: record.status };
}

module.exports = {
  versionInclude, serializeAgent, serializeVersion, serializeKnowledgeBase, createAgent, listAgents, getAgent,
  updateAgent, deleteAgent, applyPublic, copyAgent, favorite, rate, report, loadBindingKnowledgeBases, listAvailableChatAgents,
};
