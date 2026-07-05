// 错题标签服务
// 负责自定义标签的 CRUD 和关联管理

const prisma = require('../config/prisma');

/**
 * 获取用户的所有标签
 */
async function getUserTags(userId) {
  const tags = await prisma.wrongQuestionTag.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    include: {
      _count: { select: { relations: true } },
    },
  });

  return tags.map((t) => ({
    tag_id: t.tag_id,
    name: t.name,
    color: t.color,
    wrong_question_count: t._count.relations,
    created_at: t.created_at.toISOString(),
  }));
}

/**
 * 创建标签
 */
async function createTag(userId, { name, color }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName || normalizedName.length > 50) {
    throw Object.assign(new Error('标签名称不合法（1-50字符）'), { code: 40001 });
  }

  const existing = await prisma.wrongQuestionTag.findUnique({
    where: { user_id_name: { user_id: userId, name: normalizedName } },
  });
  if (existing) {
    throw Object.assign(new Error('标签名称已存在'), { code: 40001 });
  }

  const tag = await prisma.wrongQuestionTag.create({
    data: {
      user_id: userId,
      name: normalizedName,
      color: String(color || '').slice(0, 20) || null,
    },
  });

  return {
    tag_id: tag.tag_id,
    name: tag.name,
    color: tag.color,
    created_at: tag.created_at.toISOString(),
  };
}

/**
 * 更新标签
 */
async function updateTag(userId, tagId, { name, color }) {
  const tag = await prisma.wrongQuestionTag.findUnique({
    where: { tag_id: tagId },
  });
  if (!tag) {
    throw Object.assign(new Error('标签不存在'), { code: 40002 });
  }
  if (tag.user_id !== userId) {
    throw Object.assign(new Error('无权操作该标签'), { code: 40301 });
  }

  const updateData = {};
  if (name !== undefined) {
    const normalizedName = String(name).trim();
    if (!normalizedName || normalizedName.length > 50) {
      throw Object.assign(new Error('标签名称不合法'), { code: 40001 });
    }
    // 检查重名
    const duplicate = await prisma.wrongQuestionTag.findFirst({
      where: { user_id: userId, name: normalizedName, tag_id: { not: tagId } },
    });
    if (duplicate) {
      throw Object.assign(new Error('标签名称已存在'), { code: 40001 });
    }
    updateData.name = normalizedName;
  }
  if (color !== undefined) {
    updateData.color = String(color).slice(0, 20) || null;
  }

  const updated = await prisma.wrongQuestionTag.update({
    where: { tag_id: tagId },
    data: updateData,
  });

  return {
    tag_id: updated.tag_id,
    name: updated.name,
    color: updated.color,
  };
}

/**
 * 删除标签
 */
async function deleteTag(userId, tagId) {
  const tag = await prisma.wrongQuestionTag.findUnique({
    where: { tag_id: tagId },
  });
  if (!tag) {
    throw Object.assign(new Error('标签不存在'), { code: 40002 });
  }
  if (tag.user_id !== userId) {
    throw Object.assign(new Error('无权操作该标签'), { code: 40301 });
  }

  await prisma.wrongQuestionTag.delete({
    where: { tag_id: tagId },
  });

  return { deleted: true };
}

/**
 * 给错题添加标签
 */
async function addTagToWrongQuestion(userId, wrongQuestionId, tagId) {
  // 验证错题归属
  const wq = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
  });
  if (!wq) {
    throw Object.assign(new Error('错题记录不存在'), { code: 40002 });
  }
  if (wq.student_user_id !== userId) {
    throw Object.assign(new Error('无权操作该错题'), { code: 40301 });
  }

  // 验证标签归属
  const tag = await prisma.wrongQuestionTag.findUnique({
    where: { tag_id: tagId },
  });
  if (!tag) {
    throw Object.assign(new Error('标签不存在'), { code: 40002 });
  }
  if (tag.user_id !== userId) {
    throw Object.assign(new Error('无权使用该标签'), { code: 40301 });
  }

  await prisma.wrongQuestionTagRelation.upsert({
    where: {
      wrong_question_id_tag_id: {
        wrong_question_id: wrongQuestionId,
        tag_id: tagId,
      },
    },
    update: {},
    create: {
      wrong_question_id: wrongQuestionId,
      tag_id: tagId,
    },
  });

  return { success: true };
}

/**
 * 移除错题的标签
 */
async function removeTagFromWrongQuestion(userId, wrongQuestionId, tagId) {
  const wq = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
  });
  if (!wq || wq.student_user_id !== userId) {
    throw Object.assign(new Error('错题记录不存在或无权操作'), { code: 40301 });
  }

  await prisma.wrongQuestionTagRelation.deleteMany({
    where: {
      wrong_question_id: wrongQuestionId,
      tag_id: tagId,
    },
  });

  return { success: true };
}

/**
 * 批量添加标签到错题
 */
async function batchAddTagsToWrongQuestions(userId, wrongQuestionIds, tagIds) {
  if (!Array.isArray(wrongQuestionIds) || wrongQuestionIds.length === 0) {
    throw Object.assign(new Error('错题ID列表不能为空'), { code: 40001 });
  }
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    throw Object.assign(new Error('标签ID列表不能为空'), { code: 40001 });
  }

  // 验证所有错题归属
  const wqs = await prisma.wrongQuestion.findMany({
    where: {
      wrong_question_id: { in: wrongQuestionIds },
      student_user_id: userId,
    },
  });
  if (wqs.length !== wrongQuestionIds.length) {
    throw Object.assign(new Error('部分错题不存在或无权操作'), { code: 40301 });
  }

  // 验证所有标签归属
  const tags = await prisma.wrongQuestionTag.findMany({
    where: {
      tag_id: { in: tagIds },
      user_id: userId,
    },
  });
  if (tags.length !== tagIds.length) {
    throw Object.assign(new Error('部分标签不存在或无权操作'), { code: 40301 });
  }

  // 批量 upsert
  const operations = [];
  for (const wqId of wrongQuestionIds) {
    for (const tagId of tagIds) {
      operations.push(
        prisma.wrongQuestionTagRelation.upsert({
          where: {
            wrong_question_id_tag_id: {
              wrong_question_id: wqId,
              tag_id: tagId,
            },
          },
          update: {},
          create: {
            wrong_question_id: wqId,
            tag_id: tagId,
          },
        }),
      );
    }
  }

  await prisma.$transaction(operations);

  return { success: true, count: operations.length };
}

module.exports = {
  getUserTags,
  createTag,
  updateTag,
  deleteTag,
  addTagToWrongQuestion,
  removeTagFromWrongQuestion,
  batchAddTagsToWrongQuestions,
};
