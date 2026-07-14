function runtimeError(message, code = 'DIFY_AGENT_RUNTIME_FAILED', status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function envValue(name) {
  if (!name || !/^[A-Z][A-Z0-9_]{2,80}$/.test(String(name))) return '';
  return process.env[name] || '';
}

function getRuntimeConfig(version) {
  const raw = version.runtimeConfigJson && typeof version.runtimeConfigJson === 'object' ? version.runtimeConfigJson : {};
  const baseURL = String(envValue(raw.baseUrlEnv) || process.env.DIFY_CHATFLOW_BASE_URL || process.env.DIFY_BASE_URL || '').replace(/\/$/, '');
  const apiKey = envValue(raw.apiKeyEnv) || process.env.DIFY_CHATFLOW_API_KEY || '';
  if (!baseURL || !/^https?:\/\//i.test(baseURL)) throw runtimeError('Dify 智能体服务地址未配置', 'DIFY_AGENT_BASE_URL_MISSING', 500);
  if (!apiKey) throw runtimeError('Dify 智能体密钥未配置', 'DIFY_AGENT_API_KEY_MISSING', 500);
  return { baseURL, apiKey, raw };
}

function safeInputs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)));
}

function buildPayload(context, streaming, files = []) {
  const { version, question, conversation, userId } = context;
  const config = version.runtimeConfigJson || {};
  const inputs = {
    ...safeInputs(config.inputs),
    knowledge_context: (context.records || []).map(item => ({
      knowledge_base: item.knowledgeBaseName, document: item.documentName, content: item.content,
    })),
  };
  const user = `discimind-user-${Number(userId)}`;
  if (version.runtimeProvider === 'DIFY_WORKFLOW') {
    const queryInputKey = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(String(config.queryInputKey || ''))
      ? String(config.queryInputKey)
      : 'query';
    inputs[queryInputKey] = question;
    return { inputs, response_mode: streaming ? 'streaming' : 'blocking', user };
  }
  return {
    inputs,
    query: question,
    response_mode: streaming ? 'streaming' : 'blocking',
    conversation_id: conversation?.difyConversationId || undefined,
    files,
    user,
  };
}

function endpoint(version) {
  return version.runtimeProvider === 'DIFY_WORKFLOW' ? '/workflows/run' : '/chat-messages';
}

function eventDelta(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (['message', 'agent_message'].includes(payload.event)) return String(payload.answer || '');
  if (payload.event === 'text_chunk') return String(payload.data?.text || payload.text || '');
  if (payload.event === 'workflow_finished') {
    const outputs = payload.data?.outputs || payload.outputs || {};
    return String(outputs.answer || outputs.result || outputs.text || outputs.output || '');
  }
  return '';
}

function runtimeMetadata(payload) {
  const conversationId = payload?.conversation_id || payload?.data?.conversation_id || null;
  const messageId = payload?.message_id || payload?.id || payload?.data?.id || null;
  const workflowRunId = payload?.workflow_run_id || payload?.data?.id || null;
  if (!conversationId && !messageId && !workflowRunId) return null;
  return { conversationId, messageId, workflowRunId };
}

async function uploadImages(config, context, signal) {
  if (context.version.runtimeProvider !== 'DIFY_CHATFLOW' || !context.images?.length) return [];
  const user = `discimind-user-${Number(context.userId)}`;
  const uploaded = [];
  for (const image of context.images) {
    const match = String(image.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i);
    if (!match) continue;
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), image.name || 'image');
    form.append('user', user);
    const response = await fetch(`${config.baseURL}/files/upload`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: form, signal });
    if (!response.ok) throw runtimeError('Dify 图片上传失败', `DIFY_FILE_UPLOAD_${response.status}`);
    const payload = await response.json();
    if (payload.id) uploaded.push({ type: 'image', transfer_method: 'local_file', upload_file_id: payload.id });
  }
  return uploaded;
}

async function request(version, context, streaming, signal) {
  const config = getRuntimeConfig(version);
  const files = await uploadImages(config, context, signal);
  const response = await fetch(`${config.baseURL}${endpoint(version)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: streaming ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(buildPayload(context, streaming, files)),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[DifyAgent] request failed', { status: response.status, provider: version.runtimeProvider, detail: detail.slice(0, 200) });
    throw runtimeError('Dify 智能体暂时不可用', `DIFY_AGENT_HTTP_${response.status}`, response.status >= 500 ? 502 : response.status);
  }
  return response;
}

async function runDifyAgent(context, options = {}) {
  const response = await request(context.version, context, false, options.signal);
  const payload = await response.json();
  const data = payload.data || payload;
  const outputs = data.outputs || {};
  const content = data.answer || outputs.answer || outputs.result || outputs.text || outputs.output || '';
  const metadata = runtimeMetadata(payload) || runtimeMetadata(data);
  options.onMetadata?.(metadata);
  return { content: String(content), usage: data.metadata?.usage || data.usage || null, metadata };
}

async function* streamDifyAgent(context, options = {}) {
  const response = await request(context.version, context, true, options.signal);
  const decoder = new TextDecoder();
  let buffer = '';
  let emitted = '';
  const consumeFrame = (frame) => {
    const dataLine = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
    if (!dataLine || dataLine === '[DONE]') return null;
    let payload;
    try { payload = JSON.parse(dataLine); } catch { return null; }
    if (payload.event === 'error') throw runtimeError('Dify 智能体执行失败', 'DIFY_AGENT_EVENT_ERROR');
    const metadata = runtimeMetadata(payload);
    if (metadata) options.onMetadata?.(metadata);
    const delta = eventDelta(payload);
    if (!delta) return null;
    // Some Dify workflow events repeat the full answer. Only emit the suffix in that case.
    const normalized = delta.startsWith(emitted) ? delta.slice(emitted.length) : delta;
    emitted = delta.startsWith(emitted) ? delta : `${emitted}${delta}`;
    return normalized || null;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const normalized = consumeFrame(frame);
      if (normalized) yield { content: normalized };
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const normalized = consumeFrame(buffer);
    if (normalized) yield { content: normalized };
  }
}

module.exports = { getRuntimeConfig, buildPayload, uploadImages, eventDelta, runtimeMetadata, runDifyAgent, streamDifyAgent };
