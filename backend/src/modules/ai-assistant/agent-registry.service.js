const prisma = require('../../config/prisma');
const agentContext = require('../agent-chat/agent-context.service');
const { aiError } = require('./errors');
const { INTENTS } = require('./intent-router.service');

const MANUAL_RUNTIME_PROVIDERS = new Set(['MODEL', 'DIFY_CHATFLOW', 'DIFY_WORKFLOW']);
const SUBJECT_AGENT_INTENTS = new Set([INTENTS.CONCEPT, INTENTS.KNOWLEDGE]);
const SUBJECT_FORBIDDEN_INTENTS = Object.freeze([
  INTENTS.GREETING, INTENTS.CONTEXT, INTENTS.WRONG, INTENTS.RECORDS, INTENTS.SCORE,
  INTENTS.MASTERY, INTENTS.SESSIONS, INTENTS.TIME, INTENTS.TASKS, INTENTS.ANALYTICS,
  INTENTS.FILE, INTENTS.WEB, INTENTS.ATTACHMENT,
]);

function declaredCapabilities(version) {
  if (Array.isArray(version?.capabilitiesJson)) return version.capabilitiesJson.map(String);
  if (version?.capabilitiesJson && typeof version.capabilitiesJson === 'object') return Object.values(version.capabilitiesJson).flat().map(String);
  return [];
}

function capabilityMetadata(agent, version = agent.currentDraftVersion || agent.currentPublicVersion) {
  const type = String(agent.agentType || 'CHAT').toUpperCase();
  const provider = String(version?.runtimeProvider || 'MODEL').toUpperCase();
  const declared = declaredCapabilities(version);
  const questionContent = declared.some(item => /题|试卷|练习/iu.test(item)) || /出题|题目|试卷/iu.test(`${version?.name || ''} ${version?.shortDescription || ''}`);
  if (type === 'FILE_GENERATOR') return {
    capabilityTags: [...new Set(['artifact-generation', 'controlled-export', ...declared])],
    supportedIntents: [INTENTS.FILE],
    forbiddenIntents: [INTENTS.GREETING, INTENTS.WRONG, INTENTS.SCORE, INTENTS.MASTERY, INTENTS.WEB, INTENTS.ATTACHMENT, INTENTS.CONCEPT, INTENTS.KNOWLEDGE],
    inputTypes: ['text', 'course_context', 'knowledge_scope'], outputTypes: ['docx', 'pdf'],
    requiredContext: ['authenticatedUser', 'confirmation'], optionalContext: ['course', 'knowledgePoint', 'knowledgeBase', 'attachments'],
    supportedRoles: ['student', 'teacher', 'admin'], canUseKnowledgeBase: true, requiresKnowledgeBase: false,
    canGenerateArtifact: true, supportedArtifactTypes: [version?.fileGeneratorConfigJson?.documentType || 'STUDY_HANDOUT'],
    priority: 100, confidenceThreshold: 0.9, timeout: Math.max(30_000, Number(process.env.AI_AGENT_TIMEOUT_MS) || 150_000), fallbackAgentIds: [],
    preferredIntents: [INTENTS.FILE], requiresCourse: true,
  };
  const supportedIntents = questionContent
    ? [INTENTS.CHAT_QUESTIONS, INTENTS.CONCEPT]
    : [INTENTS.CONCEPT, INTENTS.KNOWLEDGE];
  return {
    capabilityTags: [...new Set([questionContent ? 'question-generation' : 'subject-qa', 'content-generation', provider.toLowerCase(), ...declared])],
    supportedIntents,
    forbiddenIntents: [...SUBJECT_FORBIDDEN_INTENTS, ...(questionContent ? [INTENTS.KNOWLEDGE] : [INTENTS.CHAT_QUESTIONS])],
    inputTypes: ['text', 'course_context', 'knowledge_context'],
    outputTypes: questionContent ? ['structured_questions', 'markdown'] : ['markdown', 'answer_with_sources'],
    requiredContext: ['authenticatedUser'], optionalContext: ['course', 'knowledgePoint', 'knowledgeBase'],
    supportedRoles: ['student', 'teacher', 'admin'], canUseKnowledgeBase: true, requiresKnowledgeBase: false,
    canGenerateArtifact: false, supportedArtifactTypes: [],
    priority: provider === 'MODEL' ? 50 : 40, confidenceThreshold: 0.62,
    timeout: Math.max(30_000, Number(process.env.AI_AGENT_TIMEOUT_MS) || 150_000), fallbackAgentIds: [],
    preferredIntents: supportedIntents, requiresCourse: false,
  };
}

function queryTerms(query, skills = []) {
  const text = String(query || '').toLowerCase();
  const terms = text.split(/[\s，。！？、；：,.!?;:()（）“”"']+/)
    .map(item => item.trim()).filter(item => item.length >= 2 && item.length <= 32);
  const domainTerms = ['机器学习', '逻辑回归', '线性回归', '深度学习', '神经网络', '注意力机制', '概率论', '高等数学', '数据结构', '算法', '复习', '蓝鲸'];
  domainTerms.forEach(term => { if (text.includes(term)) terms.push(term); });
  for (const value of skills) for (const trigger of value.triggers || []) if (String(trigger).length >= 2 && text.includes(String(trigger).toLowerCase())) terms.push(String(trigger).toLowerCase());
  return [...new Set(terms)];
}

function textScore(agent, query, skills = [], intent = null) {
  const version = agent.currentDraftVersion || agent.currentPublicVersion;
  const metadata = capabilityMetadata(agent, version);
  if (intent && (!metadata.supportedIntents.includes(intent) || metadata.forbiddenIntents.includes(intent))) return -1000;
  const haystack = `${version?.name || ''} ${version?.shortDescription || ''} ${declaredCapabilities(version).join(' ')}`.toLowerCase();
  const terms = queryTerms(query, skills);
  let matchScore = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    matchScore += term.length >= 4 ? 28 : 16;
  }
  const intentBoost = intent && metadata.supportedIntents.includes(intent) ? 10 : 0;
  const rating = Math.min(5, Number(agent.ratingAverage) || 0);
  const usage = Math.min(4, Math.log10(1 + (Number(agent.usageCount) || 0)));
  return matchScore + intentBoost + rating + usage + Math.min(5, metadata.priority / 20);
}

async function listModelAgents(userId, options = {}) {
  const refs = await prisma.userAgent.findMany({
    where: {
      deletedAt: null, agentType: 'CHAT',
      OR: [{ creatorUserId: Number(userId) }, { status: 'PUBLIC', visibility: 'PUBLIC' }],
    },
    include: { currentDraftVersion: true, currentPublicVersion: true },
    orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }], take: Math.min(200, Number(options.take) || 100),
  });
  return refs.filter(agent => {
    const own = Number(agent.creatorUserId) === Number(userId);
    const version = own ? (agent.currentDraftVersion || agent.currentPublicVersion) : agent.currentPublicVersion;
    return version && String(version.runtimeProvider || 'MODEL').toUpperCase() === 'MODEL';
  });
}

async function resolvePlan(userId, input = {}) {
  const manualRefs = Array.isArray(input.manualAgentRefs) ? input.manualAgentRefs : [];
  const callOptions = {
    allowFileGenerator: false,
    assistantMode: input.assistantMode || 'general', courseId: input.courseId || null, subjectCode: input.subjectCode || null,
  };
  if (manualRefs.length) {
    const resolved = await agentContext.resolveAgentRefs(userId, manualRefs, callOptions);
    const invalid = resolved.find(item => !MANUAL_RUNTIME_PROVIDERS.has(String(item.version.runtimeProvider || 'MODEL').toUpperCase()));
    if (invalid) throw aiError('AI_AGENT_FORBIDDEN', '该 Agent 运行时不支持从统一 AI 任务中心手动调用。', 403);
    return resolved.map((item, index) => ({ ...item, selection: 'manual', score: 1000 - index }));
  }
  if (input.auto === false || !SUBJECT_AGENT_INTENTS.has(input.intent)) return [];
  const candidates = await listModelAgents(userId);
  const scored = candidates.map(agent => {
    const metadata = capabilityMetadata(agent);
    return { agent, metadata, score: textScore(agent, input.query, input.skills || [], input.intent) };
  }).filter(item => item.metadata.supportedIntents.includes(input.intent) && !item.metadata.forbiddenIntents.includes(input.intent))
    .filter(item => item.score >= item.metadata.confidenceThreshold * 50)
    .sort((a, b) => b.score - a.score || b.metadata.priority - a.metadata.priority)
    .slice(0, Math.max(1, Math.min(3, Number(input.limit) || 1)));
  const resolved = [];
  for (const item of scored) {
    try {
      const [value] = await agentContext.resolveAgentRefs(userId, [{ agentId: item.agent.id }], callOptions);
      if (value && String(value.version.runtimeProvider || 'MODEL').toUpperCase() === 'MODEL') resolved.push({ ...value, selection: 'auto', score: item.score });
    } catch {
      // Automatic candidates outside the current role/course scope are skipped.
    }
  }
  return resolved;
}

function publicAgent(item) {
  const metadata = capabilityMetadata(item.agent, item.version);
  return {
    id: item.agent.id,
    name: item.version.name,
    description: item.version.shortDescription || '',
    agentType: item.agent.agentType,
    selection: item.selection,
    score: item.score,
    runtimeProvider: item.version.runtimeProvider,
    ...metadata,
  };
}

module.exports = {
  MANUAL_RUNTIME_PROVIDERS, SUBJECT_AGENT_INTENTS, SUBJECT_FORBIDDEN_INTENTS,
  capabilityMetadata, queryTerms, textScore, listModelAgents, resolvePlan, publicAgent,
};
