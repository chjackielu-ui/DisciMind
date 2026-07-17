const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeUploadFileName,
  classifyRemoteIndexingError,
  automaticIndexingRetryDelay,
} = require('../src/modules/knowledge-base/knowledge-ingestion.utils');

test('knowledge uploads recover UTF-8 filenames decoded as latin1', () => {
  const expected = '2024版《学生手册》.pdf';
  const mojibake = Buffer.from(expected, 'utf8').toString('latin1');
  assert.equal(normalizeUploadFileName(mojibake), expected);
  assert.equal(normalizeUploadFileName(expected), expected);
  assert.equal(normalizeUploadFileName('student-handbook.pdf'), 'student-handbook.pdf');
});

test('nested Dify embedding quota errors are classified for automatic retry', () => {
  const remoteError = JSON.stringify({
    args: { description: '[models] missing embeddings: {"status_code":429,"code":"Throttling.RateQuota"}' },
    error_type: 'InvokeError',
  });
  const result = classifyRemoteIndexingError(remoteError);
  assert.equal(result.code, 'DIFY_EMBEDDING_RATE_LIMIT');
  assert.equal(result.automaticRetry, true);
  assert.equal(result.retryable, true);
  assert.match(result.userMessage, /自动退避/);
});

test('automatic indexing retry uses bounded exponential backoff', () => {
  const options = { baseMs: 1_000, maxMs: 5_000 };
  assert.equal(automaticIndexingRetryDelay(1, options), 1_000);
  assert.equal(automaticIndexingRetryDelay(2, options), 2_000);
  assert.equal(automaticIndexingRetryDelay(4, options), 5_000);
});

test('failed Dify documents reuse update-by-file with an unavailable-document recreate fallback', () => {
  const root = path.resolve(__dirname, '..');
  const adapter = fs.readFileSync(path.join(root, 'src/modules/learning-agent/adapters/dify-knowledge.adapter.js'), 'utf8');
  const pipeline = fs.readFileSync(path.join(root, 'src/modules/knowledge-base/knowledge-document-pipeline.service.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'src/modules/async-task/async-task.worker.js'), 'utf8');
  const frontend = fs.readFileSync(path.resolve(root, '../frontend/src/api/marketplace.js'), 'utf8');
  assert.match(adapter, /documents\/\$\{encodeURIComponent\(documentId\)\}\/update-by-file/);
  assert.match(adapter, /DIFY_KNOWLEDGE_EMBEDDING_MODEL/);
  assert.match(adapter, /embedding_model_provider/);
  assert.match(pipeline, /dify\.updateDocumentFile/);
  assert.match(pipeline, /document is not available/);
  assert.match(pipeline, /dify\.deleteDatasetDocument/);
  assert.match(pipeline, /return upload\(\)/);
  assert.match(worker, /refreshed\?\.status === 'QUEUED'/);
  assert.match(frontend, /form\.append\('originalName'/);
});
