function migrationError() {
  return Object.assign(new Error('Dify 服务已停用，请使用 LangChain + LangGraph 后端运行时。'), {
    code: 41001,
    status: 410,
    publicCode: 'DIFY_RETIRED',
    retryable: false,
    expose: true,
  });
}

function retired() {
  throw migrationError();
}

async function* streamChat() {
  throw migrationError();
}

async function health() {
  return { configured: false, healthy: false, retired: true, migratedTo: 'LANGCHAIN_LANGGRAPH' };
}

module.exports = {
  getConfig: retired,
  createClient: retired,
  normalizeQuery: retired,
  userKey: retired,
  chat: retired,
  streamChat,
  workflow: retired,
  health,
};
