const prisma = require('../../config/prisma');
const dify = require('../learning-agent/adapters/dify-knowledge.adapter');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { actualPageNumber } = require('./source-utils');
const UNAVAILABLE_KNOWLEDGE_BASE_STATUSES = new Set(['DELETING', 'DELETED', 'DISABLED', 'OFFLINE', 'FAILED']);
function safeKnowledgeBaseName(kb) {
  const name = String(kb?.name || '');
  return /\uFFFD|锟斤拷|\?{3,}|(?:Ã.|Â.|â€|ðŸ)/u.test(name) ? `知识库 #${kb.knowledge_base_id}` : name;
}

async function loadUserScope(userId) {
  const [user, enrollments, teaching] = await Promise.all([
    prisma.user.findUnique({ where: { user_id: Number(userId) }, select: { role: true, status: true } }),
    prisma.studentCourseEnrollment.findMany({
      where: { student_user_id: Number(userId), enrollment_status: 'active' },
      select: { course_id: true, teaching_class_id: true },
    }),
    prisma.courseTeacherRelation.findMany({ where: { teacher_user_id: Number(userId) }, select: { course_id: true } }),
  ]);
  assert(user && user.status === 'ACTIVE', '用户状态不可用', 40301, 403);
  return {
    role: user.role,
    courseIds: new Set([...enrollments.map(item => item.course_id), ...teaching.map(item => item.course_id)]),
    teachingClassIds: new Set(enrollments.map(item => item.teaching_class_id)),
  };
}

function canAccessKnowledgeBase(kb, userId, scope) {
  if (Number(kb.owner_user_id) === Number(userId)) return true;
  if (kb.marketplace_visibility === 'PUBLIC' && kb.marketplace_status === 'PUBLIC') return true;
  if (kb.course_id && scope.courseIds.has(kb.course_id)) return true;
  if (kb.teaching_class_id && scope.teachingClassIds.has(kb.teaching_class_id)) return true;
  if (scope.role === 'TEACHER' && kb.teaching_class?.course_id && scope.courseIds.has(kb.teaching_class.course_id)) return true;
  return false;
}

function isKnowledgeBaseAvailable(kb) {
  return Boolean(kb?.dify_dataset_id) && !UNAVAILABLE_KNOWLEDGE_BASE_STATUSES.has(String(kb?.marketplace_status || '').toUpperCase());
}

async function resolveKnowledgeBaseRefs(userId, refs = []) {
  const ids = [...new Set(refs.map(item => Number(item?.knowledgeBaseId ?? item)).filter(Number.isInteger))];
  if (!ids.length) return [];
  const [scope, records] = await Promise.all([
    loadUserScope(userId),
    prisma.knowledgeBase.findMany({
      where: { knowledge_base_id: { in: ids }, deleted_at: null, status: 'active' },
      include: { teaching_class: { select: { course_id: true } }, documents: { where: { deleted_at: null } } },
    }),
  ]);
  const byId = new Map(records.map(item => [item.knowledge_base_id, item]));
  const ordered = ids.map(id => byId.get(id));
  assert(ordered.every(Boolean), '部分知识库不存在或不可用', 40002, 404);
  ordered.forEach((kb) => {
    assert(canAccessKnowledgeBase(kb, userId, scope), `无权访问知识库“${kb.name}”`, 40301, 403);
    assert(isKnowledgeBaseAvailable(kb), `知识库“${safeKnowledgeBaseName(kb)}”尚未完成可用的数据集配置`, 40903, 409);
  });
  return ordered;
}

async function listAccessibleKnowledgeBases(userId, query = {}) {
  const scope = await loadUserScope(userId);
  const records = await prisma.knowledgeBase.findMany({
    where: { deleted_at: null, status: 'active' },
    include: { teaching_class: { select: { course_id: true } } },
    orderBy: { updated_at: 'desc' }, take: 200,
  });
  const q = String(query.q || query.search || '').trim().toLowerCase();
  return records.filter(kb => canAccessKnowledgeBase(kb, userId, scope))
    .filter(kb => !q || `${kb.name} ${kb.description || ''}`.toLowerCase().includes(q))
    .map(kb => ({
      id: kb.knowledge_base_id, name: safeKnowledgeBaseName(kb), description: kb.description || '', scopeType: kb.scope_type,
      courseId: kb.course_id, teachingClassId: kb.teaching_class_id, status: kb.marketplace_status,
      documentCount: kb.document_count, isOwner: Number(kb.owner_user_id) === Number(userId),
      available: isKnowledgeBaseAvailable(kb),
    }));
}

function mentionedKnowledgeTerms(query) {
  const stopWords = /^(?:结合|使用|引用|检索|查询|搜索|根据|基于|通过|从|请用|请结合|帮我用|利用)$/;
  const terms = [];
  for (const match of String(query || '').matchAll(/([\p{Script=Han}A-Za-z0-9_-]{2,32})知识库/gu)) {
    const value = String(match[1] || '').replace(/^(?:请|帮我|结合|使用|引用|检索|查询|搜索|根据|基于|通过|从|利用)+/u, '').trim();
    if (value && !stopWords.test(value) && !terms.includes(value)) terms.push(value);
  }
  return terms;
}

async function inferKnowledgeBaseRefs(userId, query, options = {}) {
  const terms = mentionedKnowledgeTerms(query);
  if (!terms.length) return [];
  const accessible = (await listAccessibleKnowledgeBases(userId)).filter(item => item.available && Number(item.documentCount || 0) > 0);
  if (!accessible.length) return [];
  const courseId = Number(options.courseId || options.course_id) || null;
  const scored = accessible.map((item) => {
    const name = String(item.name || '').toLowerCase();
    let score = 0;
    for (const term of terms) {
      const needle = term.toLowerCase();
      if (name === needle || name === `${needle}知识库`) score = Math.max(score, 200);
      else if (name.includes(needle)) score = Math.max(score, 120);
    }
    if (courseId && Number(item.courseId) === courseId) score += 20;
    return { item, score };
  }).filter(entry => entry.score >= 80).sort((a, b) => b.score - a.score || Number(b.item.documentCount) - Number(a.item.documentCount));
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return [];
  return resolveKnowledgeBaseRefs(userId, [scored[0].item.id]);
}

async function loadAgentCallContext(userId, options = {}) {
  const assistantMode = String(options.assistantMode || options.mode || 'general').toLowerCase() === 'subject' ? 'subject' : 'general';
  const scope = await loadUserScope(userId);
  const courseId = Number(options.courseId || options.course_id) || null;
  let subjectCode = String(options.subjectCode || options.subject || '').trim() || null;
  if (assistantMode === 'subject') {
    assert(courseId, '学科模式必须选择当前课程', 40001, 400);
    assert(scope.courseIds.has(courseId), '当前课程不在你的可访问范围内', 40301, 403);
    const course = await prisma.course.findUnique({ where: { course_id: courseId }, select: { course_code: true } });
    assert(course, '课程不存在', 40002, 404);
    subjectCode ||= course.course_code;
  }
  return { assistantMode, courseId, subjectCode: subjectCode?.toLowerCase() || null, scope };
}

function canCallAgentInContext(agent, context) {
  if (agent.isCrossSubjectUtility || agent.agentType === 'FILE_GENERATOR') return true;
  const agentScope = String(agent.subjectScope || 'GENERAL').toUpperCase();
  // 通用助手可以显式调用用户有权访问的通用或学科智能体；课程隔离只在学科专属模式强制收窄。
  if (context.assistantMode === 'general') return agentScope === 'GENERAL' || agentScope === 'SUBJECT';
  if (agentScope !== 'SUBJECT') return false;
  const allowed = Array.isArray(agent.allowedCourseIdsJson) ? agent.allowedCourseIdsJson.map(Number) : [];
  return Number(agent.courseId) === Number(context.courseId)
    || allowed.includes(Number(context.courseId))
    || (agent.subjectCode && String(agent.subjectCode).toLowerCase() === context.subjectCode);
}

async function resolveAgentRefs(userId, refs = [], options = {}) {
  const ids = [...new Set(refs.map(item => Number(item?.agentId ?? item)).filter(Number.isInteger))];
  if (!ids.length) return [];
  const [records, callContext] = await Promise.all([prisma.userAgent.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: { currentDraftVersion: true, currentPublicVersion: true },
  }), loadAgentCallContext(userId, options)]);
  const byId = new Map(records.map(item => [item.id, item]));
  return ids.map(id => {
    const agent = byId.get(id);
    assert(agent, '引用的智能体不存在或已停用', 40002, 404);
    const own = Number(agent.creatorUserId) === Number(userId);
    assert(own || agent.status === 'PUBLIC', '无权调用所选智能体', 40301, 403);
    assert(canCallAgentInContext(agent, callContext), '所选智能体不属于当前助手模式或课程范围', 40301, 403);
    assert(agent.agentType === 'CHAT' || options.allowFileGenerator, '文件生成智能体需要进入专用需求确认流程', 40903, 409);
    const version = own ? (agent.currentDraftVersion || agent.currentPublicVersion) : agent.currentPublicVersion;
    assert(version, '所选智能体没有可用版本', 40903, 409);
    return { agent, version };
  });
}

function normalizedKnowledgeRefs(records) {
  return records.map(item => ({ knowledgeBaseId: item.knowledge_base_id, name: safeKnowledgeBaseName(item) }));
}

function normalizedAgentRefs(records) {
  return records.map(({ agent, version }) => ({ agentId: agent.id, name: version.name, agentType: agent.agentType }));
}

function retrievalKnowledgeBases(explicit = [], bound = []) {
  return explicit.length ? [...explicit] : [...bound];
}

async function retrieveFromKnowledgeBases(knowledgeBases, question, options = {}) {
  const usable = knowledgeBases.filter(isKnowledgeBaseAvailable);
  if (!usable.length) return { records: [], fallback: knowledgeBases.length > 0, unavailable: false };
  const concurrency = Math.max(1, Math.min(8, Number(process.env.AGENT_GRAPH_MAX_PARALLEL_TOOLS || 3) || 3));
  const settled = [];
  for (let offset = 0; offset < usable.length; offset += concurrency) {
    const batch = usable.slice(offset, offset + concurrency);
    const batchResults = await Promise.allSettled(batch.map(async (kb) => {
      const result = await dify.retrieveFromMultipleDatasets([kb.dify_dataset_id], question, {
        topK: options.topK || 5,
        scoreThreshold: options.scoreThreshold ?? 0.55,
        maxContextChars: options.maxContextChars || 8000,
      });
      return result.records.map(item => {
        const doc = kb?.documents?.find(record => record.dify_document_id === item.documentId || record.original_filename === item.documentName);
        return {
          knowledgeBaseId: kb?.knowledge_base_id,
          knowledgeBaseName: kb ? safeKnowledgeBaseName(kb) : '',
          documentId: doc?.document_id || null,
          documentName: item.documentName || doc?.original_filename || '未命名文档',
          segmentId: item.segmentId || null,
          pageNumber: actualPageNumber(item.metadata),
          content: String(item.content || '').slice(0, 1200),
          score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
          externalUrl: /^https?:\/\//i.test(String(item.metadata?.url || '')) ? item.metadata.url : null,
        };
      }).filter(item => item.knowledgeBaseId && item.content);
    }));
    settled.push(...batchResults);
  }
  const records = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const failedIds = settled.map((result, index) => result.status === 'rejected' ? usable[index].knowledge_base_id : null).filter(Boolean);
  if (failedIds.length) console.error('[AgentChat] partial knowledge retrieval degraded', { knowledgeBaseIds: failedIds });
  return { records, fallback: records.length === 0, unavailable: failedIds.length === usable.length, partialFailure: failedIds.length > 0, failedKnowledgeBaseIds: failedIds };
}

async function resolveRetrieval(userId, version, question, explicitRefs = []) {
  const explicit = await resolveKnowledgeBaseRefs(userId, explicitRefs);
  let bound = [];
  // An explicit @ selection is an allow-list, not an addition to an Agent's
  // private bindings. Mixing the two can make a selected handbook question
  // return evidence from an unrelated Agent knowledge base.
  if (!explicit.length && version.responseMode === 'KNOWLEDGE_FIRST') {
    const [scope, bindings] = await Promise.all([
      loadUserScope(userId),
      prisma.agentKnowledgeBase.findMany({
        where: { agentVersionId: version.id },
        include: { knowledgeBase: { include: { teaching_class: { select: { course_id: true } }, documents: { where: { deleted_at: null } } } } },
        orderBy: { priority: 'asc' },
      }),
    ]);
    bound = bindings.map(item => item.knowledgeBase)
      .filter(kb => kb && !kb.deleted_at && kb.status === 'active' && canAccessKnowledgeBase(kb, userId, scope));
  }
  const merged = retrievalKnowledgeBases(explicit, bound);
  if (!merged.length) return { records: [], fallback: false, unavailable: false, knowledgeBases: [] };
  const result = await retrieveFromKnowledgeBases(merged, question, { topK: version.topK, scoreThreshold: version.scoreThreshold });
  return { ...result, knowledgeBases: merged };
}

module.exports = {
  loadUserScope,
  canAccessKnowledgeBase,
  isKnowledgeBaseAvailable,
  resolveKnowledgeBaseRefs,
  listAccessibleKnowledgeBases,
  mentionedKnowledgeTerms,
  inferKnowledgeBaseRefs,
  loadAgentCallContext,
  canCallAgentInContext,
  resolveAgentRefs,
  normalizedKnowledgeRefs,
  normalizedAgentRefs,
  retrievalKnowledgeBases,
  retrieveFromKnowledgeBases,
  resolveRetrieval,
};
