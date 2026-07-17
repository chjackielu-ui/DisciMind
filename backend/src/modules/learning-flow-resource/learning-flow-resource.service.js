const crypto = require('crypto');
const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const templateService = require('../learning-workflow/workflow-template.service');
const { exportFileExists } = require('../file-generator/generated-artifact.service');

const USABLE_ARTIFACT_STATUSES = ['CONTENT_READY', 'EXPORTING', 'READY', 'FAILED'];

function id(value) {
  return value == null || value === '' ? null : Number(value);
}

function makeLinkKey(input) {
  const material = [
    input.artifactId, input.courseId, input.knowledgePointId, input.learningGoalId,
    input.workflowTemplateId, input.learningSessionId, input.learningPlanId, input.resourceRole,
  ].map((value) => value == null ? '-' : String(value)).join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function serialize(link, downloadAvailable = false) {
  return {
    id: link.id,
    artifactId: link.artifactId,
    courseId: link.courseId,
    knowledgePointId: link.knowledgePointId,
    learningGoalId: link.learningGoalId,
    workflowTemplateId: link.workflowTemplateId,
    learningSessionId: link.learningSessionId,
    learningPlanId: link.learningPlanId,
    resourceRole: link.resourceRole,
    artifact: link.artifact ? {
      id: link.artifact.id, title: link.artifact.title, artifactType: link.artifact.artifactType,
      status: link.artifact.status, fileFormat: link.artifact.fileFormat,
      fileSizeBytes: link.artifact.fileSizeBytes == null ? null : Number(link.artifact.fileSizeBytes),
      downloadAvailable,
      createdAt: link.artifact.createdAt,
    } : null,
    course: link.course ? { id: link.course.course_id, name: link.course.course_name } : null,
    knowledgePoint: link.knowledgePoint ? { id: link.knowledgePoint.knowledge_point_id, name: link.knowledgePoint.knowledge_point_name } : null,
    learningGoal: link.learningGoal ? { id: link.learningGoal.goal_id, title: link.learningGoal.normalized_title } : null,
    workflowTemplate: link.workflowTemplate ? { id: link.workflowTemplate.template_id, title: link.workflowTemplate.title } : null,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

const include = {
  artifact: { include: { exports: { where: { deletedAt: null } } } },
  course: { select: { course_id: true, course_name: true } },
  knowledgePoint: { select: { knowledge_point_id: true, knowledge_point_name: true } },
  learningGoal: { select: { goal_id: true, normalized_title: true } },
  workflowTemplate: { select: { template_id: true, title: true } },
};

async function serializeWithAvailability(link) {
  if (!link.artifact) return serialize(link, false);
  const candidates = [link.artifact, ...(link.artifact.exports || [])];
  const availability = await Promise.all(candidates.map((record) => exportFileExists(record)));
  return serialize(link, availability.some(Boolean));
}

async function assertCourseAccess(userId, courseId) {
  if (!courseId) return null;
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: userId, course_id: courseId, enrollment_status: 'active' },
    select: { enrollment_id: true },
  });
  assert(enrollment, '你尚未加入所选课程', 40301, 403);
  return courseId;
}

async function validateTargets(userId, raw) {
  const input = {
    courseId: id(raw.courseId), knowledgePointId: id(raw.knowledgePointId), learningGoalId: id(raw.learningGoalId),
    workflowTemplateId: id(raw.workflowTemplateId), learningSessionId: id(raw.learningSessionId), learningPlanId: id(raw.learningPlanId), resourceRole: raw.resourceRole,
  };
  if (input.learningPlanId) {
    const plan = await prisma.studentLearningPlan.findFirst({ where: { id: input.learningPlanId, studentUserId: userId } });
    assert(plan, '学习计划不存在或无权访问', 40301, 403);
    assert(!input.courseId || plan.courseId === input.courseId, '资料课程与学习计划不一致', 40001, 400);
    assert(!input.knowledgePointId || plan.knowledgePointId === input.knowledgePointId || (plan.knowledgePointIdsJson || []).map(Number).includes(input.knowledgePointId), '资料知识点与学习计划不一致', 40001, 400);
    assert(!input.learningGoalId || plan.learningGoalId === input.learningGoalId, '资料目标与学习计划不一致', 40001, 400);
    assert(!input.workflowTemplateId || plan.workflowTemplateId === input.workflowTemplateId, '资料工作流与学习计划不一致', 40001, 400);
    input.courseId ||= plan.courseId; input.knowledgePointId ||= plan.knowledgePointId; input.learningGoalId ||= plan.learningGoalId;
    input.workflowTemplateId ||= plan.workflowTemplateId; input.learningSessionId ||= plan.learningSessionId;
  }
  await assertCourseAccess(userId, input.courseId);
  if (input.knowledgePointId) {
    const point = await prisma.knowledgePoint.findFirst({ where: { knowledge_point_id: input.knowledgePointId, course_id: input.courseId }, select: { knowledge_point_id: true } });
    assert(point, '知识点不属于所选课程', 40001, 400);
  }
  let goal;
  if (input.learningGoalId) {
    goal = await prisma.learningGoal.findFirst({ where: { goal_id: input.learningGoalId, student_user_id: userId } });
    assert(goal, '学习目标不存在或无权访问', 40301, 403);
    assert(!input.courseId || goal.course_id === input.courseId, '学习目标不属于所选课程', 40001, 400);
    assert(!input.knowledgePointId || !goal.primary_knowledge_point_id || goal.primary_knowledge_point_id === input.knowledgePointId, '学习目标不属于所选知识点', 40001, 400);
  }
  let template;
  if (input.workflowTemplateId) {
    template = await templateService.getTemplate(input.workflowTemplateId, userId);
    assert(!input.courseId || !template.course_id || template.course_id === input.courseId, '工作流模板不属于所选课程', 40001, 400);
  }
  if (input.learningSessionId) {
    const session = await prisma.learningSession.findFirst({ where: { session_id: input.learningSessionId, student_user_id: userId } });
    assert(session, '学习会话不存在或无权访问', 40301, 403);
    assert(!input.courseId || !session.course_id || session.course_id === input.courseId, '学习会话不属于所选课程', 40001, 400);
    assert(!input.knowledgePointId || !session.knowledge_point_id || session.knowledge_point_id === input.knowledgePointId, '学习会话不属于所选知识点', 40001, 400);
    assert(!input.learningGoalId || !session.learning_goal_id || session.learning_goal_id === input.learningGoalId, '学习会话与学习目标不一致', 40001, 400);
    assert(!input.workflowTemplateId || !session.workflow_template_id || session.workflow_template_id === input.workflowTemplateId, '学习会话与工作流模板不一致', 40001, 400);
  }
  return input;
}

async function createLink(user, artifactId, raw) {
  const userId = Number(user.user_id);
  const artifact = await prisma.generatedArtifact.findFirst({ where: { id: Number(artifactId), ownerUserId: userId, deletedAt: null } });
  assert(artifact, '文件不存在或无权访问', 40301, 403);
  assert(USABLE_ARTIFACT_STATUSES.includes(artifact.status) && artifact.contentSchemaJson, '资料内容尚未准备好，不能加入学习流', 40901, 409);
  const input = await validateTargets(userId, raw);
  const linkKey = makeLinkKey({ artifactId: artifact.id, ...input });
  const existing = await prisma.learningFlowResourceLink.findUnique({ where: { linkKey }, include });
  if (existing) {
    assert(existing.ownerUserId === userId, '关联目标不可用', 40301, 403);
    if (existing.deletedAt) {
      return serialize(await prisma.learningFlowResourceLink.update({ where: { id: existing.id }, data: { deletedAt: null, createdBy: userId }, include }));
    }
    return serialize(existing);
  }
  try {
    return serialize(await prisma.learningFlowResourceLink.create({
      data: { ownerUserId: userId, artifactId: artifact.id, ...input, linkKey, createdBy: userId }, include,
    }));
  } catch (error) {
    if (error.code === 'P2002') {
      const duplicate = await prisma.learningFlowResourceLink.findUnique({ where: { linkKey }, include });
      if (duplicate?.ownerUserId === userId) return serialize(duplicate);
    }
    throw error;
  }
}

async function listResources(user, query) {
  const where = { ownerUserId: Number(user.user_id), deletedAt: null };
  for (const field of ['courseId', 'knowledgePointId', 'learningGoalId', 'workflowTemplateId', 'learningSessionId', 'learningPlanId', 'resourceRole']) {
    if (query[field] != null) where[field] = query[field];
  }
  const [records, total] = await Promise.all([
    prisma.learningFlowResourceLink.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.learningFlowResourceLink.count({ where }),
  ]);
  return { list: await Promise.all(records.map(serializeWithAvailability)), total, page: query.page, pageSize: query.pageSize };
}

async function getResource(user, linkId) {
  const link = await prisma.learningFlowResourceLink.findFirst({ where: { id: Number(linkId), ownerUserId: Number(user.user_id), deletedAt: null }, include });
  assert(link, '学习资料关联不存在或无权访问', 40301, 403);
  return serializeWithAvailability(link);
}

async function unlink(user, linkId) {
  const link = await prisma.learningFlowResourceLink.findFirst({ where: { id: Number(linkId), ownerUserId: Number(user.user_id), deletedAt: null }, select: { id: true } });
  assert(link, '学习资料关联不存在或无权访问', 40301, 403);
  await prisma.learningFlowResourceLink.update({ where: { id: link.id }, data: { deletedAt: new Date() } });
  return { unlinked: true, artifactDeleted: false };
}

module.exports = { USABLE_ARTIFACT_STATUSES, makeLinkKey, serialize, serializeWithAvailability, validateTargets, createLink, listResources, getResource, unlink };
