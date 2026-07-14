// 教师端任务管理服务

const prisma = require('../config/prisma');
const {
  getAccessibleCourseIds,
  getAccessibleTeachingClassIds,
  ensureCourseAccess,
  ensureTeachingClassAccess,
  isAdmin,
} = require('./teacher-access.service');

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

const TASK_TYPE_MAP = {
  homework: 'HOMEWORK',
  exam: 'EXAM',
  practice: 'PRACTICE',
  material: 'MATERIAL',
  announcement: 'ANNOUNCEMENT',
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
  const classIds = await getAccessibleTeachingClassIds(user);
  const where = {};
  if (courseIds) where.course_id = { in: courseIds };
  if (!isAdmin(user)) where.teaching_class_id = { in: classIds };

  if (query.course_id) {
    const cid = Number.parseInt(query.course_id, 10);
    await ensureCourseAccess(user, cid);
    where.course_id = cid;
  }
  if (query.teaching_class_id) {
    const classId = Number.parseInt(query.teaching_class_id, 10);
    await ensureTeachingClassAccess(user, classId);
    where.teaching_class_id = classId;
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
            recipients: true,
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
      recipient_count: t._count.recipients,
      created_by_name: t.creator?.profile?.real_name || t.creator?.username || null,
      created_at: t.created_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 创建任务 ----------

function parseOptionalDate(value, field) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${field} 时间格式不合法`), { code: 40001 });
  return date;
}

function normalizeTaskConfiguration(body) {
  const startTime = parseOptionalDate(body.startAt ?? body.start_time, 'startAt');
  const deadline = parseOptionalDate(body.dueAt ?? body.deadline, 'dueAt');
  if (startTime && deadline && startTime >= deadline) {
    throw Object.assign(new Error('截止时间必须晚于开始时间'), { code: 40001 });
  }
  const totalScore = body.totalScore ?? body.total_score;
  const passScore = body.passScore ?? body.pass_score;
  if (totalScore != null && Number(totalScore) < 0) throw Object.assign(new Error('totalScore 不能小于 0'), { code: 40001 });
  if (passScore != null && totalScore != null && Number(passScore) > Number(totalScore)) {
    throw Object.assign(new Error('passScore 不能高于 totalScore'), { code: 40001 });
  }
  return {
    startTime,
    deadline,
    totalScore: totalScore == null ? null : Number(totalScore),
    passScore: passScore == null ? null : Number(passScore),
    sourceMode: body.sourceMode || body.source_mode || 'question_bank',
  };
}

async function createPublishedRecipients(tx, task, senderUserId) {
  const enrollments = await tx.studentCourseEnrollment.findMany({
    where: { teaching_class_id: task.teaching_class_id, enrollment_status: 'active' },
    select: { student_user_id: true },
  });
  if (!enrollments.length) return { recipientCount: 0, notificationCount: 0 };
  await tx.learningTaskRecipient.createMany({
    data: enrollments.map((item) => ({
      task_id: task.task_id,
      student_user_id: item.student_user_id,
      teaching_class_id: task.teaching_class_id,
    })),
    skipDuplicates: true,
  });
  const typeLabel = task.task_type === 'EXAM' ? '考试' : task.task_type === 'HOMEWORK' ? '作业' : '教学任务';
  await tx.notification.createMany({
    data: enrollments.map((item) => ({
      receiver_user_id: item.student_user_id,
      sender_user_id: senderUserId,
      notification_type: 'TASK_PUBLISHED',
      title: `新${typeLabel}：${task.title}`,
      content: task.deadline ? `截止时间：${task.deadline.toLocaleString('zh-CN')}` : task.description,
      target_type: 'learning_task',
      target_id: task.task_id,
      business_type: task.task_type === 'EXAM' ? 'exam' : 'teaching_task',
      business_id: task.task_id,
      idempotency_key: `task:${task.task_id}:student:${item.student_user_id}:published`,
      expires_at: task.deadline || null,
    })),
    skipDuplicates: true,
  });
  return { recipientCount: enrollments.length, notificationCount: enrollments.length };
}

async function createTask(user, body) {
  const {
    course_id, teaching_class_id, task_type, title, description, question_ids,
    knowledge_point_ids, allow_late_submit, status, attachment_ids,
  } = body;

  if (!course_id || !title || !task_type) {
    throw Object.assign(new Error('course_id、title、task_type 为必填项'), { code: 40001 });
  }

  const courseId = Number(course_id);
  const classId = Number(teaching_class_id);
  if (!classId) throw Object.assign(new Error('teaching_class_id 为必填项'), { code: 40001 });
  await ensureCourseAccess(user, courseId);
  const teachingClass = await ensureTeachingClassAccess(user, classId);
  if (teachingClass.course_id !== courseId) throw Object.assign(new Error('教学班不属于所选课程'), { code: 40001 });
  const normalized = normalizeTaskConfiguration(body);
  const finalStatus = TASK_STATUS_MAP[status || 'draft'] || 'DRAFT';
  const questionIds = [...new Set((Array.isArray(question_ids) ? question_ids : []).map(Number).filter(Boolean))];
  const questions = questionIds.length
    ? await prisma.question.findMany({ where: { question_id: { in: questionIds }, course_id: courseId, status: { not: 'deleted' } } })
    : [];
  if (questions.length !== questionIds.length) throw Object.assign(new Error('题目不存在、已停用或不属于所选课程'), { code: 40001 });
  const questionScoreMap = body.question_scores && typeof body.question_scores === 'object' ? body.question_scores : {};
  const calculatedScore = questions.reduce((sum, item) => sum + Number(questionScoreMap[item.question_id] ?? item.score ?? 0), 0);
  if (normalized.totalScore != null && questionIds.length && Math.abs(calculatedScore - normalized.totalScore) > 0.001) {
    throw Object.assign(new Error(`题目总分 ${calculatedScore} 与设置总分 ${normalized.totalScore} 不一致`), { code: 40001 });
  }
  if (finalStatus === 'PUBLISHED' && ['HOMEWORK', 'EXAM', 'PRACTICE', 'QUIZ'].includes(TASK_TYPE_MAP[task_type]) && !questionIds.length) {
    throw Object.assign(new Error('作业、考试或练习发布时至少需要一道题目'), { code: 40001 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.learningTask.create({
      data: {
        course_id: courseId,
        teaching_class_id: classId,
        created_by_user_id: user.user_id,
        task_type: TASK_TYPE_MAP[task_type] || 'HOMEWORK',
        title,
        description: description || null,
        start_time: normalized.startTime,
        deadline: normalized.deadline,
        duration_minutes: body.durationMinutes ?? body.duration_minutes ?? null,
        allowed_attempts: body.allowedAttempts ?? body.allowed_attempts ?? 1,
        allow_late_submit: body.allowLateSubmission ?? allow_late_submit ?? false,
        allow_pause: body.allowPause ?? body.allow_pause ?? false,
        save_draft: body.saveDraft ?? body.save_draft ?? true,
        randomize_questions: body.randomizeQuestions ?? body.randomize_questions ?? false,
        randomize_options: body.randomizeOptions ?? body.randomize_options ?? false,
        show_score_policy: body.showScorePolicy || body.show_score_policy || 'after_submit',
        show_answer_policy: body.showAnswerPolicy || body.show_answer_policy || 'after_deadline',
        show_analysis_policy: body.showAnalysisPolicy || body.show_analysis_policy || 'after_deadline',
        auto_grade: body.autoGrade ?? body.auto_grade ?? true,
        ai_grade_subjective: body.aiGradeSubjective ?? body.ai_grade_subjective ?? false,
        full_screen_mode: body.fullScreenMode ?? body.full_screen_mode ?? false,
        source_mode: normalized.sourceMode,
        total_score: normalized.totalScore ?? calculatedScore,
        pass_score: normalized.passScore,
        instructions: body.instructions || null,
        rules: body.rules || null,
        configuration_json: body.configuration || body.composition || undefined,
        score_release_at: parseOptionalDate(body.scoreReleaseAt || body.score_release_at, 'scoreReleaseAt'),
        analysis_release_at: parseOptionalDate(body.analysisReleaseAt || body.analysis_release_at, 'analysisReleaseAt'),
        published_at: finalStatus === 'PUBLISHED' ? new Date() : null,
        status: finalStatus,
      },
    });
    if (questionIds.length) {
      await tx.taskQuestion.createMany({
        data: questionIds.map((questionId, idx) => ({
          task_id: task.task_id,
          question_id: questionId,
          question_order: idx,
          score: Number(questionScoreMap[questionId] ?? questions.find((item) => item.question_id === questionId)?.score ?? 0),
        })),
      });
    }
    const knowledgePointIds = [...new Set((Array.isArray(knowledge_point_ids) ? knowledge_point_ids : []).map(Number).filter(Boolean))];
    if (knowledgePointIds.length) {
      const count = await tx.knowledgePoint.count({ where: { knowledge_point_id: { in: knowledgePointIds }, course_id: courseId } });
      if (count !== knowledgePointIds.length) throw Object.assign(new Error('知识点不存在或不属于所选课程'), { code: 40001 });
      await tx.taskKnowledgePoint.createMany({ data: knowledgePointIds.map((id) => ({ task_id: task.task_id, knowledge_point_id: id })) });
    }
    const attachmentIds = [...new Set((Array.isArray(attachment_ids) ? attachment_ids : []).map(Number).filter(Boolean))];
    if (attachmentIds.length) {
      const documents = await tx.knowledgeDocument.findMany({
        where: { document_id: { in: attachmentIds }, owner_user_id: user.user_id, deleted_at: null },
        select: { document_id: true },
      });
      if (documents.length !== attachmentIds.length && !isAdmin(user)) throw Object.assign(new Error('包含无权使用的附件'), { code: 40301 });
      await tx.teachingTaskAttachment.createMany({ data: documents.map((item) => ({ task_id: task.task_id, document_id: item.document_id })) });
    }
    const delivery = finalStatus === 'PUBLISHED' ? await createPublishedRecipients(tx, task, user.user_id) : { recipientCount: 0, notificationCount: 0 };
    return { task, delivery };
  });

  return {
    task_id: result.task.task_id,
    title: result.task.title,
    task_type: toLower(result.task.task_type),
    status: toLower(result.task.status),
    recipient_count: result.delivery.recipientCount,
    notification_count: result.delivery.notificationCount,
  };
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
      attachments: { include: { document: true } },
      recipients: { select: { student_user_id: true, viewed_at: true, delivery_status: true } },
    },
  });

  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureTeachingClassAccess(user, task.teaching_class_id);

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
    duration_minutes: task.duration_minutes,
    allowed_attempts: task.allowed_attempts,
    allow_pause: task.allow_pause,
    save_draft: task.save_draft,
    randomize_questions: task.randomize_questions,
    randomize_options: task.randomize_options,
    show_score_policy: task.show_score_policy,
    show_answer_policy: task.show_answer_policy,
    show_analysis_policy: task.show_analysis_policy,
    auto_grade: task.auto_grade,
    ai_grade_subjective: task.ai_grade_subjective,
    full_screen_mode: task.full_screen_mode,
    source_mode: task.source_mode,
    total_score: task.total_score,
    pass_score: task.pass_score,
    instructions: task.instructions,
    rules: task.rules,
    configuration: task.configuration_json,
    published_at: task.published_at?.toISOString() || null,
    submission_count: task._count.submissions,
    questions: task.question_links.map((ql) => ({
      question_id: ql.question_id,
      title: ql.question.title,
      question_type: toLower(ql.question.question_type),
      difficulty_level: toLower(ql.question.difficulty_level),
      score: ql.question.score,
      task_score: ql.score ?? ql.question.score,
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
    recipient_count: task.recipients.length,
    read_count: task.recipients.filter((item) => item.viewed_at).length,
    attachments: task.attachments.map((item) => ({
      document_id: item.document_id,
      title: item.document.title,
      file_name: item.document.original_filename,
      mime_type: item.document.mime_type,
    })),
  };
}

// ---------- 更新任务 ----------

async function updateTask(user, taskId, body) {
  const task = await prisma.learningTask.findUnique({ where: { task_id: taskId } });
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureTeachingClassAccess(user, task.teaching_class_id);

  const { title, description, start_time, deadline, allow_late_submit, status, question_ids, knowledge_point_ids } = body;
  const data = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (start_time !== undefined || body.startAt !== undefined) data.start_time = parseOptionalDate(body.startAt ?? start_time, 'startAt');
  if (deadline !== undefined || body.dueAt !== undefined) data.deadline = parseOptionalDate(body.dueAt ?? deadline, 'dueAt');
  if (allow_late_submit !== undefined || body.allowLateSubmission !== undefined) data.allow_late_submit = body.allowLateSubmission ?? allow_late_submit;
  const fieldMap = {
    duration_minutes: body.durationMinutes ?? body.duration_minutes,
    allowed_attempts: body.allowedAttempts ?? body.allowed_attempts,
    allow_pause: body.allowPause ?? body.allow_pause,
    save_draft: body.saveDraft ?? body.save_draft,
    randomize_questions: body.randomizeQuestions ?? body.randomize_questions,
    randomize_options: body.randomizeOptions ?? body.randomize_options,
    show_score_policy: body.showScorePolicy ?? body.show_score_policy,
    show_answer_policy: body.showAnswerPolicy ?? body.show_answer_policy,
    show_analysis_policy: body.showAnalysisPolicy ?? body.show_analysis_policy,
    auto_grade: body.autoGrade ?? body.auto_grade,
    ai_grade_subjective: body.aiGradeSubjective ?? body.ai_grade_subjective,
    full_screen_mode: body.fullScreenMode ?? body.full_screen_mode,
    source_mode: body.sourceMode ?? body.source_mode,
    total_score: body.totalScore ?? body.total_score,
    pass_score: body.passScore ?? body.pass_score,
    instructions: body.instructions,
    rules: body.rules,
    configuration_json: body.configuration ?? body.composition,
  };
  Object.entries(fieldMap).forEach(([key, value]) => { if (value !== undefined) data[key] = value; });
  let publishing = false;
  if (status !== undefined) {
    const st = TASK_STATUS_MAP[status];
    if (st) {
      data.status = st;
      publishing = st === 'PUBLISHED' && task.status !== 'PUBLISHED';
      if (publishing) data.published_at = new Date();
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    if (Array.isArray(question_ids)) {
      const normalizedIds = [...new Set(question_ids.map(Number).filter(Boolean))];
      const count = await tx.question.count({ where: { question_id: { in: normalizedIds }, course_id: task.course_id } });
      if (count !== normalizedIds.length) throw Object.assign(new Error('题目不存在或不属于任务课程'), { code: 40001 });
      await tx.taskQuestion.deleteMany({ where: { task_id: taskId } });
      if (normalizedIds.length) {
        await tx.taskQuestion.createMany({ data: normalizedIds.map((qid, idx) => ({ task_id: taskId, question_id: qid, question_order: idx })) });
      }
    }
    if (Array.isArray(knowledge_point_ids)) {
      const normalizedIds = [...new Set(knowledge_point_ids.map(Number).filter(Boolean))];
      await tx.taskKnowledgePoint.deleteMany({ where: { task_id: taskId } });
      if (normalizedIds.length) await tx.taskKnowledgePoint.createMany({ data: normalizedIds.map((id) => ({ task_id: taskId, knowledge_point_id: id })) });
    }
    const questionCount = await tx.taskQuestion.count({ where: { task_id: taskId } });
    if (publishing && ['HOMEWORK', 'EXAM', 'PRACTICE', 'QUIZ'].includes(task.task_type) && !questionCount) {
      throw Object.assign(new Error('作业、考试或练习发布时至少需要一道题目'), { code: 40001 });
    }
    const updated = await tx.learningTask.update({ where: { task_id: taskId }, data });
    const delivery = publishing ? await createPublishedRecipients(tx, updated, user.user_id) : { recipientCount: 0, notificationCount: 0 };
    return { updated, delivery };
  });

  return {
    task_id: result.updated.task_id,
    title: result.updated.title,
    status: toLower(result.updated.status),
    recipient_count: result.delivery.recipientCount,
    notification_count: result.delivery.notificationCount,
  };
}

// ---------- 删除任务 ----------

async function deleteTask(user, taskId) {
  const task = await prisma.learningTask.findUnique({ where: { task_id: taskId } });
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureTeachingClassAccess(user, task.teaching_class_id);
  const submissionCount = await prisma.taskSubmission.count({ where: { task_id: taskId } });
  if (submissionCount > 0 || task.status === 'PUBLISHED') {
    await prisma.learningTask.update({ where: { task_id: taskId }, data: { status: 'CLOSED' } });
    return { closed: true };
  }
  await prisma.learningTask.delete({ where: { task_id: taskId } });
  return { closed: false };
}

// ---------- 提交列表 ----------

async function listSubmissions(user, taskId, query) {
  const task = await prisma.learningTask.findUnique({ where: { task_id: taskId } });
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 40002 });
  await ensureTeachingClassAccess(user, task.teaching_class_id);

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
  await ensureTeachingClassAccess(user, task.teaching_class_id);

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

async function previewTaskComposition(user, body) {
  const courseId = Number(body.course_id);
  const classId = Number(body.teaching_class_id);
  await ensureCourseAccess(user, courseId);
  const teachingClass = await ensureTeachingClassAccess(user, classId);
  if (teachingClass.course_id !== courseId) throw Object.assign(new Error('教学班不属于所选课程'), { code: 40001 });
  const sourceMode = body.source_mode || body.sourceMode || 'question_bank';
  const typeCounts = body.type_counts || body.questionTypeCounts || {};
  const requestedCount = Object.values(typeCounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || Number(body.question_count || 0);
  const manualIds = [...new Set((body.question_ids || []).map(Number).filter(Boolean))];
  const where = {
    course_id: courseId,
    status: { not: 'deleted' },
    ...(body.knowledge_point_ids?.length ? { knowledge_point_id: { in: body.knowledge_point_ids.map(Number) } } : {}),
  };
  if (sourceMode === 'question_bank') where.is_ai_generated = false;
  if (sourceMode === 'ai_generated') where.is_ai_generated = true;
  const candidates = await prisma.question.findMany({
    where,
    include: { knowledge_point: true, _count: { select: { answer_records: true } } },
    orderBy: [{ created_at: 'desc' }],
    take: 1000,
  });
  const selected = [];
  const selectedIds = new Set();
  for (const id of manualIds) {
    const candidate = candidates.find((item) => item.question_id === id)
      || await prisma.question.findFirst({ where: { question_id: id, course_id: courseId, status: { not: 'deleted' } }, include: { knowledge_point: true, _count: { select: { answer_records: true } } } });
    if (candidate) {
      selected.push(candidate);
      selectedIds.add(candidate.question_id);
    }
  }
  const normalizedTypeCounts = Object.entries(typeCounts).map(([key, count]) => [key.toUpperCase(), Number(count) || 0]);
  for (const [type, count] of normalizedTypeCounts) {
    const prismaType = type === 'BLANK' ? 'FILL_BLANK' : type;
    const bucket = candidates.filter((item) => item.question_type === prismaType && !selectedIds.has(item.question_id));
    const desiredAiRatio = sourceMode === 'mixed' ? Math.max(0, Math.min(1, Number(body.ai_ratio ?? 0.5))) : null;
    bucket.sort((a, b) => {
      if (desiredAiRatio == null) return a._count.answer_records - b._count.answer_records;
      return Number(b.is_ai_generated) - Number(a.is_ai_generated) || a._count.answer_records - b._count.answer_records;
    });
    const aiTarget = desiredAiRatio == null ? null : Math.round(count * desiredAiRatio);
    const chosen = desiredAiRatio == null
      ? bucket.slice(0, count)
      : [
          ...bucket.filter((item) => item.is_ai_generated).slice(0, aiTarget),
          ...bucket.filter((item) => !item.is_ai_generated).slice(0, count - aiTarget),
        ].slice(0, count);
    chosen.forEach((item) => {
      if (!selectedIds.has(item.question_id)) {
        selected.push(item);
        selectedIds.add(item.question_id);
      }
    });
  }
  if (!normalizedTypeCounts.length && requestedCount > selected.length) {
    candidates.filter((item) => !selectedIds.has(item.question_id)).slice(0, requestedCount - selected.length).forEach((item) => selected.push(item));
  }
  const totalScore = selected.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const requestedTotal = body.total_score ?? body.totalScore;
  const validation = {
    requested_count: requestedCount || selected.length,
    selected_count: selected.length,
    total_score: totalScore,
    requested_total_score: requestedTotal == null ? null : Number(requestedTotal),
    count_valid: !requestedCount || selected.length === requestedCount,
    score_valid: requestedTotal == null || Math.abs(totalScore - Number(requestedTotal)) < 0.001,
  };
  return {
    source_mode: sourceMode,
    questions: selected.map((item) => ({
      question_id: item.question_id,
      title: item.title,
      question_type: toLower(item.question_type),
      difficulty_level: toLower(item.difficulty_level),
      score: item.score,
      is_ai_generated: item.is_ai_generated,
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point?.knowledge_point_name || null,
    })),
    knowledge_point_coverage: [...new Set(selected.map((item) => item.knowledge_point?.knowledge_point_name).filter(Boolean))],
    validation,
  };
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
  previewTaskComposition,
};
