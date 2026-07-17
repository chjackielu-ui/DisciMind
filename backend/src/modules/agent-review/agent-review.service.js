const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { scopedOperationId } = require('../agent-marketplace/operation-id');

const agentReviewInclude = {
  targetAgent: { include: { creator: { include: { profile: true } }, category: true, reports: { where: { status: 'PENDING' } } } },
  agentVersion: { include: { tags: { include: { tag: true } }, knowledgeBases: { include: { knowledgeBase: { include: { documents: { where: { deleted_at: null } } } } } } } },
};

function serializeAgentReview(review) {
  const version = review.agentVersion;
  const creator = review.targetAgent.creator;
  return {
    id: review.id, action: review.action, submittedAt: review.createdAt,
    agent: { id: review.targetAgent.id, status: review.targetAgent.status, category: review.targetAgent.category?.name || null, reportCount: review.targetAgent.reports.length },
    creator: { id: creator.user_id, username: creator.username, name: creator.profile?.real_name || creator.username },
    version: {
      id: version.id, versionNumber: version.versionNumber, name: version.name, shortDescription: version.shortDescription,
      systemPrompt: version.systemPrompt, responseMode: version.responseMode, topK: version.topK, scoreThreshold: version.scoreThreshold,
      tags: version.tags.map((item) => ({ name: item.tag.name, group: item.tag.groupName })), changeSummary: version.changeSummary,
      knowledgeBases: version.knowledgeBases.map((item) => ({
        id: item.knowledgeBase.knowledge_base_id, name: item.knowledgeBase.name,
        visibility: item.knowledgeBase.marketplace_visibility, status: item.knowledgeBase.marketplace_status,
        documents: item.knowledgeBase.documents.map((doc) => ({ name: doc.original_filename, status: doc.marketplace_status })),
      })),
    },
    riskHints: [/[<>]/.test(version.systemPrompt) ? '提示词包含边界标记，请人工确认用途' : null, /忽略.*系统|覆盖.*指令/i.test(version.systemPrompt) ? '提示词含指令覆盖相关词语' : null].filter(Boolean),
  };
}

async function listAgentReviews() {
  const records = await prisma.agentReviewRecord.findMany({ where: { action: 'SUBMITTED', agentVersion: { reviewStatus: 'PENDING' } }, include: agentReviewInclude, orderBy: { createdAt: 'asc' } });
  return { list: records.map(serializeAgentReview) };
}
async function getAgentReview(id) {
  const record = await prisma.agentReviewRecord.findUnique({ where: { id: Number(id) }, include: agentReviewInclude });
  assert(record, '审核记录不存在', 40002, 404); return serializeAgentReview(record);
}

async function approveAgent(adminId, reviewId, rawOperationId) {
  const submitted = await prisma.agentReviewRecord.findUnique({ where: { id: Number(reviewId) }, include: { agentVersion: true, targetAgent: true } });
  assert(submitted, '审核记录不存在', 40002, 404);
  const operationId = scopedOperationId(adminId, rawOperationId, `approve-agent-review-${reviewId}`);
  const existing = await prisma.agentReviewRecord.findUnique({ where: { operationId } });
  if (existing) return { approved: true, agentId: submitted.agentId };
  assert(submitted.agentVersion.reviewStatus === 'PENDING', '审核状态已发生变化，请刷新后重试。', 40901, 409);
  await prisma.$transaction([
    prisma.userAgentVersion.update({ where: { id: submitted.agentVersionId }, data: { reviewStatus: 'APPROVED', reviewReason: null, publishedAt: new Date() } }),
    prisma.userAgent.update({ where: { id: submitted.agentId }, data: { currentPublicVersionId: submitted.agentVersionId, currentDraftVersionId: null, status: 'PUBLIC', visibility: 'PUBLIC' } }),
    prisma.agentReviewRecord.create({ data: { agentId: submitted.agentId, agentVersionId: submitted.agentVersionId, reviewerUserId: adminId, action: 'APPROVED', operationId } }),
    prisma.operationLog.create({ data: {
      user_id: adminId, role: 'ADMIN', operation_type: 'APPROVE_USER_AGENT', target_type: 'user_agent', target_id: submitted.agentId,
      request_id: operationId, action_status: 'success',
      before_summary_json: { review_status: submitted.agentVersion.reviewStatus, version_id: submitted.agentVersionId },
      after_summary_json: { review_status: 'APPROVED', version_id: submitted.agentVersionId, visibility: 'PUBLIC' },
    } }),
  ]);
  require('../agent-marketplace/agent-ranking.service').invalidateRankingCache();
  return { approved: true, agentId: submitted.agentId };
}

async function rejectAgent(adminId, reviewId, input) {
  const submitted = await prisma.agentReviewRecord.findUnique({ where: { id: Number(reviewId) }, include: { agentVersion: true, targetAgent: true } });
  assert(submitted, '审核记录不存在', 40002, 404);
  const operationId = scopedOperationId(adminId, input.operationId, `reject-agent-review-${reviewId}`);
  const existing = await prisma.agentReviewRecord.findUnique({ where: { operationId } });
  if (existing) return { rejected: true, agentId: submitted.agentId };
  assert(submitted.agentVersion.reviewStatus === 'PENDING', '审核状态已发生变化，请刷新后重试。', 40901, 409);
  await prisma.$transaction([
    prisma.userAgentVersion.update({ where: { id: submitted.agentVersionId }, data: { reviewStatus: 'REJECTED', reviewReason: input.reason } }),
    prisma.userAgent.update({ where: { id: submitted.agentId }, data: { status: submitted.targetAgent.currentPublicVersionId ? 'PUBLIC' : 'REJECTED' } }),
    prisma.agentReviewRecord.create({ data: { agentId: submitted.agentId, agentVersionId: submitted.agentVersionId, reviewerUserId: adminId, action: 'REJECTED', reason: input.reason, operationId } }),
    prisma.operationLog.create({ data: {
      user_id: adminId, role: 'ADMIN', operation_type: 'REJECT_USER_AGENT', operation_desc: input.reason,
      target_type: 'user_agent', target_id: submitted.agentId, request_id: operationId, action_status: 'success',
      before_summary_json: { review_status: submitted.agentVersion.reviewStatus, version_id: submitted.agentVersionId },
      after_summary_json: { review_status: 'REJECTED', version_id: submitted.agentVersionId, reason: input.reason },
    } }),
  ]);
  require('../agent-marketplace/agent-ranking.service').invalidateRankingCache();
  return { rejected: true, agentId: submitted.agentId };
}

async function offlineAgent(adminId, agentId, rawOperationId, reason = '管理员下架') {
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), deletedAt: null } });
  assert(agent, '智能体不存在', 40002, 404);
  const operationId = scopedOperationId(adminId, rawOperationId, `offline-agent-${agent.id}`);
  const existing = await prisma.operationLog.findFirst({ where: { request_id: operationId, operation_type: 'OFFLINE_USER_AGENT' } });
  if (existing) return { offline: true, id: agent.id };
  assert(agent.status !== 'OFFLINE', '智能体已经下架，请刷新后重试。', 40901, 409);
  await prisma.$transaction([
    prisma.userAgent.update({ where: { id: agent.id }, data: { status: 'OFFLINE', visibility: 'PRIVATE' } }),
    prisma.operationLog.create({ data: {
      user_id: adminId, role: 'ADMIN', operation_type: 'OFFLINE_USER_AGENT', operation_desc: reason,
      target_type: 'user_agent', target_id: agent.id, request_id: operationId, action_status: 'success',
      before_summary_json: { status: agent.status, visibility: agent.visibility },
      after_summary_json: { status: 'OFFLINE', visibility: 'PRIVATE', reason },
    } }),
  ]);
  require('../agent-marketplace/agent-ranking.service').invalidateRankingCache();
  return { offline: true, id: agent.id };
}

const kbReviewInclude = { knowledgeBase: { include: { owner: { include: { profile: true } }, documents: { where: { deleted_at: null } }, agent_bindings: true } } };
function serializeKbReview(review) {
  const kb = review.knowledgeBase;
  return { id: review.id, submittedAt: review.createdAt, knowledgeBase: {
    id: kb.knowledge_base_id, name: kb.name, description: kb.description, visibility: kb.marketplace_visibility,
    status: kb.marketplace_status, owner: { id: kb.owner?.user_id, username: kb.owner?.username, name: kb.owner?.profile?.real_name || kb.owner?.username },
    boundAgentCount: kb.agent_bindings.length, documents: kb.documents.map((doc) => ({ id: doc.document_id, name: doc.original_filename, mimeType: doc.mime_type, sizeBytes: doc.file_size_bytes, status: doc.marketplace_status })),
  } };
}
async function listKnowledgeReviews() {
  const records = await prisma.knowledgeBaseReviewRecord.findMany({ where: { action: 'SUBMITTED', knowledgeBase: { marketplace_visibility: 'PUBLIC_PENDING', deleted_at: null } }, include: kbReviewInclude, orderBy: { createdAt: 'asc' } });
  return { list: records.map(serializeKbReview) };
}
async function getKnowledgeReview(id) {
  const record = await prisma.knowledgeBaseReviewRecord.findUnique({ where: { id: Number(id) }, include: kbReviewInclude });
  assert(record, '审核记录不存在', 40002, 404); return serializeKbReview(record);
}
async function reviewKnowledge(adminId, reviewId, input, approved) {
  const submitted = await prisma.knowledgeBaseReviewRecord.findUnique({ where: { id: Number(reviewId) }, include: { knowledgeBase: true } });
  assert(submitted, '审核记录不存在', 40002, 404);
  if (!approved) assert(input.reason, '驳回必须填写原因');
  const action = approved ? 'APPROVED' : 'REJECTED';
  const operationId = scopedOperationId(adminId, input.operationId, `${action.toLowerCase()}-kb-review-${reviewId}`);
  const existing = await prisma.knowledgeBaseReviewRecord.findUnique({ where: { operationId } });
  if (existing) return { approved, rejected: !approved, knowledgeBaseId: submitted.knowledgeBaseId };
  assert(submitted.knowledgeBase.marketplace_visibility === 'PUBLIC_PENDING', '审核状态已发生变化，请刷新后重试。', 40901, 409);
  await prisma.$transaction([
    prisma.knowledgeBase.update({ where: { knowledge_base_id: submitted.knowledgeBaseId }, data: { marketplace_visibility: approved ? 'PUBLIC' : 'REJECTED', marketplace_status: approved ? 'PUBLIC' : 'REJECTED' } }),
    prisma.knowledgeBaseReviewRecord.create({ data: { knowledgeBaseId: submitted.knowledgeBaseId, reviewerUserId: adminId, action, reason: input.reason || null, operationId } }),
    prisma.operationLog.create({ data: {
      user_id: adminId, role: 'ADMIN', operation_type: `${action}_AGENT_KNOWLEDGE_BASE`, operation_desc: input.reason || null,
      target_type: 'knowledge_base', target_id: submitted.knowledgeBaseId, request_id: operationId, action_status: 'success',
      before_summary_json: { visibility: submitted.knowledgeBase.marketplace_visibility, status: submitted.knowledgeBase.marketplace_status },
      after_summary_json: { visibility: approved ? 'PUBLIC' : 'REJECTED', status: approved ? 'PUBLIC' : 'REJECTED', reason: input.reason || null },
    } }),
  ]);
  return { approved, rejected: !approved, knowledgeBaseId: submitted.knowledgeBaseId };
}

async function listReports() {
  const reports = await prisma.agentReport.findMany({ where: { status: 'PENDING' }, include: { user: { include: { profile: true } }, agent: { include: { currentPublicVersion: true, creator: { include: { profile: true } } } } }, orderBy: { createdAt: 'asc' } });
  return { list: reports.map((item) => ({ id: item.id, reason: item.reason, detail: item.detail, status: item.status, createdAt: item.createdAt, reporter: { id: item.userId, name: item.user.profile?.real_name || item.user.username }, agent: { id: item.agentId, name: item.agent.currentPublicVersion?.name || '未命名智能体', creator: item.agent.creator.profile?.real_name || item.agent.creator.username } })) };
}
async function resolveReport(adminId, reportId, input) {
  const report = await prisma.agentReport.findUnique({ where: { id: Number(reportId) }, include: { agent: true } });
  assert(report, '举报不存在', 40002, 404);
  const operationId = scopedOperationId(adminId, input.operationId, `resolve-agent-report-${report.id}`);
  const existing = await prisma.operationLog.findFirst({ where: { request_id: operationId, operation_type: 'RESOLVE_AGENT_REPORT' } });
  if (existing) return { resolved: true, offline: Boolean(existing.after_summary_json?.offline_agent) };
  assert(report.status === 'PENDING', '举报已经处理，请刷新后重试。', 40901, 409);
  await prisma.$transaction(async (tx) => {
    await tx.agentReport.update({ where: { id: report.id }, data: { status: 'RESOLVED', resolverUserId: adminId, resolution: input.resolution, resolvedAt: new Date() } });
    if (input.offlineAgent) {
      await tx.userAgent.update({ where: { id: report.agentId }, data: { status: 'OFFLINE', visibility: 'PRIVATE' } });
      await tx.operationLog.create({ data: {
        user_id: adminId, role: 'ADMIN', operation_type: 'OFFLINE_USER_AGENT', operation_desc: input.resolution,
        target_type: 'user_agent', target_id: report.agentId, request_id: `${operationId}:offline`, action_status: 'success',
        before_summary_json: { status: report.agent.status, visibility: report.agent.visibility, source_report_id: report.id },
        after_summary_json: { status: 'OFFLINE', visibility: 'PRIVATE', source_report_id: report.id },
      } });
    }
    await tx.operationLog.create({ data: {
      user_id: adminId, role: 'ADMIN', operation_type: 'RESOLVE_AGENT_REPORT', operation_desc: input.resolution,
      target_type: 'agent_report', target_id: report.id, request_id: operationId, action_status: 'success',
      before_summary_json: { status: report.status, agent_id: report.agentId },
      after_summary_json: { status: 'RESOLVED', agent_id: report.agentId, resolution: input.resolution, offline_agent: input.offlineAgent },
    } });
  });
  require('../agent-marketplace/agent-ranking.service').invalidateRankingCache();
  return { resolved: true, offline: input.offlineAgent };
}

module.exports = { listAgentReviews, getAgentReview, approveAgent, rejectAgent, offlineAgent, listKnowledgeReviews, getKnowledgeReview, reviewKnowledge, listReports, resolveReport, serializeAgentReview, serializeKbReview };
