const prisma = require('../../../config/prisma');

const PENDING_STATUS = 'pending';
const CLAIMED_STATUS = 'applying';
const APPLIED_STATUS = 'applied';
const FAILED_STATUS = 'failed';
const EXPIRED_STATUS = 'expired';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildScopeAnd({ courseId, knowledgePointId, practiceSessionId }) {
  const scope = [
    { OR: [{ course_id: null }, { course_id: courseId }] },
    { OR: [{ knowledge_point_id: null }, { knowledge_point_id: knowledgePointId }] },
  ];
  if (practiceSessionId) {
    scope.push({ OR: [{ practice_session_id: null }, { practice_session_id: practiceSessionId }] });
  } else {
    scope.push({ practice_session_id: null });
  }
  return scope;
}

async function expireStaleInterventions({ studentUserId = null, targetAgent = null } = {}) {
  const now = new Date();
  return prisma.agentIntervention.updateMany({
    where: {
      status: PENDING_STATUS,
      expires_at: { lte: now },
      ...(studentUserId ? { student_user_id: studentUserId } : {}),
      ...(targetAgent ? { target_agent: targetAgent } : {}),
    },
    data: {
      status: EXPIRED_STATUS,
      result_json: {
        reason: 'expired_before_consumption',
        expiredAt: now.toISOString(),
      },
    },
  });
}

async function claimPendingIntervention({ studentUserId, targetAgent, courseId, knowledgePointId, practiceSessionId = null }) {
  if (!studentUserId || !targetAgent) return null;
  await expireStaleInterventions({ studentUserId, targetAgent });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const candidate = await prisma.agentIntervention.findFirst({
      where: {
        student_user_id: studentUserId,
        target_agent: targetAgent,
        status: PENDING_STATUS,
        OR: [
          { expires_at: null },
          { expires_at: { gt: now } },
        ],
        AND: buildScopeAnd({ courseId, knowledgePointId, practiceSessionId }),
      },
      orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    }).catch(() => null);
    if (!candidate) return null;

    const claimed = await prisma.agentIntervention.updateMany({
      where: {
        agent_intervention_id: candidate.agent_intervention_id,
        status: PENDING_STATUS,
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } },
        ],
      },
      data: {
        status: CLAIMED_STATUS,
        result_json: {
          ...asObject(candidate.result_json),
          claimedAt: new Date().toISOString(),
          claimedBy: targetAgent,
        },
      },
    });

    if (claimed.count === 1) {
      return prisma.agentIntervention.findUnique({
        where: { agent_intervention_id: candidate.agent_intervention_id },
      });
    }
  }
  return null;
}

async function applyClaimedIntervention(intervention, { runId = null, result = {} } = {}) {
  if (!intervention?.agent_intervention_id) return null;
  const now = new Date();
  const updated = await prisma.agentIntervention.updateMany({
    where: {
      agent_intervention_id: intervention.agent_intervention_id,
      status: CLAIMED_STATUS,
    },
    data: {
      status: APPLIED_STATUS,
      applied_at: now,
      applied_by_run_id: runId,
      result_json: {
        ...asObject(intervention.result_json),
        ...asObject(result),
        appliedAt: now.toISOString(),
      },
    },
  });
  if (updated.count !== 1) return null;
  return prisma.agentIntervention.findUnique({
    where: { agent_intervention_id: intervention.agent_intervention_id },
  });
}

async function failClaimedIntervention(intervention, { runId = null, error = null, result = {} } = {}) {
  if (!intervention?.agent_intervention_id) return null;
  const now = new Date();
  const updated = await prisma.agentIntervention.updateMany({
    where: {
      agent_intervention_id: intervention.agent_intervention_id,
      status: CLAIMED_STATUS,
    },
    data: {
      status: FAILED_STATUS,
      failed_at: now,
      applied_by_run_id: runId,
      result_json: {
        ...asObject(intervention.result_json),
        ...asObject(result),
        failedAt: now.toISOString(),
        errorCode: error?.code || 'INTERVENTION_CONSUMPTION_FAILED',
        message: String(error?.message || '干预消费失败').slice(0, 500),
      },
    },
  });
  if (updated.count !== 1) return null;
  return prisma.agentIntervention.findUnique({
    where: { agent_intervention_id: intervention.agent_intervention_id },
  });
}

module.exports = {
  APPLIED_STATUS,
  CLAIMED_STATUS,
  EXPIRED_STATUS,
  FAILED_STATUS,
  PENDING_STATUS,
  applyClaimedIntervention,
  claimPendingIntervention,
  expireStaleInterventions,
  failClaimedIntervention,
};
