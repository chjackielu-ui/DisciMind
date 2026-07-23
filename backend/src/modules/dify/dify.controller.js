function migrationResponse(res) {
  return res.status(410).json({
    code: 41001,
    message: 'Dify 接口已停用，请使用现有智能体、训练师或知识库业务接口。',
    data: { migratedTo: 'LANGCHAIN_LANGGRAPH' },
  });
}

async function chat(_req, res) {
  return migrationResponse(res);
}

async function workflow(_req, res) {
  return migrationResponse(res);
}

async function health(_req, res) {
  return res.json({
    code: 0,
    message: 'ok',
    data: { configured: false, healthy: false, retired: true, migratedTo: 'LANGCHAIN_LANGGRAPH' },
  });
}

module.exports = { chat, workflow, health };
