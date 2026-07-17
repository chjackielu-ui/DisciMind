// 错题服务
// 负责错题记录的创建、查询、更新、统计、分类树等
// 按 student_user_id + question_id 唯一键 upsert

const prisma = require('../config/prisma');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function toPositiveInt(value, required = false) {
  if (value == null || value === '') {
    if (required) throw Object.assign(new Error('参数不合法'), { code: 40001 });
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return parsed;
}

function parsePagination(query) {
  let page = Number.parseInt(query.page, 10);
  let pageSize = Number.parseInt(query.pageSize ?? query.page_size, 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 100) pageSize = 100;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

const VALID_REVIEW_STATUSES = new Set([
  'PENDING_REVIEW', 'REINFORCING', 'WRONG_AGAIN', 'MASTERED', 'IGNORED',
]);
const VALID_WRONG_REASONS = new Set([
  'CONCEPT_MISUNDERSTANDING', 'MEMORY_WEAK', 'FORMULA_ERROR',
  'CALCULATION_ERROR', 'QUESTION_READING_ERROR', 'METHOD_SELECTION_ERROR',
  'CARELESS', 'TIME_INSUFFICIENT', 'UNKNOWN', 'OTHER',
]);

const QUESTION_TYPE_TO_PRISMA = {
  single_choice: 'SINGLE_CHOICE',
  multiple_choice: 'MULTIPLE_CHOICE',
  fill_blank: 'FILL_BLANK',
  blank: 'BLANK',
  true_false: 'TRUE_FALSE',
  short_answer: 'SHORT_ANSWER',
  programming: 'PROGRAMMING',
};

const DIFFICULTY_TO_PRISMA = {
  basic: 'BASIC',
  medium: 'MEDIUM',
  hard: 'HARD',
};

// ========================
// 概览统计
// ========================

/**
 * 获取错题概览统计数据
 */
async function getOverview(userId, courseId) {
  const courseFilter = courseId ? { course_id: courseId } : {};

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalCount, reviewStatusCounts, weeklyNew, weeklyCompleted, topKnowledgePoints] =
    await Promise.all([
      // 总数（排除已删除）
      prisma.wrongQuestion.count({
        where: { student_user_id: userId, status: { not: 'REMOVED' }, ...courseFilter },
      }),
      // 按 review_status 分组统计
      prisma.wrongQuestion.groupBy({
        by: ['review_status'],
        where: { student_user_id: userId, status: { not: 'REMOVED' }, ...courseFilter },
        _count: { wrong_question_id: true },
      }),
      // 本周新增
      prisma.wrongQuestion.count({
        where: {
          student_user_id: userId,
          status: { not: 'REMOVED' },
          created_at: { gte: weekAgo },
          ...courseFilter,
        },
      }),
      // 本周完成重做
      prisma.wrongQuestion.count({
        where: {
          student_user_id: userId,
          last_reviewed_at: { gte: weekAgo },
          ...courseFilter,
        },
      }),
      // 错题最多的3个知识点
      prisma.wrongQuestion.groupBy({
        by: ['knowledge_point_id'],
        where: {
          student_user_id: userId,
          status: { not: 'REMOVED' },
          knowledge_point_id: { not: null },
          ...courseFilter,
        },
        _count: { wrong_question_id: true },
        orderBy: { _count: { wrong_question_id: 'desc' } },
        take: 3,
      }),
    ]);

  // 构建 review_status 计数
  const statusMap = {};
  for (const item of reviewStatusCounts) {
    if (item.review_status) {
      statusMap[toLower(item.review_status)] = item._count.wrong_question_id;
    }
  }

  // 获取知识点名称
  const kpIds = topKnowledgePoints.map((k) => k.knowledge_point_id).filter(Boolean);
  const kpMap = {};
  if (kpIds.length > 0) {
    const kps = await prisma.knowledgePoint.findMany({
      where: { knowledge_point_id: { in: kpIds } },
      select: { knowledge_point_id: true, knowledge_point_name: true },
    });
    for (const kp of kps) {
      kpMap[kp.knowledge_point_id] = kp.knowledge_point_name;
    }
  }

  return {
    total: totalCount,
    pending_review: statusMap['pending_review'] || 0,
    reinforcing: statusMap['reinforcing'] || 0,
    wrong_again: statusMap['wrong_again'] || 0,
    mastered: statusMap['mastered'] || 0,
    ignored: statusMap['ignored'] || 0,
    weekly_new: weeklyNew,
    weekly_completed: weeklyCompleted,
    top_knowledge_points: topKnowledgePoints.map((k) => ({
      knowledge_point_id: k.knowledge_point_id,
      knowledge_point_name: kpMap[k.knowledge_point_id] || null,
      wrong_count: k._count.wrong_question_id,
    })),
  };
}

// ========================
// 分类树
// ========================

/**
 * 获取课程→章节→知识点的分类树（含错题数）
 */
async function getTaxonomy(userId, courseId) {
  // 获取用户所有错题的课程列表
  const courseFilter = courseId ? { course_id: courseId } : {};

  const courseWQs = await prisma.wrongQuestion.groupBy({
    by: ['course_id'],
    where: { student_user_id: userId, status: { not: 'REMOVED' }, ...courseFilter },
    _count: { wrong_question_id: true },
  });

  const courseIds = courseWQs.map((c) => c.course_id).filter(Boolean);
  if (courseIds.length === 0) return [];

  const courses = await prisma.course.findMany({
    where: { course_id: { in: courseIds } },
    select: { course_id: true, course_name: true },
  });
  const courseMap = {};
  for (const c of courses) courseMap[c.course_id] = c;

  // 获取这些课程的章节
  const chapters = await prisma.chapter.findMany({
    where: { course_id: { in: courseIds } },
    orderBy: { chapter_order: 'asc' },
    select: { chapter_id: true, course_id: true, chapter_name: true },
  });

  // 按章节统计错题
  const chapterWQs = await prisma.wrongQuestion.groupBy({
    by: ['chapter_id'],
    where: {
      student_user_id: userId,
      status: { not: 'REMOVED' },
      chapter_id: { not: null },
      ...courseFilter,
    },
    _count: { wrong_question_id: true },
  });
  const chapterCountMap = {};
  for (const c of chapterWQs) chapterCountMap[c.chapter_id] = c._count.wrong_question_id;

  // 获取知识点
  const kps = await prisma.knowledgePoint.findMany({
    where: { course_id: { in: courseIds } },
    orderBy: { sort_order: 'asc' },
    select: {
      knowledge_point_id: true,
      course_id: true,
      chapter_id: true,
      knowledge_point_name: true,
    },
  });

  // 按知识点统计错题
  const kpWQs = await prisma.wrongQuestion.groupBy({
    by: ['knowledge_point_id'],
    where: {
      student_user_id: userId,
      status: { not: 'REMOVED' },
      knowledge_point_id: { not: null },
      ...courseFilter,
    },
    _count: { wrong_question_id: true },
  });
  const kpCountMap = {};
  for (const k of kpWQs) kpCountMap[k.knowledge_point_id] = k._count.wrong_question_id;

  // 组装树形结构
  const courseCountMap = {};
  for (const c of courseWQs) courseCountMap[c.course_id] = c._count.wrong_question_id;

  const result = [];
  for (const cwq of courseWQs) {
    const course = courseMap[cwq.course_id];
    if (!course) continue;

    const courseChapters = chapters.filter((ch) => ch.course_id === cwq.course_id);
    const chapterNodes = courseChapters.map((ch) => {
      const chKps = kps.filter((kp) => kp.chapter_id === ch.chapter_id);
      const kpNodes = chKps
        .filter((kp) => (kpCountMap[kp.knowledge_point_id] || 0) > 0)
        .map((kp) => ({
          knowledge_point_id: kp.knowledge_point_id,
          knowledge_point_name: kp.knowledge_point_name,
          wrong_count: kpCountMap[kp.knowledge_point_id] || 0,
        }));

      return {
        chapter_id: ch.chapter_id,
        chapter_name: ch.chapter_name,
        wrong_count: chapterCountMap[ch.chapter_id] || 0,
        knowledge_points: kpNodes,
      };
    });

    result.push({
      course_id: course.course_id,
      course_name: course.course_name,
      wrong_count: courseCountMap[course.course_id] || 0,
      chapters: chapterNodes,
    });
  }

  return result;
}

// ========================
// 多条件查询
// ========================

/**
 * 多条件查询错题列表（后端实现全部筛选）
 */
async function queryWrongQuestions(userId, query = {}) {
  const { page, pageSize, skip } = parsePagination(query);

  // 构建 where 条件
  const where = {
    student_user_id: userId,
    status: { not: 'REMOVED' },
  };

  const courseId = toPositiveInt(query.courseId ?? query.course_id);
  if (courseId) where.course_id = courseId;

  const chapterId = toPositiveInt(query.chapterId ?? query.chapter_id);
  if (chapterId) where.chapter_id = chapterId;

  const knowledgePointId = toPositiveInt(
    query.knowledgePointId ?? query.knowledge_point_id,
  );
  if (knowledgePointId) where.knowledge_point_id = knowledgePointId;

  // 错误原因筛选
  const wrongReason = String(query.wrongReason ?? query.wrong_reason ?? '').toUpperCase();
  if (wrongReason && VALID_WRONG_REASONS.has(wrongReason)) {
    where.wrong_reason = wrongReason;
  }

  // 学习状态筛选
  const reviewStatus = String(query.reviewStatus ?? query.review_status ?? '').toUpperCase();
  if (reviewStatus && VALID_REVIEW_STATUSES.has(reviewStatus)) {
    where.review_status = reviewStatus;
  }

  // 题型筛选（需要 join question 表）
  const questionType = toLower(query.questionType ?? query.question_type);
  const questionWhere = {};
  if (questionType && QUESTION_TYPE_TO_PRISMA[questionType]) {
    questionWhere.question_type = QUESTION_TYPE_TO_PRISMA[questionType];
  }

  // 难度筛选
  const difficulty = toLower(query.difficulty);
  if (difficulty && DIFFICULTY_TO_PRISMA[difficulty]) {
    questionWhere.difficulty_level = DIFFICULTY_TO_PRISMA[difficulty];
  }

  // 标签筛选
  const tagsStr = query.tags;
  let tagFilter = null;
  if (tagsStr) {
    const tagIds = String(tagsStr)
      .split(',')
      .map((s) => toPositiveInt(s.trim()))
      .filter(Boolean);
    if (tagIds.length > 0) {
      tagFilter = { some: { tag_id: { in: tagIds } } };
    }
  }

  // 错题系列筛选
  const collectionId = toPositiveInt(query.collectionId ?? query.collection_id);
  let collectionFilter = null;
  if (collectionId) {
    collectionFilter = { some: { collection_id: collectionId } };
  }

  // 搜索关键词
  const search = String(query.search ?? query.keyword ?? '').trim();

  // 组合 question 条件
  if (Object.keys(questionWhere).length > 0) {
    where.question = questionWhere;
  }

  if (tagFilter) {
    where.tag_relations = tagFilter;
  }

  if (collectionFilter) {
    where.collection_items = collectionFilter;
  }

  // 排序
  const sort = String(query.sort ?? 'recent').toLowerCase();
  let orderBy;
  switch (sort) {
    case 'wrong_count':
      orderBy = { updated_at: 'desc' }; // Fallback, wrong_count not a direct field
      break;
    case 'difficulty':
      orderBy = { question: { difficulty_level: 'asc' } };
      break;
    case 'last_reviewed':
      orderBy = { last_reviewed_at: 'desc' };
      break;
    case 'recent':
    default:
      orderBy = { updated_at: 'desc' };
      break;
  }

  // 如果有关键词搜索，需要在应用层过滤（Prisma 不支持跨表模糊搜索）
  const needClientFilter = search.length > 0;

  const include = {
    course: true,
    chapter: true,
    knowledge_point: true,
    question: {
      include: {
        options: { orderBy: { option_order: 'asc' } },
      },
    },
    tag_relations: {
      include: { tag: true },
    },
  };

  const [items, total] = await Promise.all([
    prisma.wrongQuestion.findMany({
      where,
      orderBy,
      skip: needClientFilter ? 0 : skip,
      take: needClientFilter ? 1000 : pageSize, // 关键词搜索时取更多数据前端分页
      include,
    }),
    prisma.wrongQuestion.count({ where }),
  ]);

  // 前端关键词过滤
  let filteredItems = items;
  if (needClientFilter) {
    const kw = search.toLowerCase();
    filteredItems = items.filter((item) => {
      const content = (item.question?.content || '').toLowerCase();
      const title = (item.question?.title || '').toLowerCase();
      const kpName = (item.knowledge_point?.knowledge_point_name || '').toLowerCase();
      const analysis = (item.question?.analysis || '').toLowerCase();
      return content.includes(kw) || title.includes(kw) || kpName.includes(kw) || analysis.includes(kw);
    });
    // 分页
    const pagedItems = filteredItems.slice(skip, skip + pageSize);
    return {
      list: pagedItems.map(formatWrongQuestionItem),
      total: filteredItems.length,
      page,
      page_size: pageSize,
    };
  }

  return {
    list: items.map(formatWrongQuestionItem),
    total,
    page,
    page_size: pageSize,
  };
}

function formatWrongQuestionItem(item) {
  const q = item.question || {};
  return {
    wrong_question_id: item.wrong_question_id,
    question_id: item.question_id,
    source_type: item.source_type,
    status: toLower(item.status),
    wrong_reason: toLower(item.wrong_reason),
    wrong_reason_source: toLower(item.wrong_reason_source),
    review_status: toLower(item.review_status),
    review_count: item.review_count,
    consecutive_correct_count: item.consecutive_correct_count,
    last_reviewed_at: item.last_reviewed_at ? item.last_reviewed_at.toISOString() : null,
    last_wrong_at: item.last_wrong_at ? item.last_wrong_at.toISOString() : null,
    mastered_at: item.mastered_at ? item.mastered_at.toISOString() : null,
    ignored_at: item.ignored_at ? item.ignored_at.toISOString() : null,
    course_id: item.course_id,
    course_name: item.course?.course_name || null,
    chapter_id: item.chapter_id,
    chapter_name: item.chapter?.chapter_name || null,
    knowledge_point_id: item.knowledge_point_id,
    knowledge_point_name: item.knowledge_point?.knowledge_point_name || null,
    question: q.question_id
      ? {
          question_id: q.question_id,
          question_type: toLower(q.question_type),
          title: q.title,
          question_content: q.content,
          difficulty_level: toLower(q.difficulty_level),
          score: q.score,
          is_ai_generated: q.is_ai_generated,
          source_type: toLower(q.source_type),
          correct_answer: q.correct_answer,
          answer_analysis: q.analysis,
          options: (q.options || []).map((opt) => ({
            option_id: opt.option_id,
            option_label: opt.option_key,
            option_content: opt.option_content,
          })),
        }
      : null,
    tags: (item.tag_relations || []).map((tr) => ({
      tag_id: tr.tag?.tag_id,
      name: tr.tag?.name,
      color: tr.tag?.color,
    })),
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

// ========================
// 单条更新
// ========================

/**
 * 更新单条错题信息
 */
async function updateWrongQuestion(userId, wrongQuestionId, data = {}) {
  const record = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
  });
  if (!record) {
    throw Object.assign(new Error('错题记录不存在'), { code: 40002 });
  }
  if (record.student_user_id !== userId) {
    throw Object.assign(new Error('无权操作该错题记录'), { code: 40301 });
  }

  const updateData = {};

  // 错误原因
  if (data.wrongReason !== undefined || data.wrong_reason !== undefined) {
    const reason = String(data.wrongReason ?? data.wrong_reason).toUpperCase();
    if (VALID_WRONG_REASONS.has(reason)) {
      updateData.wrong_reason = reason;
    }
  }

  // 错误原因来源
  if (data.wrongReasonSource !== undefined || data.wrong_reason_source !== undefined) {
    const source = String(
      data.wrongReasonSource ?? data.wrong_reason_source,
    ).toUpperCase();
    if (['USER', 'AI_SUGGESTED', 'SYSTEM'].includes(source)) {
      updateData.wrong_reason_source = source;
    }
  }

  // 学习状态
  if (data.reviewStatus !== undefined || data.review_status !== undefined) {
    const status = String(data.reviewStatus ?? data.review_status).toUpperCase();
    if (VALID_REVIEW_STATUSES.has(status)) {
      updateData.review_status = status;
      if (status === 'MASTERED') {
        updateData.mastered_at = new Date();
      }
      if (status === 'IGNORED') {
        updateData.ignored_at = new Date();
      }
    }
  }

  // 旧版状态兼容
  if (data.status !== undefined) {
    const status = String(data.status).toUpperCase();
    if (['UNRESOLVED', 'MASTERED', 'REMOVED'].includes(status)) {
      updateData.status = status;
      if (status === 'MASTERED') {
        updateData.review_status = 'MASTERED';
        updateData.mastered_at = new Date();
      }
    }
  }

  if (Object.keys(updateData).length === 0) {
    return formatWrongQuestionItem(record);
  }

  updateData.updated_at = new Date();

  const updated = await prisma.wrongQuestion.update({
    where: { wrong_question_id: wrongQuestionId },
    data: updateData,
    include: {
      course: true,
      chapter: true,
      knowledge_point: true,
      question: {
        include: {
          options: { orderBy: { option_order: 'asc' } },
        },
      },
      tag_relations: {
        include: { tag: true },
      },
    },
  });

  return formatWrongQuestionItem(updated);
}

/**
 * 获取单条错题详情
 */
async function getWrongQuestionDetail(userId, wrongQuestionId) {
  const record = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
    include: {
      course: true,
      chapter: true,
      knowledge_point: true,
      question: {
        include: {
          options: { orderBy: { option_order: 'asc' } },
        },
      },
      tag_relations: {
        include: { tag: true },
      },
    },
  });

  if (!record) {
    throw Object.assign(new Error('错题记录不存在'), { code: 40002 });
  }
  if (record.student_user_id !== userId) {
    throw Object.assign(new Error('无权查看该错题记录'), { code: 40301 });
  }

  return formatWrongQuestionItem(record);
}

// ========================
// 批量更新
// ========================

/**
 * 批量更新错题
 */
async function batchUpdateWrongQuestions(userId, ids, data = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw Object.assign(new Error('ids 参数不合法'), { code: 40001 });
  }
  if (ids.length > 200) {
    throw Object.assign(new Error('单次批量更新不能超过 200 条'), { code: 40001 });
  }

  // 验证所有权
  const records = await prisma.wrongQuestion.findMany({
    where: {
      wrong_question_id: { in: ids },
      student_user_id: userId,
    },
  });

  if (records.length !== ids.length) {
    throw Object.assign(new Error('部分错题记录不存在或无权操作'), { code: 40301 });
  }

  const updateData = { updated_at: new Date() };

  if (data.reviewStatus !== undefined || data.review_status !== undefined) {
    const status = String(data.reviewStatus ?? data.review_status).toUpperCase();
    if (VALID_REVIEW_STATUSES.has(status)) {
      updateData.review_status = status;
      if (status === 'MASTERED') updateData.mastered_at = new Date();
      if (status === 'IGNORED') updateData.ignored_at = new Date();
    }
  }
  if (data.wrongReason !== undefined || data.wrong_reason !== undefined) {
    const reason = String(data.wrongReason ?? data.wrong_reason).toUpperCase();
    if (VALID_WRONG_REASONS.has(reason)) updateData.wrong_reason = reason;
  }

  if (Object.keys(updateData).length <= 1) {
    // 只有 updated_at
    return { updated_count: ids.length };
  }

  await prisma.wrongQuestion.updateMany({
    where: {
      wrong_question_id: { in: ids },
      student_user_id: userId,
    },
    data: updateData,
  });

  return { updated_count: ids.length };
}

// ========================
// 重做结果更新学习状态
// ========================

/**
 * 重做练习后更新原错题的学习状态
 */
async function updateReviewStatus(userId, wrongQuestionId, result = {}) {
  const { isCorrect } = result;

  const record = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
  });
  if (!record) return null;
  if (record.student_user_id !== userId) return null;

  const updateData = {
    review_count: (record.review_count || 0) + 1,
    last_reviewed_at: new Date(),
    updated_at: new Date(),
  };

  if (isCorrect === true) {
    updateData.consecutive_correct_count = (record.consecutive_correct_count || 0) + 1;
    // 连续答对2次及以上 → 建议掌握
    if (updateData.consecutive_correct_count >= 2) {
      updateData.review_status = 'MASTERED';
      updateData.mastered_at = new Date();
      updateData.status = 'MASTERED';
    } else {
      updateData.review_status = 'REINFORCING';
    }
  } else {
    updateData.consecutive_correct_count = 0;
    updateData.review_status = 'WRONG_AGAIN';
    updateData.last_wrong_at = new Date();
    // 确保错题状态仍然是 UNRESOLVED
    if (record.status === 'MASTERED') {
      updateData.status = 'UNRESOLVED';
      updateData.mastered_at = null;
    }
  }

  const updated = await prisma.wrongQuestion.update({
    where: { wrong_question_id: wrongQuestionId },
    data: updateData,
  });

  return formatWrongQuestionItem(updated);
}

// ========================
// 核心：创建或更新错题（答题批改后调用）
// ========================

/**
 * 根据批改结果创建或更新错题记录
 *
 * @param {Object} params
 * @param {number} params.studentId - 学生用户 ID
 * @param {number} params.submissionId - 提交 ID
 * @param {string} params.sourceType - 错题来源
 * @param {Array} params.answerResults - 批改结果数组
 * @param {Object} params.questionMap - question_id → question 映射
 * @returns {Promise<{created: number, updated: number, resolved: number}>}
 */
async function createOrUpdateWrongQuestions({
  studentId,
  submissionId,
  answerResults,
  questionMap,
  sourceType = 'task_submission',
}) {
  let created = 0;
  let updated = 0;
  let resolved = 0;

  if (!answerResults || answerResults.length === 0) {
    return { created, updated, resolved };
  }

  for (const result of answerResults) {
    const question = questionMap[result.question_id];
    if (!question) continue;

    const isWrong =
      result.is_correct === false ||
      (result.score != null && result.max_score != null && result.score < result.max_score);
    const knowledgePointId = question.knowledge_point_id || null;
    const courseId = question.course_id || null;

    if (isWrong) {
      // 错题：创建或更新为 UNRESOLVED
      const existing = await prisma.wrongQuestion.findUnique({
        where: {
          student_user_id_question_id: {
            student_user_id: studentId,
            question_id: result.question_id,
          },
        },
      });

      if (existing) {
        // 已存在：更新状态，记录 last_wrong_at
        const updateData = {
          last_wrong_at: new Date(),
          updated_at: new Date(),
        };
        if (existing.status === 'MASTERED' || existing.status === 'REMOVED') {
          updateData.status = 'UNRESOLVED';
          updateData.mastered_at = null;
        }
        // 如果之前是 mastered，重置 review_status
        if (existing.review_status === 'MASTERED') {
          updateData.review_status = 'WRONG_AGAIN';
          updateData.consecutive_correct_count = 0;
        }
        await prisma.wrongQuestion.update({
          where: { wrong_question_id: existing.wrong_question_id },
          data: updateData,
        });
        updated++;
      } else {
        // 不存在：创建新记录
        await prisma.wrongQuestion.create({
          data: {
            student_user_id: studentId,
            question_id: result.question_id,
            course_id: courseId,
            knowledge_point_id: knowledgePointId,
            source_type: sourceType,
            status: 'UNRESOLVED',
            review_status: 'PENDING_REVIEW',
            last_wrong_at: new Date(),
          },
        });
        created++;
      }
    } else {
      // 答对了
      const existing = await prisma.wrongQuestion.findUnique({
        where: {
          student_user_id_question_id: {
            student_user_id: studentId,
            question_id: result.question_id,
          },
        },
      });

      if (existing && existing.status === 'UNRESOLVED') {
        // 记录重做成功
        const newConsecutive = (existing.consecutive_correct_count || 0) + 1;
        const updateData = {
          review_count: (existing.review_count || 0) + 1,
          last_reviewed_at: new Date(),
          consecutive_correct_count: newConsecutive,
          updated_at: new Date(),
        };

        if (newConsecutive >= 2) {
          updateData.status = 'MASTERED';
          updateData.review_status = 'MASTERED';
          updateData.mastered_at = new Date();
        } else {
          updateData.review_status = 'REINFORCING';
        }

        await prisma.wrongQuestion.update({
          where: { wrong_question_id: existing.wrong_question_id },
          data: updateData,
        });
        if (newConsecutive >= 2) resolved++;
      }
    }
  }

  return { created, updated, resolved };
}

// ========================
// 错题统计（按知识点聚合）
// ========================

/**
 * 获取学生的错题统计（按知识点聚合）
 */
async function getWrongQuestionStats(studentId, courseId) {
  const wrongQuestions = await prisma.wrongQuestion.findMany({
    where: {
      student_user_id: studentId,
      status: 'UNRESOLVED',
      ...(courseId ? { course_id: courseId } : {}),
    },
    include: {
      knowledge_point: true,
    },
  });

  // 按知识点聚合统计
  const statsMap = {};
  for (const wq of wrongQuestions) {
    const kpId = wq.knowledge_point_id;
    if (!kpId) continue;
    if (!statsMap[kpId]) {
      statsMap[kpId] = {
        knowledge_point_id: kpId,
        knowledge_point_name: wq.knowledge_point?.knowledge_point_name || null,
        wrong_count: 0,
      };
    }
    statsMap[kpId].wrong_count++;
  }

  return Object.values(statsMap).sort((a, b) => b.wrong_count - a.wrong_count);
}

module.exports = {
  getOverview,
  getTaxonomy,
  queryWrongQuestions,
  getWrongQuestionDetail,
  updateWrongQuestion,
  batchUpdateWrongQuestions,
  updateReviewStatus,
  createOrUpdateWrongQuestions,
  getWrongQuestionStats,
};
