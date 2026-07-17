const crypto = require('crypto');
const prisma = require('../../config/prisma');
const templateService = require('../learning-workflow/workflow-template.service');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');

function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function jsonValue(value, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function serialize(record, { valid = true, reason = null } = {}) {
  if (!record) return { active: false, valid: false, reason: reason || '尚未设置当前学习上下文' };
  return {
    id: record.id, active: record.isActive, valid, reason,
    courseId: record.courseId, knowledgePointId: record.knowledgePointId,
    learningGoalId: record.learningGoalId, workflowTemplateId: record.workflowTemplateId,
    targetMastery: record.targetMastery, completionMode: record.completionMode,
    learningPreference: record.learningPreferenceJson || {}, voiceConfig: record.voiceConfigJson || {},
    snapshot: record.contextSnapshotJson || {}, contextHash: record.contextHash,
    course: record.course ? { id: record.course.course_id, name: record.course.course_name } : null,
    knowledgePoint: record.knowledgePoint ? { id: record.knowledgePoint.knowledge_point_id, name: record.knowledgePoint.knowledge_point_name } : null,
    learningGoal: record.learningGoal ? { id: record.learningGoal.goal_id, title: record.learningGoal.normalized_title, status: record.learningGoal.status } : null,
    workflowTemplate: record.workflowTemplate ? { id: record.workflowTemplate.template_id, title: record.workflowTemplate.title, key: record.workflowTemplate.template_key } : null,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}

const include = { course: true, knowledgePoint: true, learningGoal: true, workflowTemplate: true };

async function validateTargets(userId, input) {
  const [enrollment, point, goal] = await Promise.all([
    prisma.studentCourseEnrollment.findFirst({ where: { student_user_id: userId, course_id: input.courseId, enrollment_status: 'active' } }),
    prisma.knowledgePoint.findFirst({ where: { knowledge_point_id: input.knowledgePointId, course_id: input.courseId } }),
    prisma.learningGoal.findUnique({ where: { goal_id: input.learningGoalId } }),
  ]);
  assert(enrollment, '当前课程未选修或已失效', 40301, 403);
  assert(point, '知识点不属于所选课程', 40001, 400);
  assert(goal && goal.student_user_id === userId, '学习目标不存在', 40401, 404);
  assert(goal.course_id === input.courseId, '学习目标与课程范围冲突', 40901, 409);
  const relatedIds = Array.isArray(goal.related_knowledge_points)
    ? goal.related_knowledge_points.map(item => Number(item?.knowledgePointId)).filter(Number.isInteger)
    : [];
  assert(!goal.primary_knowledge_point_id || goal.primary_knowledge_point_id === input.knowledgePointId || relatedIds.includes(input.knowledgePointId), '学习目标与知识点范围冲突', 40901, 409);
  assert(!['CANCELLED', 'FAILED', 'OUT_OF_SCOPE', 'INSUFFICIENT_COVERAGE'].includes(goal.status), '学习目标当前不可用', 40901, 409);
  let template;
  try {
    template = await templateService.getTemplate(input.workflowTemplateId, userId);
  } catch (error) {
    if (error?.status === 404) throw error;
    if (error?.status === 403) throw Object.assign(new Error('工作流当前不可见'), { code: 40301, status: 403 });
    throw error;
  }
  assert((!template.course_id || template.course_id === input.courseId) && (!template.knowledge_point_id || template.knowledge_point_id === input.knowledgePointId), '工作流模板与当前学习范围冲突', 40901, 409);
  return { point, goal, template };
}

async function buildSnapshot(userId, input, targets) {
  const [mastery, courseMastery, wrongGroups, recentStudy, resourceCount] = await Promise.all([
    prisma.studentMasteryRecord.findUnique({ where: { student_user_id_course_id_knowledge_point_id: { student_user_id: userId, course_id: input.courseId, knowledge_point_id: input.knowledgePointId } } }),
    prisma.studentMasteryRecord.findMany({ where: { student_user_id: userId, course_id: input.courseId }, include: { knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } } }, orderBy: { mastery_score: 'desc' } }),
    prisma.wrongQuestion.groupBy({ by: ['wrong_reason'], where: { student_user_id: userId, course_id: input.courseId, knowledge_point_id: input.knowledgePointId, status: 'UNRESOLVED' }, _count: { _all: true } }),
    prisma.studyRecord.findMany({ where: { student_user_id: userId, course_id: input.courseId, knowledge_point_id: input.knowledgePointId }, orderBy: { created_at: 'desc' }, take: 10, select: { action_type: true, duration_seconds: true, progress_percent: true, created_at: true } }),
    prisma.learningFlowResourceLink.count({ where: { ownerUserId: userId, courseId: input.courseId, knowledgePointId: input.knowledgePointId, deletedAt: null } }),
  ]);
  return {
    version: 1, capturedAt: new Date().toISOString(),
    scope: { courseId: input.courseId, knowledgePointId: input.knowledgePointId, learningGoalId: input.learningGoalId, workflowTemplateId: input.workflowTemplateId },
    labels: { knowledgePoint: targets.point.knowledge_point_name, learningGoal: targets.goal.normalized_title, workflowTemplate: targets.template.title },
    mastery: mastery ? { score: mastery.mastery_score, level: mastery.mastery_level, updatedAt: mastery.updated_at } : { score: 0, level: 'WEAK', updatedAt: null },
    unresolvedWrongQuestions: wrongGroups.reduce((sum, item) => sum + item._count._all, 0),
    wrongReasonDistribution: wrongGroups.map(item => ({ reason: item.wrong_reason || 'UNSPECIFIED', count: item._count._all })),
    recentStudy, linkedResourceCount: resourceCount,
    masteredKnowledgePoints: courseMastery.filter(item => item.mastery_score >= 80).slice(0, 8).map(item => ({ id: item.knowledge_point_id, name: item.knowledge_point.knowledge_point_name, score: item.mastery_score })),
    weakKnowledgePoints: courseMastery.filter(item => item.mastery_score < 60).slice(-8).map(item => ({ id: item.knowledge_point_id, name: item.knowledge_point.knowledge_point_name, score: item.mastery_score })),
    currentLearningProgress: recentStudy.length ? Math.round(recentStudy.reduce((sum, item) => sum + Number(item.progress_percent || 0), 0) / recentStudy.length) : 0,
    recommendedLearningMode: wrongGroups.length ? '先讲解错因，再进行针对性练习与总结' : (mastery?.mastery_score || 0) >= 80 ? '使用精炼复习与进阶练习巩固' : '先概念讲解和例题，再进入标准练习',
    targetMastery: input.targetMastery ?? targets.goal.target_mastery ?? 80,
    completionMode: input.completionMode, learningPreference: jsonValue(input.learningPreference), voiceConfig: jsonValue(input.voiceConfig),
  };
}

async function putContext(user, input) {
  const userId = Number(user.user_id); const targets = await validateTargets(userId, input);
  const safeInput = {
    ...input,
    learningPreference: jsonValue(input.learningPreference),
    voiceConfig: jsonValue(input.voiceConfig),
  };
  const snapshot = await buildSnapshot(userId, safeInput, targets); const contextHash = hash(snapshot);
  const record = await prisma.studentLearningContext.upsert({
    where: { userId },
    create: { userId, courseId: input.courseId, knowledgePointId: input.knowledgePointId, learningGoalId: input.learningGoalId, workflowTemplateId: input.workflowTemplateId, targetMastery: input.targetMastery ?? targets.goal.target_mastery ?? 80, completionMode: input.completionMode, learningPreferenceJson: safeInput.learningPreference, voiceConfigJson: safeInput.voiceConfig, contextSnapshotJson: snapshot, contextHash, isActive: true },
    update: { courseId: input.courseId, knowledgePointId: input.knowledgePointId, learningGoalId: input.learningGoalId, workflowTemplateId: input.workflowTemplateId, targetMastery: input.targetMastery ?? targets.goal.target_mastery ?? 80, completionMode: input.completionMode, learningPreferenceJson: safeInput.learningPreference, voiceConfigJson: safeInput.voiceConfig, contextSnapshotJson: snapshot, contextHash, isActive: true },
    include,
  });
  return serialize(record);
}

async function getContext(user, { refresh = false } = {}) {
  const userId = Number(user.user_id); let record = await prisma.studentLearningContext.findUnique({ where: { userId }, include });
  if (!record?.isActive) return serialize(null);
  try {
    const input = { courseId: record.courseId, knowledgePointId: record.knowledgePointId, learningGoalId: record.learningGoalId, workflowTemplateId: record.workflowTemplateId, targetMastery: record.targetMastery, completionMode: record.completionMode, learningPreference: record.learningPreferenceJson || {}, voiceConfig: record.voiceConfigJson || {} };
    const targets = await validateTargets(userId, input);
    if (refresh) {
      const snapshot = await buildSnapshot(userId, input, targets); record = await prisma.studentLearningContext.update({ where: { id: record.id }, data: { contextSnapshotJson: snapshot, contextHash: hash(snapshot) }, include });
    }
    return serialize(record);
  } catch (error) { return serialize(record, { valid: false, reason: error.message }); }
}

async function clearContext(user) {
  const result = await prisma.studentLearningContext.updateMany({ where: { userId: Number(user.user_id), isActive: true }, data: { isActive: false } });
  return { cleared: result.count > 0 };
}

module.exports = { serialize, validateTargets, buildSnapshot, putContext, getContext, clearContext };
