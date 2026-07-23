const test = require('node:test');
const assert = require('node:assert/strict');
const { productionEnvErrors, validateProductionEnv } = require('../src/config/env');

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(32),
    CORS_ORIGIN: 'https://app.example.com',
    REFRESH_TOKEN_COOKIE_SECURE: 'true',
    AI_CONFIG_DB_ENABLED: 'false',
    KNOWLEDGE_STORAGE_DRIVER: 'local',
    KNOWLEDGE_VECTOR_STORE: 'database',
    ...overrides,
  };
}

test('production environment accepts local knowledge compatibility mode', () => {
  assert.deepEqual(productionEnvErrors(productionEnv()), []);
  assert.doesNotThrow(() => validateProductionEnv(productionEnv()));
});

test('production environment rejects unsupported knowledge drivers', () => {
  const errors = productionEnvErrors(productionEnv({
    KNOWLEDGE_STORAGE_DRIVER: 's3',
    KNOWLEDGE_VECTOR_STORE: 'pinecone',
  }));
  assert.ok(errors.includes('KNOWLEDGE_STORAGE_DRIVER 仅支持 local 或 oss'));
  assert.ok(errors.includes('KNOWLEDGE_VECTOR_STORE 仅支持 database 或 qdrant'));
});

test('production environment requires complete OSS configuration', () => {
  const errors = productionEnvErrors(productionEnv({ KNOWLEDGE_STORAGE_DRIVER: 'oss' }));
  assert.ok(errors.includes('KNOWLEDGE_OSS_BUCKET 不能为空'));
  assert.ok(errors.includes('KNOWLEDGE_OSS_ACCESS_KEY_ID 不能为空'));
  assert.ok(errors.includes('KNOWLEDGE_OSS_ACCESS_KEY_SECRET 不能为空'));
  assert.ok(errors.includes('KNOWLEDGE_OSS_REGION 与 KNOWLEDGE_OSS_ENDPOINT 至少填写一项'));

  assert.deepEqual(productionEnvErrors(productionEnv({
    KNOWLEDGE_STORAGE_DRIVER: 'oss',
    KNOWLEDGE_OSS_REGION: 'oss-cn-hangzhou',
    KNOWLEDGE_OSS_BUCKET: 'discimind-test',
    KNOWLEDGE_OSS_ACCESS_KEY_ID: 'test-access-key-id',
    KNOWLEDGE_OSS_ACCESS_KEY_SECRET: 'test-access-key-secret',
  })), []);
});

test('production environment requires Qdrant and embedding configuration', () => {
  const errors = productionEnvErrors(productionEnv({ KNOWLEDGE_VECTOR_STORE: 'qdrant' }));
  assert.ok(errors.includes('QDRANT_URL 不能为空'));
  assert.ok(errors.includes('QDRANT_COLLECTION 不能为空'));
  assert.ok(errors.includes('Qdrant 知识库必须配置 KNOWLEDGE_EMBEDDING_API_KEY 或 BAILIAN_API_KEY'));

  assert.deepEqual(productionEnvErrors(productionEnv({
    KNOWLEDGE_VECTOR_STORE: 'qdrant',
    QDRANT_URL: 'http://127.0.0.1:6333',
    QDRANT_COLLECTION: 'discimind_knowledge',
    BAILIAN_API_KEY: 'test-bailian-key',
  })), []);
});

test('knowledge cloud validation is production-only', () => {
  assert.deepEqual(productionEnvErrors({
    NODE_ENV: 'test',
    KNOWLEDGE_STORAGE_DRIVER: 'invalid',
    KNOWLEDGE_VECTOR_STORE: 'invalid',
  }), []);
});
