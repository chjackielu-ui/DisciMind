// Agent API — 统一 Agent 调用封装
// 禁止页面直接写 fetch('/api/agent/...)

import { post, get } from './request.js';
import { streamRequest } from './stream-request.js';

const BASE = '/agent';

export const explainerApi = {
  /**
   * 流式调用 Explainer Agent（SSE）
   * @param {object} params
   * @param {number} params.knowledgePointId
   * @param {string} params.message
   * @param {string} params.strategyHint - direct_instruction | socratic_dialogue | analogy_bridge | auto
   * @param {string} params.depth - shallow | moderate | deep
   * @param {boolean} params.newConversation
   * @param {string} params.learningSessionId
   * @param {AbortSignal} signal
   * @param {object} callbacks - { onConnected, onStreamStart, onDelta, onDone, onError }
   * @returns {Promise<{conversationId, messageId, fullText}>}
   */
  streamChat(params, signal, callbacks = {}) {
    return streamRequest(BASE + '/explainer/chat', {
      knowledgePointId: params.knowledgePointId,
      message: params.message,
      strategyHint: params.strategyHint || 'auto',
      depth: params.depth || 'moderate',
      newConversation: params.newConversation !== false,
      learningSessionId: String(params.learningSessionId || ''),
    }, signal, callbacks);
  },
};

export const trainerApi = {
  /**
   * 创建 Trainer 练习会话
   */
  createSession(data) {
    return post(BASE + '/trainer/sessions', data);
  },

  /**
   * 提交答案
   */
  submitAnswer(sessionId, data) {
    return post(`${BASE}/trainer/sessions/${sessionId}/answers`, data);
  },
};

export const diagnosticianApi = {
  /**
   * 调用诊断师分析
   */
  analyze(data) {
    return post(BASE + '/diagnostician/analyze', data);
  },

  /**
   * 获取心智模型
   */
  getMentalModel(knowledgePointId, sessionId) {
    return get(`${BASE}/diagnostician/mental-model/${knowledgePointId}`, { sessionId });
  },
};
