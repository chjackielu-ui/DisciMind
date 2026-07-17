const prisma = require('../../config/prisma');
const events = require('./subject-chat-event.service');
const stateMachine = require('./subject-chat-state-machine');

const TERMINAL_RUN_STATUSES = stateMachine.TERMINAL_RUN_STATUSES;
const ACTIVE_RUN_STATUSES = [...stateMachine.ACTIVE_RUN_STATUSES, 'pending'];
const DEFAULT_RUN_TIMEOUT_MS = Math.max(30_000, Number(process.env.AGENT_GRAPH_TIMEOUT_MS) || 180_000);
const DEFAULT_TASK_TIMEOUT_MS = Math.max(15_000, Number(process.env.SUBJECT_CHAT_TASK_TIMEOUT_MS) || 120_000);

const TASK_DEFINITIONS = Object.freeze([
  ['understand_request', '理解问题', '识别当前请求实际需要的能力'],
  ['generate_response', '生成回答', '生成并保存最终回答'],
]);

function definitionsForPlan(plan) {
  const definitions = Array.isArray(plan?.taskDefinitions) ? plan.taskDefinitions : [];
  const valid = definitions.filter(item => Array.isArray(item) && item.length >= 3 && item[0] && item[1]);
  return valid.length ? valid.map(item => [String(item[0]).slice(0, 100), String(item[1]).slice(0, 255), String(item[2] || '').slice(0, 1000)]) : TASK_DEFINITIONS;
}

async function notifyTerminalRun(run, status) {
  if (!run) return;
  const labels = {
    completed: ['AI 学习任务已完成', '回答已生成并保存，点击返回原对话查看。'],
    failed: ['AI 学习任务失败', run.errorMessage || '本次运行失败，可返回原对话重试。'],
    stalled: ['AI 学习任务等待超时', run.errorMessage || '任务已停止等待，可返回原对话重试。'],
    cancelled: ['AI 学习任务已停止', '已保留当前生成内容，点击返回原对话查看。'],
  };
  const [title, content] = labels[status] || labels.failed;
  await prisma.notification.upsert({
    where: { idempotency_key: `subject-chat-run:${run.id}:${status}` },
    update: { title, content },
    create: {
      receiver_user_id: run.userId,
      notification_type: 'AI_TASK_DONE',
      title,
      content,
      target_type: 'ai_conversation',
      target_id: run.conversationId,
      business_type: 'ai_chat_run',
      business_id: run.conversationId,
      idempotency_key: `subject-chat-run:${run.id}:${status}`,
    },
  }).catch((error) => console.error('[subject-chat] 终态通知写入失败:', error.message));
}

function serializeTask(task) {
  return {
    taskId: task.id,
    runId: task.runId,
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    status: stateMachine.normalizeTaskStatus(task.status),
    orderIndex: task.orderIndex,
    progress: task.progress,
    inputSummary: task.inputSummary,
    outputSummary: task.outputSummary,
    errorMessage: task.errorMessage,
    errorCode: task.errorCode,
    startedAt: task.startedAt,
    lastHeartbeatAt: task.lastHeartbeatAt,
    completedAt: task.completedAt,
    durationMs: task.durationMs,
    timeoutAt: task.timeoutAt,
    retryCount: task.retryCount || 0,
    firstDeltaAt: task.firstDeltaAt,
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
    status: stateMachine.normalizeRunStatus(run.status),
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
    errorCode: run.errorCode,
    startedAt: run.startedAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    timeoutAt: run.timeoutAt,
    retryCount: run.retryCount || 0,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    serverNow: new Date(),
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

async function createRun(userId, turn, plan = turn.executionPlan) {
  const definitions = definitionsForPlan(plan);
  const run = await prisma.subjectChatRun.create({
    data: {
      conversationId: turn.conversation.id,
      userId,
      assistantMode: String(turn.conversation.mode || 'subject').toLowerCase(),
      status: 'queued',
      lastHeartbeatAt: new Date(),
      timeoutAt: new Date(Date.now() + DEFAULT_RUN_TIMEOUT_MS),
      totalTaskCount: definitions.length,
      pendingTaskCount: definitions.length,
      userMessageId: turn.userMessage?.id || null,
      operationId: `chat-run:${turn.conversation.id}:${turn.userMessage?.id || 'regenerate'}:${Date.now()}`,
      stateJson: plan ? { dynamicPlan: plan, planRevision: 1 } : null,
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
    message: `已按当前请求创建 ${definitions.length} 个动态执行步骤`,
    payload: { run: serializeRun(run, false), executionMode: plan?.executionMode || 'DIRECT_RESPONSE' },
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
  const completed = tasks.filter((task) => stateMachine.normalizeTaskStatus(task.status) === 'completed').length;
  const pending = tasks.filter((task) => ['pending', 'running', 'retrying'].includes(stateMachine.normalizeTaskStatus(task.status))).length;
  const running = tasks.find((task) => stateMachine.normalizeTaskStatus(task.status) === 'running');
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

async function transitionRunStatus(runId, nextStatus, currentTask = undefined) {
  const current = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  if (!current) return null;
  const normalized = stateMachine.assertRunTransition(current.status, nextStatus);
  if (stateMachine.isTerminalRunStatus(current.status)) return current;
  const now = new Date();
  const data = {
    status: normalized,
    lastHeartbeatAt: now,
    ...(current.startedAt ? { durationMs: Math.max(0, now.getTime() - new Date(current.startedAt).getTime()) } : {}),
    ...(currentTask !== undefined ? { currentTask } : {}),
  };
  const changed = await prisma.subjectChatRun.updateMany({
    where: { id: runId, status: current.status },
    data,
  });
  if (!changed.count) return prisma.subjectChatRun.findUnique({ where: { id: runId } });
  const run = { ...current, ...data };
  if (stateMachine.normalizeRunStatus(current.status) !== normalized) {
    await events.record({
      runId,
      eventType: 'run_status_changed',
      title: '运行阶段更新',
      message: currentTask || normalized,
      payload: {
        previousStatus: stateMachine.normalizeRunStatus(current.status),
        status: normalized,
        run: serializeRun(run, false),
      },
    });
  }
  return run;
}

async function heartbeat(runId, options = {}) {
  const current = options.status
    ? await transitionRunStatus(runId, options.status, options.currentTask)
    : await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  if (!current || stateMachine.isTerminalRunStatus(current.status)) return current;
  const now = new Date();
  const durationMs = current.startedAt ? Math.max(0, now.getTime() - new Date(current.startedAt).getTime()) : 0;
  const run = await prisma.subjectChatRun.update({
    where: { id: runId },
    data: {
      lastHeartbeatAt: now,
      durationMs,
      ...(options.currentTask !== undefined ? { currentTask: options.currentTask } : {}),
    },
  });
  if (options.taskId) {
    const task = await prisma.subjectChatTask.findUnique({ where: { id: options.taskId } });
    if (task && ['running', 'retrying'].includes(stateMachine.normalizeTaskStatus(task.status))) {
      await prisma.subjectChatTask.update({
        where: { id: task.id },
        data: {
          lastHeartbeatAt: now,
          durationMs: task.startedAt ? Math.max(0, now.getTime() - new Date(task.startedAt).getTime()) : 0,
        },
      });
    }
  }
  await events.record({
    runId,
    taskId: options.taskId || null,
    eventType: options.eventType || 'run_heartbeat',
    title: options.title || '任务仍在执行',
    message: options.message || options.currentTask || run.currentTask || '运行心跳正常',
    payload: { ...(options.payload || {}), run: serializeRun(run, false) },
  });
  return run;
}

async function markFirstDelta(runId, taskId) {
  const now = new Date();
  await transitionRunStatus(runId, 'generating');
  await prisma.subjectChatTask.updateMany({
    where: { id: taskId, firstDeltaAt: null },
    data: { firstDeltaAt: now, lastHeartbeatAt: now },
  });
  await events.record({
    runId,
    taskId,
    eventType: 'agent_first_delta',
    title: 'Agent 已开始输出',
    message: '已收到首个模型增量片段',
    payload: { firstDeltaAt: now },
  });
}

async function markRunStarted(runId) {
  const now = new Date();
  const run = await prisma.subjectChatRun.update({
    where: { id: runId },
    data: {
      status: 'planning',
      startedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: new Date(now.getTime() + DEFAULT_RUN_TIMEOUT_MS),
      durationMs: 0,
      errorMessage: null,
      errorCode: null,
      completedAt: null,
    },
  });
  await events.record({
    runId,
    eventType: 'run_started',
    title: '开始执行',
    message: '动态 AI 编排器已启动',
    payload: { run: serializeRun(run, false) },
  });
  return run;
}

async function startTask(task, inputSummary = null, options = {}) {
  const now = new Date();
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || DEFAULT_TASK_TIMEOUT_MS);
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: {
      status: 'running',
      progress: 5,
      inputSummary,
      errorMessage: null,
      errorCode: null,
      startedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: new Date(now.getTime() + timeoutMs),
      durationMs: 0,
      completedAt: null,
    },
  });
  if (options.runStatus) await transitionRunStatus(task.runId, options.runStatus, task.title);
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
  const now = new Date();
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: {
      progress: Math.max(5, Math.min(95, Number(progress) || 5)),
      outputSummary: message || undefined,
      lastHeartbeatAt: now,
      ...(task.startedAt ? { durationMs: Math.max(0, now.getTime() - new Date(task.startedAt).getTime()) } : {}),
    },
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
  const now = new Date();
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: {
      status: 'completed',
      progress: 100,
      outputSummary,
      lastHeartbeatAt: now,
      completedAt: now,
      timeoutAt: null,
      durationMs: task.startedAt ? Math.max(0, now.getTime() - new Date(task.startedAt).getTime()) : 0,
    },
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
  const now = new Date();
  const updated = await prisma.subjectChatTask.update({
    where: { id: task.id },
    data: {
      status: 'failed',
      errorMessage: message,
      errorCode: String(error?.code || 'TASK_FAILED').slice(0, 100),
      lastHeartbeatAt: now,
      completedAt: now,
      timeoutAt: null,
      durationMs: task.startedAt ? Math.max(0, now.getTime() - new Date(task.startedAt).getTime()) : 0,
    },
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
  const current = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  if (!current || stateMachine.isTerminalRunStatus(current.status)) return current;
  const now = new Date();
  const changed = await prisma.subjectChatRun.updateMany({
    where: { id: runId, status: current.status },
    data: {
      status: 'completed',
      progress: 100,
      currentTask: null,
      completedTaskCount: current.totalTaskCount,
      pendingTaskCount: 0,
      finalAnswer,
      finalMessageId,
      completedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: null,
      durationMs: current.startedAt ? Math.max(0, now.getTime() - new Date(current.startedAt).getTime()) : 0,
      errorMessage: null,
      errorCode: null,
    },
  });
  if (!changed.count) return prisma.subjectChatRun.findUnique({ where: { id: runId } });
  const run = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  await events.record({
    runId,
    eventType: 'run_completed',
    title: 'AI 学习任务已完成',
    message: '最终回答已保存',
    payload: { run: serializeRun(run, false), finalAnswer, finalMessageId },
  });
  await notifyTerminalRun(run, 'completed');
  return run;
}

async function failRun(runId, error) {
  const current = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  if (!current || stateMachine.isTerminalRunStatus(current.status)) return current;
  const message = String(error?.message || '运行失败').slice(0, 2000);
  const now = new Date();
  await prisma.subjectChatTask.updateMany({
    where: { runId, status: { in: ['pending', 'running', 'retrying'] } },
    data: {
      status: 'skipped',
      errorCode: 'UPSTREAM_RUN_FAILED',
      errorMessage: '前序任务失败，未执行',
      completedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: null,
    },
  });
  const changed = await prisma.subjectChatRun.updateMany({
    where: { id: runId, status: current.status },
    data: {
      status: 'failed',
      currentTask: null,
      pendingTaskCount: 0,
      errorMessage: message,
      errorCode: String(error?.code || 'RUN_FAILED').slice(0, 100),
      completedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: null,
      durationMs: current.startedAt ? Math.max(0, now.getTime() - new Date(current.startedAt).getTime()) : 0,
    },
  });
  if (!changed.count) return prisma.subjectChatRun.findUnique({ where: { id: runId } });
  const run = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  await events.record({
    runId,
    eventType: 'run_failed',
    title: '答疑任务失败',
    message,
    payload: { run: serializeRun(run, false) },
  });
  await notifyTerminalRun(run, 'failed');
  return run;
}

async function stallRun(runId, error) {
  const current = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  if (!current || stateMachine.isTerminalRunStatus(current.status)) return current;
  const now = new Date();
  const message = String(error?.message || '运行心跳超时，已停止等待').slice(0, 2000);
  await prisma.subjectChatTask.updateMany({
    where: { runId, status: { in: ['pending', 'running', 'retrying'] } },
    data: {
      status: 'cancelled',
      errorCode: 'RUN_STALLED',
      errorMessage: message,
      completedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: null,
    },
  });
  const changed = await prisma.subjectChatRun.updateMany({
    where: { id: runId, status: current.status },
    data: {
      status: 'stalled',
      currentTask: null,
      pendingTaskCount: 0,
      errorCode: String(error?.code || 'RUN_TIMEOUT').slice(0, 100),
      errorMessage: message,
      completedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: null,
      durationMs: current.startedAt ? Math.max(0, now.getTime() - new Date(current.startedAt).getTime()) : 0,
    },
  });
  if (!changed.count) return prisma.subjectChatRun.findUnique({ where: { id: runId } });
  const run = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  await events.record({
    runId,
    eventType: 'run_stalled',
    title: '答疑任务等待超时',
    message,
    payload: { run: serializeRun(run, false) },
  });
  await notifyTerminalRun(run, 'stalled');
  return run;
}

async function cancelRun(userId, runId, partialAnswer = null) {
  const owned = await getOwnedRun(userId, runId);
  if (stateMachine.isTerminalRunStatus(owned.status)) return owned;
  const current = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  const now = new Date();
  await prisma.subjectChatTask.updateMany({
    where: { runId, status: { in: ['pending', 'running', 'retrying'] } },
    data: { status: 'cancelled', completedAt: now, lastHeartbeatAt: now, timeoutAt: null, errorMessage: null, errorCode: null },
  });
  const changed = await prisma.subjectChatRun.updateMany({
    where: { id: runId, status: current.status },
    data: {
      status: 'cancelled',
      currentTask: null,
      pendingTaskCount: 0,
      completedAt: now,
      lastHeartbeatAt: now,
      timeoutAt: null,
      durationMs: current.startedAt ? Math.max(0, now.getTime() - new Date(current.startedAt).getTime()) : 0,
      ...(partialAnswer ? { finalAnswer: partialAnswer } : {}),
    },
  });
  if (!changed.count) return getOwnedRun(userId, runId);
  const run = await prisma.subjectChatRun.findUnique({ where: { id: runId } });
  await events.record({
    runId,
    eventType: 'run_cancelled',
    title: '已停止生成',
    message: '未执行步骤已取消，已生成内容予以保留',
    payload: { run: serializeRun(run, false), finalAnswer: partialAnswer || run.finalAnswer },
  });
  await notifyTerminalRun(run, 'cancelled');
  return getOwnedRun(userId, runId);
}

async function resetForRetry(userId, runId, taskId, options = {}) {
  const owned = await getOwnedRun(userId, runId);
  const target = owned.tasks.find((task) => task.taskId === String(taskId));
  if (!target || !['failed', 'cancelled'].includes(target.status)) {
    const error = new Error('仅失败或已取消的步骤可以重试');
    error.code = 40001;
    throw error;
  }
  const plan = options.plan || owned.graphState?.dynamicPlan || null;
  const definitions = definitionsForPlan(plan);
  if (plan) {
    await prisma.$transaction([
      prisma.subjectChatSource.deleteMany({ where: { runId } }),
      prisma.subjectChatEvent.deleteMany({ where: { runId } }),
      prisma.subjectChatTask.deleteMany({ where: { runId } }),
      prisma.subjectChatRun.update({
        where: { id: runId },
        data: {
          status: 'queued', progress: 0, currentTask: null,
          totalTaskCount: definitions.length, completedTaskCount: 0, pendingTaskCount: definitions.length,
          stateJson: { dynamicPlan: plan, planRevision: Number(owned.graphState?.planRevision || 1) + 1 },
          finalAnswer: null, finalMessageId: null, errorMessage: null, errorCode: null,
          startedAt: null, lastHeartbeatAt: new Date(), completedAt: null, durationMs: null,
          timeoutAt: new Date(Date.now() + DEFAULT_RUN_TIMEOUT_MS), retryCount: { increment: 1 },
          tasks: { create: definitions.map(([taskType, title, description], index) => ({ taskType, title, description, orderIndex: index + 1 })) },
        },
      }),
    ]);
  } else await prisma.$transaction([
    prisma.subjectChatSource.deleteMany({ where: { runId } }),
    prisma.subjectChatTask.updateMany({
      where: { runId },
      data: {
        status: 'pending',
        progress: 0,
        inputSummary: null,
        outputSummary: null,
        errorMessage: null,
        errorCode: null,
        startedAt: null,
        lastHeartbeatAt: null,
        completedAt: null,
        durationMs: null,
        timeoutAt: null,
        firstDeltaAt: null,
        retryCount: { increment: 1 },
      },
    }),
    prisma.subjectChatRun.update({
      where: { id: runId },
      data: {
        status: 'queued',
        progress: 0,
        currentTask: null,
        completedTaskCount: 0,
        pendingTaskCount: owned.totalTaskCount,
        finalAnswer: null,
        finalMessageId: null,
        errorMessage: null,
        errorCode: null,
        startedAt: null,
        lastHeartbeatAt: new Date(),
        completedAt: null,
        durationMs: null,
        timeoutAt: new Date(Date.now() + DEFAULT_RUN_TIMEOUT_MS),
        retryCount: { increment: 1 },
      },
    }),
  ]);
  const refreshed = await getOwnedRun(userId, runId);
  await events.record({
    runId,
    taskId: refreshed.tasks[0]?.taskId || null,
    eventType: 'task_progress',
    title: '重新执行运行任务',
    message: `从“${target.title}”发起重试，并重建所需上下文`,
    payload: { retryTaskId: target.taskId },
  });
  return getOwnedRun(userId, runId);
}

module.exports = {
  TASK_DEFINITIONS,
  definitionsForPlan,
  TERMINAL_RUN_STATUSES,
  serializeRun,
  serializeTask,
  serializeSource,
  assertNoActiveRun,
  createRun,
  getOwnedRun,
  getLatestForConversation,
  transitionRunStatus,
  heartbeat,
  markFirstDelta,
  markRunStarted,
  startTask,
  progressTask,
  completeTask,
  failTask,
  createSource,
  completeRun,
  failRun,
  stallRun,
  cancelRun,
  resetForRetry,
};
