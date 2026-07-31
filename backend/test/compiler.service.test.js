const test = require('node:test');
const assert = require('node:assert/strict');
const compiler = require('../src/modules/compiler/compiler.service');
const judge0 = require('../src/modules/compiler/judge0.service');

test('compiler normalizes output before sample comparison', () => {
  assert.equal(compiler.normalizeOutput(' 1  \r\n2\n '), '1\n2');
  assert.equal(compiler.verdictFor({ status: 'SUCCESS', stdout: '1\n' }, ' 1 '), 'PASSED');
  assert.equal(compiler.verdictFor({ status: 'TIME_LIMIT_EXCEEDED', stdout: '' }, ''), 'TIME_LIMIT_EXCEEDED');
});

test('compiler status aggregation follows compile, timeout, runtime priority', () => {
  assert.equal(compiler.overallStatus([{ verdict: 'PASSED' }, { verdict: 'WRONG_ANSWER' }]), 1);
  assert.equal(compiler.overallStatus([{ verdict: 'TIME_LIMIT_EXCEEDED' }, { verdict: 'RUNTIME_ERROR' }]), 2);
  assert.equal(compiler.overallStatus([{ verdict: 'COMPILE_ERROR' }, { verdict: 'TIME_LIMIT_EXCEEDED' }]), 0);
});

test('compiler extracts bounded test case formats from question JSON', () => {
  const cases = compiler.extractTestCases({ test_cases: [{ stdin: '1', stdout: '2' }, { input: '3', expected_output: '4' }] });
  assert.deepEqual(cases, [
    { index: 1, input: '1', expectedOutput: '2' },
    { index: 2, input: '3', expectedOutput: '4' },
  ]);
});

test('judge0 uses per-process limits for cgroup v2 compatibility', async () => {
  let requestBody;
  const fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 201,
      json: async () => ({
        stdout: Buffer.from('ok\n').toString('base64'),
        status: { id: 3, description: 'Accepted' },
      }),
    };
  };

  const result = await judge0.executeC(
    { sourceCode: 'int main(void){return 0;}', stdin: '' },
    { fetch, env: { JUDGE0_BASE_URL: 'http://127.0.0.1:2358' } },
  );

  assert.equal(result.status, 'SUCCESS');
  assert.equal(requestBody.enable_per_process_and_thread_time_limit, true);
  assert.equal(requestBody.enable_per_process_and_thread_memory_limit, true);
  assert.equal(requestBody.enable_network, false);
});

test('judge0 submits Python with the configured language id and classifies syntax errors', async () => {
  let requestBody;
  const fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 201,
      json: async () => ({
        stderr: Buffer.from('SyntaxError: invalid syntax\n').toString('base64'),
        status: { id: 11, description: 'Runtime Error (NZEC)' },
      }),
    };
  };

  const result = await judge0.executeCode(
    { language: 'python', sourceCode: 'print(', stdin: '' },
    { fetch, env: { JUDGE0_BASE_URL: 'http://127.0.0.1:2358', JUDGE0_PYTHON_LANGUAGE_ID: '71' } },
  );

  assert.equal(requestBody.language_id, 71);
  assert.equal(result.status, 'COMPILE_ERROR');
  assert.equal(result.statusCode, 0);
});

test('compiler persists the selected language in history records', async () => {
  let saved;
  const db = { compileRecord: { create: async ({ data }) => { saved = data; return { id: 10 }; } } };
  const result = await compiler.run(7, { sourceCode: 'print(42)', stdin: '', language: 'python' }, {
    db,
    execute: async ({ language }) => ({ status: 'SUCCESS', statusCode: 1, stdout: '42\n', compileMessage: '', stderr: '', message: '', language }),
  });

  assert.equal(result.recordId, 10);
  assert.equal(saved.language, 'python');
});

test('compiler does not report history persistence failures as sandbox failures', async () => {
  const databaseError = new Error('database unavailable');
  const db = { compileRecord: { create: async () => { throw databaseError; } } };

  await assert.rejects(
    compiler.run(7, { sourceCode: 'print(42)', stdin: '', language: 'python' }, {
      db,
      execute: async () => ({ status: 'SUCCESS', statusCode: 1, stdout: '42\n', compileMessage: '', stderr: '', message: '' }),
    }),
    databaseError,
  );
});
