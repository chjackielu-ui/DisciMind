import { learningNarrationApi, narrationWebSocketUrl } from '../api/learning-narration.js';
import { LearningNarrationAudio } from './learning-narration-audio.js';

export class LearningNarrationClient extends EventTarget {
  constructor() {
    super();
    this.settings = null;
    this.audio = null;
    this.socket = null;
    this.jobId = null;
    this.currentSegment = null;
    this.segmentOrder = [];
    this.segmentAudio = new Map();
    this.enabledByUser = localStorage.getItem('discimind:narration-enabled') === 'true';
    this.subtitlesEnabled = localStorage.getItem('discimind:narration-subtitles') !== 'false';
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async loadSettings() {
    const result = await learningNarrationApi.settings();
    this.settings = result.data || result;
    this.audio = new LearningNarrationAudio({ sampleRate: this.settings.sampleRate || 24000 });
    this.emit('settings', this.settings);
    return this.settings;
  }

  async enable() {
    if (!this.settings?.enabled) throw new Error(this.settings?.unavailableReason === 'TTS_NOT_CONFIGURED' ? '语音服务暂未配置' : '语音伴学未开启');
    await this.audio.unlock();
    this.enabledByUser = true;
    localStorage.setItem('discimind:narration-enabled', 'true');
    this.emit('state', { state: 'ready' });
  }

  disable() {
    this.enabledByUser = false;
    localStorage.setItem('discimind:narration-enabled', 'false');
    this.stop({ cancel: true });
    this.emit('state', { state: 'disabled' });
  }

  async start(input) {
    if (!this.enabledByUser || !this.settings?.enabled) return;
    await this.stop({ cancel: true });
    this.emit('state', { state: 'preparing' });
    const result = await learningNarrationApi.createJob(input);
    const job = result.data || result;
    if (job.unavailable) { this.emit('state', { state: 'unavailable' }); return; }
    if (!job.ticket) {
      this.emit('state', { state: job.status === 'COMPLETED' ? 'done' : 'unavailable' });
      return;
    }
    this.jobId = job.jobId;
    this.audio.stop();
    this.segmentOrder = [];
    this.segmentAudio.clear();
    await this.audio.resume();
    this.emit('state', { state: 'connecting' });
    const ws = new WebSocket(narrationWebSocketUrl(job.wsPath, job.ticket));
    this.socket = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        if (this.currentSegment?.segmentId) {
          const chunks = this.segmentAudio.get(this.currentSegment.segmentId) || [];
          chunks.push(event.data.slice(0));
          this.segmentAudio.set(this.currentSegment.segmentId, chunks);
        }
        this.audio.pushPcm(event.data);
        this.emit('state', { state: 'playing' });
        return;
      }
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === 'narration.segment.started') {
        this.currentSegment = data;
        if (!this.segmentOrder.includes(data.segmentId)) this.segmentOrder.push(data.segmentId);
        this.emit('segment', data);
        this.emit('state', { state: 'generating' });
      } else if (data.type === 'narration.segment.done') {
        this.emit('segmentDone', data);
      } else if (data.type === 'narration.job.done') {
        this.emit('state', { state: 'done', usage: data.usage });
      } else if (data.type === 'narration.job.cancelled') {
        this.emit('state', { state: 'cancelled' });
      } else if (data.type === 'narration.error') {
        this.emit('error', data);
        this.emit('state', { state: 'unavailable', message: data.message });
      }
    };
    ws.onerror = () => this.emit('state', { state: 'unavailable', message: '语音暂时不可用，文字内容不受影响。' });
    ws.onclose = () => { if (this.socket === ws) this.socket = null; };
  }

  async pause() { await this.audio?.pause(); this.emit('state', { state: 'paused' }); }
  async resume() { await this.audio?.resume(); this.emit('state', { state: 'playing' }); }
  async replay() { await this.audio?.replay(); this.emit('state', { state: 'playing' }); }
  async playRelativeSegment(offset) {
    if (!this.currentSegment || !this.segmentOrder.length) return;
    const currentIndex = Math.max(0, this.segmentOrder.indexOf(this.currentSegment.segmentId));
    const targetId = this.segmentOrder[Math.max(0, Math.min(this.segmentOrder.length - 1, currentIndex + offset))];
    const chunks = this.segmentAudio.get(targetId) || [];
    if (!chunks.length) return;
    await this.audio.unlock();
    this.audio.stop({ clearHistory: false });
    chunks.forEach((chunk) => this.audio.pushPcm(chunk, false));
    this.currentSegment = { ...this.currentSegment, segmentId: targetId };
    this.emit('state', { state: 'playing' });
  }
  setPlaybackRate(rate) { this.audio?.setPlaybackRate(rate); this.emit('rate', { rate: this.audio?.playbackRate || 1 }); }
  setSubtitles(enabled) { this.subtitlesEnabled = enabled; localStorage.setItem('discimind:narration-subtitles', String(enabled)); this.emit('subtitles', { enabled }); }

  async stop({ cancel = false } = {}) {
    const jobId = this.jobId;
    this.jobId = null;
    if (this.socket) {
      if (cancel && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'narration.cancel' }));
      this.socket.close();
      this.socket = null;
    }
    this.audio?.stop();
    if (cancel && jobId) learningNarrationApi.cancelJob(jobId).catch(() => {});
    this.emit('state', { state: 'stopped' });
  }

  async destroy() { await this.stop({ cancel: true }); await this.audio?.close(); }
}
