const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../src/config/env');
const { getNarrationConfig, safeConfigSummary } = require('../src/modules/learning-narration/config');
const { BailianRealtimeTtsAdapter } = require('../src/modules/learning-narration/adapters/bailian-realtime-tts.adapter');
const { normalizeSpeechText } = require('../src/modules/learning-narration/services/speech-text-normalizer.service');

function wavHeader(byteLength, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + byteLength, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(byteLength, 40);
  return header;
}

async function main() {
  loadEnv();
  const config = getNarrationConfig();
  if (!config.enabled) throw new Error(`TTS integration disabled: ${config.unavailableReason}`);
  const metrics = { startedAt: Date.now(), audioBytes: 0 };
  const adapter = new BailianRealtimeTtsAdapter(config);
  const source = '## 逻辑回归\n逻辑回归的概率为 $P(Y=1|X=x)$。**请注意**，不要朗读 Markdown 标记。';
  const text = normalizeSpeechText(source, metrics);
  const result = await adapter.synthesize({
    segments: [{ segmentId: 'live_1', type: 'content', order: 0, text }], metrics,
  });
  const pcm = Buffer.concat(result.audioBySegment);
  const output = path.resolve(config.cacheDir, 'live-integration-test.wav');
  await fs.promises.mkdir(config.cacheDir, { recursive: true });
  await fs.promises.writeFile(output, Buffer.concat([wavHeader(pcm.length, config.sampleRate), pcm]));
  console.log(JSON.stringify({
    ok: pcm.length > 0,
    config: safeConfigSummary(config),
    sessionCreatedToFirstAudioDeltaMs: metrics.firstAudioDeltaMs,
    upstreamConnectMs: metrics.upstreamConnectMs,
    sessionReadyMs: metrics.sessionReadyMs,
    formulaNormalizeMs: metrics.formulaNormalizeMs || 0,
    audioBytes: pcm.length,
    usageCharacters: result.usage.characters,
    output,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || 'LIVE_TTS_FAILED', message: error.message }));
  process.exitCode = 1;
});
