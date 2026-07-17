const STREAM_VERSION = '1.0';
const EVENT_TYPES = Object.freeze([
  'run.started', 'run.heartbeat', 'intent.detected', 'plan.created',
  'search.started', 'search.sources', 'search.completed',
  'knowledge.started', 'knowledge.hits', 'knowledge.completed',
  'reasoning.delta', 'module.started', 'module.completed',
  'agent.started', 'agent.first_delta', 'agent.heartbeat', 'agent.completed', 'agent.failed',
  'tool.validation_failed', 'tool.started', 'tool.completed', 'artifact.started', 'artifact.completed',
  'answer.delta', 'citations.updated', 'usage.updated',
  'run.completed', 'run.failed', 'run.cancelled', 'run.stalled',
]);

class StreamEventFactory {
  constructor(runId, options = {}) {
    this.runId = String(runId);
    this.sequence = Number(options.sequence || 0);
    this.version = options.version || STREAM_VERSION;
    this.clock = options.clock || (() => new Date());
    this.terminalType = null;
  }

  create(type, payload = {}) {
    if (!EVENT_TYPES.includes(type)) throw new Error(`未知 AI 流事件：${type}`);
    if (this.terminalType) throw new Error(`AI 流已结束（${this.terminalType}），不能继续写入 ${type}`);
    this.sequence += 1;
    const event = {
      version: this.version,
      type,
      runId: this.runId,
      sequence: this.sequence,
      eventId: `${this.runId}:${this.sequence}`,
      timestamp: this.clock().toISOString(),
      payload: payload || {},
    };
    if (['run.completed', 'run.failed', 'run.cancelled', 'run.stalled'].includes(type)) this.terminalType = type;
    return event;
  }
}

function writeSse(res, event) {
  if (!res || res.destroyed || res.writableEnded) return false;
  res.write(`id: ${event.sequence}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  return true;
}

module.exports = { STREAM_VERSION, EVENT_TYPES, StreamEventFactory, writeSse };
