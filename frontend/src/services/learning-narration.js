import { learningNarrationApi, narrationWebSocketUrl } from '../api/learning-narration.js';
import { LearningNarrationAudio } from './learning-narration-audio.js';

export const NARRATION_STATES = Object.freeze([
  'idle', 'preparing', 'playing', 'paused', 'stopped', 'completed', 'error',
]);

function browserSpeechAvailable() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
}

function normalizedSegments(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((segment, index) => ({
      id: String(segment?.id || `segment-${index + 1}`),
      title: String(segment?.title || `第 ${index + 1} 段`),
      text: String(segment?.text || '').trim(),
      anchorId: segment?.anchorId ? String(segment.anchorId) : null,
    }))
    .filter((segment) => segment.text);
}

export class LearningNarrationClient extends EventTarget {
  constructor() {
    super();
    this.settings = null;
    this.audio = null;
    this.socket = null;
    this.jobId = null;
    this.mode = 'none';
    this.state = 'idle';
    this.segments = [];
    this.currentIndex = -1;
    this.currentSegment = null;
    this.segmentOrder = [];
    this.segmentAudio = new Map();
    this.playbackRate = Number(localStorage.getItem('discimind:narration-rate')) || 1;
    this.enabledByUser = localStorage.getItem('discimind:narration-enabled') === 'true';
    this.subtitlesEnabled = localStorage.getItem('discimind:narration-subtitles') !== 'false';
    this.browserVoice = null;
    this.utterance = null;
    this.runToken = 0;
    this.lastInput = null;
    this.fallbackStarted = false;
    this.pausedByVisibility = false;
    this.destroyed = false;
    this.boundVoicesChanged = () => this.selectBrowserVoice();
    this.boundVisibilityChanged = () => this.handleVisibilityChange();
    if (browserSpeechAvailable()) {
      window.speechSynthesis.addEventListener?.('voiceschanged', this.boundVoicesChanged);
      document.addEventListener('visibilitychange', this.boundVisibilityChanged);
      this.selectBrowserVoice();
    }
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  setState(state, detail = {}) {
    const safeState = NARRATION_STATES.includes(state) ? state : 'error';
    this.state = safeState;
    this.emit('state', {
      state: safeState,
      mode: this.mode,
      hasSession: this.hasSession,
      currentIndex: this.currentIndex,
      total: this.totalSegments,
      progress: this.progress,
      ...detail,
    });
  }

  get hasSession() { return Boolean(this.jobId || this.segments.length || this.segmentOrder.length); }
  get totalSegments() { return this.segments.length || this.segmentOrder.length; }
  get progress() {
    const total = this.totalSegments;
    if (!total || this.currentIndex < 0) return 0;
    if (this.state === 'completed') return 100;
    return Math.max(0, Math.min(99, Math.round(((this.currentIndex + 1) / total) * 100)));
  }

  async loadSettings() {
    let remote = {};
    try {
      const result = await learningNarrationApi.settings();
      remote = result.data || result || {};
    } catch (error) {
      remote = { enabled: false, unavailableReason: 'TTS_SETTINGS_UNAVAILABLE', error };
    }
    const browserFallbackEnabled = browserSpeechAvailable();
    const remoteEnabled = Boolean(remote.enabled);
    this.mode = remoteEnabled ? 'remote' : browserFallbackEnabled ? 'browser' : 'none';
    this.settings = {
      ...remote,
      enabled: remoteEnabled || browserFallbackEnabled,
      remoteEnabled,
      browserFallbackEnabled,
      deliveryMode: this.mode,
      unavailableReason: remoteEnabled || browserFallbackEnabled ? null : (remote.unavailableReason || 'SPEECH_UNSUPPORTED'),
    };
    if (remoteEnabled) this.audio = new LearningNarrationAudio({ sampleRate: remote.sampleRate || 24000 });
    this.emit('settings', this.settings);
    this.setState('idle', { message: remoteEnabled ? '实时语音服务已就绪' : browserFallbackEnabled ? '已启用浏览器语音讲解' : '当前浏览器不支持语音讲解' });
    return this.settings;
  }

  selectBrowserVoice() {
    if (!browserSpeechAvailable()) return null;
    const voices = window.speechSynthesis.getVoices?.() || [];
    this.browserVoice = voices.find((voice) => /^zh[-_](CN|Hans)/i.test(voice.lang) && /xiaoxiao|xiaoyi|yunxi|tingting|huihui|mandarin|chinese/i.test(voice.name))
      || voices.find((voice) => /^zh[-_](CN|Hans)/i.test(voice.lang))
      || voices.find((voice) => /^zh/i.test(voice.lang))
      || voices.find((voice) => voice.default)
      || voices[0]
      || null;
    return this.browserVoice;
  }

  async enable() {
    if (!this.settings?.enabled) throw new Error('当前浏览器和语音服务均不可用');
    this.setState('preparing', { message: '正在启动语音伴学…' });
    if (this.mode === 'remote') {
      try {
        await this.audio.unlock();
      } catch (error) {
        if (!this.settings.browserFallbackEnabled) throw error;
        this.mode = 'browser';
        this.settings.deliveryMode = 'browser';
        this.selectBrowserVoice();
      }
    } else this.selectBrowserVoice();
    this.enabledByUser = true;
    localStorage.setItem('discimind:narration-enabled', 'true');
    this.setState('idle', { message: this.mode === 'remote' ? '实时语音伴学已开启' : '浏览器语音伴学已开启' });
  }

  disable() {
    this.enabledByUser = false;
    localStorage.setItem('discimind:narration-enabled', 'false');
    this.stop({ cancel: true, preserveSession: false }).catch(() => {});
  }

  async start(input = {}) {
    if (!this.enabledByUser || !this.settings?.enabled) return;
    await this.stop({ cancel: true, preserveSession: false, silent: true });
    this.lastInput = input;
    this.segments = normalizedSegments(input.fallbackSegments);
    this.currentIndex = this.segments.length ? 0 : -1;
    this.currentSegment = this.segments[0] || null;
    this.fallbackStarted = false;
    this.setState('preparing');
    if (this.mode === 'remote' && this.settings.remoteEnabled) {
      try {
        await this.startRemote(input);
        return;
      } catch (error) {
        if (!this.settings.browserFallbackEnabled || !this.segments.length) throw error;
        await this.startBrowserFallback('实时语音不可用，已切换浏览器语音。');
        return;
      }
    }
    await this.startBrowserFallback();
  }

  async startRemote(input) {
    const result = await learningNarrationApi.createJob(input);
    const job = result.data || result;
    if (job.unavailable || !job.ticket) {
      if (this.settings.browserFallbackEnabled && this.segments.length) return this.startBrowserFallback('实时语音不可用，已切换浏览器语音。');
      throw new Error('语音服务暂时不可用，文字内容不受影响。');
    }
    this.jobId = job.jobId;
    this.audio.stop();
    this.segmentOrder = [];
    this.segmentAudio.clear();
    await this.audio.resume();
    const ws = new WebSocket(narrationWebSocketUrl(job.wsPath, job.ticket));
    this.socket = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        if (this.currentSegment?.id) {
          const chunks = this.segmentAudio.get(this.currentSegment.id) || [];
          chunks.push(event.data.slice(0));
          this.segmentAudio.set(this.currentSegment.id, chunks);
        }
        this.audio.pushPcm(event.data);
        this.setState('playing');
        return;
      }
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === 'narration.segment.started') {
        const id = String(data.segmentId || `remote-${this.segmentOrder.length + 1}`);
        if (!this.segmentOrder.includes(id)) this.segmentOrder.push(id);
        const knownIndex = Number.isInteger(data.index) ? data.index : this.segmentOrder.indexOf(id);
        this.currentIndex = Math.max(0, knownIndex);
        this.currentSegment = {
          id,
          title: data.title || this.segments[this.currentIndex]?.title || `第 ${this.currentIndex + 1} 段`,
          text: data.subtitle || this.segments[this.currentIndex]?.text || '',
          anchorId: this.segments[this.currentIndex]?.anchorId || null,
        };
        this.emitSegment();
        this.setState('preparing', { message: '正在生成当前段语音' });
      } else if (data.type === 'narration.segment.done') {
        this.emit('segmentDone', { ...data, currentIndex: this.currentIndex, total: this.totalSegments });
      } else if (data.type === 'narration.job.done') {
        this.setState('completed', { usage: data.usage });
      } else if (data.type === 'narration.job.cancelled') {
        this.setState('stopped');
      } else if (data.type === 'narration.error') {
        this.handleRemoteFailure(data.message);
      }
    };
    ws.onerror = () => this.handleRemoteFailure('实时语音连接失败，已尝试浏览器语音。');
    ws.onclose = () => { if (this.socket === ws) this.socket = null; };
  }

  async handleRemoteFailure(message) {
    if (this.fallbackStarted || this.destroyed) return;
    if (this.settings?.browserFallbackEnabled && this.segments.length) {
      await this.startBrowserFallback(message);
      return;
    }
    this.emit('error', { message: message || '语音暂时不可用，文字内容不受影响。' });
    this.setState('error', { message: message || '语音暂时不可用，文字内容不受影响。' });
  }

  async startBrowserFallback(message = '') {
    if (!browserSpeechAvailable() || !this.segments.length) {
      this.setState('error', { message: message || '当前内容暂时没有可讲解文本。' });
      return;
    }
    this.fallbackStarted = true;
    this.mode = 'browser';
    if (this.socket) { this.socket.close(); this.socket = null; }
    this.audio?.stop();
    this.jobId = null;
    this.currentIndex = Math.max(0, Math.min(this.currentIndex < 0 ? 0 : this.currentIndex, this.segments.length - 1));
    this.setState('preparing', { message });
    this.speakCurrentBrowserSegment();
  }

  speakCurrentBrowserSegment() {
    if (!browserSpeechAvailable()) return;
    const segment = this.segments[this.currentIndex];
    if (!segment) { this.setState('completed'); return; }
    const token = ++this.runToken;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(segment.text);
    this.utterance = utterance;
    utterance.lang = this.browserVoice?.lang || 'zh-CN';
    utterance.voice = this.browserVoice;
    utterance.rate = this.playbackRate;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => {
      if (token !== this.runToken) return;
      this.currentSegment = segment;
      this.emitSegment();
      this.setState('playing');
    };
    utterance.onboundary = (event) => {
      if (token !== this.runToken) return;
      this.emit('boundary', {
        charIndex: event.charIndex || 0,
        charLength: event.charLength || 0,
        segment,
        currentIndex: this.currentIndex,
        total: this.totalSegments,
        progress: this.progress,
      });
    };
    utterance.onend = () => {
      if (token !== this.runToken || this.state === 'stopped') return;
      if (this.currentIndex + 1 >= this.segments.length) {
        this.currentIndex = this.segments.length - 1;
        this.setState('completed');
        return;
      }
      this.currentIndex += 1;
      window.setTimeout(() => { if (token === this.runToken) this.speakCurrentBrowserSegment(); }, 20);
    };
    utterance.onerror = (event) => {
      if (token !== this.runToken || ['canceled', 'interrupted'].includes(event.error)) return;
      this.emit('error', { message: '浏览器语音播放失败，文字学习不受影响。', code: event.error });
      this.setState('error', { message: '浏览器语音播放失败，文字学习不受影响。' });
    };
    window.speechSynthesis.speak(utterance);
  }

  emitSegment() {
    this.emit('segment', {
      ...(this.currentSegment || {}),
      subtitle: this.currentSegment?.text || '',
      currentIndex: this.currentIndex,
      total: this.totalSegments,
      progress: this.progress,
      mode: this.mode,
    });
  }

  async pause() {
    if (this.state !== 'playing' && this.state !== 'preparing') return;
    if (this.mode === 'browser') window.speechSynthesis.pause();
    else await this.audio?.pause();
    this.setState('paused');
  }

  async resume() {
    if (this.state !== 'paused') return;
    if (this.mode === 'browser') window.speechSynthesis.resume();
    else await this.audio?.resume();
    this.setState('playing');
  }

  async replay() {
    if (!this.hasSession) return;
    if (this.mode === 'browser') this.speakCurrentBrowserSegment();
    else {
      const chunks = this.segmentAudio.get(this.currentSegment?.id) || [];
      if (chunks.length) await this.audio?.playBuffers(chunks);
    }
    this.setState('playing');
  }

  async playRelativeSegment(offset) {
    const total = this.totalSegments;
    if (!total) return;
    this.currentIndex = Math.max(0, Math.min(total - 1, Math.max(0, this.currentIndex) + Number(offset || 0)));
    if (this.mode === 'browser') {
      this.currentSegment = this.segments[this.currentIndex];
      this.speakCurrentBrowserSegment();
    } else {
      const targetId = this.segmentOrder[this.currentIndex];
      const chunks = this.segmentAudio.get(targetId) || [];
      if (!chunks.length) return;
      this.currentSegment = { id: targetId, title: `第 ${this.currentIndex + 1} 段`, text: this.segments[this.currentIndex]?.text || '' };
      await this.audio?.playBuffers(chunks);
      this.emitSegment();
      this.setState('playing');
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = Math.max(0.75, Math.min(2, Number(rate) || 1));
    localStorage.setItem('discimind:narration-rate', String(this.playbackRate));
    this.audio?.setPlaybackRate(this.playbackRate);
    if (this.mode === 'browser' && ['playing', 'preparing'].includes(this.state)) this.speakCurrentBrowserSegment();
    this.emit('rate', { rate: this.playbackRate });
  }

  setSubtitles(enabled) {
    this.subtitlesEnabled = Boolean(enabled);
    localStorage.setItem('discimind:narration-subtitles', String(this.subtitlesEnabled));
    this.emit('subtitles', { enabled: this.subtitlesEnabled });
  }

  async stop({ cancel = false, preserveSession = true, silent = false } = {}) {
    const jobId = this.jobId;
    this.jobId = null;
    this.runToken += 1;
    if (browserSpeechAvailable()) window.speechSynthesis.cancel();
    this.utterance = null;
    if (this.socket) {
      if (cancel && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'narration.cancel' }));
      this.socket.close();
      this.socket = null;
    }
    this.audio?.stop();
    if (cancel && jobId) learningNarrationApi.cancelJob(jobId).catch(() => {});
    if (!preserveSession) {
      this.segments = [];
      this.segmentOrder = [];
      this.segmentAudio.clear();
      this.currentIndex = -1;
      this.currentSegment = null;
    }
    if (!silent) this.setState(preserveSession && this.hasSession ? 'stopped' : 'idle');
  }

  async handleVisibilityChange() {
    if (document.hidden && this.state === 'playing') {
      this.pausedByVisibility = true;
      await this.pause();
    } else if (!document.hidden && this.pausedByVisibility && this.state === 'paused') {
      this.pausedByVisibility = false;
      await this.resume();
    }
  }

  async destroy() {
    this.destroyed = true;
    window.speechSynthesis?.removeEventListener?.('voiceschanged', this.boundVoicesChanged);
    document.removeEventListener('visibilitychange', this.boundVisibilityChanged);
    await this.stop({ cancel: true, preserveSession: false, silent: true });
    await this.audio?.close();
    this.setState('idle');
  }
}
