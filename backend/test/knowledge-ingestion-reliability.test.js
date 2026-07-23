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

test('nested embedding quota errors are classified for automatic retry', () => {
  const remoteError = JSON.stringify({
    args: { description: '[models] missing embeddings: {"status_code":429,"code":"Throttling.RateQuota"}' },
    error_type: 'InvokeError',
  });
  const result = classifyRemoteIndexingError(remoteError);
  assert.equal(result.code, 'KNOWLEDGE_EMBEDDING_RATE_LIMIT');
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

test('knowledge indexing stays in the backend pipeline without frontend or Dify coupling', () => {
  const root = path.resolve(__dirname, '..');
  const pipeline = fs.readFileSync(path.join(root, 'src/modules/knowledge-base/knowledge-document-pipeline.service.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'src/modules/async-task/async-task.worker.js'), 'utf8');
  assert.match(pipeline, /knowledgeProvider\.indexDocument/);
  assert.match(pipeline, /parse_status: 'EMBEDDED'/);
  assert.match(pipeline, /status: 'SUCCEEDED'/);
  assert.doesNotMatch(pipeline, /dify-knowledge\.adapter|dify\.updateDocumentFile|WAITING_EXTERNAL/);
  assert.match(worker, /externalFailure: false/);
  assert.doesNotMatch(worker, /getDocumentIndexingStatus|refreshStatus\(task\.userId/);
});

test('cloud knowledge wiring keeps real seed content behind the normal indexing worker', () => {
  const root = path.resolve(__dirname, '..');
  const knowledgeBase = fs.readFileSync(path.join(root, 'src/modules/knowledge-base/knowledge-base.service.js'), 'utf8');
  const pipeline = fs.readFileSync(path.join(root, 'src/modules/knowledge-base/knowledge-document-pipeline.service.js'), 'utf8');
  const seed = fs.readFileSync(path.join(root, 'prisma/seed.js'), 'utf8');
  const seedAsset = fs.readFileSync(path.join(root, 'prisma/seed-assets/408-public-knowledge.md'), 'utf8');
  const seedKnowledgeSource = seed.slice(
    seed.indexOf('async function seedPublicKnowledgeSource'),
    seed.indexOf('async function upsertUser'),
  );
  assert.match(knowledgeBase, /knowledgeStorage\.storeUpload/);
  assert.match(pipeline, /knowledgeStorage\.materializeDocument/);
  assert.match(pipeline, /ensureSystemFileAgents/);
  assert.match(seed, /taskType: 'KNOWLEDGE_INDEXING'/);
  assert.match(seedKnowledgeSource, /parse_status: 'UPLOADED'/);
  assert.doesNotMatch(seedKnowledgeSource, /parse_status: 'EMBEDDED'/);
  assert.ok(seedAsset.length > 1000);
});
