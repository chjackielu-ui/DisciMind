// 教师端看板与学情分析服务

const prisma = require('../config/prisma');
const keywordCloudService = require('./teacher-keyword-cloud.service');

// ---------- 词云停用词表（过滤无意义词语）----------
const STOP_WORDS = new Set([
  '你好', '谢谢', '感谢', '请问', '好的', '嗯', '哦', '啊', '哎',
  '这个', '那个', '就是', '然后', '感觉', '可以', '怎么', '如何',
  '为什么', '什么', '一个', '一下', '还有', '以及', '你说的',
  '是不是', '能不能', '不会', '我想', '帮我', '老师', '助手',
  '题目', '这道', '那道', '那个', '这些', '那些', '一些',
  '因为', '所以', '如果', '虽然', '但是', '而且', '或者',
  '没有', '不是', '我们', '他们', '你们', '自己', '知道',
  '问题', '时候', '这样', '那样', '之后', '之前', '现在',
  '已经', '可以', '应该', '可能', '需要', '通过', '进行',
  '使用', '利用', '实现', '基于', '相关', '主要', '比较',
  '其中', '之一', '包括', '比如', '例如', '叫做', '称为',
  '所谓', '关于', '对于', '按照', '根据', '因为', '由于',
  '因此', '从而', '从而', '最终', '首先', '其次', '最后',
  '目前', '当前', '一般', '通常', '往往', '容易', '很难',
  '完全', '基本', '某种', '多种', '不同', '各种', '大量',
  '很多', '不少', '少数', '部分', '其他', '别的', '整个',
  '第一', '第二', '第三', '第几', '第一个', '第二个',
  '一会儿', '快速', '详细', '简单', '复杂', '直接', '间接',
  '往往', '不断', '持续', '已经', '正在', '一直', '一直',
  '还是', '或是', '或是', '只是', '但是', '可是', '然而',
  '那么', '那么', '既然', '假如', '即使', '虽然', '固然',
  'hello', 'hi', 'ok', 'okay', 'thanks', 'thank', 'please',
  '知道', '明白', '懂了', '理解', '不清楚', '不明白', '不懂',
]);

// 学科概念映射（将同义表达归一化）
const SYNONYM_MAP = {
  'loss函数': '损失函数',
  'loss function': '损失函数',
  '损失函数': '损失函数',
  'lr': '学习率',
  'learning rate': '学习率',
  '学习率': '学习率',
  'activation': '激活函数',
  '激活函数': '激活函数',
  '激活': '激活函数',
  'bp': '反向传播',
  'back propagation': '反向传播',
  '反向传播': '反向传播',
  'cnn': '卷积神经网络',
  '卷积': '卷积神经网络',
  'rnn': '循环神经网络',
  'lstm': '长短期记忆网络',
  'transformer': 'Transformer',
  '注意力': '注意力机制',
  'attention': '注意力机制',
  'dropout': 'Dropout',
  '正则化': '正则化',
  '归一化': '归一化',
  '标准化': '标准化',
  '归一': '归一化',
  '标化': '标准化',
  '过拟合': '过拟合',
  '欠拟合': '欠拟合',
  '拟合': '拟合',
  'train': '训练集',
  'test': '测试集',
  '验证': '验证集',
  '数据集': '数据集',
};

// ---------- 辅助函数 ----------

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function toPositiveInt(value, fieldName, required = false) {
  if (value == null || value === '') {
    if (required) throw Object.assign(new Error(`${fieldName} 不能为空`), { code: 40001 });
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw Object.assign(new Error(`${fieldName} 参数不合法`), { code: 40001 });
  }
  return parsed;
}

function parseDate(value, fieldName) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`${fieldName} 日期格式不合法`), { code: 40001 });
  }
  return parsed;
}

async function getAccessibleCourseIds(user) {
  if (user.role === 'admin') return null;
  const relations = await prisma.courseTeacherRelation.findMany({
    where: { teacher_user_id: user.user_id },
    select: { course_id: true },
  });
  return relations.map((item) => item.course_id);
}

async function resolveCourseIds(user, query = {}) {
  const requestedCourseId = toPositiveInt(
    query.courseId ?? query.course_id,
    'course_id',
    false,
  );
  const accessibleCourseIds = await getAccessibleCourseIds(user);

  if (requestedCourseId) {
    if (accessibleCourseIds && !accessibleCourseIds.includes(requestedCourseId)) {
      throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
    }
    return [requestedCourseId];
  }
  return accessibleCourseIds;
}

async function ensureCourseAccess(user, courseId) {
  if (user.role === 'admin') return;
  const accessibleIds = await getAccessibleCourseIds(user);
  if (accessibleIds && !accessibleIds.includes(courseId)) {
    throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
  }
}

function getCourseFilter(courseIds) {
  if (!courseIds) return {};
  return { course_id: { in: courseIds } };
}

// ---------- 看板 ----------

async function getDashboard(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  // 教师管理的课程数和班级数
  const courses = courseIds
    ? await prisma.course.findMany({
        where: { course_id: { in: courseIds } },
        select: { course_id: true, course_name: true },
      })
    : [];

  const courseIdList = courses.map((c) => c.course_id);

  // 教学班级数
  const teachingClassCount = courseIdList.length > 0
    ? await prisma.teachingClass.count({
        where: { course_id: { in: courseIdList } },
      })
    : 0;

  // 学生总数
  const studentCount = courseIdList.length > 0
    ? await prisma.studentCourseEnrollment.groupBy({
        by: ['student_user_id'],
        where: {
          course_id: { in: courseIdList },
          enrollment_status: 'active',
        },
      })
    : [];

  // 平均掌握度
  const masteryAgg = courseIdList.length > 0
    ? await prisma.studentMasteryRecord.aggregate({
        _avg: { mastery_score: true },
        where: { course_id: { in: courseIdList } },
      })
    : { _avg: { mastery_score: null } };

  // 平均测试成绩（最近提交的会话）
  const sessionAgg = courseIdList.length > 0
    ? await prisma.practiceSession.aggregate({
        _avg: { total_score: true, max_score: true },
        where: {
          course_id: { in: courseIdList },
          status: { notIn: ['IN_PROGRESS', 'in_progress'] },
          total_score: { not: null },
          max_score: { not: null, gt: 0 },
        },
      })
    : { _avg: { total_score: null, max_score: null } };

  const averageTestScore = sessionAgg._avg.total_score != null && sessionAgg._avg.max_score > 0
    ? Math.round((sessionAgg._avg.total_score / sessionAgg._avg.max_score) * 100)
    : null;

  // AI 提问总数
  const aiQuestionCount = courseIdList.length > 0
    ? await prisma.studentQuestionRecord.count({
        where: { course_id: { in: courseIdList } },
      })
    : 0;

  // 薄弱知识点数量
  const weakKpCount = courseIdList.length > 0
    ? await prisma.studentMasteryRecord.count({
        where: {
          course_id: { in: courseIdList },
          mastery_level: 'WEAK',
        },
      })
    : 0;

  // 待审核文档数量
  const pendingReviewCount = courseIdList.length > 0
    ? await prisma.knowledgeDocument.count({
        where: {
          course_id: { in: courseIdList },
          review_status: 'PENDING',
        },
      })
    : 0;

  return {
    course_count: courses.length,
    teaching_class_count: teachingClassCount,
    student_count: studentCount.length,
    average_mastery_score: masteryAgg._avg.mastery_score
      ? Math.round(masteryAgg._avg.mastery_score)
      : 0,
    average_test_score: averageTestScore ?? 0,
    ai_question_count: aiQuestionCount,
    weak_knowledge_point_count: weakKpCount,
    pending_review_document_count: pendingReviewCount,
  };
}

// ---------- 学习进度统计 ----------

async function getProgress(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const where = { status: { notIn: ['IN_PROGRESS', 'in_progress'] }, ...courseFilter };
  if (classId) where.teaching_class_id = classId;

  const sessions = await prisma.practiceSession.findMany({
    where,
    include: {
      student: { include: { profile: true } },
      course: true,
      teaching_class: true,
    },
    orderBy: { submitted_at: 'desc' },
    take: 100,
  });

  const studentProgressMap = {};
  for (const session of sessions) {
    const sid = session.student_user_id;
    if (!studentProgressMap[sid]) {
      studentProgressMap[sid] = {
        student_user_id: sid,
        student_name: session.student?.profile?.real_name || session.student?.username || null,
        course_id: session.course_id,
        course_name: session.course?.course_name || null,
        class_id: session.teaching_class_id,
        class_name: session.teaching_class?.teaching_class_name || null,
        session_count: 0,
        total_accuracy: 0,
        total_score_rate: 0,
        score_count: 0,
        last_active: null,
      };
    }
    const item = studentProgressMap[sid];
    item.session_count += 1;
    if (session.correct_count != null && session.question_count > 0) {
      item.total_accuracy = Math.round(
        ((item.total_accuracy * (item.session_count - 1)) + (session.correct_count / session.question_count) * 100) / item.session_count
      );
    }
    if (session.total_score != null && session.max_score > 0) {
      item.total_score_rate += (session.total_score / session.max_score) * 100;
      item.score_count += 1;
    }
    if (session.submitted_at && (!item.last_active || session.submitted_at > item.last_active)) {
      item.last_active = session.submitted_at;
    }
  }

  const students = Object.values(studentProgressMap).map((item) => ({
    ...item,
    average_score_rate: item.score_count > 0 ? Math.round(item.total_score_rate / item.score_count) : 0,
    total_score_rate: undefined,
    score_count: undefined,
    last_active: item.last_active ? item.last_active.toISOString() : null,
  }));

  const totalSessions = sessions.length;
  const submittedSessions = sessions.filter((s) => s.status !== 'IN_PROGRESS' && s.status !== 'in_progress').length;

  return {
    summary: {
      total_students: Object.keys(studentProgressMap).length,
      total_sessions: totalSessions,
      submitted_sessions: submittedSessions,
    },
    students,
  };
}

// ---------- 知识热力图 ----------

async function getKnowledgeHeatmap(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const masteryWhere = { ...courseFilter };
  if (classId) {
    const enrollments = await prisma.studentCourseEnrollment.findMany({
      where: { teaching_class_id: classId, enrollment_status: 'active' },
      select: { student_user_id: true },
    });
    masteryWhere.student_user_id = { in: enrollments.map((e) => e.student_user_id) };
  }

  const records = await prisma.studentMasteryRecord.findMany({
    where: masteryWhere,
    include: {
      student: { include: { profile: true } },
      knowledge_point: true,
    },
    orderBy: [{ student_user_id: 'asc' }, { knowledge_point_id: 'asc' }],
  });

  const heatmapData = records.map((r) => ({
    student_user_id: r.student_user_id,
    student_name: r.student?.profile?.real_name || r.student?.username || null,
    knowledge_point_id: r.knowledge_point_id,
    knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
    mastery_score: r.mastery_score,
    mastery_level: toLower(r.mastery_level),
  }));

  return { list: heatmapData };
}

// ---------- 成绩分布 ----------

async function getScoreDistribution(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const sessionWhere = { status: { notIn: ['IN_PROGRESS', 'in_progress'] }, total_score: { not: null }, max_score: { not: null, gt: 0 }, ...courseFilter };
  if (classId) sessionWhere.teaching_class_id = classId;

  const sessions = await prisma.practiceSession.findMany({
    where: sessionWhere,
    select: { total_score: true, max_score: true },
  });

  const scoreRates = sessions
    .map((s) => (s.total_score / s.max_score) * 100)
    .filter((rate) => rate >= 0 && rate <= 100);

  const distribution = {
    excellent: 0, // 90-100
    good: 0,      // 75-89
    general: 0,   // 60-74
    weak: 0,      // 0-59
  };

  for (const rate of scoreRates) {
    if (rate >= 90) distribution.excellent += 1;
    else if (rate >= 75) distribution.good += 1;
    else if (rate >= 60) distribution.general += 1;
    else distribution.weak += 1;
  }

  return {
    total_sessions: sessions.length,
    distribution: {
      excellent: { count: distribution.excellent, percentage: sessions.length > 0 ? Math.round((distribution.excellent / sessions.length) * 100) : 0, label: '优秀 (90-100分)' },
      good: { count: distribution.good, percentage: sessions.length > 0 ? Math.round((distribution.good / sessions.length) * 100) : 0, label: '良好 (75-89分)' },
      general: { count: distribution.general, percentage: sessions.length > 0 ? Math.round((distribution.general / sessions.length) * 100) : 0, label: '一般 (60-74分)' },
      weak: { count: distribution.weak, percentage: sessions.length > 0 ? Math.round((distribution.weak / sessions.length) * 100) : 0, label: '薄弱 (0-59分)' },
    },
    average_score_rate: scoreRates.length > 0 ? Math.round(scoreRates.reduce((a, b) => a + b, 0) / scoreRates.length) : 0,
  };
}

// ---------- 高频提问统计 ----------

async function getQuestionFrequency(user, query) {
  const courseIds = await resolveCourseIds(user, query);

  // 调用统一关键词云服务
  const cloudResult = await keywordCloudService.computeKeywordCloud({
    courseIds: courseIds || [],
    limit: 50,
  });

  // 加载知识点维度统计（原有 list/top_tags 保留）
  const courseFilter = getCourseFilter(courseIds);
  const questions = await prisma.studentQuestionRecord.findMany({
    where: {
      ...courseFilter,
      OR: [
        { conversation_id: null },
        { conversation: { agent_type: 'COURSE_QA' } },
      ],
    },
    include: {
      analysis_records: {
        include: { knowledge_point: true, keywords: true, confusion_tags: true },
        take: 1,
      },
    },
    orderBy: { created_at: 'desc' },
  });

  const kpMap = {};
  const globalTagMap = {};
  for (const q of questions) {
    const analysis = q.analysis_records?.[0];
    const confusionTags = analysis?.confusion_tags || [];
    for (const tag of confusionTags) {
      const t = tag.tag?.trim();
      if (!t) continue;
      if (!globalTagMap[t]) globalTagMap[t] = { tag: t, count: 0 };
      globalTagMap[t].count += 1;
    }
    const kp = analysis?.knowledge_point;
    if (!kp) continue;
    if (!kpMap[kp.knowledge_point_id]) {
      kpMap[kp.knowledge_point_id] = {
        knowledge_point_id: kp.knowledge_point_id,
        knowledge_point_name: kp.knowledge_point_name,
        question_count: 0,
        student_ids: new Set(),
        top_keywords: [],
        top_confusion_tags: [],
      };
    }
    kpMap[kp.knowledge_point_id].question_count += 1;
    kpMap[kp.knowledge_point_id].student_ids.add(q.student_user_id);
  }

  const list = Object.values(kpMap)
    .map(item => ({
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point_name,
      question_count: item.question_count,
      student_count: item.student_ids.size,
      top_keywords: [],
      top_confusion_tags: [],
    }))
    .sort((a, b) => b.question_count - a.question_count);

  const topTags = Object.values(globalTagMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // word_cloud 使用统一服务结果，字段兼容前端渲染
  return {
    total_questions: cloudResult.total_questions,
    total_students: cloudResult.total_students,
    list,
    word_cloud: cloudResult.word_cloud.map(w => ({
      keyword: w.keyword,
      count: w.count,
      char_length: w.char_length,
      score: w.score,
      student_count: w.student_count,
      difficulty: w.difficulty,
      category: w.category,
      related_kp: w.related_kp,
    })),
    top_tags: topTags,
  };
}

// ---------- 薄弱知识点排行 ----------

async function getWeakKnowledgePoints(user, query) {
  const courseIds = await resolveCourseIds(user, query);
  const courseFilter = getCourseFilter(courseIds);

  const classId = toPositiveInt(query.classId ?? query.class_id, 'class_id', false);

  const masteryWhere = { mastery_level: 'WEAK', ...courseFilter };
  if (classId) {
    const enrollments = await prisma.studentCourseEnrollment.findMany({
      where: { teaching_class_id: classId, enrollment_status: 'active' },
      select: { student_user_id: true },
    });
    masteryWhere.student_user_id = { in: enrollments.map((e) => e.student_user_id) };
  }

  const records = await prisma.studentMasteryRecord.findMany({
    where: masteryWhere,
    include: {
      knowledge_point: true,
      student: { include: { profile: true } },
    },
    orderBy: { mastery_score: 'asc' },
    take: 50,
  });

  const kpMap = {};
  for (const r of records) {
    const kpId = r.knowledge_point_id;
    if (!kpMap[kpId]) {
      kpMap[kpId] = {
        knowledge_point_id: kpId,
        knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
        student_count: 0,
        average_score: 0,
        score_sum: 0,
        students: [],
      };
    }
    kpMap[kpId].student_count += 1;
    kpMap[kpId].score_sum += r.mastery_score;
    kpMap[kpId].students.push({
      student_user_id: r.student_user_id,
      student_name: r.student?.profile?.real_name || r.student?.username || null,
      mastery_score: r.mastery_score,
    });
  }

  const list = Object.values(kpMap)
    .map((item) => ({
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point_name,
      student_count: item.student_count,
      average_score: Math.round(item.score_sum / item.student_count),
      students: item.students.sort((a, b) => a.mastery_score - b.mastery_score).slice(0, 10),
    }))
    .sort((a, b) => a.average_score - b.average_score);

  return { list };
}

// ---------- 学生能力雷达图 ----------

async function getStudentRadar(user, studentUserId, query) {
  const courseIds = await resolveCourseIds(user, query);

  if (user.role !== 'admin') {
    const enrollment = await prisma.studentCourseEnrollment.findFirst({
      where: {
        student_user_id: studentUserId,
        ...(courseIds ? { course_id: { in: courseIds } } : {}),
        enrollment_status: 'active',
      },
    });
    if (!enrollment) {
      throw Object.assign(new Error('无权访问该学生数据'), { code: 40301 });
    }
  }

  const courseId = toPositiveInt(query.courseId ?? query.course_id, 'course_id', false);

  const student = await prisma.user.findUnique({
    where: { user_id: studentUserId },
    include: { profile: true },
  });
  if (!student) {
    throw Object.assign(new Error('学生不存在'), { code: 40002 });
  }

  // 获取画像数据
  const portraitWhere = { student_user_id: studentUserId };
  if (courseId) portraitWhere.course_id = courseId;

  const portrait = await prisma.studentPortrait.findFirst({
    where: portraitWhere,
  });

  // 获取掌握度
  const masteryWhere = { student_user_id: studentUserId };
  if (courseId) masteryWhere.course_id = courseId;

  const masteryRecords = await prisma.studentMasteryRecord.findMany({
    where: masteryWhere,
    include: { knowledge_point: true },
    orderBy: { mastery_score: 'asc' },
  });

  return {
    student: {
      student_user_id: student.user_id,
      student_name: student.profile?.real_name || student.username,
      student_no: student.profile?.student_no || null,
    },
    radar: portrait ? {
      learning_ability_score: portrait.learning_total_score,
      progress_score: portrait.progress_score,
      mastery_score: portrait.mastery_score,
      test_score: portrait.test_score,
      wrong_question_score: portrait.wrong_question_score,
      activity_score: portrait.activity_score,
      qa_score: portrait.qa_score,
    } : null,
    mastery_records: masteryRecords.map((r) => ({
      knowledge_point_id: r.knowledge_point_id,
      knowledge_point_name: r.knowledge_point?.knowledge_point_name || null,
      mastery_score: r.mastery_score,
      mastery_level: toLower(r.mastery_level),
    })),
  };
}

module.exports = {
  getDashboard,
  getProgress,
  getKnowledgeHeatmap,
  getScoreDistribution,
  getQuestionFrequency,
  getWeakKnowledgePoints,
  getStudentRadar,
};
