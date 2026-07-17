const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class NarrationCacheService {
  constructor(config) {
    this.config = config;
    this.inflight = new Map();
  }

  key(scriptHash) {
    const material = [scriptHash, this.config.voice, this.config.speechRate, this.config.pitchRate,
      this.config.volume, this.config.responseFormat, this.config.sampleRate, this.config.model].join('|');
    return crypto.createHash('sha256').update(material).digest('hex');
  }

  paths(key) {
    return { audio: path.join(this.config.cacheDir, `${key}.pcm`), meta: path.join(this.config.cacheDir, `${key}.json`) };
  }

  async get(scriptHash) {
    if (!this.config.cacheEnabled) return null;
    const key = this.key(scriptHash);
    const files = this.paths(key);
    const started = Date.now();
    try {
      const [metaText, audio] = await Promise.all([fs.promises.readFile(files.meta, 'utf8'), fs.promises.readFile(files.audio)]);
      const meta = JSON.parse(metaText);
      if (meta.key !== key || meta.byteLength !== audio.length || meta.checksum !== crypto.createHash('sha256').update(audio).digest('hex')) throw new Error('corrupt');
      const audioBySegment = meta.segments.map((item) => audio.subarray(item.offset, item.offset + item.length));
      return { key, meta, audioBySegment, cacheLookupMs: Date.now() - started };
    } catch {
      await Promise.allSettled([fs.promises.unlink(files.meta), fs.promises.unlink(files.audio)]);
      return null;
    }
  }

  async put(scriptHash, segments, audioBySegment, usage = {}) {
    if (!this.config.cacheEnabled || !audioBySegment?.length) return null;
    const key = this.key(scriptHash);
    const files = this.paths(key);
    const audio = Buffer.concat(audioBySegment);
    const token = crypto.randomBytes(6).toString('hex');
    const tmpAudio = `${files.audio}.${token}.tmp`;
    const tmpMeta = `${files.meta}.${token}.tmp`;
    let offset = 0;
    const segmentMeta = segments.map((segment, index) => {
      const length = audioBySegment[index]?.length || 0;
      const item = { segmentId: segment.segmentId, order: segment.order, offset, length };
      offset += length;
      return item;
    });
    const meta = { key, byteLength: audio.length, checksum: crypto.createHash('sha256').update(audio).digest('hex'), segments: segmentMeta, usage, createdAt: new Date().toISOString() };
    await fs.promises.mkdir(this.config.cacheDir, { recursive: true });
    await fs.promises.writeFile(tmpAudio, audio, { flag: 'wx' });
    await fs.promises.writeFile(tmpMeta, JSON.stringify(meta), { flag: 'wx' });
    await fs.promises.rename(tmpAudio, files.audio);
    await fs.promises.rename(tmpMeta, files.meta);
    return { key, meta };
  }

  coalesce(key, factory) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const task = Promise.resolve().then(factory).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  async cleanupOlderThan(maxAgeMs) {
    if (!this.config.cacheEnabled) return 0;
    const files = await fs.promises.readdir(this.config.cacheDir).catch(() => []);
    let removed = 0;
    await Promise.all(files.map(async (name) => {
      const file = path.join(this.config.cacheDir, name);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > maxAgeMs) { await fs.promises.unlink(file).catch(() => {}); removed += 1; }
    }));
    return removed;
  }
}

module.exports = { NarrationCacheService };
