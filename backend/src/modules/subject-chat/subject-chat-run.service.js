const prisma = require('../../config/prisma');
const events = require('./subject-chat-event.service');

const TERMINAL_RUN_STATUSES = new Set(['success', 'failed', 'cancelled']);
const ACTIVE_RUN_STATUSES = ['pending', 'running'];

const TASK_DEFINITIONS = [
  ['analyze_question', '分析问题', '校验输入并建立本轮对话上下文'],
  ['identify_scope', '识别课程与知识点', '从选课与当前学习上下文中识别真实范围'],
  ['load_learning_context', '读取学习上下文', '读取最近学习记录、任务和学习流进度'],
  ['load_student_profile', '读取学生画像', '读取掌握度、薄弱点与错题概况'],
  ['retrieve_knowledge', '检索学科知识库', '检索课程知识库并记录可验证来源'],
  ['invoke_subject_agent', '调用学科答疑 Agent', '复用现有学科答疑模型流式生成回答'],
  ['organize_sources', '整理引用来源', '整理本轮实际使用的课程资料与学习数据'],
  ['quality_check', '检查答案质量', '检查回答完整性与引用编号'],
  ['finalize_answer', '生成最终回答', '保存最终消息并完成本轮运行'],
];

function serializeTask(task) {
  return {
    taskId: task.id,
    runId: task.runId,
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    status: task.status,
    orderIndex: task.orderIndex,
    progress: task.progress,
    inputSummary: task.inputSummary,
    outputSummary: task.outputSummary,
    errorMessage: task.errorMessage,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  };
}

function serializeSource(source) {
  return {
    sourceId: source.id,
    runId: source.runId,
    taskId: source.taskId,
    sourceType: source.sourceType,
    title: source.title,
    summary: source.summary,
    url: source.url,
    documentId: source.documentId,
    datasetId: source.datasetId,
    relevanceScore: source.relevanceScore,
    metadata: source.metadata || {},
    createdAt: source.createdAt,
  };
}

function serializeRun(run, detail = true) {
  const result = {
    runId: run.id,
    conversationId: run.conversationId,
    userId: run.userId,
    assistantMode: run.assistantMode,
    courseId: run.courseId,
    knowledgePointId: run.knowledgePointId,
    status: run.status,
    progress: run.progress,
    currentTask: run.currentTask,
    graphVersion: run.graphVersion,
    currentNode: run.currentNode,
    graphState: run.stateJson || null,
    operationId: run.operationId,
    totalTaskCount: run.totalTaskCount,
    completedTaskCount: run.completedTaskCount,
    pendingTaskCount: run.pendingTaskCount,
    userMessageId: run.userMessageId,
    finalMessageId: run.finalMessageId,
    finalAnswer: run.finalAnswer,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
  if (detail) {
    result.tasks = (run.tasks || []).map(serializeTask);
    result.events = (run.events || []).map(events.serializeEvent);
    result.sources = (run.sources || []).map(serializeSource);
  }
  return result;
}

const detailInclude = {
  tasks: { orderBy: { orderIndex: 'asc' } },
  events: { orderBy: { sequence: 'asc' } },
  sources: { orderBy: { createdAt: 'asc' } },
};

async function assertNoActiveRun(userId, conversationId) {
  const active = await prisma.subjectChatRun.findFirst({
    where: { userId, conversationId, status: { in: ACTIVE_RUN_STATUSES } },
    orderBy: { createdAt: 'desc' },
  });
  if (active) {
    const error = new Error('当前会话已有正在执行的答疑任务');
    error.code = 40901;
    error.runId = active.id;
    throw error;
  }
}

async function createRun(userId, turn) {
  const definitions = TASK_DEFINITIONS;
  const run = await prisma.subjectChatRun.create({
    data: {
      conversationId: turn.conversation.id,
      userId,
      assistantMode: String(turn.conversation.mode || 'subject').toLowerCase(),
      status: 'pending',
      totalTaskCount: definitions.length,
      pendingTaskCount: definitions.length,
      userMessageId: turn.userMessage?.id || null,
      operationId: `chat-run:${turn.conversation.id}:${turn.userMessage?.id || 'regenerate'}:${Date.now()}`,
      tasks: {
        create: definitions.map(([taskType, title, description], index) => ({
          taskType,
          title,
          description,
          orderIndex: index + 1,
        })),
      },
    },
    include: detailInclude,
  });
  await events.record({
    runId: run.id,
    eventType: 'run_created',
    title: '运行任务已创建',
    message: `已创建 ${definitions.length} 个真实执行步骤`,
    payload: { run: serializeRun(run, false) },
  });
  for (const task of run.tasks) {
    await events.record({
      runId: run.id,
      taskId: task.id,
      eventType: 'task_created',
      title: task.title,
      message: task.description,
      payload: { task: serializeTask(task) },
    });
  }
  return getOwnedRun(userId, run.id);
}

async function getOwnedRun(userId, runId) {
  const run = await prisma.subjectChatRun.findFirst({
    where: { id: String(runId), userId: Number(userId) },
    include: detailInclude,
  });
  if (!run) {
    const error = new Error('运行任务不存在或无权访问');
    error.code = 40301;
    throw error;
  }
  return serializeRun(run);
}

async function getLatestForConversation(userId, conversationId) {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: Number(conversationId), userId: Number(userId) },
    select: { id: true },
  });
  if (!conversation) {
    const error = new Error('会话不存在或无权访问');
    error.code = 40301;
    throw error;
  }
  const run = await prisma.subjectChatRun.findFirst({
    where: { conversationId: conversation.id, userId: Number(userId) },
    orderBy: { createdAt: 'desc' },
    include: detailInclude,
  });
  return run ? serializeRun(run) : null;
}

async function refreshProgress(runId, currentTask = undefined) {
  const tasks = await prisma.subjectChatTask.findMany({ where: { runId } });
  const completed = tasks.filter((task) => task.status === 'success').length;
  const pending = tasks.filter((task) => ['pending', 'running'].includes(task.status)).length;
  const running = tasks.find((task) => task.status === 'running');
  const partial = running ? Math.max(0, Math.min(100, running.progress)) / 100 : 0;
  const progress = tasks.length ? Math.min(99, Math.round(((completed + partial) / tasks.length) * 100)) : 0;
  return prisma.subjectChatRun.update({
    where: { id: runId },
    data: {
      completedTaskCount: completed,
      pendingTaskCount: pending,
      progress,
      ...(currentTask !== undefined ? { currentTask } : {}),
    },
  });
}

async function markRunStarted(runId) {
  const run = await prisma.subjectChatRun.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date(), errorMessage: null },
  });
  await events.record({
    runId,
    eventType: 'run_started',
    title: '开始执行',
    message: '学科答疑编排器已启动',
    payload: { run: serializeRun(run, false) },
  });
  return run;
}

async function startTask(task, inputSummary = null) {
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: { status: 'running', progress: 5, inputSummary, errorMessage: null, startedAt: new Date(), completedAt: null },
  });
  const run = await refreshProgress(task.runId, task.title);
  await events.record({
    runId: task.runId,
    taskId: task.id,
    eventType: 'task_started',
    title: task.title,
    message: inputSummary || task.description,
    payload: { task: serializeTask(updated), run: serializeRun(run, false) },
  });
  return updated;
}

async function progressTask(task, progress, message, payload = null) {
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: { progress: Math.max(5, Math.min(95, Number(progress) || 5)), outputSummary: message || undefined },
  });
  const run = await refreshProgress(task.runId, task.title);
  await events.record({
    runId: task.runId,
    taskId: task.id,
    eventType: 'task_progress',
    title: task.title,
    message,
    payload: { ...(payload || {}), task: serializeTask(updated), run: serializeRun(run, false) },
  });
  return updated;
}

async function completeTask(task, outputSummary, payload = null) {
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: { status: 'success', progress: 100, outputSummary, completedAt: new Date() },
  });
  const run = await refreshProgress(task.runId, null);
  await events.record({
    runId: task.runId,
    taskId: task.id,
    eventType: 'task_completed',
    title: task.title,
    message: outputSummary,
    payload: { ...(payload || {}), task: serializeTask(updated), run: serializeRun(run, false) },
  });
  return updated;
}

async function failTask(task, error) {
  const message = String(error?.message || '任务执行失败').slice(0, 2000);
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: { status: 'failed', errorMessage: message, completedAt: new Date() },
  });
  const run = await refreshProgress(task.runId, task.title);
  await events.record({
    runId: task.runId,
    taskId: task.id,
    eventType: 'task_failed',
    title: `${task.title}失败`,
    message,
    payload: { task: serializeTask(updated), run: serializeRun(run, false) },
  });
  return updated;
}

async function createSource(runId, taskId, data) {
  const source = await prisma.subjectChatSource.create({
    data: {
      runId,
      taskId,
      sourceType: String(data.sourceType || 'COURSE_KNOWLEDGE'),
      title: String(data.title || '未命名来源').slice(0, 255),
      summary: data.summary ? String(data.summary).slice(0, 4000) : null,
      url: data.url ? String(data.url).slice(0, 1000) : null,
      documentId: data.documentId ? String(data.documentId).slice(0, 255) : null,
      datasetId: data.datasetId ? String(data.datasetId).slice(0, 255) : null,
      relevanceScore: Number.isFinite(Number(data.relevanceScore)) ? Number(data.relevanceScore) : null,
      metadata: data.metadata || null,
    },
  });
  const serialized = serializeSource(source);
  await events.record({
    runId,
    taskId,
    eventType: 'source_found',
    title: source.title,
    message: source.summary || '已找到可用资料',
    payload: { source: serialized },
  });
  return serialized;
}

async function completeRun(runId, { finalAnswer, finalMessageId }) {
  const run = await prisma.subjectChatRun.update({
    where: { id: runId },
    data: {
      status: 'success',
      progress: 100,
      currentTask: null,
      completedTaskCount: TASK_DEFINITIONS.length,
      pendingTaskCount: 0,
      finalAnswer,
      finalMessageId,
      completedAt: new Date(),
      errorMessage: null,
    },
  });
  await events.record({
    runId,
    eventType: 'run_completed',
    title: '答疑任务已完成',
    message: '最终回答已保存',
    payload: { run: serializeRun(run, false), finalAnswer, finalMessageId },
  });
  return run;
}

async function failRun(runId, error) {
  const current = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  if (!current || current.status === 'cancelled') return current;
  const message = String(error?.message || '运行失败').slice(0, 2000);
  await prisma.subjectChatTask.updateMany({
    where: { runId, status: 'pending' },
    data: { status: 'skipped', errorMessage: '前序任务失败，未执行', completedAt: new Date() },
  });
  const run = await prisma.subjectChatRun.update({
    where: { id: runId },
    data: { status: 'failed', currentTask: null, pendingTaskCount: 0, errorMessage: message, completedAt: new Date() },
  });
  await events.record({
    runId,
    eventType: 'run_failed',
    title: '答疑任务失败',
    message,
    payload: { run: serializeRun(run, false) },
  });
  return run;
}

async function cancelRun(userId, runId, partialAnswer = null) {
  const owned = await getOwnedRun(userId, runId);
  if (TERMINAL_RUN_STATUSES.has(owned.status)) return owned;
  await prisma.subjectChatTask.updateMany({
    where: { runId, status: { in: ['pending', 'running'] } },
    data: { status: 'cancelled', completedAt: new Date(), errorMessage: null },
  });
  const run = await prisma.subjectChatRun.update({
    where: { id: runId },
    data: {
      status: 'cancelled',
      currentTask: null,
      pendingTaskCount: 0,
      completedAt: new Date(),
      ...(partialAnswer ? { finalAnswer: partialAnswer } : {}),
    },
  });
  await events.record({
    runId,
    eventType: 'run_cancelled',
    title: '已停止生成',
    message: '未执行步骤已取消，已生成内容予以保留',
    payload: { run: serializeRun(run, false), finalAnswer: partialAnswer || run.finalAnswer },
  });
  return getOwnedRun(userId, runId);
}

async function resetForRetry(userId, runId, taskId) {
  const owned = await getOwnedRun(userId, runId);
  const target = owned.tasks.find((task) => task.taskId === String(taskId));
  if (!target || !['failed', 'cancelled'].includes(target.status)) {
    const error = new Error('仅失败或已取消的步骤可以重试');
    error.code = 40001;
    throw error;
  }
  await prisma.$transaction([
    prisma.subjectChatSource.deleteMany({ where: { runId } }),
    prisma.subjectChatTask.updateMany({
      where: { runId },
      data: { status: 'pending', progress: 0, inputSummary: null, outputSummary: null, errorMessage: null, startedAt: null, completedAt: null },
    }),
    prisma.subjectChatRun.update({
      where: { id: runId },
      data: { status: 'pending', progress: 0, currentTask: null, completedTaskCount: 0, pendingTaskCount: TASK_DEFINITIONS.length, finalAnswer: null, finalMessageId: null, errorMessage: null, startedAt: null, completedAt: null },
    }),
  ]);
  await events.record({
    runId,
    taskId: target.taskId,
    eventType: 'task_progress',
    title: '重新执行运行任务',
    message: `从“${target.title}”发起重试，并重建所需上下文`,
    payload: { retryTaskId: target.taskId },
  });
  return getOwnedRun(userId, runId);
}

module.exports = {
  TASK_DEFINITIONS,
  TERMINAL_RUN_STATUSES,
  serializeRun,
  serializeTask,
  serializeSource,
  assertNoActiveRun,
  createRun,
  getOwnedRun,
  getLatestForConversation,
  markRunStarted,
  startTask,
  progressTask,
  completeTask,
  failTask,
  createSource,
  completeRun,
  failRun,
  cancelRun,
  resetForRetry,
};
