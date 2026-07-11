const active = new Map();

function register(generationId, abortController) {
  active.set(String(generationId), abortController);
  return () => active.delete(String(generationId));
}

function cancel(generationId) {
  const controller = active.get(String(generationId));
  if (!controller) return false;
  controller.abort();
  return true;
}

function cancelAll() {
  for (const controller of active.values()) controller.abort();
  return active.size;
}

module.exports = { register, cancel, cancelAll, size: () => active.size };
