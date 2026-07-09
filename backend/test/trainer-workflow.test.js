const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const trainerRoutes = require('../src/modules/dify/trainer.routes');
const { validateTrainerRunInput } = require('../src/modules/dify/trainer.validator');
const {
  buildDifyUser,
  parseMaybeJson,
  runTrainerWorkflow,
} = require('../src/modules/dify/trainer-workflow.service');

const TRAINER_ENV_KEYS = [
  'DIFY_TRAINER_BASE_URL',
  'DIFY_TRAINER_API_KEY',
  'DIFY_TRAINER_TIMEOUT_MS',
  'DIFY_TRAINER_MAX_RETRIES',
  'DIFY_TRAINER_USER_PREFIX',
  'DIFY_TRAINER_DEBUG',
  'NODE_ENV',
];

const DEFAULT_TRAINER_ENV = {
  DIFY_TRAINER_BASE_URL: 'http://localhost/v1',
  DIFY_TRAINER_API_KEY: 'placeholder',
  DIFY_TRAINER_TIMEOUT_MS: '120000',
  DIFY_TRAINER_MAX_RETRIES: '0',
  DIFY_TRAINER_USER_PREFIX: 'discimind-user',
  DIFY_TRAINER_DEBUG: 'false',
  NODE_ENV: 'test',
};

async function withTrainerEnv(overrides, fn) {
  const previous = new Map();
  TRAINER_ENV_KEYS.forEach((key) => previous.set(key, process.env[key]));
  Object.entries({ ...DEFAULT_TRAINER_ENV, ...overrides }).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });

  try {
    return await fn();
  } finally {
    TRAINER_ENV_KEYS.forEach((key) => {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

function difyResponse(result, dataOverrides = {}) {
  return {
    data: {
      task_id: 'task_001',
      workflow_run_id: 'workflow_run_001',
      data: {
        id: 'data_001',
        status: 'succeeded',
        outputs: { result },
        error: null,
        elapsed_time: 1.2,
        total_tokens: 2000,
        ...dataOverrides,
      },
    },
  };
}

function axiosError({ status, code, message = 'upstream error', responseData = {} } = {}) {
  const err = new Error(message);
  if (code) err.code = code;
  if (status) {
    err.response = {
      status,
      data: responseData,
    };
  }
  err.config = {
    headers: {
      Authorization: 'Bearer should-not-leak',
    },
  };
  return err;
}

function createClient(handler) {
  const calls = [];
  return {
    calls,
    async post(path, body) {
      calls.push({ path, body });
      return handler(calls.length, path, body);
    },
  };
}

async function callServiceWithResult(result, mode = 'diagnostic_pre_test') {
  return withTrainerEnv({}, async () => {
    const client = createClient(() => difyResponse(result));
    return runTrainerWorkflow({
      mode,
      requestId: `req_${mode}`,
      payload: {},
      locale: 'zh-CN',
      debug: false,
      difyUser: buildDifyUser(42),
    }, { client });
  });
}

test('validator rejects invalid mode and invalid payload shapes', () => {
  assert.throws(
    () => validateTrainerRunInput({ mode: 'unknown', payload: {} }),
    (err) => err.code === 'INVALID_MODE',
  );
  assert.throws(
    () => validateTrainerRunInput({ mode: 'diagnostic_pre_test', payload: null }),
    (err) => err.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateTrainerRunInput({ mode: 'diagnostic_pre_test', payload: [] }),
    (err) => err.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateTrainerRunInput({ mode: 'diagnostic_pre_test', payload: 'bad' }),
    (err) => err.code === 'INVALID_INPUT',
  );
});

test('service succeeds for diagnostic_pre_test and preserves questions as objects', async () => {
  const businessResult = {
    success: true,
    request_id: 'req_diag',
    mode: 'diagnostic_pre_test',
    error: {},
    result: {
      question_count: 1,
      questions: [
        {
          question_key: 'q1',
          type: 'single_choice',
          stem: '题干',
          options: [
            { key: 'A', content: 'A', is_correct: false },
            { key: 'B', content: 'B', is_correct: true },
          ],
        },
      ],
    },
  };

  const { businessResult: actual } = await callServiceWithResult(businessResult);

  assert.equal(actual.success, true);
  assert.equal(actual.mode, 'diagnostic_pre_test');
  assert.equal(Array.isArray(actual.result.questions), true);
  assert.equal(typeof actual.result.questions[0], 'object');
  assert.equal(typeof actual.result.questions[0].options[0], 'object');
});

test('service succeeds for adaptive_training and preserves next_question object', async () => {
  const businessResult = {
    success: true,
    request_id: 'req_adaptive',
    mode: 'adaptive_training',
    error: {},
    result: {
      decision: { action: 'remediate' },
      next_question: { question_key: 'q2', adaptive_action: 'remediate' },
      session_progress: { step: 2 },
    },
  };

  const { businessResult: actual } = await callServiceWithResult(businessResult, 'adaptive_training');

  assert.equal(actual.mode, 'adaptive_training');
  assert.equal(typeof actual.result.decision, 'object');
  assert.equal(typeof actual.result.next_question, 'object');
  assert.equal(actual.result.next_question.adaptive_action, actual.result.decision.action);
});

test('service succeeds for deep_evaluation and preserves analysis objects', async () => {
  const businessResult = {
    success: true,
    request_id: 'req_eval',
    mode: 'deep_evaluation',
    error: {},
    result: {
      verdict: 'incorrect',
      error_type: 'concept_confusion',
      error_analysis: { misconception: '混淆回归与分类' },
      remediation: { next_step: '复习概率输出' },
      deterministic_result: { is_correct: false },
    },
  };

  const { businessResult: actual } = await callServiceWithResult(businessResult, 'deep_evaluation');

  assert.equal(actual.mode, 'deep_evaluation');
  assert.equal(typeof actual.result.error_analysis, 'object');
  assert.equal(typeof actual.result.remediation, 'object');
  assert.equal(typeof actual.result.deterministic_result, 'object');
});

test('service parses outputs.result when it is a JSON string', async () => {
  const businessResult = {
    success: true,
    request_id: 'req_json_string',
    mode: 'diagnostic_pre_test',
    error: {},
    result: { questions: [] },
  };

  const { businessResult: actual } = await callServiceWithResult(JSON.stringify(businessResult));

  assert.deepEqual(actual, businessResult);
  assert.deepEqual(parseMaybeJson(JSON.stringify({ ok: true })), { ok: true });
});

test('service rejects missing API key before calling Dify', async () => {
  await withTrainerEnv({ DIFY_TRAINER_API_KEY: '' }, async () => {
    const client = createClient(() => difyResponse({ success: true }));

    await assert.rejects(
      () => runTrainerWorkflow({
        mode: 'diagnostic_pre_test',
        requestId: 'req_missing_key',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-user-1',
      }, { client }),
      (err) => err.code === 'TRAINER_CONFIG_ERROR' && err.status === 500,
    );

    assert.equal(client.calls.length, 0);
  });
});

test('service maps Dify 401 and 403 to upstream auth failure', async () => {
  for (const status of [401, 403]) {
    await withTrainerEnv({}, async () => {
      const client = createClient(() => { throw axiosError({ status }); });

      await assert.rejects(
        () => runTrainerWorkflow({
          mode: 'diagnostic_pre_test',
          requestId: `req_${status}`,
          payload: {},
          locale: 'zh-CN',
          debug: false,
          difyUser: 'discimind-user-1',
        }, { client }),
        (err) => err.code === 'TRAINER_UPSTREAM_AUTH_FAILED' && err.status === 502,
      );
    });
  }
});

test('service maps timeout and connection errors safely', async () => {
  await withTrainerEnv({}, async () => {
    const timeoutClient = createClient(() => { throw axiosError({ code: 'ECONNABORTED', message: 'timeout of 10ms exceeded' }); });
    await assert.rejects(
      () => runTrainerWorkflow({
        mode: 'diagnostic_pre_test',
        requestId: 'req_timeout',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-user-1',
      }, { client: timeoutClient }),
      (err) => err.code === 'TRAINER_TIMEOUT' && err.status === 504,
    );

    const refusedClient = createClient(() => { throw axiosError({ code: 'ECONNREFUSED' }); });
    await assert.rejects(
      () => runTrainerWorkflow({
        mode: 'diagnostic_pre_test',
        requestId: 'req_conn',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-user-1',
      }, { client: refusedClient }),
      (err) => err.code === 'TRAINER_UPSTREAM_UNAVAILABLE' && err.status === 502,
    );
  });
});

test('service rejects failed workflow status and missing outputs.result', async () => {
  await withTrainerEnv({}, async () => {
    const failedClient = createClient(() => difyResponse(undefined, {
      status: 'failed',
      outputs: {},
      error: { code: 'workflow_failed', message: 'bad input' },
    }));
    await assert.rejects(
      () => runTrainerWorkflow({
        mode: 'diagnostic_pre_test',
        requestId: 'req_failed',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-user-1',
      }, { client: failedClient }),
      (err) => err.code === 'TRAINER_WORKFLOW_FAILED' && err.status === 502,
    );

    const missingResultClient = createClient(() => difyResponse(undefined, { outputs: {} }));
    await assert.rejects(
      () => runTrainerWorkflow({
        mode: 'diagnostic_pre_test',
        requestId: 'req_missing_result',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-user-1',
      }, { client: missingResultClient }),
      (err) => err.code === 'TRAINER_INVALID_RESPONSE' && err.status === 502,
    );
  });
});

test('service returns workflow success=false as 422 with original business payload', async () => {
  const businessFailure = {
    success: false,
    request_id: 'req_business_failed',
    mode: 'diagnostic_pre_test',
    error: { code: 'INVALID_KNOWLEDGE_POINT', message: '知识点缺失' },
    result: {},
  };

  await withTrainerEnv({}, async () => {
    const client = createClient(() => difyResponse(businessFailure));

    await assert.rejects(
      () => runTrainerWorkflow({
        mode: 'diagnostic_pre_test',
        requestId: 'req_business_failed',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-user-1',
      }, { client }),
      (err) => {
        assert.equal(err.code, 'TRAINER_WORKFLOW_BUSINESS_FAILED');
        assert.equal(err.status, 422);
        assert.deepEqual(err.data, businessFailure);
        return true;
      },
    );
  });
});

test('service retries retryable upstream failures with the same request_id', async () => {
  await withTrainerEnv({ DIFY_TRAINER_MAX_RETRIES: '1' }, async () => {
    const client = createClient((callNo) => {
      if (callNo === 1) throw axiosError({ status: 503 });
      return difyResponse({
        success: true,
        request_id: 'req_retry',
        mode: 'diagnostic_pre_test',
        error: {},
        result: {},
      });
    });

    const { businessResult } = await runTrainerWorkflow({
      mode: 'diagnostic_pre_test',
      requestId: 'req_retry',
      payload: {},
      locale: 'zh-CN',
      debug: false,
      difyUser: 'discimind-user-1',
    }, { client });

    assert.equal(businessResult.request_id, 'req_retry');
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].body.inputs.request_id, 'req_retry');
    assert.equal(client.calls[1].body.inputs.request_id, 'req_retry');
  });
});

test('service mapped errors do not leak API keys or authorization headers', async () => {
  await withTrainerEnv({ DIFY_TRAINER_API_KEY: 'sensitive-marker' }, async () => {
    const client = createClient(() => { throw axiosError({ status: 500 }); });

    await assert.rejects(
      () => runTrainerWorkflow({
        mode: 'diagnostic_pre_test',
        requestId: 'req_no_leak',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-user-1',
      }, { client }),
      (err) => {
        const responsePayload = JSON.stringify({
          code: err.code,
          message: err.message,
          data: err.data,
        });
        assert.equal(responsePayload.includes('sensitive-marker'), false);
        assert.equal(responsePayload.includes('should-not-leak'), false);
        assert.equal(responsePayload.includes('Authorization'), false);
        return true;
      },
    );
  });
});

test('route rejects unauthenticated trainer calls before Dify is invoked', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ai/trainer', trainerRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/ai/trainer/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'diagnostic_pre_test',
        payload: {},
      }),
    });

    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.code, 40101);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
