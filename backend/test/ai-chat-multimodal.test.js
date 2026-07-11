const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeImageInputs,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
} = require('../src/services/ai-chat.service');
const {
  buildChatCompletionParams,
} = require('../src/services/bailian-openai.service');

function tinyPngDataUrl() {
  return `data:image/png;base64,${Buffer.from('valid-test-image-bytes').toString('base64')}`;
}

test('AI chat accepts a validated pasted image without storing the data URL as metadata', () => {
  const [image] = normalizeImageInputs([{ name: '题目截图.png', dataUrl: tinyPngDataUrl() }]);
  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.name, '题目截图.png');
  assert.ok(Buffer.isBuffer(image.buffer));
  assert.ok(!Object.keys(image).includes('dataUrl'));
});

test('AI chat rejects unsupported image types and excessive image counts', () => {
  assert.throws(() => normalizeImageInputs([{ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }]), /格式不支持/);
  assert.throws(() => normalizeImageInputs(Array.from({ length: MAX_IMAGE_COUNT + 1 }, () => ({ dataUrl: tinyPngDataUrl() }))), /最多上传/);
});

test('AI chat rejects an oversized image', () => {
  const oversized = `data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')}`;
  assert.throws(() => normalizeImageInputs([{ dataUrl: oversized }]), /不能超过/);
});

test('Bailian chat parameters use qwen3.7-plus and disable thinking for lower latency', () => {
  const oldKey = process.env.BAILIAN_API_KEY;
  const oldModel = process.env.BAILIAN_MODEL;
  process.env.BAILIAN_API_KEY = 'unit-test-key';
  process.env.BAILIAN_MODEL = 'qwen3.7-plus';
  try {
    const params = buildChatCompletionParams({ messages: [{ role: 'user', content: '你好' }], stream: true });
    assert.equal(params.model, 'qwen3.7-plus');
    assert.equal(params.enable_thinking, false);
    assert.equal(params.stream, true);
  } finally {
    if (oldKey === undefined) delete process.env.BAILIAN_API_KEY; else process.env.BAILIAN_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.BAILIAN_MODEL; else process.env.BAILIAN_MODEL = oldModel;
  }
});
