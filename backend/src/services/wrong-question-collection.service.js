// 错题系列服务
// 负责错题系列的 CRUD 和题目管理

const prisma = require('../config/prisma');

/**
 * 获取用户的所有错题系列
 */
async function getUserCollections(userId) {
  const collections = await prisma.wrongQuestionCollection.findMany({
    where: { user_id: userId },
    orderBy: { updated_at: 'desc' },
    include: {
      _count: { select: { items: true } },
    },
  });

  return collections.map((c) => ({
    collection_id: c.collection_id,
    name: c.name,
    description: c.description,
    wrong_question_count: c._count.items,
    created_at: c.created_at.toISOString(),
    updated_at: c.updated_at.toISOString(),
  }));
}

/**
 * 获取错题系列详情（含题目列表）
 */
async function getCollectionDetail(userId, collectionId) {
  const collection = await prisma.wrongQuestionCollection.findUnique({
    where: { collection_id: collectionId },
    include: {
      items: {
        orderBy: { sort_order: 'asc' },
        include: {
          wrong_question: {
            include: {
              question: {
                include: {
                  options: { orderBy: { option_order: 'asc' } },
                },
              },
              knowledge_point: true,
              course: true,
            },
          },
        },
      },
    },
  });

  if (!collection) {
    throw Object.assign(new Error('错题系列不存在'), { code: 40002 });
  }
  if (collection.user_id !== userId) {
    throw Object.assign(new Error('无权查看该错题系列'), { code: 40301 });
  }

  return {
    collection_id: collection.collection_id,
    name: collection.name,
    description: collection.description,
    items: collection.items.map((item) => ({
      item_id: item.item_id,
      sort_order: item.sort_order,
      wrong_question_id: item.wrong_question.wrong_question_id,
      question_id: item.wrong_question.question_id,
      question_content: item.wrong_question.question?.content?.slice(0, 120) || '',
      course_name: item.wrong_question.course?.course_name || null,
      knowledge_point_name:
        item.wrong_question.knowledge_point?.knowledge_point_name || null,
    })),
    created_at: collection.created_at.toISOString(),
    updated_at: collection.updated_at.toISOString(),
  };
}

/**
 * 创建错题系列
 */
async function createCollection(userId, { name, description, wrongQuestionIds }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName || normalizedName.length > 100) {
    throw Object.assign(new Error('系列名称不合法（1-100字符）'), { code: 40001 });
  }

  const collection = await prisma.wrongQuestionCollection.create({
    data: {
      user_id: userId,
      name: normalizedName,
      description: String(description || '').slice(0, 1000) || null,
    },
  });

  // 如果有初始题目，添加进去
  if (Array.isArray(wrongQuestionIds) && wrongQuestionIds.length > 0) {
    const uniqueIds = [...new Set(wrongQuestionIds)];
    // 验证归属
    const wqs = await prisma.wrongQuestion.findMany({
      where: {
        wrong_question_id: { in: uniqueIds },
        student_user_id: userId,
      },
    });
    const validIds = wqs.map((w) => w.wrong_question_id);

    if (validIds.length > 0) {
      await prisma.wrongQuestionCollectionItem.createMany({
        data: validIds.map((wqId, idx) => ({
          collection_id: collection.collection_id,
          wrong_question_id: wqId,
          sort_order: idx,
        })),
      });
    }
  }

  return {
    collection_id: collection.collection_id,
    name: collection.name,
    description: collection.description,
    created_at: collection.created_at.toISOString(),
  };
}

/**
 * 更新错题系列
 */
async function updateCollection(userId, collectionId, { name, description }) {
  const collection = await prisma.wrongQuestionCollection.findUnique({
    where: { collection_id: collectionId },
  });
  if (!collection) {
    throw Object.assign(new Error('错题系列不存在'), { code: 40002 });
  }
  if (collection.user_id !== userId) {
    throw Object.assign(new Error('无权操作该错题系列'), { code: 40301 });
  }

  const updateData = {};
  if (name !== undefined) {
    const normalizedName = String(name).trim();
    if (!normalizedName || normalizedName.length > 100) {
      throw Object.assign(new Error('系列名称不合法'), { code: 40001 });
    }
    updateData.name = normalizedName;
  }
  if (description !== undefined) {
    updateData.description = String(description).slice(0, 1000) || null;
  }

  const updated = await prisma.wrongQuestionCollection.update({
    where: { collection_id: collectionId },
    data: updateData,
  });

  return {
    collection_id: updated.collection_id,
    name: updated.name,
    description: updated.description,
    updated_at: updated.updated_at.toISOString(),
  };
}

/**
 * 删除错题系列
 */
async function deleteCollection(userId, collectionId) {
  const collection = await prisma.wrongQuestionCollection.findUnique({
    where: { collection_id: collectionId },
  });
  if (!collection) {
    throw Object.assign(new Error('错题系列不存在'), { code: 40002 });
  }
  if (collection.user_id !== userId) {
    throw Object.assign(new Error('无权操作该错题系列'), { code: 40301 });
  }

  await prisma.wrongQuestionCollection.delete({
    where: { collection_id: collectionId },
  });

  return { deleted: true };
}

/**
 * 向系列添加错题
 */
async function addItemsToCollection(userId, collectionId, wrongQuestionIds) {
  const collection = await prisma.wrongQuestionCollection.findUnique({
    where: { collection_id: collectionId },
  });
  if (!collection || collection.user_id !== userId) {
    throw Object.assign(new Error('错题系列不存在或无权操作'), { code: 40301 });
  }

  if (!Array.isArray(wrongQuestionIds) || wrongQuestionIds.length === 0) {
    throw Object.assign(new Error('题目列表不能为空'), { code: 40001 });
  }

  // 验证归属
  const wqs = await prisma.wrongQuestion.findMany({
    where: {
      wrong_question_id: { in: wrongQuestionIds },
      student_user_id: userId,
    },
  });

  // 获取当前最大 sort_order
  const maxItem = await prisma.wrongQuestionCollectionItem.findFirst({
    where: { collection_id: collectionId },
    orderBy: { sort_order: 'desc' },
    select: { sort_order: true },
  });
  let nextOrder = (maxItem?.sort_order || 0) + 1;

  let added = 0;
  for (const wq of wqs) {
    await prisma.wrongQuestionCollectionItem.upsert({
      where: {
        collection_id_wrong_question_id: {
          collection_id: collectionId,
          wrong_question_id: wq.wrong_question_id,
        },
      },
      update: {},
      create: {
        collection_id: collectionId,
        wrong_question_id: wq.wrong_question_id,
        sort_order: nextOrder++,
      },
    });
    added++;
  }

  return { added_count: added };
}

/**
 * 从系列移除错题
 */
async function removeItemFromCollection(userId, collectionId, wrongQuestionId) {
  const collection = await prisma.wrongQuestionCollection.findUnique({
    where: { collection_id: collectionId },
  });
  if (!collection || collection.user_id !== userId) {
    throw Object.assign(new Error('错题系列不存在或无权操作'), { code: 40301 });
  }

  await prisma.wrongQuestionCollectionItem.deleteMany({
    where: {
      collection_id: collectionId,
      wrong_question_id: wrongQuestionId,
    },
  });

  return { success: true };
}

module.exports = {
  getUserCollections,
  getCollectionDetail,
  createCollection,
  updateCollection,
  deleteCollection,
  addItemsToCollection,
  removeItemFromCollection,
};
