const { randomUUID } = require('crypto');
const WebSocket = require('ws');

class NarrationUpstreamError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NarrationUpstreamError';
    this.code = code;
  }
}

function buildSessionUpdate(config, eventId = randomUUID()) {
  return {
    event_id: eventId,
    type: 'session.update',
    session: {
      voice: config.voice,
      mode: 'commit',
      language_type: config.languageType,
      response_format: config.responseFormat,
      sample_rate: config.sampleRate,
      speech_rate: config.speechRate,
      volume: config.volume,
      pitch_rate: config.pitchRate,
    },
  };
}

function summarizeUpstreamError(event = {}) {
  const details = event.error && typeof event.error === 'object' ? event.error : event;
  const clean = (value, fallback, maxLength) => String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return {
    code: clean(details.code || details.type, 'UNKNOWN', 100),
    eventId: clean(event.event_id || event.eventId, '', 100),
    param: clean(details.param, '', 100),
    message: clean(details.message, '语音服务返回未知错误', 300),
  };
}

class BailianRealtimeTtsAdapter {
  constructor(config, options = {}) {
    this.config = config;
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.activeSockets = new Set();
  }

  buildUrl() {
    const url = new URL(this.config.wsUrl);
    url.searchParams.set('model', this.config.model);
    return url.toString();
  }

  async synthesize({ segments, signal, onSessionReady, onSegmentStart, onAudioDelta, onSegmentDone, metrics = {} }) {
    if (!this.config.enabled) throw new NarrationUpstreamError('TTS_DISABLED', '语音服务未启用');
    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'user-agent': 'DisciMind-Learning-Narration/1.0',
    };
    if (this.config.workspaceId) headers['X-DashScope-WorkSpace'] = this.config.workspaceId;
    const socket = new this.WebSocketImpl(this.buildUrl(), { headers, handshakeTimeout: this.config.connectTimeoutMs });
    this.activeSockets.add(socket);
    const eventIds = new Set();
    const nextId = () => {
      let id;
      do id = randomUUID(); while (eventIds.has(id));
      eventIds.add(id);
      return id;
    };
    const pending = new Map();
    let closed = false;
    let current = null;
    let usageCharacters = 0;
    let responseTimer = null;
    const clearResponseTimer = () => { if (responseTimer) clearTimeout(responseTimer); responseTimer = null; };
    const failAll = (error) => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      if (current) { current.reject(error); current = null; }
    };
    const waitFor = (type, timeoutMs = this.config.responseTimeoutMs) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(type);
        reject(new NarrationUpstreamError('TTS_UPSTREAM_TIMEOUT', '语音服务响应超时'));
      }, timeoutMs);
      pending.set(type, {
        resolve: (event) => { clearTimeout(timer); pending.delete(type); resolve(event); },
        reject: (error) => { clearTimeout(timer); pending.delete(type); reject(error); },
      });
    });
    const send = (payload) => {
      if (closed || socket.readyState !== this.WebSocketImpl.OPEN) throw new NarrationUpstreamError('TTS_UPSTREAM_DISCONNECTED', '语音服务连接已断开');
      socket.send(JSON.stringify(payload));
    };
    const abort = () => {
      const error = new NarrationUpstreamError('NARRATION_CANCELLED', '语音任务已取消');
      failAll(error);
      try {
        if (socket.readyState === this.WebSocketImpl.OPEN) send({ event_id: nextId(), type: 'session.finish' });
      } catch {}
      socket.close(1000, 'cancelled');
    };
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });

    socket.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === 'error') {
        const upstream = summarizeUpstreamError(event);
        console.warn('[learning-narration] TTS upstream error', {
          code: upstream.code,
          ...(upstream.eventId ? { eventId: upstream.eventId } : {}),
          ...(upstream.param ? { param: upstream.param } : {}),
          ...(this.config.debug ? { message: upstream.message } : {}),
        });
        const error = new NarrationUpstreamError('TTS_UPSTREAM_ERROR', '语音服务暂时不可用');
        error.upstreamCode = upstream.code;
        failAll(error);
        return;
      }
      const waiter = pending.get(event.type);
      if (waiter) waiter.resolve(event);
      if (event.type === 'response.audio.delta' && current) {
        try {
          const audio = Buffer.from(event.delta || event.audio?.delta || '', 'base64');
          if (audio.length) {
            if (!metrics.firstAudioDeltaMs) metrics.firstAudioDeltaMs = Date.now() - metrics.connectedAt;
            metrics.audioBytes = (metrics.audioBytes || 0) + audio.length;
            current.buffers.push(audio);
            onAudioDelta?.(audio, current.segment);
          }
        } catch {
          current.reject(new NarrationUpstreamError('TTS_AUDIO_INVALID', '语音数据格式异常'));
        }
      }
      if (event.type === 'response.audio.done' && current) current.audioDone = true;
      if (event.type === 'response.done' && current) {
        current.responseDone = true;
        usageCharacters += Number(event.usage?.characters || event.response?.usage?.characters || 0);
      }
      if (current?.audioDone && current?.responseDone) {
        const done = current;
        current = null;
        clearResponseTimer();
        done.resolve(done.buffers);
      }
    });
    socket.on('error', () => failAll(new NarrationUpstreamError('TTS_UPSTREAM_CONNECTION_FAILED', '语音服务连接失败')));
    socket.on('close', () => {
      closed = true;
      clearResponseTimer();
      if (pending.size || current) failAll(new NarrationUpstreamError('TTS_UPSTREAM_DISCONNECTED', '语音服务连接已断开'));
    });

    try {
      const createdPromise = waitFor('session.created', this.config.connectTimeoutMs);
      await createdPromise;
      metrics.connectedAt = Date.now();
      metrics.upstreamConnectMs = metrics.connectedAt - metrics.startedAt;
      const updatedPromise = waitFor('session.updated');
      send(buildSessionUpdate(this.config, nextId()));
      await updatedPromise;
      metrics.sessionReadyMs = Date.now() - metrics.connectedAt;
      onSessionReady?.();

      const audioBySegment = [];
      for (const segment of segments) {
        if (signal?.aborted) throw new NarrationUpstreamError('NARRATION_CANCELLED', '语音任务已取消');
        onSegmentStart?.(segment);
        const buffers = await new Promise((resolve, reject) => {
          current = { segment, buffers: [], audioDone: false, responseDone: false, resolve, reject };
          responseTimer = setTimeout(() => {
            if (!current) return;
            const timedOut = current;
            current = null;
            timedOut.reject(new NarrationUpstreamError('TTS_UPSTREAM_TIMEOUT', '语音服务响应超时'));
          }, this.config.responseTimeoutMs);
          send({ event_id: nextId(), type: 'input_text_buffer.append', text: segment.text });
          send({ event_id: nextId(), type: 'input_text_buffer.commit' });
        });
        audioBySegment.push(Buffer.concat(buffers));
        onSegmentDone?.(segment);
      }

      const finishedPromise = waitFor('session.finished');
      send({ event_id: nextId(), type: 'session.finish' });
      await finishedPromise;
      socket.close(1000, 'finished');
      return { audioBySegment, usage: { characters: usageCharacters } };
    } finally {
      signal?.removeEventListener('abort', abort);
      clearResponseTimer();
      this.activeSockets.delete(socket);
      if (socket.readyState === this.WebSocketImpl.OPEN) socket.close();
    }
  }

  closeAll() {
    for (const socket of this.activeSockets) {
      try { socket.close(1001, 'server shutdown'); } catch {}
    }
    this.activeSockets.clear();
  }
}

module.exports = { BailianRealtimeTtsAdapter, NarrationUpstreamError, buildSessionUpdate, summarizeUpstreamError };
