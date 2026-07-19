const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const { getNarrationConfig, safeConfigSummary } = require('../src/modules/learning-narration/config');
const { normalizeMathExpression, normalizeMathInText } = require('../src/modules/learning-narration/services/math-speech-normalizer.service');
const { normalizeSpeechText } = require('../src/modules/learning-narration/services/speech-text-normalizer.service');
const { buildNarrationScript, splitSpeechText } = require('../src/modules/learning-narration/services/narration-script.service');
const { BailianRealtimeTtsAdapter, buildSessionUpdate, summarizeUpstreamError } = require('../src/modules/learning-narration/adapters/bailian-realtime-tts.adapter');
const { NarrationCacheService } = require('../src/modules/learning-narration/services/narration-cache.service');

const baseConfig = {
  enabled: true, model: 'qwen3-tts-flash-realtime', voice: 'test-voice', wsUrl: 'wss://example.test/realtime', apiKey: 'secret', workspaceId: 'workspace',
  mode: 'commit', languageType: 'Chinese', responseFormat: 'pcm', sampleRate: 24000,
  speechRate: 0.95, volume: 55, pitchRate: 1, connectTimeoutMs: 500, responseTimeoutMs: 500,
  maxSegmentChars: 180, maxTotalChars: 1200, maxTextLength: 500,
};

test('TTS configuration safely disables when required values are missing', () => {
  const old = { ...process.env };
  process.env.LEARNING_NARRATION_ENABLED = 'true';
  process.env.BAILIAN_TTS_ENABLED = 'true';
  delete process.env.BAILIAN_TTS_API_KEY;
  delete process.env.BAILIAN_TTS_VOICE;
  const config = getNarrationConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.unavailableReason, 'TTS_NOT_CONFIGURED');
  assert.equal(JSON.stringify(safeConfigSummary(config)).includes('apiKey'), false);
  process.env = old;
});

test('session.update contains only Flash commit fields and unique event ids', () => {
  const first = buildSessionUpdate(baseConfig);
  const second = buildSessionUpdate(baseConfig);
  assert.equal(first.type, 'session.update');
  assert.equal(first.session.mode, 'commit');
  assert.equal(first.session.sample_rate, 24000);
  assert.equal('instructions' in first.session, false);
  assert.notEqual(first.event_id, second.event_id);
});

test('TTS upstream error summary keeps only safe diagnostic fields', () => {
  const summary = summarizeUpstreamError({
    type: 'error',
    event_id: 'evt-1',
    text: '不应进入日志的讲稿',
    error: { code: 'InvalidVoice', param: 'voice', message: '音色\n不匹配', authorization: 'Bearer secret' },
  });
  assert.deepEqual(summary, {
    code: 'InvalidVoice',
    eventId: 'evt-1',
    param: 'voice',
    message: '音色 不匹配',
  });
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  assert.equal(JSON.stringify(summary).includes('讲稿'), false);
});

test('Markdown, JSON, URL, image, code and table are normalized for speech', () => {
  const result = normalizeSpeechText('## 核心概念\n**监督学习** [文档](https://example.com/a)\n![图](x.png)\n```js\nconst x = 1;\n```\n|名称|值|\n|---|---|\n|A|分类|\n{"sourceId":"x"}');
  assert.match(result, /核心概念/);
  assert.match(result, /监督学习/);
  assert.match(result, /请查看屏幕中的图片/);
  assert.doesNotMatch(result, /https?:|```|\*\*|sourceId|[{}]/);
  assert.doesNotMatch(result, /\|/);
});

test('math rules cover powers, subscripts, fraction, root, sum, product, integral and limit', () => {
  assert.equal(normalizeMathExpression('x^2'), 'x 的平方');
  assert.equal(normalizeMathExpression('x_i'), 'x 下标 i');
  assert.equal(normalizeMathExpression('\\frac{a}{b}'), 'a 除以 b');
  assert.equal(normalizeMathExpression('\\sqrt{x}'), '根号 x');
  assert.match(normalizeMathExpression('\\sum_{i=1}^{n}'), /从 i 等于 1 到 n 的求和/);
  assert.match(normalizeMathExpression('\\prod_{i=1}^{n}'), /连乘/);
  assert.match(normalizeMathExpression('\\int_a^b f(x) dx'), /从 a 到 b/);
  assert.match(normalizeMathExpression('\\lim_{x\\to 0}'), /趋近于 0/);
});

test('conditional probability, derivatives, symbols, Greek and abbreviations are spoken', () => {
  assert.match(normalizeMathExpression('P(Y=1|X=x)'), /条件下/);
  assert.equal(normalizeMathExpression('\\frac{dy}{dx}'), 'y 对 x 的导数');
  assert.match(normalizeMathExpression('α + β ≥ 0'), /阿尔法.*加.*贝塔.*大于等于/);
  assert.match(normalizeMathExpression('AUC'), /A U C/);
});

test('inline and block LaTeX are converted and unknown formulas degrade', () => {
  assert.match(normalizeMathInText('值为 $x^2$，以及 $$\\frac{a}{b}$$'), /x 的平方.*a 除以 b/);
  const metrics = {};
  assert.match(normalizeMathInText('$$\\begin{matrix}a&b\\end{matrix}$$', metrics), /请查看屏幕中的公式/);
  assert.equal(metrics.formulaConversionFailures, 1);
});

test('semantic segmentation keeps complete words and respects max length', () => {
  const segments = splitSpeechText('这是第一句话，用来说明核心定义。这是第二句话，用来说明应用场景。machine learning should remain readable。', 45, 15);
  assert.ok(segments.length >= 2);
  assert.ok(segments.every((item) => item.length <= 45));
  assert.ok(segments.some((item) => item.includes('machine')));
});

test('Trainer before submit never leaks answer or analysis', () => {
  const script = buildNarrationScript({
    jobId: 'j', sessionId: 1, nodeRunId: 2, nodeType: 'basic_practice', agentType: 'TRAINER', purpose: 'node_content', config: baseConfig,
    content: { mode: 'basic_practice', questions: [{ stem: '以下哪项属于监督学习？', options: [{ key: 'A', content: '分类' }, { key: 'B', content: '聚类' }], correct_answer: 'A', analysis: '答案就是 A' }] },
  });
  const speech = script.segments.map((item) => item.text).join('');
  assert.match(speech, /A，分类/);
  assert.doesNotMatch(speech, /答案就是|correct|聚类是错/);
});

test('Trainer feedback is short and contains no rubric', () => {
  const script = buildNarrationScript({
    jobId: 'j', sessionId: 1, nodeRunId: 2, nodeType: 'basic_practice', agentType: 'TRAINER', purpose: 'feedback', config: baseConfig,
    content: { finalAnswer: { isCorrect: false, feedback: '要先区分有标签和无标签数据。', rubric: '内部评分规则' } },
  });
  const speech = script.segments.map((item) => item.text).join('');
  assert.match(speech, /回答不正确/);
  assert.doesNotMatch(speech, /内部评分规则/);
  assert.ok(speech.length <= 100);
});

test('one-time ticket expires and cannot be consumed twice', () => {
  const { NarrationJobService } = require('../src/modules/learning-narration/services/narration-job.service');
  const service = new NarrationJobService({ config: baseConfig, adapter: { closeAll() {} }, cache: {} });
  const job = { id: 'job', userId: 1, sessionId: 2, nodeRunId: 3 };
  service.jobs.set(job.id, job);
  const issued = service.issueTicket(job);
  assert.equal(service.consumeTicket(issued.raw), job);
  assert.equal(service.consumeTicket(issued.raw), null);
  const expired = service.issueTicket(job);
  for (const ticket of service.tickets.values()) ticket.expiresAt = Date.now() - 1;
  assert.equal(service.consumeTicket(expired.raw), null);
});

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  constructor(url, options) {
    super();
    this.url = url; this.options = options; this.readyState = MockWebSocket.OPEN; this.sent = [];
    MockWebSocket.instances.push(this);
    setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.created' }))));
  }
  send(raw) {
    const event = JSON.parse(raw); this.sent.push(event);
    if (event.type === 'session.update') setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' }))));
    if (event.type === 'input_text_buffer.commit') setImmediate(() => {
      for (const response of [
        { type: 'input_text_buffer.committed' }, { type: 'response.created' },
        { type: 'response.audio.delta', delta: Buffer.from([1, 2, 3, 4]).toString('base64') },
        { type: 'response.audio.done' }, { type: 'response.done', usage: { characters: 4 } },
      ]) this.emit('message', Buffer.from(JSON.stringify(response)));
    });
    if (event.type === 'session.finish') setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.finished' }))));
  }
  close() { this.readyState = 3; this.emit('close'); }
}
MockWebSocket.instances = [];

test('adapter performs append+commit, decodes audio, usage, finish and cleanup', async () => {
  const adapter = new BailianRealtimeTtsAdapter(baseConfig, { WebSocketImpl: MockWebSocket });
  const chunks = [];
  const result = await adapter.synthesize({ segments: [{ segmentId: 'content_1', text: '测试语音', order: 0 }], metrics: { startedAt: Date.now() }, onAudioDelta: (audio) => chunks.push(audio) });
  const socket = MockWebSocket.instances.at(-1);
  assert.match(socket.url, /model=qwen3-tts-flash-realtime/);
  assert.equal(socket.options.headers.Authorization, 'Bearer secret');
  assert.equal(socket.options.headers['X-DashScope-WorkSpace'], 'workspace');
  assert.deepEqual(socket.sent.map((item) => item.type), ['session.update', 'input_text_buffer.append', 'input_text_buffer.commit', 'session.finish']);
  assert.deepEqual([...chunks[0]], [1, 2, 3, 4]);
  assert.equal(result.usage.characters, 4);
  assert.equal(adapter.activeSockets.size, 0);
});

test('cache hit returns segment audio and avoids upstream work', async () => {
  const cacheDir = path.join(process.cwd(), 'storage', 'learning-narration-test');
  await fs.promises.rm(cacheDir, { recursive: true, force: true });
  const cache = new NarrationCacheService({ ...baseConfig, cacheEnabled: true, cacheDir });
  const segments = [{ segmentId: 'a', order: 0 }, { segmentId: 'b', order: 1 }];
  await cache.put('hash', segments, [Buffer.from([1, 2]), Buffer.from([3, 4])], { characters: 2 });
  const hit = await cache.get('hash');
  assert.deepEqual(hit.audioBySegment.map((item) => [...item]), [[1, 2], [3, 4]]);
  assert.equal(hit.meta.usage.characters, 2);
  let calls = 0;
  const [a, b] = await Promise.all([cache.coalesce('same', async () => { calls += 1; return 1; }), cache.coalesce('same', async () => { calls += 1; return 2; })]);
  assert.deepEqual([a, b], [1, 1]);
  assert.equal(calls, 1);
  await fs.promises.rm(cacheDir, { recursive: true, force: true });
});

test('concurrent orchestrators with the same script share one upstream synthesis', async () => {
  const { NarrationOrchestrator } = require('../src/modules/learning-narration/services/narration-orchestrator.service');
  const cacheDir = path.join(process.cwd(), 'storage', 'learning-narration-coalesce-test');
  await fs.promises.rm(cacheDir, { recursive: true, force: true });
  const config = { ...baseConfig, cacheEnabled: true, cacheDir };
  const cache = new NarrationCacheService(config);
  let calls = 0;
  const adapter = {
    async synthesize(callbacks) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      const segment = callbacks.segments[0];
      const audio = Buffer.from([5, 6, 7, 8]);
      callbacks.onSegmentStart(segment); callbacks.onAudioDelta(audio, segment); callbacks.onSegmentDone(segment);
      return { audioBySegment: [audio], usage: { characters: 4 } };
    },
  };
  const job = { script: { scriptHash: 'shared', segments: [{ segmentId: 'a', order: 0, text: '测试' }] }, metrics: {} };
  const first = new NarrationOrchestrator({ adapter, cache, config });
  const second = new NarrationOrchestrator({ adapter, cache, config });
  const secondAudio = [];
  second.on('audio', (chunk) => secondAudio.push(...chunk));
  await Promise.all([first.run(job, new AbortController().signal), second.run({ ...job, metrics: {} }, new AbortController().signal)]);
  assert.equal(calls, 1);
  assert.deepEqual(secondAudio, [5, 6, 7, 8]);
  await fs.promises.rm(cacheDir, { recursive: true, force: true });
});
