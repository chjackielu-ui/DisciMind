const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

function channel(lessonPlanId) {
  return `lesson-plan:${Number(lessonPlanId)}`;
}

function publish(lessonPlanId, event) {
  emitter.emit(channel(lessonPlanId), { lesson_plan_id: Number(lessonPlanId), at: new Date().toISOString(), ...event });
}

function subscribe(lessonPlanId, listener) {
  const key = channel(lessonPlanId);
  emitter.on(key, listener);
  return () => emitter.off(key, listener);
}

module.exports = { publish, subscribe };
