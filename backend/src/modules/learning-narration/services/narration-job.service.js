const crypto = require('crypto');
const prisma = require('../../../config/prisma');
const { buildNarrationScript } = require('./narration-script.service');
const { NarrationOrchestrator } = require('./narration-orchestrator.service');

const FRIENDLY_ERRORS = {
  TTS_UPSTREAM_TIMEOUT: '语音服务响应超时，文字内容不受影响。',
  TTS_UPSTREAM_CONNECTION_FAILED: '语音暂时不可用，文字内容不受影响。',
  TTS_UPSTREAM_DISCONNECTED: '语音连接已断开，文字内容不受影响。',
  TTS_UPSTREAM_ERROR: '语音暂时不可用，文字内容不受影响。',
  TTS_DISABLED: '语音伴学未开启，文字内容不受影响。',
};

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeNodeType(value) { return String(value || '').toLowerCase(); }

class NarrationJobService {
  constructor({ config, adapter, cache }) {
    this.config = config;
    this.adapter = adapter;
    this.cache = cache;
    this.jobs = new Map();
    this.tickets = new Map();
    this.activeByUser = new Map();
    this.dedupe = new Map();
    this.running = 0;
    this.waiters = [];
  }

  async loadOwnedNode(userId, sessionId, nodeRunId) {
    const session = await prisma.learningSession.findFirst({
      where: { session_id: Number(sessionId), student_user_id: Number(userId) },
      select: { session_id: true, student_user_id: true, current_node_run_id: true },
    });
    if (!session) throw Object.assign(new Error('无权访问该学习会话'), { status: 403, code: 'NARRATION_FORBIDDEN' });
    const nodeRun = await prisma.learningSessionNodeRun.findFirst({
      where: { node_run_id: Number(nodeRunId), session_id: session.session_id },
      select: { node_run_id: true, session_id: true, node_id: true, node_type: true, agent_type: true, status: true, output_content: true, output_summary_json: true },
    });
    if (!nodeRun) throw Object.assign(new Error('学习节点不存在或不属于该会话'), { status: 403, code: 'NARRATION_FORBIDDEN' });
    return { session, nodeRun };
  }

  contentFor(nodeRun) {
    const summary = parseJson(nodeRun.output_summary_json) || {};
    return parseJson(nodeRun.output_content) || summary.data || summary.result || summary.normalizedOutput || summary;
  }

  async createJob(userId, input) {
    if (!this.config.enabled) return { unavailable: true, reason: this.config.unavailableReason };
    const startedAt = Date.now();
    const { nodeRun } = await this.loadOwnedNode(userId, input.sessionId, input.nodeRunId);
    const key = `${userId}:${input.sessionId}:${input.nodeRunId}:${input.contentBlockId}:${input.purpose}`;
    const existingId = this.dedupe.get(key);
    const existing = existingId && this.jobs.get(existingId);
    if (existing && ['READY', 'COMPLETED'].includes(existing.status)) {
      existing.status = 'READY';
      existing.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      this.activeByUser.set(Number(userId), existing.id);
      return this.publicJob(existing, true, this.issueTicket(existing));
    }
    if (existing?.status === 'RUNNING') return this.publicJob(existing, true);

    if (prisma.learningNarrationAsset) {
      const dailyCount = await prisma.learningNarrationAsset.count({
        where: { student_user_id: Number(userId), created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });
      if (dailyCount >= 100) throw Object.assign(new Error('今日语音任务次数已达上限'), { status: 429, code: 'NARRATION_DAILY_LIMIT' });
    }

    const oldId = this.activeByUser.get(Number(userId));
    if (oldId) await this.cancelJob(userId, oldId, { reason: 'node_switch' }).catch(() => {});
    const id = crypto.randomUUID();
    const metrics = { startedAt, jobCreateMs: 0, cacheHit: false, retryCount: 0, audioBytes: 0 };
    const script = buildNarrationScript({
      jobId: id, sessionId: input.sessionId, nodeRunId: input.nodeRunId,
      nodeType: normalizeNodeType(nodeRun.node_type), agentType: nodeRun.agent_type,
      content: this.contentFor(nodeRun), purpose: input.purpose, config: this.config, metrics,
    });
    metrics.jobCreateMs = Date.now() - startedAt;
    const job = {
      id, userId: Number(userId), sessionId: Number(input.sessionId), nodeRunId: Number(input.nodeRunId),
      contentBlockId: input.contentBlockId, purpose: input.purpose, key, status: 'READY', script, metrics,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60 * 1000), abortController: null,
    };
    this.jobs.set(id, job);
    this.dedupe.set(key, id);
    this.activeByUser.set(Number(userId), id);
    await this.persist(job).catch(() => {});
    return this.publicJob(job, false, this.issueTicket(job));
  }

  issueTicket(job) {
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = Date.now() + 60000;
    this.tickets.set(hash, { jobId: job.id, userId: job.userId, sessionId: job.sessionId, nodeRunId: job.nodeRunId, expiresAt });
    return { raw, expiresAt };
  }

  consumeTicket(raw) {
    if (!raw || raw.length > 128) return null;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const ticket = this.tickets.get(hash);
    this.tickets.delete(hash);
    if (!ticket || ticket.expiresAt < Date.now()) return null;
    const job = this.jobs.get(ticket.jobId);
    if (!job || job.userId !== ticket.userId || job.sessionId !== ticket.sessionId || job.nodeRunId !== ticket.nodeRunId) return null;
    return job;
  }

  publicJob(job, deduplicated = false, ticket = null) {
    return {
      jobId: job.id, status: job.status, sessionId: job.sessionId, nodeRunId: job.nodeRunId,
      deduplicated, expiresAt: ticket ? new Date(ticket.expiresAt).toISOString() : job.expiresAt.toISOString(),
      ticket: ticket?.raw, wsPath: ticket ? '/ws/learning-narration' : undefined,
      sampleRate: this.config.sampleRate, format: this.config.responseFormat,
    };
  }

  async acquire() {
    if (this.running < this.config.maxConcurrentJobs) { this.running += 1; return; }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.running += 1;
  }

  release() {
    this.running = Math.max(0, this.running - 1);
    this.waiters.shift()?.();
  }

  async streamJob(job, sink) {
    if (job.status !== 'READY') throw Object.assign(new Error('语音任务不可重复连接'), { code: 'NARRATION_JOB_NOT_READY' });
    await this.acquire();
    job.status = 'RUNNING';
    job.abortController = new AbortController();
    const orchestrator = new NarrationOrchestrator({ adapter: this.adapter, cache: this.cache, config: this.config });
    const control = (event) => sink.control(event);
    const audio = (chunk) => sink.audio(chunk);
    orchestrator.on('control', control);
    orchestrator.on('audio', audio);
    const timeout = setTimeout(() => job.abortController.abort(), this.config.jobTimeoutMs);
    try {
      sink.control({ type: 'narration.job.created', jobId: job.id });
      const result = await orchestrator.run(job, job.abortController.signal);
      if (job.abortController.signal.aborted) {
        job.status = 'CANCELLED';
        sink.control({ type: 'narration.job.cancelled', jobId: job.id });
      } else {
        job.status = 'COMPLETED';
        job.completedAt = new Date();
        sink.control({ type: 'narration.job.done', jobId: job.id, usage: result.usage || { characters: job.metrics.characterCount } });
      }
    } catch (error) {
      if (job.abortController.signal.aborted || error.code === 'NARRATION_CANCELLED') {
        job.status = 'CANCELLED';
        sink.control({ type: 'narration.job.cancelled', jobId: job.id });
      } else {
        job.status = 'FAILED';
        job.errorCode = FRIENDLY_ERRORS[error.code] ? error.code : 'TTS_UNAVAILABLE';
        sink.control({ type: 'narration.error', code: job.errorCode, message: FRIENDLY_ERRORS[error.code] || '语音暂时不可用，文字内容不受影响。' });
      }
    } finally {
      clearTimeout(timeout);
      orchestrator.off('control', control);
      orchestrator.off('audio', audio);
      this.release();
      if (this.activeByUser.get(job.userId) === job.id) this.activeByUser.delete(job.userId);
      if (['FAILED', 'CANCELLED'].includes(job.status)) this.dedupe.delete(job.key);
      await this.persist(job).catch(() => {});
      this.logPerformance(job);
    }
  }

  async getJob(userId, jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== Number(userId)) throw Object.assign(new Error('语音任务不存在'), { status: 404 });
    return this.publicJob(job);
  }

  async cancelJob(userId, jobId, options = {}) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== Number(userId)) throw Object.assign(new Error('语音任务不存在'), { status: 404 });
    if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      job.status = 'CANCELLED';
      job.cancelReason = options.reason || 'user';
      job.abortController?.abort();
      this.dedupe.delete(job.key);
    }
    return this.publicJob(job);
  }

  async persist(job) {
    if (!prisma.learningNarrationAsset) return;
    await prisma.learningNarrationAsset.upsert({
      where: { job_id: job.id },
      create: {
        job_id: job.id, student_user_id: job.userId, session_id: job.sessionId, node_run_id: job.nodeRunId,
        content_block_id: job.contentBlockId, script_hash: job.script.scriptHash, model: this.config.model,
        voice: this.config.voice, format: this.config.responseFormat, sample_rate: this.config.sampleRate,
        speech_rate: this.config.speechRate, status: job.status, character_count: job.metrics.characterCount,
        expires_at: job.expiresAt,
      },
      update: { status: job.status, error_code: job.errorCode || null, completed_at: job.completedAt || null, character_count: job.metrics.characterCount },
    });
  }

  logPerformance(job) {
    const m = job.metrics;
    console.info(JSON.stringify({
      event: 'learning_narration_performance', jobId: job.id.slice(0, 8), sessionId: job.sessionId,
      nodeRunId: job.nodeRunId, cacheHit: Boolean(m.cacheHit), jobCreateMs: m.jobCreateMs,
      scriptBuildMs: m.scriptBuildMs, formulaNormalizeMs: m.formulaNormalizeMs || 0,
      upstreamConnectMs: m.upstreamConnectMs || null, firstAudioDeltaMs: m.firstAudioDeltaMs || null,
      timeToFirstAudioMs: m.firstAudioDeltaMs ? m.upstreamConnectMs + m.firstAudioDeltaMs : null,
      characterCount: m.characterCount, audioBytes: m.audioBytes || 0, retryCount: m.retryCount || 0,
      formulaConversionFailures: m.formulaConversionFailures || 0, status: job.status,
    }));
  }

  closeAll() {
    for (const job of this.jobs.values()) job.abortController?.abort();
    this.tickets.clear();
    this.adapter.closeAll();
  }
}

module.exports = { NarrationJobService, FRIENDLY_ERRORS };
