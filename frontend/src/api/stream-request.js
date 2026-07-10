// SSE 流式请求工具 — 用于 Agent 流式调用
// 统一处理 base URL、JWT、AbortController、SSE 事件解析

import { BASE_URL } from './request.js';
import { getToken } from '../utils/auth.js';

/**
 * 发起 SSE 流式 POST 请求
 * @param {string} url - 相对路径，如 '/agent/explainer/chat'
 * @param {object} body - 请求体
 * @param {AbortSignal} signal - AbortController signal
 * @param {object} callbacks - 事件回调 { onStart, onDelta, onMetadata, onResult, onDone, onError, onConnected }
 * @returns {Promise<{conversationId, messageId, fullText, resultAnswer}>}
 */
export async function streamRequest(url, body, signal, callbacks = {}) {
  const token = getToken();
  const fullUrl = `${BASE_URL}${url}`;

  const response = await fetch(fullUrl, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorData = {};
    try {
      errorData = await response.json();
    } catch {
      const text = await response.text().catch(() => '');
      errorData = { message: text || `HTTP ${response.status}` };
    }
    const err = new Error(errorData.message || `Agent 请求失败 (${response.status})`);
    err.httpStatus = response.status;
    err.code = errorData.code || 'STREAM_HTTP_ERROR';
    err.source = errorData.source || null;
    err.stage = errorData.stage || null;
    err.retryable = response.status >= 500 || response.status === 0 || response.status === 408;
    if (err.source === 'discimind' && err.stage === 'local_jwt_authentication') {
      err.retryable = false;
    }
    err.data = errorData.data;
    throw err;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const err = new Error('响应格式错误：期望 text/event-stream，实际收到 ' + contentType);
    err.httpStatus = response.status;
    err.code = 'STREAM_CONTENT_TYPE_ERROR';
    err.retryable = false;
    throw err;
  }

  // 流连接已建立
  if (callbacks.onConnected) callbacks.onConnected();

  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let fullText = '';
  let conversationId = null;
  let messageId = null;
  let resultAnswer = null;
  let streamStarted = false;
  let done = false;
  let sseEventName = ''; // BUGFIX: persist SSE event name across lines

  try {
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;

      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        // Skip empty lines
        if (!line) continue;

        if (line.startsWith('event:')) {
          sseEventName = line.slice(6).trim();
          if (sseEventName === 'start' && !streamStarted) {
            streamStarted = true;
            if (callbacks.onStreamStart) callbacks.onStreamStart({ event: 'start' });
          }
          continue;
        }

        if (!line.startsWith('data:')) continue;

        let data = null;
        try {
          data = JSON.parse(line.slice(5).trim());
        } catch {
          sseEventName = ''; // reset for next event
          continue;
        }

        // Prioritize SSE event name over data.event field
        if (!streamStarted && (sseEventName === 'start' || data.event === 'start' || data.text)) {
          streamStarted = true;
          if (callbacks.onStreamStart) callbacks.onStreamStart(data);
        }

        if (data.text) {
          fullText += data.text;
          if (callbacks.onDelta) callbacks.onDelta(data.text, fullText);
        }

        if (data.conversationId) conversationId = data.conversationId;
        if (data.messageId) messageId = data.messageId;
        if (data.answer) {
          resultAnswer = data.answer;
          if (callbacks.onResult) callbacks.onResult(data.answer, data);
        }

        // Handle metadata (via event name or data field)
        if ((sseEventName === 'metadata' || data.event === 'metadata') && callbacks.onMetadata) {
          callbacks.onMetadata(data);
        }

        // Handle done (via event name or data field)
        if (sseEventName === 'done' || data.event === 'done') {
          done = true;
        }

        // Handle error (via event name or data field)
        if (sseEventName === 'error' || data.event === 'error') {
          const err = new Error(data.message || 'Agent 流式响应错误');
          err.code = data.code || 'STREAM_ERROR';
          err.retryable = data.retryable !== false;
          if (callbacks.onError) callbacks.onError(err);
          throw err;
        }

        // Handle result (via SSE event name from backend — event: result)
        if (sseEventName === 'result' && callbacks.onResult) {
          if (data.answer) {
            resultAnswer = data.answer;
            callbacks.onResult(data.answer, data);
          } else if (data.result) {
            resultAnswer = data.result;
            callbacks.onResult(data.result, data);
          }
        }

        // Reset SSE event name after processing to avoid stale bleed
        sseEventName = '';
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (callbacks.onDone) callbacks.onDone({ conversationId, messageId, fullText, resultAnswer });

  return { conversationId, messageId, fullText, resultAnswer };
}

/**
 * 获取完整的后端 API URL（用于非流式 fetch）
 */
export function apiUrl(relativePath) {
  return `${BASE_URL}${relativePath}`;
}

/**
 * 获取带 JWT 认证头的请求选项
 */
export function authFetchOptions(method = 'POST', body = null, extraHeaders = {}) {
  const token = getToken();
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  };
}
