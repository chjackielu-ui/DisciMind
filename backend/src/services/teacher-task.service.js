// 教师端任务管理服务

const prisma = require('../config/prisma');

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

async function getAccessibleCourseIds(user) {
  if (user.role === 'admin') return null;
  const relations = await prisma.courseTeacherRelation.findMany({
    where: { teacher_user_id: user.user_id },
    select: { course_id: true },
  });
  return relations.map((item) => item.course_id);
}

async function ensureCourseAccess(user, courseId) {
  if (user.role === 'admin') return;
  const ids = await getAccessibleCourseIds(user);
  if (!ids || !ids.includes(courseId)) {
    throw Object.assign(new Error('无权访问该课程数据'), { code: 40301 });
  }
}

const TASK_TYPE_MAP = {
  homework: 'HOMEWORK',
  quiz: 'QUIZ',
  study_task: 'STUDY_TASK',
  review_plan: 'REVIEW_PLAN',
};

const TASK_STATUS_MAP = {
  draft: 'DRAFT',
  published: 'PUBLISHED',
  closed: 'CLOSED',
};

// ---------- 任务列表 ----------

async function listTasks(user, query) {
  const courseIds = await getAccessibleCourseIds(user);
  const where = {};
  if (courseIds) where.course_id = { in: courseIds };

  if (query.course_id) {
    const cid = Number.parseInt(query.course_id, 10);
    await ensureCourseAccess(user, cid);
    where.course_id = cid;
  }
  if (query.teaching_class_id) {
    where.teaching_class_id = Number.parseInt(query.teaching_class_id, 10);
  }
  if (query.task_type) {
    const tt = TASK_TYPE_MAP[query.task_type];
    if (tt) where.task_type = tt;
  }
  if (query.status) {
    const st = TASK_STATUS_MAP[query.status];
    if (st) where.status = st;
  }

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));
  const skip = (page - 1) * pageSize;

  const [tasks, total] = await Promise.all([
    prisma.learningTask.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: { select: { course_name: true } },
        teaching_class: { select: { teaching_class_name: true } },
        creator: { include: { profile: true } },
        _count: {
          select: {
            question_links: true,
            submissions: true,
          },
        },
      },
    }),
    prisma.learningTask.count({ where }),
  ]);

  return {
    list: tasks.map((t) => ({
      task_id: t.task_id,
      title: t.title,
      description: t.description,
      task_type: toLower(t.task_type),
      course_id: t.course_id,
      course_name: t.course?.course_name || null,
      teaching_class_id: t.teaching_class_id,
      class_name: t.teaching_class?.teaching_class_name || null,
      status: toLower(t.status),
      start_time: t.start_time?.toISOString() || null,
      deadline: t.deadline?.toISOString() || null,
      allow_late_submit: t.allow_late_submit,
      question_count: t._count.question_links,
      submission_count: t._count.submissions,
      created_by_name: t.creator?.profile?.real_name || t.creator?.username || null,
      created_at: t.created_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 创建任务 ----------

async function createTask(user, body) {
  const { course_id, teaching_class_id, task_type, title, description, start_time, deadline, question_ids, knowledge_point_ids, allow_late_submit, status } = body;

  if (!course_id || !title || !task_type) {
    throw Object.assign(new Error('course_id、title、task_type 为必填项'), { code: 40001 });
  }

  await ensureCourseAccess(user, course_id);

  const task = await prisma.learningTask.create({
    data: {
      course_id,
      teaching_class_id: teaching_class_id || null,
      created_by_user_id: user.user_id,
      task_type: TASK_TYPE_MAP[task_type] || 'HOMEWORK',
      title,
      description: description || null,
      start_time: start_time ? new Date(start_time) : null,
      deadline: deadline ? new Date(deadline) : null,
      allow_late_submit: allow_late_submit ?? false,
      status: TASK_STATUS_MAP[status || 'draft'] || 'DRAFT',
    },
  });

  // 关联题目
  if (question_ids && Array.isArray(question_ids) && question_ids.length > 0) {
    await prisma.taskQuestion.createMany({
      data: question_ids.map((qid, idx) => ({
        task_id: task.task_id,
        question_id: qid,
        question_order: idx,
      })),
    });
  }

  // 关联知识点
  if (knowledge_point_ids && Array.isArray(knowledge_point_ids) && knowledge_point_ids.length > 0) {
    await prisma.taskKnowledgePoint.createMany({
      data: knowledge_point_ids.map((kpid) => ({
        task_id: task.task_id,
        knowledge_point_id: kpid,
      })),
    });
  }

  return { task_id: task.task_id, title: task.title, task_type: task.task_type, status: task.status };
}

// ---------- 任务详情 ----------

async function getTask(user, taskId) {
  const task = await prisma.learningTask.findUnique({
    where: { task_id: taskId },
    include: {
      course: true,
      teaching_class: true,
      creator: { include: { profile: true } },
      question_links: {
        include: {
          question: {
            include: { knowledge_point: true, options: { orderBy: { option_order: 'asc' } } },
          },
        },
        orderBy: { question_order: 'asc' },
      },
      knowledge_point_links: {
        include: { knowledge_point: true },
      },
      _count: { select: { submissions: true } },
    },
  });

  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureCourseAccess(user, task.course_id);

  return {
    task_id: task.task_id,
    title: task.title,
    description: task.description,
    task_type: toLower(task.task_type),
    course_id: task.course_id,
    course_name: task.course?.course_name || null,
    teaching_class_id: task.teaching_class_id,
    class_name: task.teaching_class?.teaching_class_name || null,
    status: toLower(task.status),
    start_time: task.start_time?.toISOString() || null,
    deadline: task.deadline?.toISOString() || null,
    allow_late_submit: task.allow_late_submit,
    submission_count: task._count.submissions,
    questions: task.question_links.map((ql) => ({
      question_id: ql.question_id,
      title: ql.question.title,
      question_type: toLower(ql.question.question_type),
      difficulty_level: toLower(ql.question.difficulty_level),
      score: ql.question.score,
      knowledge_point_id: ql.question.knowledge_point_id,
      knowledge_point_name: ql.question.knowledge_point?.knowledge_point_name || null,
      options: ql.question.options.map((opt) => ({
        option_key: opt.option_key,
        option_content: opt.option_content,
      })),
    })),
    knowledge_points: task.knowledge_point_links.map((kl) => ({
      knowledge_point_id: kl.knowledge_point_id,
      knowledge_point_name: kl.knowledge_point?.knowledge_point_name || null,
    })),
    creator: {
      user_id: task.created_by_user_id,
      name: task.creator?.profile?.real_name || task.creator?.username || null,
    },
    created_at: task.created_at.toISOString(),
  };
}

// ---------- 更新任务 ----------

async function updateTask(user, taskId, body) {
  const task = await prisma.learningTask.findUnique({ where: { task_id: taskId } });
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureCourseAccess(user, task.course_id);

  const { title, description, start_time, deadline, allow_late_submit, status, question_ids, knowledge_point_ids } = body;
  const data = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (start_time !== undefined) data.start_time = start_time ? new Date(start_time) : null;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (allow_late_submit !== undefined) data.allow_late_submit = allow_late_submit;
  if (status !== undefined) {
    const st = TASK_STATUS_MAP[status];
    if (st) data.status = st;
  }

  const updated = await prisma.learningTask.update({
    where: { task_id: taskId },
    data,
  });

  // 更新题目关联
  if (question_ids && Array.isArray(question_ids)) {
    await prisma.taskQuestion.deleteMany({ where: { task_id: taskId } });
    if (question_ids.length > 0) {
      await prisma.taskQuestion.createMany({
        data: question_ids.map((qid, idx) => ({
          task_id: taskId,
          question_id: qid,
          question_order: idx,
        })),
      });
    }
  }

  // 更新知识点关联
  if (knowledge_point_ids && Array.isArray(knowledge_point_ids)) {
    await prisma.taskKnowledgePoint.deleteMany({ where: { task_id: taskId } });
    if (knowledge_point_ids.length > 0) {
      await prisma.taskKnowledgePoint.createMany({
        data: knowledge_point_ids.map((kpid) => ({
          task_id: taskId,
          knowledge_point_id: kpid,
        })),
      });
    }
  }

  return { task_id: updated.task_id, title: updated.title, status: toLower(updated.status) };
}

// ---------- 删除任务 ----------

async function deleteTask(user, taskId) {
  const task = await prisma.learningTask.findUnique({ where: { task_id: taskId } });
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureCourseAccess(user, task.course_id);
  await prisma.learningTask.delete({ where: { task_id: taskId } });
}

// ---------- 提交列表 ----------

async function listSubmissions(user, taskId, query) {
  const task = await prisma.learningTask.findUnique({ where: { task_id: taskId } });
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureCourseAccess(user, task.course_id);

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));
  const skip = (page - 1) * pageSize;

  // 1. 查询新的 attempt 数据（PracticeSession source_type=TEACHER_TASK）
  const attemptWhere = {
    source_type: 'TEACHER_TASK',
    source_id: taskId,
    status: { not: 'CREATED' },
  };
  if (query.submission_status) {
    const s = query.submission_status.toUpperCase();
    if (s === 'IN_PROGRESS') {
      attemptWhere.status = { in: ['IN_PROGRESS', 'CREATED'] };
    } else {
      attemptWhere.status = s;
    }
  }

  const [attempts, attemptTotal] = await Promise.all([
    prisma.practiceSession.findMany({
      where: attemptWhere,
      orderBy: { submitted_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        student: { include: { profile: true } },
        _count: { select: { answer_records: true } },
      },
    }),
    prisma.practiceSession.count({ where: attemptWhere }),
  ]);

  // 2. 查询旧 TaskSubmission（迁移前历史数据）
  const subWhere = { task_id: taskId };
  if (query.submission_status) {
    subWhere.submission_status = query.submission_status.toUpperCase();
  }
  const [legacySubs, legacyTotal] = await Promise.all([
    prisma.taskSubmission.findMany({
      where: subWhere,
      orderBy: { submitted_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        student: { include: { profile: true } },
        _count: { select: { answer_records: true } },
      },
    }),
    prisma.taskSubmission.count({ where: subWhere }),
  ]);

  // 3. 合并结果（attempt 优先，旧数据为辅，按 student_user_id 去重）
  const seenStudentIds = new Set();
  const list = [];

  // 先添加 attempt 数据
  for (const a of attempts) {
    seenStudentIds.add(a.student_user_id);
    list.push(formatAttemptAsSubmission(a));
  }

  // 再添加旧 TaskSubmission（与 attempt 不重复的学生）
  for (const s of legacySubs) {
    if (!seenStudentIds.has(s.student_user_id)) {
      list.push(formatLegacySubmission(s));
    }
  }

  return {
    list,
    total: attemptTotal + legacyTotal,
    page,
    page_size: pageSize,
    engines: { attempt: attemptTotal, legacy: legacyTotal },
  };
}

function formatAttemptAsSubmission(s) {
  return {
    submission_id: s.practice_session_id,
    engine: 'ATTEMPT',
    task_id: s.source_id,
    student_user_id: s.student_user_id,
    student_name: s.student?.profile?.real_name || s.student?.username || null,
    student_no: s.student?.profile?.student_no || null,
    submission_status: toLower(s.status === 'SUBMITTED' ? 'submitted' : s.status),
    grading_status: 'auto_graded',
    total_score: s.total_score,
    objective_score: s.objective_score,
    ai_score: s.ai_score,
    started_at: s.started_at?.toISOString() || null,
    submitted_at: s.submitted_at?.toISOString() || null,
    duration_seconds: s.duration_seconds,
    is_late: false,
    answer_count: s._count.answer_records,
    submit_reason: s.submit_reason || null,
  };
}

function formatLegacySubmission(s) {
  return {
    submission_id: s.submission_id,
    engine: 'LEGACY_TASK_SUBMISSION',
    task_id: s.task_id,
    student_user_id: s.student_user_id,
    student_name: s.student?.profile?.real_name || s.student?.username || null,
    student_no: s.student?.profile?.student_no || null,
    submission_status: toLower(s.submission_status),
    grading_status: toLower(s.grading_status),
    total_score: s.total_score,
    objective_score: s.objective_score,
    ai_score: s.ai_score,
    started_at: s.started_at?.toISOString() || null,
    submitted_at: s.submitted_at?.toISOString() || null,
    duration_seconds: s.duration_seconds,
    is_late: s.is_late,
    answer_count: s._count.answer_records,
    submit_reason: null,
  };
}

// ---------- 提交详情 ----------

async function getSubmission(user, taskId, submissionId) {
  const task = await prisma.learningTask.findUnique({ where: { task_id: taskId } });
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureCourseAccess(user, task.course_id);

  // 1. 先尝试查询 attempt (PracticeSession)
  const attempt = await prisma.practiceSession.findUnique({
    where: { practice_session_id: submissionId },
    include: {
      student: { include: { profile: true } },
      answer_records: {
        include: {
          question: {
            include: { knowledge_point: true, options: { orderBy: { option_order: 'asc' } } },
          },
        },
      },
    },
  });

  if (attempt && attempt.source_type === 'TEACHER_TASK' && attempt.source_id === taskId) {
    return formatAttemptDetail(attempt);
  }

  // 2. 降级查询旧 TaskSubmission
  const submission = await prisma.taskSubmission.findUnique({
    where: { submission_id: submissionId },
    include: {
      student: { include: { profile: true } },
      answer_records: {
        include: {
          question: {
            include: { knowledge_point: true, options: { orderBy: { option_order: 'asc' } } },
          },
        },
      },
    },
  });

  if (submission) {
    return formatLegacyDetail(submission);
  }

  throw Object.assign(new Error('提交记录不存在'), { code: 40002 });
}

function formatAttemptDetail(s) {
  return {
    submission_id: s.practice_session_id,
    engine: 'ATTEMPT',
    task_id: s.source_id,
    student_user_id: s.student_user_id,
    student_name: s.student?.profile?.real_name || s.student?.username || null,
    submission_status: toLower(s.status === 'SUBMITTED' ? 'submitted' : s.status),
    grading_status: 'auto_graded',
    total_score: s.total_score,
    objective_score: s.objective_score,
    ai_score: s.ai_score,
    started_at: s.started_at?.toISOString() || null,
    submitted_at: s.submitted_at?.toISOString() || null,
    duration_seconds: s.duration_seconds,
    is_late: false,
    submit_reason: s.submit_reason || null,
    answers: (s.answer_records || []).map((ar) => ({
      answer_record_id: ar.answer_record_id,
      question_id: ar.question_id,
      question_title: ar.question?.title || null,
      question_type: ar.question ? toLower(ar.question.question_type) : null,
      difficulty_level: ar.question ? toLower(ar.question.difficulty_level) : null,
      score: ar.question?.score || 0,
      knowledge_point: ar.question?.knowledge_point ? {
        knowledge_point_id: ar.question.knowledge_point.knowledge_point_id,
        knowledge_point_name: ar.question.knowledge_point.knowledge_point_name,
      } : null,
      options: (ar.question?.options || []).map((opt) => ({
        option_key: opt.option_key,
        option_content: opt.option_content,
      })),
      answer_content: ar.answer_content,
      is_correct: ar.is_correct,
      obtained_score: ar.score,
      feedback: ar.feedback,
    })),
  };
}

function formatLegacyDetail(submission) {
  return {
    submission_id: submission.submission_id,
    engine: 'LEGACY_TASK_SUBMISSION',
    task_id: submission.task_id,
    student_user_id: submission.student_user_id,
    student_name: submission.student?.profile?.real_name || submission.student?.username || null,
    submission_status: toLower(submission.submission_status),
    grading_status: toLower(submission.grading_status),
    total_score: submission.total_score,
    objective_score: submission.objective_score,
    ai_score: submission.ai_score,
    started_at: submission.started_at?.toISOString() || null,
    submitted_at: submission.submitted_at?.toISOString() || null,
    duration_seconds: submission.duration_seconds,
    is_late: submission.is_late,
    submit_reason: null,
    answers: submission.answer_records.map((ar) => ({
      answer_record_id: ar.answer_record_id,
      question_id: ar.question_id,
      question_title: ar.question.title,
      question_type: toLower(ar.question.question_type),
      difficulty_level: toLower(ar.question.difficulty_level),
      score: ar.question.score,
      knowledge_point: ar.question.knowledge_point ? {
        knowledge_point_id: ar.question.knowledge_point.knowledge_point_id,
        knowledge_point_name: ar.question.knowledge_point.knowledge_point_name,
      } : null,
      options: ar.question.options.map((opt) => ({
        option_key: opt.option_key,
        option_content: opt.option_content,
      })),
      answer_content: ar.answer_content,
      is_correct: ar.is_correct,
      obtained_score: ar.score,
      feedback: ar.feedback,
      started_at: ar.started_at?.toISOString() || null,
      submitted_at: ar.submitted_at?.toISOString() || null,
      duration_seconds: ar.duration_seconds,
    })),
  };
}

module.exports = {
  listTasks,
  createTask,
  getTask,
  updateTask,
  deleteTask,
  listSubmissions,
  getSubmission,
};
