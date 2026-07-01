// 学生端视频推荐服务
// 根据薄弱知识点推荐视频资源，记录观看行为

const prisma = require('../config/prisma');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

async function ensureStudentInCourse(userId, courseId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: userId,
      course_id: courseId,
      enrollment_status: 'active',
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('未加入该课程或课程不存在'), { code: 40301 });
  }
  return enrollment;
}

// ========================
// 1. 获取视频推荐
// ========================

async function getVideoRecommendations(userId, query) {
  const { course_id, knowledge_point_id } = query;

  // 获取学生已加入的课程
  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: userId, enrollment_status: 'active' },
    include: { course: true },
  });

  if (enrollments.length === 0) {
    return { list: [] };
  }

  const enrolledCourseIds = enrollments.map((e) => e.course_id);

  // 如果指定了 course_id，校验权限
  let targetCourseIds = enrolledCourseIds;
  if (course_id) {
    const cid = parseInt(course_id, 10);
    if (!enrolledCourseIds.includes(cid)) {
      throw Object.assign(new Error('未加入该课程'), { code: 40301 });
    }
    targetCourseIds = [cid];
  }

  let recommendations = [];
  let weakKpIds = [];

  if (knowledge_point_id) {
    // 优先推荐指定知识点的视频
    const kpid = parseInt(knowledge_point_id, 10);

    // 校验知识点属于学生课程
    const kp = await prisma.knowledgePoint.findUnique({
      where: { knowledge_point_id: kpid },
    });
    if (!kp || !targetCourseIds.includes(kp.course_id)) {
      throw Object.assign(new Error('知识点不存在或无权访问'), { code: 40301 });
    }

    const videos = await prisma.videoResource.findMany({
      where: {
        knowledge_point_id: kpid,
      },
      include: {
        knowledge_point: true,
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    recommendations = videos.map((v) => ({
      video_id: v.video_id,
      title: v.title,
      source: toLower(v.source),
      bvid: v.bvid,
      cover_url: v.cover_url,
      embed_url: v.embed_url,
      external_url: v.original_url,
      duration: v.duration_seconds,
      knowledge_point: v.knowledge_point
        ? {
            knowledge_point_id: v.knowledge_point.knowledge_point_id,
            knowledge_point_name: v.knowledge_point.knowledge_point_name,
          }
        : null,
      recommend_reason: v.recommend_reason || `关于"${v.knowledge_point?.knowledge_point_name || '相关知识点'}"的学习视频。`,
    }));
  } else {
    // 根据薄弱知识点推荐
    const weakMastery = await prisma.studentMasteryRecord.findMany({
      where: {
        student_user_id: userId,
        course_id: { in: targetCourseIds },
        mastery_level: 'WEAK',
      },
      include: {
        knowledge_point: true,
      },
      orderBy: { mastery_score: 'asc' },
      take: 5,
    });

    weakKpIds = weakMastery.map((m) => m.knowledge_point_id);

    if (weakKpIds.length > 0) {
      const videos = await prisma.videoResource.findMany({
        where: {
          knowledge_point_id: { in: weakKpIds },
        },
        include: {
          knowledge_point: true,
        },
        orderBy: { created_at: 'desc' },
        take: 15,
      });

      recommendations = videos.map((v) => {
        const mastery = weakMastery.find((m) => m.knowledge_point_id === v.knowledge_point_id);
        return {
          video_id: v.video_id,
          title: v.title,
          source: toLower(v.source),
          bvid: v.bvid,
          cover_url: v.cover_url,
          embed_url: v.embed_url,
          external_url: v.original_url,
          duration: v.duration_seconds,
          knowledge_point: v.knowledge_point
            ? {
                knowledge_point_id: v.knowledge_point.knowledge_point_id,
                knowledge_point_name: v.knowledge_point.knowledge_point_name,
              }
            : null,
          recommend_reason: v.recommend_reason
            || (mastery
              ? `该知识点掌握度为薄弱（${mastery.mastery_score}分），建议观看视频讲解加强学习。`
              : '建议观看学习。'),
        };
      });
    }

    // 如果视频不够，补充课程级别的视频
    if (recommendations.length < 5) {
      const courseVideos = await prisma.videoResource.findMany({
        where: {
          course_id: { in: targetCourseIds },
        },
        include: {
          knowledge_point: true,
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      });

      // 去重
      const existingIds = new Set(recommendations.map((r) => r.video_id));
      const additional = courseVideos
        .filter((v) => !existingIds.has(v.video_id))
        .map((v) => ({
          video_id: v.video_id,
          title: v.title,
          source: toLower(v.source),
          bvid: v.bvid,
          cover_url: v.cover_url,
          embed_url: v.embed_url,
          external_url: v.original_url,
          duration: v.duration_seconds,
          knowledge_point: v.knowledge_point
            ? {
                knowledge_point_id: v.knowledge_point.knowledge_point_id,
                knowledge_point_name: v.knowledge_point.knowledge_point_name,
              }
            : null,
          recommend_reason: v.recommend_reason || '课程相关学习视频。',
        }));

      recommendations = recommendations.concat(additional);
    }
  }

  // 如果仍然没有视频，返回外部搜索建议
  if (recommendations.length === 0 && weakKpIds && weakKpIds.length > 0) {
    const weakKps = await prisma.knowledgePoint.findMany({
      where: { knowledge_point_id: { in: weakKpIds } },
    });

    recommendations = weakKps.map((kp) => ({
      video_id: null,
      title: `${kp.knowledge_point_name} 视频讲解`,
      source: 'bilibili',
      search_keyword: `${kp.knowledge_point_name} 机器学习 讲解`,
      bvid: null,
      cover_url: null,
      embed_url: null,
      external_url: null,
      duration: null,
      knowledge_point: {
        knowledge_point_id: kp.knowledge_point_id,
        knowledge_point_name: kp.knowledge_point_name,
      },
      recommend_reason: '该知识点掌握度较低，建议在 B 站等平台搜索相关视频讲解。',
      status: 'pending_search',
    }));
  }

  return {
    list: recommendations,
    weak_knowledge_point_ids: weakKpIds || [],
  };
}

// ========================
// 2. 获取知识点视频
// ========================

async function getKnowledgePointVideos(userId, knowledgePointId) {
  const kp = await prisma.knowledgePoint.findUnique({
    where: { knowledge_point_id: knowledgePointId },
    include: { course: true },
  });

  if (!kp) {
    throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  }

  await ensureStudentInCourse(userId, kp.course_id);

  const videos = await prisma.videoResource.findMany({
    where: {
      knowledge_point_id: knowledgePointId,
    },
    orderBy: { created_at: 'desc' },
  });

  const list = videos.map((v) => ({
    video_id: v.video_id,
    title: v.title,
    source: toLower(v.source),
    bvid: v.bvid,
    cover_url: v.cover_url,
    embed_url: v.embed_url,
    external_url: v.original_url,
    duration: v.duration_seconds,
    recommend_reason: v.recommend_reason || null,
    created_at: v.created_at ? v.created_at.toISOString() : null,
  }));

  return {
    knowledge_point: {
      knowledge_point_id: kp.knowledge_point_id,
      knowledge_point_name: kp.knowledge_point_name,
      knowledge_point_code: kp.knowledge_point_code,
      course_id: kp.course_id,
      course_name: kp.course.course_name,
    },
    videos: list,
    search_suggestion: list.length === 0
      ? {
          title: `${kp.knowledge_point_name} 视频讲解`,
          search_keyword: `${kp.knowledge_point_name} 机器学习`,
          source: 'bilibili',
          status: 'pending_search',
        }
      : null,
  };
}

// ========================
// 3. 记录视频学习行为
// ========================

async function recordWatch(userId, videoId, body) {
  const { course_id, knowledge_point_id, watch_duration_seconds, is_finished, progress_percent } = body;

  // 校验视频存在
  const video = await prisma.videoResource.findUnique({
    where: { video_id: videoId },
  });

  if (!video) {
    throw Object.assign(new Error('视频资源不存在'), { code: 40002 });
  }

  // 确定课程和知识点
  const courseId = course_id ? parseInt(course_id, 10) : video.course_id;
  const kpId = knowledge_point_id ? parseInt(knowledge_point_id, 10) : video.knowledge_point_id;

  // 校验课程权限
  if (courseId) {
    await ensureStudentInCourse(userId, courseId);
  }

  // 校验知识点属于课程
  if (kpId && courseId) {
    const kp = await prisma.knowledgePoint.findUnique({
      where: { knowledge_point_id: kpId },
    });
    if (!kp || kp.course_id !== courseId) {
      throw Object.assign(new Error('知识点不属于该课程'), { code: 40001 });
    }
  }

  const now = new Date();
  const actionType = is_finished ? 'FINISH' : 'VIEW';
  const duration = watch_duration_seconds || 0;

  const record = await prisma.studyRecord.create({
    data: {
      student_user_id: userId,
      course_id: courseId,
      knowledge_point_id: kpId,
      resource_type: 'video',
      resource_id: videoId,
      action_type: actionType,
      started_at: now,
      finished_at: is_finished ? now : null,
      duration_seconds: duration,
      progress_percent: progress_percent || (is_finished ? 100 : 0),
    },
  });

  // 如果看完视频，更新掌握度的 last_study_at
  if (is_finished && kpId) {
    try {
      await prisma.studentMasteryRecord.upsert({
        where: {
          student_user_id_course_id_knowledge_point_id: {
            student_user_id: userId,
            course_id: courseId,
            knowledge_point_id: kpId,
          },
        },
        update: {
          updated_at: now,
        },
        create: {
          student_user_id: userId,
          course_id: courseId,
          knowledge_point_id: kpId,
          mastery_score: 0,
          mastery_level: 'WEAK',
        },
      });
    } catch (updateErr) {
      console.error('[student-video.service] 更新掌握度失败:', updateErr.message);
    }
  }

  return {
    study_record_id: record.study_record_id,
    video_id: videoId,
    action_type: toLower(record.action_type),
    duration_seconds: record.duration_seconds,
    is_finished,
    created_at: record.created_at ? record.created_at.toISOString() : null,
  };
}

module.exports = {
  getVideoRecommendations,
  getKnowledgePointVideos,
  recordWatch,
};
