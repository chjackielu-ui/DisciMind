const crypto = require('crypto');
const prisma = require('../../config/prisma');

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];
const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_LOCAL_SCAN_MS = 3_000;
const DEFAULT_EXTERNAL_SCAN_MS = 15_000;
const DEFAULT_RUNNING_STALE_MS = 5 * 60_000;
const DEFAULT_EXTERNAL_MAX_AGE_MS = 24 * 60 * 60_000;
// PPT/PPTX conversions are owned by document-conversion.service. They use the
// global task table for visibility, but the generic artifact exporter must not
// claim them while LibreOffice is running.
const PPT_CONVERSION_OPERATION_PREFIX = 'DOCUMENT_EXPORT:ppt-convert-';

function delayForAttempt(attempt) {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, Number(attempt || 1) - 1)));
}

class AsyncTaskWorker {
  constructor(options = {}) {
    this.instanceId = options.instanceId || `${process.pid}-${crypto.randomUUID()}`;
    this.leaseMs = Number(options.leaseMs || DEFAULT_LEASE_MS);
    this.heartbeatMs = Number(options.heartbeatMs || DEFAULT_HEARTBEAT_MS);
    this.localScanMs = Number(options.localScanMs || DEFAULT_LOCAL_SCAN_MS);
    this.externalScanMs = Number(options.externalScanMs || DEFAULT_EXTERNAL_SCAN_MS);
    this.runningStaleMs = Number(options.runningStaleMs || DEFAULT_RUNNING_STALE_MS);
    this.externalMaxAgeMs = Number(options.externalMaxAgeMs || DEFAULT_EXTERNAL_MAX_AGE_MS);
    this.maxConcurrent = Math.max(1, Number(options.maxConcurrent || process.env.ASYNC_TASK_WORKER_CONCURRENCY || 2));
    this.operationIdContains = options.operationIdContains ? String(options.operationIdContains) : null;
    this.handlers = new Map();
    this.active = new Map();
    this.localTimer = null;
    this.externalTimer = null;
    this.started = false;
    this.stopping = false;
  }

  register(taskType, handler, options = {}) {
    this.handlers.set(taskType, {
      handler,
      external: Boolean(options.external),
      local: options.local === undefined ? !options.external : Boolean(options.local),
    });
    return this;
  }

  cancel(taskId) {
    const execution = this.active.get(Number(taskId));
    if (!execution) return false;
    execution.abortController.abort();
    return true;
  }

  registerDefaults() {
    this.register('FILE_GENERATION', async (task, { signal }) => {
      const artifactId = Number(task.relatedResourceId || task.metadataJson?.artifactId);
      if (!Number.isInteger(artifactId) || artifactId < 1) {
        throw Object.assign(new Error('文件生成任务缺少有效 Artifact 关联'), {
          code: 'ARTIFACT_NOT_FOUND', permanent: true,
          userMessage: '文件生成失败，任务关联的文件不存在。',
        });
      }
      const generationGraph = require('../file-generator/graph/file-generator.graph');
      await generationGraph.runFileGeneratorGraph(artifactId, { taskId: task.id, signal });
      return { terminal: true };
    });
    this.register('DOCUMENT_EXPORT', async (task, { signal }) => {
      const artifactId = Number(task.relatedResourceId || task.metadataJson?.artifactId);
      if (!Number.isInteger(artifactId) || artifactId < 1) {
        throw Object.assign(new Error('文件导出任务缺少有效 Artifact 关联'), {
          code: 'ARTIFACT_NOT_FOUND', permanent: true,
          userMessage: '文件导出失败，任务关联的文件不存在。',
        });
      }
      const exporter = require('../file-generator/artifact-export.service');
      await exporter.exportFormat(artifactId, task.metadataJson?.format || 'DOCX', { taskId: task.id, signal });
      return { terminal: true };
    });
    this.register('LESSON_PLAN_EXPORT', async (task, { signal }) => {
      const exporter = require('../../services/teacher-preparation-document.service');
      await exporter.retryLessonPlanExportTask(task, { signal });
      return { terminal: true };
    });
    this.register('ARTIFACT_CLEANUP', async (task) => {
      const cleanup = require('../file-generator/artifact-cleanup.service');
      await cleanup.runCleanup({ taskId: task.id });
      return { terminal: true };
    });
    this.register('LEARNING_FLOW_PRELOAD', async (task, { signal }) => {
      if (task.metadataJson?.kind === 'KNOWLEDGE_RESOURCE_PACKAGE') {
        const packages = require('../../services/student-learning-package.service');
        const timeoutMs = Math.max(5 * 60_000, Number(process.env.RESOURCE_PACKAGE_TASK_TIMEOUT_MS || 30 * 60_000));
        const timeoutController = new AbortController();
        const forwardAbort = () => timeoutController.abort();
        signal.addEventListener('abort', forwardAbort, { once: true });
        const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
        timer.unref?.();
        try {
          await packages.processPackageTask(task, timeoutController.signal);
        } catch (error) {
          if (timeoutController.signal.aborted && !signal.aborted) {
            throw Object.assign(new Error('个性化学习资源包生成超时'), {
              code: 'RESOURCE_PACKAGE_TIMEOUT',
              userMessage: '学习资源包生成超时，已完成的资料会保留；可以稍后重新生成缺失资源。',
            });
          }
          throw error;
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', forwardAbort);
        }
        return { terminal: true };
      }
      if (task.metadataJson?.kind === 'DAILY_LEARNING_CARD') {
        const cards = require('../learning-card/learning-card-ai.service');
        await cards.processDailyCardTask(task, { signal });
        return { terminal: true };
      }
      if (task.metadataJson?.kind === 'LEARNING_CARD') {
        const cards = require('../learning-flow-preload/knowledge-card.service');
        await cards.processCardTask(task, { signal });
        return { terminal: true };
      }
      const processor = require('../learning-flow-preload/learning-flow-preload.processor');
      await processor.processPreload(Number(task.relatedResourceId || task.metadataJson?.preloadId), { taskId: task.id, signal });
      return { terminal: true };
    });
    this.register('VOICE_PRELOAD', async (task, { signal }) => {
      if (task.metadataJson?.kind === 'PPT_VIDEO_NARRATION') {
        const media = require('../../services/student-learning-media.service');
        const timeoutMs = Math.max(60_000, Number(process.env.VIDEO_NARRATION_TASK_TIMEOUT_MS || 15 * 60_000));
        const timeoutController = new AbortController();
        const forwardAbort = () => timeoutController.abort();
        signal.addEventListener('abort', forwardAbort, { once: true });
        const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
        timer.unref?.();
        try {
          await media.processVideoTask(task, timeoutController.signal);
          if (timeoutController.signal.aborted && !signal.aborted) {
            throw Object.assign(new Error('视频素材生成超时'), { code: 'VIDEO_NARRATION_TIMEOUT', userMessage: '视频讲稿或配音生成超时，请减少PPT页数后重试。' });
          }
        } catch (error) {
          if (timeoutController.signal.aborted && !signal.aborted) {
            throw Object.assign(new Error('视频素材生成超时'), { code: 'VIDEO_NARRATION_TIMEOUT', userMessage: '视频讲稿或配音生成超时，请减少PPT页数后重试。' });
          }
          throw error;
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', forwardAbort);
        }
        return { terminal: true };
      }
      const voice = require('../learning-flow-preload/voice-prewarm.service');
      await voice.processVoiceTask(task, signal);
      return { terminal: true };
    });
    this.register('LESSON_PLAN_GENERATION', async (task) => {
      const lessonPlanGraph = require('../lesson-plan/graph/lesson-plan.graph');
      await lessonPlanGraph.runLessonPlanGraph(task.id);
      return { terminal: true };
    });
    this.register('KNOWLEDGE_INDEXING', async (task, { signal }) => {
      const documentId = Number(task.relatedResourceId);
      if (!Number.isInteger(documentId) || documentId < 1) {
        throw Object.assign(new Error('知识库任务缺少有效文档关联'), {
          code: 'KNOWLEDGE_DOCUMENT_MISSING', permanent: true,
          userMessage: '知识库处理失败，可以重新上传或重新建立索引。',
        });
      }
      const doc = await prisma.knowledgeDocument.findUnique({
        where: { document_id: documentId },
        select: { knowledge_base_id: true, processing_state: true, dify_batch_id: true },
      });
      if (!doc) throw Object.assign(new Error('知识库文档不存在'), {
        code: 'KNOWLEDGE_DOCUMENT_MISSING', permanent: true,
        userMessage: '知识库处理失败，可以重新上传或重新建立索引。',
      });
      const knowledge = require('../knowledge-base/knowledge-base.service');
      if (task.status !== 'WAITING_EXTERNAL' || doc.processing_state !== 'indexing' || !doc.dify_batch_id) {
        return require('../knowledge-base/knowledge-document-pipeline.service').processDocumentTask(task, signal);
      }
      if (Date.now() - new Date(task.createdAt).getTime() >= this.externalMaxAgeMs) {
        throw Object.assign(new Error('外部知识库任务等待超时'), {
          code: 'EXTERNAL_TASK_TIMEOUT', permanent: true,
          userMessage: '知识库处理等待超时，可以重新上传或重新建立索引。',
        });
      }
      await knowledge.refreshStatus(task.userId, doc.knowledge_base_id, { throwOnSyncError: true });
      const refreshed = await prisma.asyncTask.findUnique({ where: { id: task.id } });
      if (TERMINAL_STATUSES.includes(refreshed?.status)) return { terminal: true };
      if (refreshed?.status === 'QUEUED') return { status: 'QUEUED', nextRunAt: refreshed.nextRunAt };
      return { status: 'WAITING_EXTERNAL', nextRunAt: new Date(Date.now() + this.externalScanMs) };
    }, { external: true, local: true });
    return this;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    await this.scanLocal().catch((error) => this.log('local startup scan failed', error));
    await this.scanExternal().catch((error) => this.log('external startup scan failed', error));
    this.scheduleLocal();
    this.scheduleExternal();
  }

  scheduleLocal() {
    if (this.stopping || this.localTimer) return;
    this.localTimer = setTimeout(async () => {
      this.localTimer = null;
      await this.scanLocal().catch((error) => this.log('local scan failed', error));
      this.scheduleLocal();
    }, this.localScanMs);
    this.localTimer.unref?.();
  }

  scheduleExternal() {
    if (this.stopping || this.externalTimer) return;
    this.externalTimer = setTimeout(async () => {
      this.externalTimer = null;
      await this.scanExternal().catch((error) => this.log('external scan failed', error));
      this.scheduleExternal();
    }, this.externalScanMs);
    this.externalTimer.unref?.();
  }

  async scanLocal() {
    const types = [...this.handlers.entries()].filter(([, value]) => value.local).map(([key]) => key);
    if (!types.length) return;
    await this.claimAndRun({ statuses: ['QUEUED', 'RUNNING'], taskTypes: types, incrementAttempt: true });
  }

  async scanExternal() {
    const types = [...this.handlers.entries()].filter(([, value]) => value.external).map(([key]) => key);
    if (!types.length) return;
    await this.claimAndRun({ statuses: ['WAITING_EXTERNAL'], taskTypes: types, incrementAttempt: false });
  }

  async claimAndRun({ statuses, taskTypes, incrementAttempt }) {
    if (this.stopping || this.active.size >= this.maxConcurrent) return;
    const now = new Date();
    const leaseExpiredAt = new Date(Date.now() - this.leaseMs);
    const runningStaleAt = new Date(Date.now() - this.runningStaleMs);
    const statusConditions = statuses.map((status) => status === 'RUNNING'
      ? { status, OR: [{ lockedAt: null }, { lockedAt: { lt: leaseExpiredAt } }, { updatedAt: { lte: runningStaleAt } }] }
      : { status });
    const candidates = await prisma.asyncTask.findMany({
      where: {
        AND: [
          { OR: statusConditions },
          { OR: [{ lockedAt: null }, { lockedAt: { lt: leaseExpiredAt } }] },
        ],
        taskType: { in: taskTypes }, nextRunAt: { lte: now },
        NOT: { operationId: { startsWith: PPT_CONVERSION_OPERATION_PREFIX } },
        ...(this.operationIdContains ? { operationId: { contains: this.operationIdContains } } : {}),
      },
      orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
      take: Math.max(1, this.maxConcurrent - this.active.size),
    });
    for (const candidate of candidates) {
      if (this.stopping || this.active.size >= this.maxConcurrent) break;
      if (incrementAttempt && candidate.attemptCount >= candidate.maxAttempts) {
        await prisma.asyncTask.updateMany({
          where: { id: candidate.id, status: candidate.status, attemptCount: candidate.attemptCount },
          data: { status: 'FAILED', stage: 'FAILED', errorCode: 'MAX_ATTEMPTS_REACHED', errorMessage: '任务重试次数已用尽。', completedAt: now, lockedBy: null, lockedAt: null },
        });
        continue;
      }
      const data = {
        lockedBy: this.instanceId,
        lockedAt: now,
        ...(candidate.status === 'QUEUED' ? { status: 'RUNNING', startedAt: candidate.startedAt || now } : {}),
        ...(incrementAttempt ? { attemptCount: { increment: 1 } } : {}),
      };
      const claimed = await prisma.asyncTask.updateMany({
        where: {
          id: candidate.id, status: candidate.status, attemptCount: candidate.attemptCount,
          nextRunAt: { lte: now },
          ...(this.operationIdContains ? { operationId: { contains: this.operationIdContains } } : {}),
          OR: [{ lockedAt: null }, { lockedAt: { lt: leaseExpiredAt } }],
        },
        data,
      });
      if (claimed.count !== 1) continue;
      const task = await prisma.asyncTask.findUnique({ where: { id: candidate.id } });
      if (task) void this.execute(task);
    }
  }

  async execute(task) {
    const registration = this.handlers.get(task.taskType);
    if (!registration) return this.release(task.id, new Date(Date.now() + 30_000));
    const abortController = new AbortController();
    const execution = { abortController, promise: null, heartbeat: null };
    this.active.set(task.id, execution);
    execution.heartbeat = setInterval(() => {
      prisma.asyncTask.updateMany({
        where: { id: task.id, lockedBy: this.instanceId, status: { in: ACTIVE_STATUSES } },
        data: { lockedAt: new Date() },
      }).catch((error) => this.log(`heartbeat failed task=${task.id}`, error));
    }, this.heartbeatMs);
    execution.heartbeat.unref?.();

    execution.promise = (async () => {
      try {
        const result = await registration.handler(task, { signal: abortController.signal, worker: this });
        if (result?.terminal) return;
        await prisma.asyncTask.updateMany({
          where: { id: task.id, lockedBy: this.instanceId, status: { in: ACTIVE_STATUSES } },
          data: {
            status: result?.status || task.status,
            nextRunAt: result?.nextRunAt || new Date(Date.now() + (registration.external ? this.externalScanMs : this.localScanMs)),
            lockedBy: null, lockedAt: null,
          },
        });
      } catch (error) {
        if (abortController.signal.aborted || this.stopping) return;
        await this.handleFailure(task, error, registration.external);
      } finally {
        clearInterval(execution.heartbeat);
        this.active.delete(task.id);
      }
    })();
    await execution.promise;
  }

  async handleFailure(task, error, external) {
    const current = await prisma.asyncTask.findUnique({ where: { id: task.id } });
    if (!current || TERMINAL_STATUSES.includes(current.status)) return;
    const nextAttempt = external ? current.attemptCount + 1 : current.attemptCount;
    const exhausted = Boolean(error.permanent) || nextAttempt >= current.maxAttempts;
    await prisma.asyncTask.updateMany({
      where: { id: task.id, lockedBy: this.instanceId, status: { in: ACTIVE_STATUSES } },
      data: exhausted ? {
        status: 'FAILED', stage: 'FAILED', attemptCount: nextAttempt,
        errorCode: String(error.code || 'TASK_EXECUTION_FAILED').slice(0, 100),
        errorMessage: String(error.userMessage || '后台任务执行失败，可以稍后重试。'), completedAt: new Date(),
        lockedBy: null, lockedAt: null,
      } : {
        status: external ? 'WAITING_EXTERNAL' : 'QUEUED', attemptCount: nextAttempt,
        nextRunAt: new Date(Date.now() + delayForAttempt(nextAttempt)), lockedBy: null, lockedAt: null,
      },
    });
  }

  async release(taskId, nextRunAt = new Date()) {
    await prisma.asyncTask.updateMany({
      where: { id: Number(taskId), lockedBy: this.instanceId, status: { in: ACTIVE_STATUSES } },
      data: { lockedBy: null, lockedAt: null, nextRunAt },
    });
  }

  async stop() {
    if (!this.started || this.stopping) return;
    this.stopping = true;
    clearTimeout(this.localTimer);
    clearTimeout(this.externalTimer);
    this.localTimer = null;
    this.externalTimer = null;
    for (const execution of this.active.values()) execution.abortController.abort();
    const pending = [...this.active.values()].map((item) => item.promise).filter(Boolean);
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await prisma.asyncTask.updateMany({
      where: { lockedBy: this.instanceId, status: { in: ACTIVE_STATUSES } },
      data: { lockedBy: null, lockedAt: null, nextRunAt: new Date(Date.now() + this.localScanMs) },
    });
    this.active.clear();
    this.started = false;
  }

  log(message, error) {
    console.error(`[AsyncTaskWorker] ${message}`, { instanceId: this.instanceId, message: error?.message || String(error) });
  }
}

let singleton;
function getAsyncTaskWorker() {
  if (!singleton) singleton = new AsyncTaskWorker().registerDefaults();
  return singleton;
}

module.exports = {
  AsyncTaskWorker, getAsyncTaskWorker, delayForAttempt,
  DEFAULT_LEASE_MS, DEFAULT_HEARTBEAT_MS, DEFAULT_LOCAL_SCAN_MS, DEFAULT_EXTERNAL_SCAN_MS,
  DEFAULT_RUNNING_STALE_MS, DEFAULT_EXTERNAL_MAX_AGE_MS, PPT_CONVERSION_OPERATION_PREFIX,
};
