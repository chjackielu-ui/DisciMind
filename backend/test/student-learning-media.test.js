const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const media = require('../src/services/student-learning-media.service');
const images = require('../src/modules/ai-generate/image-generate.service');
const { getNarrationConfig } = require('../src/modules/learning-narration/config');

test('PCM is wrapped as a valid mono WAV without re-encoding', () => {
  const pcm = Buffer.alloc(24000 * 2, 1);
  const wav = media.wavFromPcm(pcm, 24000, 16, 1);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.length, pcm.length + 44);
});

test('subtitle segments cover the slide duration in order', () => {
  const subtitles = media.subtitlesFor('第一句。第二句！第三句。', 9000);
  assert.equal(subtitles.length, 3);
  assert.equal(subtitles[0].startMs, 0);
  assert.equal(subtitles.at(-1).endMs, 9000);
  for (let index = 1; index < subtitles.length; index += 1) assert.equal(subtitles[index].startMs, subtitles[index - 1].endMs);
});

test('focus cues follow narration subtitles and preserve bullet indexes', () => {
  const slide = { bullets: ['均方误差衡量预测偏差', '梯度下降更新模型参数'] };
  const narration = '首先，均方误差衡量预测值和真实值的偏差。接着，梯度下降会沿着损失减小的方向更新模型参数。';
  const subtitles = media.subtitlesFor(narration, 8000);
  const cues = media.focusCuesFor(slide, narration, 8000, subtitles);
  assert.deepEqual(cues.map((item) => item.index), [0, 1]);
  assert.ok(cues.every((item) => item.target === 'bullet' && item.startMs < item.endMs));
  assert.ok(cues[0].startMs <= subtitles[0].endMs);
  assert.ok(cues[1].endMs >= subtitles[1].startMs);
});

test('student video fallback narration expands slide outlines into an explanation', () => {
  const text = media.fallbackNarrationForSlide({
    type: 'content',
    title: '线性回归的核心思想',
    bullets: ['拟合连续值', '均方误差', '梯度下降'],
    notes: '介绍三个核心要点。',
  }, 1, 4, 500);
  assert.ok(text.length >= 140);
  assert.match(text, /线性回归的核心思想/);
  assert.match(text, /均方误差/);
  assert.match(text, /例子/);
});

test('AI narration response stays page-aligned and falls back for short pages', () => {
  const slides = [
    { type: 'cover', title: '线性回归', bullets: ['定义', '应用'] },
    { type: 'content', title: '损失函数', bullets: ['均方误差'] },
  ];
  const longText = '均方误差用于衡量预测值与真实值之间的平均平方偏差。'.repeat(8);
  const scripts = media.parseNarrationScripts(JSON.stringify({ scripts: [
    { page: 1, text: '太短' },
    { page: 2, text: longText },
  ] }), slides, 500);
  assert.equal(scripts.length, 2);
  assert.ok(scripts[0].length >= 80);
  assert.equal(scripts[1], longText.slice(0, 500));
});

test('public video manifest never exposes local storage paths', () => {
  const value = media.publicManifest({ slides: [{ page: 1, audioStoragePath: '1/video/private.wav', audioUrl: '/api/audio/1' }] });
  assert.equal(value.slides[0].audioStoragePath, undefined);
  assert.equal(value.slides[0].audioUrl, '/api/audio/1');
});

test('video failure state remains retryable only while worker attempts remain', () => {
  assert.deepEqual(
    media.videoFailureState({ attemptCount: 1, maxAttempts: 2 }, new Error('temporary upstream error')),
    { status: 'PENDING', error_message: null },
  );
  assert.deepEqual(
    media.videoFailureState({ attemptCount: 2, maxAttempts: 2 }, new Error('temporary upstream error')),
    { status: 'FAILED', error_message: 'temporary upstream error' },
  );
  const permanent = Object.assign(new Error('invalid PPT'), { permanent: true });
  assert.deepEqual(
    media.videoFailureState({ attemptCount: 1, maxAttempts: 2 }, permanent),
    { status: 'FAILED', error_message: 'invalid PPT' },
  );
});

test('active async retry state takes precedence over stale video failure state', () => {
  assert.equal(media.publicVideoTaskStatus('FAILED', 'QUEUED'), 'generating');
  assert.equal(media.publicVideoTaskStatus('FAILED', 'RUNNING'), 'generating');
  assert.equal(media.publicVideoTaskStatus('FAILED', 'FAILED'), 'failed');
  assert.equal(media.publicVideoTaskStatus('GENERATING', 'WAITING_EXTERNAL'), 'ready');
  assert.equal(media.publicVideoTaskStatus('SUCCESS', 'RUNNING'), 'success');
});

test('PPT image prompt enforces an educational no-text composition', () => {
  const prompt = images.promptForSlide({ imagePrompt: '线性回归拟合散点图' });
  assert.match(prompt, /16:9教学配图/);
  assert.match(prompt, /不出现文字/);
});

test('TTS accepts the built-in Bailian WebSocket URL when other required settings exist', () => {
  const previous = {
    enabled: process.env.BAILIAN_TTS_ENABLED,
    apiKey: process.env.BAILIAN_TTS_API_KEY,
    fallbackKey: process.env.BAILIAN_API_KEY,
    model: process.env.BAILIAN_TTS_MODEL,
    voice: process.env.BAILIAN_TTS_VOICE,
    wsUrl: process.env.BAILIAN_TTS_WS_URL,
  };
  process.env.BAILIAN_TTS_ENABLED = 'true';
  process.env.BAILIAN_TTS_API_KEY = 'test-key';
  process.env.BAILIAN_TTS_MODEL = 'test-model';
  process.env.BAILIAN_TTS_VOICE = 'test-voice';
  delete process.env.BAILIAN_TTS_WS_URL;
  try {
    const config = getNarrationConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.wsUrl, 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
  } finally {
    for (const [name, value] of Object.entries({
      BAILIAN_TTS_ENABLED: previous.enabled,
      BAILIAN_TTS_API_KEY: previous.apiKey,
      BAILIAN_API_KEY: previous.fallbackKey,
      BAILIAN_TTS_MODEL: previous.model,
      BAILIAN_TTS_VOICE: previous.voice,
      BAILIAN_TTS_WS_URL: previous.wsUrl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('student PPT/video UI persists course generation state across task-center navigation', async () => {
  const panel = await fs.readFile(path.resolve(__dirname, '../../frontend/src/components/video/LearningMediaPanel.jsx'), 'utf8');
  const taskIsland = await fs.readFile(path.resolve(__dirname, '../../frontend/src/components/task-center.js'), 'utf8');
  const workCenter = await fs.readFile(path.resolve(__dirname, '../../frontend/src/components/unified-task-message-center.js'), 'utf8');
  const taskPage = await fs.readFile(path.resolve(__dirname, '../../frontend/src/pages/agent/AgentTasksPage.js'), 'utf8');
  const coursePage = await fs.readFile(path.resolve(__dirname, '../../frontend/src/pages/student-course-detail.js'), 'utf8');
  assert.match(panel, /sessionStorage\.setItem\(mediaStateKey/);
  assert.match(panel, /restoredVideoTaskId/);
  assert.match(panel, /restoredPackageTaskId/);
  assert.match(panel, /packageTaskIdFromLocation/);
  assert.match(panel, /packageId/);
  assert.match(panel, /createStudentKnowledgeResourcePackage/);
  assert.match(panel, /retryStudentKnowledgeResourcePackage/);
  assert.match(panel, /一键生成五类资源包/);
  assert.match(panel, /section', 'learning-media'/);
  assert.match(taskIsland, /returnTo=/);
  assert.match(workCenter, /returnTo=/);
  assert.match(taskPage, /返回生成页面/);
  assert.match(taskPage, /query\.set\('returnTo', returnTo\)/);
  assert.match(coursePage, /section === 'learning-media'/);
});

test('development server proxies generated PPT images for browser video rendering', async () => {
  const viteConfig = await fs.readFile(path.resolve(__dirname, '../../frontend/vite.config.js'), 'utf8');
  assert.match(viteConfig, /['"]\/uploads['"]\s*:\s*\{/);
  assert.match(viteConfig, /target:\s*['"]http:\/\/localhost:3000['"]/);
});

test('PPT tasks interrupted by a process restart have startup recovery', async () => {
  const [pptService, server] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../src/services/teacher-ppt.service.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../src/server.js'), 'utf8'),
  ]);
  assert.match(pptService, /recoverInterruptedTasks/);
  assert.match(pptService, /PPT_GENERATION_INTERRUPTED/);
  assert.match(pptService, /recoveredAtStartup/);
  assert.match(server, /recoverInterruptedTasks\(\)/);
});

test('video task creation is serialized, idempotent while active and transactional', async () => {
  const service = await fs.readFile(path.resolve(__dirname, '../src/services/student-learning-media.service.js'), 'utf8');
  assert.match(service, /videoCreationLocks/);
  assert.match(service, /status:\s*\{\s*in:\s*\['QUEUED',\s*'RUNNING',\s*'WAITING_EXTERNAL'\]/);
  assert.match(service, /prisma\.\$transaction/);
  assert.match(service, /dedupeKey:\s*`ppt-video:/);
});
