const { EventEmitter } = require('events');
const prisma = require('../../config/prisma');

const emitter = new EventEmitter();
emitter.setMaxListeners(500);
const writeQueues = new Map();

function safeJson(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { message: '事件详情无法序列化' };
  }
}

function serializeEvent(event) {
  return {
    eventId: event.id,
    runId: event.runId,
    taskId: event.taskId,
    sequence: event.sequence,
    eventType: event.eventType,
    type: event.eventType,
    title: event.title,
    message: event.message,
    payload: safeJson(event.payload),
    createdAt: event.createdAt,
    timestamp: event.createdAt,
  };
}

function enqueue(runId, operation) {
  const previous = writeQueues.get(runId) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writeQueues.set(runId, next);
  return next.finally(() => {
    if (writeQueues.get(runId) === next) writeQueues.delete(runId);
  });
}

async function record({ runId, taskId = null, eventType, title = null, message = null, payload = null }) {
  return enqueue(runId, async () => {
    const aggregate = await prisma.subjectChatEvent.aggregate({
      where: { runId },
      _max: { sequence: true },
    });
    const event = await prisma.subjectChatEvent.create({
      data: {
        runId,
        taskId,
        sequence: Number(aggregate._max.sequence || 0) + 1,
        eventType,
        title,
        message,
        payload: safeJson(payload),
      },
    });
    const serialized = serializeEvent(event);
    emitter.emit(`run:${runId}`, serialized);
    return serialized;
  });
}

function subscribe(runId, listener) {
  const key = `run:${runId}`;
  emitter.on(key, listener);
  return () => emitter.off(key, listener);
}

async function list(runId, afterSequence = 0) {
  const events = await prisma.subjectChatEvent.findMany({
    where: { runId, sequence: { gt: Math.max(0, Number(afterSequence) || 0) } },
    orderBy: { sequence: 'asc' },
  });
  return events.map(serializeEvent);
}

module.exports = { record, subscribe, list, serializeEvent, safeJson };
