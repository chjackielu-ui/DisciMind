// 学习引导老师 — 百炼 SSE API 客户端
// 职责：发起引导请求、接收语句块、管理 SSE 连接生命周期

import { BASE_URL } from './request.js';
import { getToken } from '../utils/auth.js';

/**
 * 发起学习引导 SSE 请求
 * @param {number} sessionId
 * @param {string} nodeId
 * @param {string} phase - enter|waiting|ready|transition|paused|resumed|failed
 * @param {AbortSignal} signal
 * @param {object} callbacks - { onGuideStart, onBlock, onGuideDone, onGuideError }
 * @returns {Promise<{requestId, blocks, blockCount}>}
 */
export async function streamLearningGuide(sessionId, nodeId, phase, signal, callbacks = {}, extraContext = null) {
  const token = getToken();
  const url = `${BASE_URL}/learning-workflows/sessions/${sessionId}/guide/stream`;
  const clientRequestId = `guide_${sessionId}_${nodeId}_${Date.now()}`;

  const body = {
    nodeId,
    phase,
    clientRequestId,
  };
  // Pass extra context (question info, answer info, etc.) to backend
  if (extraContext) {
    body.context = extraContext;
    body.expectedNodeExecutionId = extraContext.nodeExecutionId || null;
    body.requestVersion = extraContext.requestVersion || null;
  }

  const response = await fetch(url, {
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
      errorData = { message: `HTTP ${response.status}` };
    }
    const err = new Error(errorData.message || '学习引导请求失败');
    err.httpStatus = response.status;
    err.code = errorData.code || 'GUIDE_HTTP_ERROR';
    throw err;
  }

  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const blocks = [];
  let requestId = clientRequestId;
  let done = false;

  // BUGFIX: eventName must persist across lines — previously scoped inside for loop,
  // so the 'event:' line set it but the next 'data:' line saw it reset to ''.
  let eventName = '';

  try {
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;

      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      // Only reset buf if the last line is complete (ends with \n).
      // If not, the incomplete last line stays in buf for the next chunk.
      buf = lines.pop() || '';

      for (const line of lines) {
        // Skip empty lines (SSE comment/keepalive boundary)
        if (!line) continue;

        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
          continue;
        }

        if (!line.startsWith('data:')) continue;

        let data = null;
        try {
          data = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }

        // Backend sends SSE events as 'event: guide_start' / 'event: guide_block' etc.
        // The JSON payload does NOT contain an 'event' field — rely on eventName.
        if (eventName === 'guide_start') {
          requestId = data.requestId || requestId;
          if (callbacks.onGuideStart) callbacks.onGuideStart(data);
        } else if (eventName === 'guide_block') {
          blocks.push(data);
          if (callbacks.onBlock) callbacks.onBlock(data);
        } else if (eventName === 'guide_done') {
          done = true;
          if (callbacks.onGuideDone) callbacks.onGuideDone(data, blocks);
        } else if (eventName === 'guide_error') {
          done = true;
          const err = new Error(data.message || '学习引导生成失败');
          err.code = data.code;
          err.retryable = data.retryable;
          if (callbacks.onGuideError) callbacks.onGuideError(err, blocks);
        }
        // Reset eventName after processing to avoid stale event names bleeding
        // into subsequent data lines that lack a preceding event: header.
        eventName = '';
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  return { requestId, blocks, blockCount: blocks.length };
}
