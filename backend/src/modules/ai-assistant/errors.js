class AiAssistantError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message);
    this.name = 'AiAssistantError';
    this.publicCode = code;
    this.code = status >= 500 ? 50002 : status === 403 ? 40301 : status === 404 ? 40401 : 40001;
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

const ERROR_MESSAGES = Object.freeze({
  AI_MODEL_TIMEOUT: 'AI 模型响应超时，请缩小任务范围后重试。',
  AI_SEARCH_DISABLED: '当前已关闭联网搜索，无法保证实时信息准确性。',
  AI_SEARCH_NOT_TRIGGERED: '已请求联网搜索，但上游没有实际执行搜索，请稍后重试。',
  AI_SEARCH_UNSUPPORTED: '当前模型或地域不支持所选联网能力。',
  AI_AGENT_NOT_FOUND: '所选智能体不存在或已停用。',
  AI_AGENT_FORBIDDEN: '当前身份无权调用所选智能体。',
  AI_TOOL_VALIDATION_FAILED: '工具参数校验失败。',
  AI_TOOL_TIMEOUT: '工具执行超时。',
  AI_WORKFLOW_LOOP: '任务调用次数已达到安全上限，已停止继续执行。',
  AI_ARTIFACT_GENERATION_FAILED: '成果生成失败，请稍后重试。',
  AI_STREAM_INTERRUPTED: '流式连接已中断，可刷新页面恢复已保存内容。',
});

function aiError(code, message = ERROR_MESSAGES[code] || 'AI 任务执行失败', status = 500, details = null) {
  return new AiAssistantError(code, message, status, details);
}

module.exports = { AiAssistantError, ERROR_MESSAGES, aiError };
