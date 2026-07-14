export function int16PcmToFloat32(input) {
  const bytes = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const view = new DataView(bytes);
  const samples = new Float32Array(Math.floor(view.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    const value = view.getInt16(i * 2, true);
    samples[i] = value < 0 ? value / 32768 : value / 32767;
  }
  return samples;
}

function withAudioTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => window.clearTimeout(timer));
}

export class LearningNarrationAudio {
  constructor({ sampleRate = 24000 } = {}) {
    this.sampleRate = sampleRate;
    this.context = null;
    this.worklet = null;
    this.fallbackSources = new Set();
    this.nextFallbackTime = 0;
    this.playbackRate = 1;
    this.history = [];
    this.paused = false;
  }

  async unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('当前浏览器不支持 Web Audio API');
      this.context = new AudioContext({ sampleRate: this.sampleRate, latencyHint: 'interactive' });
      if (this.context.audioWorklet) {
        try {
          await withAudioTimeout(this.context.audioWorklet.addModule('/learning-narration-worklet.js'), 2500, '语音播放器初始化超时');
          this.worklet = new AudioWorkletNode(this.context, 'learning-narration-pcm', { outputChannelCount: [1] });
          this.worklet.connect(this.context.destination);
          this.worklet.port.postMessage({ type: 'rate', value: this.playbackRate });
        } catch { this.worklet = null; }
      }
    }
    if (this.context.state === 'suspended') {
      await withAudioTimeout(this.context.resume(), 2500, '浏览器未允许启动音频，请再次点击播放');
    }
  }

  pushPcm(buffer, remember = true) {
    if (!this.context) return;
    const samples = int16PcmToFloat32(buffer);
    if (!samples.length) return;
    if (remember) this.history.push(samples.slice());
    if (this.worklet) {
      this.worklet.port.postMessage({ type: 'push', samples }, [samples.buffer]);
      return;
    }
    const audioBuffer = this.context.createBuffer(1, samples.length, this.sampleRate);
    audioBuffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime + 0.04, this.nextFallbackTime);
    source.start(startAt);
    this.nextFallbackTime = startAt + audioBuffer.duration / this.playbackRate;
    this.fallbackSources.add(source);
    source.onended = () => this.fallbackSources.delete(source);
  }

  async play() { await this.unlock(); this.resume(); }
  async pause() { if (!this.context) return; this.paused = true; this.worklet?.port.postMessage({ type: 'pause' }); await this.context.suspend(); }
  async resume() { if (!this.context) return; this.paused = false; this.worklet?.port.postMessage({ type: 'resume' }); if (this.context.state === 'suspended') await this.context.resume(); }

  stop({ clearHistory = true } = {}) {
    this.worklet?.port.postMessage({ type: 'clear' });
    for (const source of this.fallbackSources) { try { source.stop(); } catch {} }
    this.fallbackSources.clear();
    this.nextFallbackTime = this.context?.currentTime || 0;
    if (clearHistory) this.history = [];
    this.paused = false;
  }

  async replay() {
    await this.unlock();
    const copies = this.history.map((samples) => samples.slice());
    this.stop({ clearHistory: false });
    for (const samples of copies) {
      if (this.worklet) this.worklet.port.postMessage({ type: 'push', samples }, [samples.buffer]);
      else {
        const pcm = new ArrayBuffer(samples.length * 2);
        const view = new DataView(pcm);
        samples.forEach((sample, i) => view.setInt16(i * 2, Math.max(-32768, Math.min(32767, sample * 32767)), true));
        this.pushPcm(pcm, false);
      }
    }
  }

  async playBuffers(buffers = []) {
    await this.unlock();
    this.stop({ clearHistory: false });
    for (const buffer of buffers) this.pushPcm(buffer.slice ? buffer.slice(0) : buffer, false);
  }

  setPlaybackRate(rate) {
    this.playbackRate = Math.max(0.5, Math.min(2, Number(rate) || 1));
    this.worklet?.port.postMessage({ type: 'rate', value: this.playbackRate });
    for (const source of this.fallbackSources) source.playbackRate.value = this.playbackRate;
  }

  async close() {
    this.stop();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.worklet = null;
  }
}
