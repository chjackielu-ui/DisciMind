// 学习流模板服务：列表、权限、版本、复制与安全删除。
const prisma = require('../../config/prisma');
const { createAgentError } = require('../agent/common/agent.errors');
const {
  validateGraphJson,
  validateSettingsJson,
  sanitizeGraphJson,
  sanitizeSettingsJson,
  MAX_TITLE_LENGTH,
} = require('./workflow-schema');

const TEMPLATE_SELECT = {
  template_id: true, template_key: true, title: true, description: true,
  owner_type: true, owner_user_id: true, course_id: true, knowledge_point_id: true,
  source_type: true, is_published: true, is_default: true, status: true,
  created_at: true, updated_at: true,
};
const VERSION_SELECT = {
  version_id: true, template_id: true, version_number: true, graph_json: true,
  settings_json: true, created_by: true, change_summary: true, created_at: true,
};

function asPositiveInt(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw createAgentError('INVALID_INPUT', `${label} 不合法`, 400);
  }
  return id;
}

function normaliseSource(source) {
  const value = String(source || 'ALL').toUpperCase();
  if (value === 'ALL') return null;
  if (value === 'MINE' || value === 'USER') return 'STUDENT';
  if (['SYSTEM', 'STUDENT', 'TEACHER'].includes(value)) return value;
  throw createAgentError('INVALID_INPUT', '学习流来源筛选不合法', 400);
}

async function assertScopeAccess(userId, courseId, knowledgePointId) {
  const normalizedCourseId = asPositiveInt(courseId, '课程');
  const normalizedKnowledgePointId = asPositiveInt(knowledgePointId, '知识点');
  if (!normalizedCourseId && normalizedKnowledgePointId) {
    throw createAgentError('INVALID_INPUT', '绑定知识点时必须同时绑定课程', 400);
  }
  if (!normalizedCourseId) return { courseId: null, knowledgePointId: null };

  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: Number(userId),
      course_id: normalizedCourseId,
      enrollment_status: 'active',
    },
    select: { enrollment_id: true },
  });
  if (!enrollment) throw createAgentError('COURSE_ACCESS_DENIED', '你尚未加入该课程', 403);

  if (normalizedKnowledgePointId) {
    const knowledgePoint = await prisma.knowledgePoint.findFirst({
      where: { knowledge_point_id: normalizedKnowledgePointId, course_id: normalizedCourseId },
      select: { knowledge_point_id: true },
    });
    if (!knowledgePoint) {
      throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '知识点不属于所选课程', 400);
    }
  }
  return { courseId: normalizedCourseId, knowledgePointId: normalizedKnowledgePointId };
}

async function getVisibleTemplate(templateId, userId) {
  const template = await prisma.learningWorkflowTemplate.findUnique({
    where: { template_id: Number(templateId) },
    select: {
      ...TEMPLATE_SELECT,
      versions: { select: VERSION_SELECT, orderBy: { version_number: 'desc' }, take: 1 },
      owner: { select: { username: true, user_id: true } },
      course: { select: { course_id: true, course_name: true } },
      knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } },
    },
  });
  if (!template || template.status !== 'active') {
    throw createAgentError('TEMPLATE_NOT_FOUND', '学习流不存在或已删除', 404);
  }
  const isOwner = template.owner_user_id === Number(userId);
  const isPublic = template.source_type === 'SYSTEM'
    || (template.source_type === 'TEACHER' && template.is_published);
  if (!isOwner && !isPublic) throw createAgentError('TEMPLATE_ACCESS_DENIED', '无权访问该学习流', 403);
  // 教师模板不是全站公开内容：即使直接猜到 ID，也必须属于该模板关联课程。
  if (!isOwner && template.source_type === 'TEACHER') {
    if (!template.course_id) throw createAgentError('TEMPLATE_ACCESS_DENIED', '教师学习流缺少课程范围', 403);
    const enrollment = await prisma.studentCourseEnrollment.findFirst({
      where: { student_user_id: Number(userId), course_id: template.course_id, enrollment_status: 'active' },
      select: { enrollment_id: true },
    });
    if (!enrollment) throw createAgentError('TEMPLATE_ACCESS_DENIED', '你未加入该教师学习流所属课程', 403);
  }
  return { ...template, latestVersion: template.versions[0] || null, versions: undefined };
}

async function isKnowledgeBaseEnabled(courseId) {
  if (!courseId) return false;
  return Boolean(await prisma.knowledgeBase.findFirst({ where: { course_id: Number(courseId), status: 'active' } }));
}

async function listTemplates({ userId, courseId, knowledgePointId, learningGoalId, source, search, page, pageSize } = {}) {
  const sourceType = normaliseSource(source);
  const enrolled = await prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: Number(userId), enrollment_status: 'active' },
    select: { course_id: true },
  });
  const courseIds = enrolled.map((item) => item.course_id);
  const visibility = {
    OR: [
      { source_type: 'SYSTEM' },
      { source_type: 'TEACHER', is_published: true, course_id: { in: courseIds } },
      { owner_user_id: Number(userId) },
    ],
  };
  const where = { status: 'active', ...visibility };
  if (sourceType === 'STUDENT') where.AND = [{ owner_user_id: Number(userId) }];
  else if (sourceType) where.AND = [{ source_type: sourceType }];
  if (search && String(search).trim()) {
    where.AND = [...(where.AND || []), {
      OR: [
        { title: { contains: String(search).trim() } },
        { description: { contains: String(search).trim() } },
      ],
    }];
  }
  const normalizedCourseId = asPositiveInt(courseId, '课程');
  const normalizedPointId = asPositiveInt(knowledgePointId, '知识点');
  if (normalizedPointId && !normalizedCourseId) throw createAgentError('INVALID_INPUT', '筛选知识点时必须同时提供课程', 400);
  let goal = null;
  if (learningGoalId) {
    goal = await prisma.learningGoal.findUnique({ where: { goal_id: asPositiveInt(learningGoalId, '学习目标') } });
    if (!goal || goal.student_user_id !== Number(userId)) throw createAgentError('GOAL_NOT_FOUND', '学习目标不存在', 404);
    const relatedIds = Array.isArray(goal.related_knowledge_points) ? goal.related_knowledge_points.map(item => Number(item?.knowledgePointId)) : [];
    if ((normalizedCourseId && goal.course_id !== normalizedCourseId) || (normalizedPointId && goal.primary_knowledge_point_id && goal.primary_knowledge_point_id !== normalizedPointId && !relatedIds.includes(normalizedPointId))) {
      throw createAgentError('GOAL_SCOPE_CONFLICT', '学习目标与当前范围冲突', 409);
    }
  }
  if (normalizedCourseId) where.AND = [...(where.AND || []), { OR: [{ course_id: null }, { course_id: normalizedCourseId }] }];
  if (normalizedPointId) where.AND = [...(where.AND || []), { OR: [{ knowledge_point_id: null }, { knowledge_point_id: normalizedPointId }] }];

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(48, Math.max(1, Number(pageSize) || 24));
  const [templates, total, allVisible] = await Promise.all([
    prisma.learningWorkflowTemplate.findMany({
      where,
      select: {
        ...TEMPLATE_SELECT,
        versions: { select: VERSION_SELECT, orderBy: { version_number: 'desc' }, take: 1 },
        course: { select: { course_id: true, course_name: true } },
        knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true } },
      },
      orderBy: [{ is_default: 'desc' }, { updated_at: 'desc' }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.learningWorkflowTemplate.count({ where }),
    prisma.learningWorkflowTemplate.findMany({
      where: { status: 'active', ...visibility },
      select: { template_id: true, source_type: true, owner_user_id: true },
    }),
  ]);

  const templateIds = templates.map((item) => item.template_id);
  const usageRows = templateIds.length ? await prisma.learningSession.groupBy({
    by: ['workflow_template_id', 'status'],
    where: { workflow_template_id: { in: templateIds } },
    _count: { _all: true },
  }) : [];
  const usageByTemplate = new Map();
  usageRows.forEach((row) => {
    const record = usageByTemplate.get(row.workflow_template_id) || { usage_count: 0, completion_count: 0 };
    record.usage_count += row._count._all;
    if (row.status === 'COMPLETED') record.completion_count += row._count._all;
    usageByTemplate.set(row.workflow_template_id, record);
  });
  const currentContext = prisma.studentLearningContext ? await prisma.studentLearningContext.findFirst({ where: { userId: Number(userId), isActive: true } }) : null;
  const preloadRows = templateIds.length && prisma.learningFlowPreload
    ? await prisma.learningFlowPreload.findMany({
      where: { userId: Number(userId), workflowTemplateId: { in: templateIds }, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    }) : [];
  const preloadByTemplate = new Map();
  preloadRows.forEach((item) => {
    if (currentContext && item.workflowTemplateId === currentContext.workflowTemplateId && item.learningGoalId !== currentContext.learningGoalId) return;
    if (!preloadByTemplate.has(item.workflowTemplateId)) preloadByTemplate.set(item.workflowTemplateId, item);
  });
  const counts = { all: allVisible.length, system: 0, mine: 0, teacher: 0 };
  allVisible.forEach((item) => {
    if (item.source_type === 'SYSTEM') counts.system += 1;
    else if (item.source_type === 'TEACHER') counts.teacher += 1;
    else if (item.owner_user_id === Number(userId)) counts.mine += 1;
  });
  return {
    items: templates.map((template) => ({
      ...template,
      latestVersion: template.versions[0] || null,
      versions: undefined,
      ...(usageByTemplate.get(template.template_id) || { usage_count: 0, completion_count: 0 }),
      can_edit: template.owner_user_id === Number(userId) && !['SYSTEM', 'TEACHER'].includes(template.source_type),
      can_delete: template.owner_user_id === Number(userId) && !['SYSTEM', 'TEACHER'].includes(template.source_type),
      recommendationRank: goal?.workflow_template_id === template.template_id ? 100
        : template.is_default ? 90
          : template.source_type === 'TEACHER' ? 80
            : template.source_type === 'SYSTEM' ? 70
              : template.owner_user_id === Number(userId) ? 60 : 0,
      recommendationReason: goal?.workflow_template_id === template.template_id ? '学习目标已匹配'
        : template.is_default ? '课程默认'
          : template.source_type === 'TEACHER' ? '教师推荐'
            : template.source_type === 'SYSTEM' ? '系统推荐' : '我的模板',
      ...(() => {
        const preload = preloadByTemplate.get(template.template_id);
        const expired = preload && new Date(preload.expiresAt).getTime() <= Date.now();
        return {
          preloadId: preload?.id || null,
          preloadStatus: expired ? 'EXPIRED' : (preload?.status || 'NOT_STARTED'),
          preloadReady: Boolean(preload && !expired && ['PARTIAL', 'READY'].includes(preload.status)),
          preloadProgress: expired ? 0 : (preload?.progress || 0),
          preloadStage: expired ? '准备内容已过期' : (preload?.stage || null),
          preloadExpiresAt: preload?.expiresAt || null,
          preloadLearningGoalId: preload?.learningGoalId || null,
        };
      })(),
    })).sort((a, b) => b.recommendationRank - a.recommendationRank || new Date(b.updated_at) - new Date(a.updated_at)),
    counts,
    pagination: { page: safePage, pageSize: safePageSize, total, totalPages: Math.ceil(total / safePageSize) },
  };
}

async function getTemplate(templateId, userId) {
  return getVisibleTemplate(templateId, userId);
}

async function createTemplate(data, userId) {
  const title = String(data.title || '').trim().slice(0, MAX_TITLE_LENGTH);
  if (!title) throw createAgentError('INVALID_INPUT', '学习流名称不能为空', 400);
  const graph = sanitizeGraphJson(data.graph_json || {});
  const settings = sanitizeSettingsJson(data.settings_json || {});
  const graphValidation = validateGraphJson(graph);
  if (!graphValidation.valid) throw createAgentError('INVALID_GRAPH', `流程校验失败: ${graphValidation.errors.join('；')}`, 400);
  const settingsValidation = validateSettingsJson(settings);
  if (!settingsValidation.valid) throw createAgentError('INVALID_SETTINGS', `流程设置不合法: ${settingsValidation.errors.join('；')}`, 400);
  const scope = await assertScopeAccess(userId, data.course_id, data.knowledge_point_id);
  const templateKey = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const templateId = await prisma.$transaction(async (tx) => {
    const template = await tx.learningWorkflowTemplate.create({
      data: {
        template_key: templateKey, title,
        description: String(data.description || '').trim().slice(0, 2000) || null,
        owner_type: 'STUDENT', owner_user_id: Number(userId),
        course_id: scope.courseId, knowledge_point_id: scope.knowledgePointId,
        source_type: 'STUDENT', is_published: false, is_default: false, status: 'active',
      },
    });
    await tx.learningWorkflowVersion.create({
      data: {
        template_id: template.template_id, version_number: 1, graph_json: graph, settings_json: settings,
        created_by: Number(userId), change_summary: '初始版本',
      },
    });
    return template.template_id;
  });
  return getTemplate(templateId, userId);
}

async function updateTemplate(templateId, data, userId) {
  const existing = await getVisibleTemplate(templateId, userId);
  if (existing.owner_user_id !== Number(userId) || ['SYSTEM', 'TEACHER'].includes(existing.source_type)) {
    throw createAgentError('TEMPLATE_ACCESS_DENIED', '系统和教师学习流不可直接编辑', 403);
  }
  const title = String(data.title ?? existing.title).trim().slice(0, MAX_TITLE_LENGTH);
  if (!title) throw createAgentError('INVALID_INPUT', '学习流名称不能为空', 400);
  const graph = sanitizeGraphJson(data.graph_json || existing.latestVersion?.graph_json || {});
  const settings = sanitizeSettingsJson(data.settings_json || existing.latestVersion?.settings_json || {});
  const graphValidation = validateGraphJson(graph);
  if (!graphValidation.valid) throw createAgentError('INVALID_GRAPH', `流程校验失败: ${graphValidation.errors.join('；')}`, 400);
  const scope = await assertScopeAccess(userId,
    data.course_id !== undefined ? data.course_id : existing.course_id,
    data.knowledge_point_id !== undefined ? data.knowledge_point_id : existing.knowledge_point_id);
  await prisma.$transaction(async (tx) => {
    const latest = await tx.learningWorkflowVersion.findFirst({
      where: { template_id: Number(templateId) }, orderBy: { version_number: 'desc' },
    });
    await tx.learningWorkflowTemplate.update({
      where: { template_id: Number(templateId) },
      data: {
        title,
        description: data.description === undefined ? existing.description : String(data.description || '').trim().slice(0, 2000) || null,
        course_id: scope.courseId, knowledge_point_id: scope.knowledgePointId,
      },
    });
    await tx.learningWorkflowVersion.create({
      data: {
        template_id: Number(templateId), version_number: (latest?.version_number || 0) + 1,
        graph_json: graph, settings_json: settings, created_by: Number(userId),
        change_summary: String(data.change_summary || '更新学习流').slice(0, 500),
      },
    });
  });
  return getTemplate(templateId, userId);
}

async function copyTemplate(templateId, userId) {
  const source = await getVisibleTemplate(templateId, userId);
  const version = source.latestVersion;
  if (!version) throw createAgentError('VERSION_NOT_FOUND', '学习流没有可用版本', 400);
  return createTemplate({
    title: `${source.title}（副本）`, description: source.description || '',
    course_id: source.course_id, knowledge_point_id: source.knowledge_point_id,
    graph_json: version.graph_json, settings_json: version.settings_json,
  }, userId);
}

async function deleteTemplates(templateIds, userId) {
  const ids = [...new Set((Array.isArray(templateIds) ? templateIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw createAgentError('INVALID_INPUT', '请至少选择一个学习流', 400);
  const templates = await prisma.learningWorkflowTemplate.findMany({
    where: { template_id: { in: ids } },
    select: { template_id: true, owner_user_id: true, source_type: true, _count: { select: { sessions: true } } },
  });
  if (templates.length !== ids.length || templates.some((item) => item.owner_user_id !== Number(userId) || ['SYSTEM', 'TEACHER'].includes(item.source_type))) {
    throw createAgentError('TEMPLATE_ACCESS_DENIED', '只能删除自己的学习流', 403);
  }
  const idsWithHistory = templates.filter((item) => item._count.sessions > 0).map((item) => item.template_id);
  const idsWithoutHistory = templates.filter((item) => item._count.sessions === 0).map((item) => item.template_id);
  await prisma.$transaction(async (tx) => {
    // 无学习历史时级联删除模板版本；已有会话时保留快照，只从可见列表归档。
    if (idsWithoutHistory.length) {
      await tx.learningWorkflowTemplate.deleteMany({ where: { template_id: { in: idsWithoutHistory }, owner_user_id: Number(userId) } });
    }
    if (idsWithHistory.length) {
      await tx.learningWorkflowTemplate.updateMany({
        where: { template_id: { in: idsWithHistory }, owner_user_id: Number(userId) },
        data: { status: 'archived' },
      });
    }
  });
  return { deletedCount: ids.length, archivedCount: idsWithHistory.length, deletedPermanently: idsWithoutHistory.length };
}

async function listVersions(templateId, userId) {
  const template = await getVisibleTemplate(templateId, userId);
  if (template.owner_user_id !== Number(userId)) throw createAgentError('TEMPLATE_ACCESS_DENIED', '无权查看版本记录', 403);
  return prisma.learningWorkflowVersion.findMany({ where: { template_id: Number(templateId) }, select: VERSION_SELECT, orderBy: { version_number: 'desc' } });
}

async function restoreVersion(templateId, versionId, userId) {
  const template = await getVisibleTemplate(templateId, userId);
  if (template.owner_user_id !== Number(userId) || ['SYSTEM', 'TEACHER'].includes(template.source_type)) throw createAgentError('TEMPLATE_ACCESS_DENIED', '无权恢复该版本', 403);
  const version = await prisma.learningWorkflowVersion.findFirst({ where: { version_id: Number(versionId), template_id: Number(templateId) } });
  if (!version) throw createAgentError('VERSION_NOT_FOUND', '版本不存在', 404);
  await updateTemplate(templateId, {
    title: template.title, description: template.description,
    graph_json: version.graph_json, settings_json: version.settings_json,
    change_summary: `从版本 ${version.version_number} 恢复`,
  }, userId);
  return getTemplate(templateId, userId);
}

// 保留教师端已有调用；学习流学生路由不会暴露为可写的教师接口。
async function publishTemplate(templateId, userId) {
  const template = await prisma.learningWorkflowTemplate.findUnique({ where: { template_id: Number(templateId) } });
  if (!template || template.owner_user_id !== Number(userId) || template.owner_type !== 'TEACHER') throw createAgentError('TEMPLATE_ACCESS_DENIED', '无权发布该模板', 403);
  await prisma.learningWorkflowTemplate.update({ where: { template_id: Number(templateId) }, data: { is_published: true } });
  return getTemplate(templateId, userId);
}
async function setDefaultTemplate(templateId, userId) {
  const template = await prisma.learningWorkflowTemplate.findUnique({ where: { template_id: Number(templateId) } });
  if (!template?.course_id || template.owner_user_id !== Number(userId) || template.owner_type !== 'TEACHER') throw createAgentError('TEMPLATE_ACCESS_DENIED', '无权设置课程默认学习流', 403);
  await prisma.$transaction([
    prisma.learningWorkflowTemplate.updateMany({ where: { course_id: template.course_id, is_default: true }, data: { is_default: false } }),
    prisma.learningWorkflowTemplate.update({ where: { template_id: Number(templateId) }, data: { is_default: true } }),
  ]);
  return getTemplate(templateId, userId);
}

module.exports = {
  isKnowledgeBaseEnabled, assertScopeAccess, listTemplates, getTemplate, createTemplate, updateTemplate,
  deleteTemplates, copyTemplate, listVersions, restoreVersion, publishTemplate, setDefaultTemplate,
};
