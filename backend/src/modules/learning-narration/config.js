const fs = require('fs');
const path = require('path');

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function number(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getNarrationConfig() {
  const cacheDir = path.resolve(process.cwd(), process.env.LEARNING_NARRATION_CACHE_DIR || './storage/learning-narration');
  const ttsConfigured = Boolean(process.env.BAILIAN_TTS_API_KEY && process.env.BAILIAN_TTS_MODEL
    && process.env.BAILIAN_TTS_VOICE && process.env.BAILIAN_TTS_WS_URL);
  const featureEnabled = bool('LEARNING_NARRATION_ENABLED', true);
  const upstreamEnabled = bool('BAILIAN_TTS_ENABLED', false);
  return {
    featureEnabled,
    upstreamEnabled,
    ttsConfigured,
    enabled: featureEnabled && upstreamEnabled && ttsConfigured,
    unavailableReason: !featureEnabled ? 'FEATURE_DISABLED' : !upstreamEnabled ? 'TTS_DISABLED' : !ttsConfigured ? 'TTS_NOT_CONFIGURED' : null,
    autoplayDefault: bool('LEARNING_NARRATION_AUTOPLAY_DEFAULT', false),
    scriptMode: process.env.LEARNING_NARRATION_SCRIPT_MODE || 'fast',
    maxSegmentChars: number('LEARNING_NARRATION_MAX_SEGMENT_CHARS', 180, { min: 40, max: 500 }),
    maxTotalChars: number('LEARNING_NARRATION_MAX_TOTAL_CHARS', 1200, { min: 80, max: 5000 }),
    prefetchSegments: number('LEARNING_NARRATION_PREFETCH_SEGMENTS', 1, { min: 0, max: 1 }),
    maxConcurrentJobs: number('LEARNING_NARRATION_MAX_CONCURRENT_JOBS', 2, { min: 1, max: 10 }),
    cacheEnabled: bool('LEARNING_NARRATION_CACHE_ENABLED', true),
    cacheDir,
    jobTimeoutMs: number('LEARNING_NARRATION_JOB_TIMEOUT_MS', 90000, { min: 5000, max: 300000 }),
    debug: bool('LEARNING_NARRATION_DEBUG', false),
    model: process.env.BAILIAN_TTS_MODEL || 'qwen3-tts-flash-realtime',
    voice: process.env.BAILIAN_TTS_VOICE || '',
    wsUrl: process.env.BAILIAN_TTS_WS_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    apiKey: process.env.BAILIAN_TTS_API_KEY || '',
    workspaceId: process.env.BAILIAN_TTS_WORKSPACE_ID || '',
    mode: process.env.BAILIAN_TTS_MODE || 'commit',
    languageType: process.env.BAILIAN_TTS_LANGUAGE_TYPE || 'Chinese',
    responseFormat: process.env.BAILIAN_TTS_RESPONSE_FORMAT || 'pcm',
    sampleRate: number('BAILIAN_TTS_SAMPLE_RATE', 24000, { min: 8000, max: 48000 }),
    speechRate: number('BAILIAN_TTS_SPEECH_RATE', 0.95, { min: 0.5, max: 2 }),
    volume: number('BAILIAN_TTS_VOLUME', 55, { min: 0, max: 100 }),
    pitchRate: number('BAILIAN_TTS_PITCH_RATE', 1, { min: 0.5, max: 2 }),
    connectTimeoutMs: number('BAILIAN_TTS_CONNECT_TIMEOUT_MS', 10000, { min: 1000, max: 60000 }),
    responseTimeoutMs: number('BAILIAN_TTS_RESPONSE_TIMEOUT_MS', 60000, { min: 5000, max: 180000 }),
    maxTextLength: number('BAILIAN_TTS_MAX_TEXT_LENGTH', 500, { min: 40, max: 2000 }),
  };
}

function initializeNarrationStorage(config = getNarrationConfig()) {
  if (config.cacheEnabled) fs.mkdirSync(config.cacheDir, { recursive: true });
  return config;
}

function safeConfigSummary(config = getNarrationConfig()) {
  return {
    enabled: config.enabled,
    model: config.model,
    voiceConfigured: Boolean(config.voice),
    format: config.responseFormat,
    sampleRate: config.sampleRate,
    mode: config.mode,
    configurationComplete: config.ttsConfigured,
  };
}

module.exports = { getNarrationConfig, initializeNarrationStorage, safeConfigSummary };
