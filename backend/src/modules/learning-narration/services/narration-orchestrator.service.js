const { EventEmitter } = require('events');

class NarrationOrchestrator extends EventEmitter {
  constructor({ adapter, cache, config }) {
    super();
    this.adapter = adapter;
    this.cache = cache;
    this.config = config;
  }

  emitControl(type, data = {}) { this.emit('control', { type, ...data }); }

  async run(job, signal) {
    const metrics = job.metrics;
    const cached = await this.cache.get(job.script.scriptHash);
    metrics.cacheLookupMs = cached?.cacheLookupMs || 0;
    metrics.cacheHit = Boolean(cached);
    this.emitControl('narration.session.ready', { sampleRate: this.config.sampleRate, format: this.config.responseFormat });
    if (cached) {
      for (let index = 0; index < job.script.segments.length; index += 1) {
        if (signal.aborted) return;
        const segment = job.script.segments[index];
        this.emitControl('narration.segment.started', { segmentId: segment.segmentId, order: segment.order, subtitle: segment.text });
        const audio = cached.audioBySegment[index];
        for (let offset = 0; offset < audio.length; offset += 4096) this.emit('audio', audio.subarray(offset, offset + 4096));
        this.emitControl('narration.segment.done', { segmentId: segment.segmentId });
      }
      return { usage: cached.meta.usage || { characters: metrics.characterCount }, cacheHit: true };
    }
    const synthesisKey = this.cache.key(job.script.scriptHash);
    let producedLocally = false;
    const result = await this.cache.coalesce(synthesisKey, async () => {
      producedLocally = true;
      const synthesized = await this.adapter.synthesize({
        segments: job.script.segments,
        signal,
        metrics,
        onSegmentStart: (segment) => this.emitControl('narration.segment.started', { segmentId: segment.segmentId, order: segment.order, subtitle: segment.text }),
        onAudioDelta: (audio) => this.emit('audio', audio),
        onSegmentDone: (segment) => this.emitControl('narration.segment.done', { segmentId: segment.segmentId }),
      });
      await this.cache.put(job.script.scriptHash, job.script.segments, synthesized.audioBySegment, synthesized.usage);
      return synthesized;
    });
    // A concurrent job with the same cache key joins the single upstream request,
    // then receives the completed PCM in segment order without another paid call.
    if (!producedLocally) {
      for (let index = 0; index < job.script.segments.length; index += 1) {
        if (signal.aborted) break;
        const segment = job.script.segments[index];
        this.emitControl('narration.segment.started', { segmentId: segment.segmentId, order: segment.order, subtitle: segment.text });
        const audio = result.audioBySegment[index] || Buffer.alloc(0);
        for (let offset = 0; offset < audio.length; offset += 4096) this.emit('audio', audio.subarray(offset, offset + 4096));
        this.emitControl('narration.segment.done', { segmentId: segment.segmentId });
      }
    }
    return { ...result, cacheHit: false, coalesced: !producedLocally };
  }
}

module.exports = { NarrationOrchestrator };
