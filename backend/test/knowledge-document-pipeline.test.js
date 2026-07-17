const test = require('node:test');
const assert = require('node:assert/strict');
const pipeline = require('../src/modules/knowledge-base/knowledge-document-pipeline.service');

test('knowledge pipeline preserves heading and page metadata in structured chunks', () => {
  const text = pipeline.cleanText(`[[PAGE:1]]\n# 第一章\n\n这是第一段。${'结构化内容。'.repeat(90)}\n\n[[PAGE:2]]\n## 第二节\n\n- 要点一\n- 要点二`, 2);
  const chunks = pipeline.chunkStructuredText(text, { documentId: 9, chunkSize: 400, chunkOverlap: 60 });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].document_id, 9);
  assert.equal(chunks[0].page_number, 1);
  assert.match(chunks[0].title_path, /第一章/);
  assert.ok(chunks.every((chunk, index) => chunk.chunk_index === index + 1));
  assert.ok(chunks.every((chunk) => chunk.chunk_hash?.length === 64 && chunk.char_count === chunk.chunk_text.length));
  assert.ok(chunks.some((chunk) => chunk.page_number === 2 && /第二节/.test(chunk.title_path || '')));
});

test('knowledge pipeline reports scanned or empty documents at parsing stage', () => {
  assert.throws(
    () => pipeline.cleanText('   ', 1),
    (error) => error.code === 'DOCUMENT_TEXT_EMPTY' && error.stage === 'parsing' && error.retryable === false,
  );
});

test('knowledge pipeline rejects heavily damaged text', () => {
  assert.throws(
    () => pipeline.cleanText(`正常开头${'�'.repeat(20)}乱码尾部`, 1),
    (error) => error.code === 'DOCUMENT_TEXT_GARBLED' && error.stage === 'parsing',
  );
});
