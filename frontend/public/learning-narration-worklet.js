class LearningNarrationPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.paused = false;
    this.rate = 1;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'push' && data.samples) this.queue.push(data.samples);
      if (data.type === 'pause') this.paused = true;
      if (data.type === 'resume') this.paused = false;
      if (data.type === 'rate') this.rate = Math.max(0.5, Math.min(2, Number(data.value) || 1));
      if (data.type === 'clear') { this.queue = []; this.current = null; this.offset = 0; }
    };
  }

  process(inputs, outputs) {
    const channel = outputs[0][0];
    channel.fill(0);
    if (this.paused) return true;
    for (let i = 0; i < channel.length; i += 1) {
      while (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
        if (!this.current) break;
      }
      if (!this.current) break;
      const low = Math.floor(this.offset);
      const high = Math.min(this.current.length - 1, low + 1);
      const fraction = this.offset - low;
      channel[i] = this.current[low] * (1 - fraction) + this.current[high] * fraction;
      this.offset += this.rate;
    }
    return true;
  }
}

registerProcessor('learning-narration-pcm', LearningNarrationPcmProcessor);
