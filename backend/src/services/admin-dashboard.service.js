// 管理员端看板服务
// 提供系统总览统计数据的聚合查询

const prisma = require('../config/prisma');

/**
 * 获取系统总览统计数据
 */
async function getDashboard() {
  // 用户总数（按角色分组）
  const userCounts = await prisma.user.groupBy({
    by: ['role'],
    _count: { user_id: true },
    where: { status: 'ACTIVE' },
  });

  let studentCount = 0;
  let teacherCount = 0;
  let adminCount = 0;

  for (const item of userCounts) {
    if (item.role === 'STUDENT') studentCount = item._count.user_id;
    if (item.role === 'TEACHER') teacherCount = item._count.user_id;
    if (item.role === 'ADMIN') adminCount = item._count.user_id;
  }

  const userCount = studentCount + teacherCount + adminCount;

  // 课程总数
  const courseCount = await prisma.course.count({
    where: { status: 'ACTIVE' },
  });

  // 知识库文档总数
  const knowledgeDocumentCount = await prisma.knowledgeDocument.count();

  // 今日 AI 调用次数
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const aiCallCountToday = await prisma.aiCallLog.count({
    where: {
      created_at: { gte: todayStart },
    },
  });

  // 待审核文档数
  const pendingReviewDocumentCount = await prisma.knowledgeDocument.count({
    where: { review_status: 'PENDING' },
  });

  return {
    user_count: userCount,
    student_count: studentCount,
    teacher_count: teacherCount,
    course_count: courseCount,
    knowledge_document_count: knowledgeDocumentCount,
    ai_call_count_today: aiCallCountToday,
    pending_review_document_count: pendingReviewDocumentCount,
  };
}

module.exports = { getDashboard };
