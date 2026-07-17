#!/usr/bin/env node
// Diagnose Dify Agent connectivity from the DisciMind backend.
// Usage:
//   node scripts/diagnose-dify-agents.js
//   node scripts/diagnose-dify-agents.js --agent explainer

const path = require('path');
const dotenv = require('dotenv');
const http = require('http');

// ---------- Parse CLI args ----------
const args = process.argv.slice(2);
const targetAgent = args.includes('--agent')
  ? args[args.indexOf('--agent') + 1] || null
  : null;

// ---------- Main (async IIFE for CommonJS) ----------
(async function main() {

// ---------- Load env the same way as the app ----------
const cwd = process.cwd();
let envPath = path.resolve(__dirname, '../.env');
if (!require('fs').existsSync(envPath)) {
  envPath = path.resolve(__dirname, '../../backend/.env');
}

console.log('==========================================');
console.log('  Dify Agent Diagnostics');
console.log('==========================================');
console.log('');
console.log('Runtime:');
console.log(`  platform: ${process.platform}`);
console.log(`  cwd: ${cwd}`);
console.log(`  env file: ${envPath}`);
console.log(`  env exists: ${require('fs').existsSync(envPath)}`);

// Load env
dotenv.config({ path: envPath, quiet: true });
dotenv.config({ quiet: true });
console.log(`  env loaded: yes`);
console.log('');

// ---------- Test basic HTTP reachability ----------
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get(u, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: data.slice(0, 200) }));
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ---------- Safe env read ----------
function safeConfig(prefix) {
  const baseURL = String(process.env[`${prefix}_BASE_URL`] || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env[`${prefix}_API_KEY`] || '').trim();
  const enabled = String(process.env[`${prefix}_ENABLED`] || 'true').trim().toLowerCase() === 'true';

  if (!apiKey) return { configured: false, enabled, baseURL, reason: 'API Key missing' };
  if (!baseURL) return { configured: false, enabled, baseURL, reason: 'Base URL missing' };

  const hasQuotes = apiKey.startsWith('"') || apiKey.startsWith("'");
  const hasNewline = apiKey.includes('\n') || apiKey.includes('\r');
  const trimChanged = process.env[`${prefix}_API_KEY`] !== apiKey;

  return {
    configured: true,
    enabled,
    baseURL,
    hasQuotes,
    hasNewline,
    trimChanged,
  };
}

// ---------- Test network ----------
console.log('Network:');
try {
  const result = await httpGet('http://localhost/');
  console.log(`  http://localhost reachable: yes (HTTP ${result.status})`);
  console.log(`  HTTP gateway status: reachable`);
} catch (err) {
  console.log(`  http://localhost reachable: no (${err.message})`);
  console.log(`  HTTP gateway status: unreachable`);
}
console.log('');

// ---------- Agent definitions ----------
const AGENTS = {
  explainer: {
    label: '讲解者 (Explainer)',
    type: 'Chatflow',
    prefix: 'DIFY_EXPLAINER',
    endpoint: '/chat-messages',
    buildBody(config) {
      return {
        inputs: {
          request_id: 'diag_explainer_' + Date.now(),
          knowledge_point_id: '1',
          knowledge_point_name: '诊断测试知识点',
          student_profile_summary: '{}',
          strategy_hint: 'direct',
          exposure_level: 'unknown',
          understanding_depth: 'unknown',
          learning_style: 'unknown',
          detected_misconceptions: '[]',
          interest_tags: '[]',
          knowledge_context_override: '',
        },
        query: '你好，这是一次诊断连通性测试。请简短回复。',
        response_mode: 'streaming',
        user: `${config.userPrefix || 'discimind-explainer'}-diag-test`,
      };
    },
    validateResponse(res, body) {
      const ct = res.headers['content-type'] || '';
      if (!ct.includes('text/event-stream')) {
        return { pass: false, reason: `Content-Type 不是 text/event-stream，实际: ${ct}`, phase: 'sse_validation' };
      }
      // Check for SSE events
      const hasStart = body.includes('event:') || body.includes('data:');
      return { pass: hasStart, reason: hasStart ? null : '未收到 SSE 事件', phase: hasStart ? 'sse_received' : 'sse_validation' };
    },
  },
  trainer: {
    label: '训练师 (Trainer)',
    type: 'Workflow',
    prefix: 'DIFY_TRAINER',
    endpoint: '/workflows/run',
    buildBody(config) {
      return {
        inputs: {
          mode: 'adaptive_training',
          request_id: 'diag_trainer_' + Date.now(),
          payload: {
            student_id: 'diag_test',
            course_id: '1',
            knowledge_point_id: '1',
            question_count: 1,
            difficulty_preference: 'medium',
          },
          locale: 'zh-CN',
          debug: false,
        },
        response_mode: 'blocking',
        user: `${config.userPrefix || 'discimind-user'}-diag-test`,
      };
    },
    validateResponse(res, body) {
      try {
        const data = JSON.parse(body);
        if (data.data?.status === 'succeeded') return { pass: true, phase: 'workflow_succeeded' };
        if (data.data?.error) return { pass: false, reason: JSON.stringify(data.data.error).slice(0, 200), phase: 'workflow_error' };
        return { pass: true, reason: 'Workflow 返回了非标准成功状态但无错误', phase: 'workflow_completed' };
      } catch {
        return { pass: false, reason: '响应不是有效 JSON', phase: 'response_parse' };
      }
    },
  },
  diagnostician: {
    label: '诊断师 (Diagnostician)',
    type: 'Workflow',
    prefix: 'DIFY_DIAGNOSTICIAN',
    endpoint: '/workflows/run',
    buildBody(config) {
      return {
        inputs: {
          mode: 'mental_model',
          request_id: 'diag_diag_' + Date.now(),
          payload: {
            student_id: 'diag_test',
            course_id: '1',
            knowledge_point_id: '1',
            preprocessed_data: { test: true },
          },
          locale: 'zh-CN',
          debug: false,
        },
        response_mode: 'blocking',
        user: `${config.userPrefix || 'discimind-diagnostician'}-diag-test`,
      };
    },
    validateResponse(res, body) {
      try {
        const data = JSON.parse(body);
        if (data.data?.status === 'succeeded') return { pass: true, phase: 'workflow_succeeded' };
        if (data.data?.error) return { pass: false, reason: JSON.stringify(data.data.error).slice(0, 200), phase: 'workflow_error' };
        return { pass: true, reason: 'Workflow 返回了非标准成功状态但无错误', phase: 'workflow_completed' };
      } catch {
        return { pass: false, reason: '响应不是有效 JSON', phase: 'response_parse' };
      }
    },
  },
};

// ---------- Run tests ----------
const agentsToTest = targetAgent
  ? Object.entries(AGENTS).filter(([key]) => key === targetAgent)
  : Object.entries(AGENTS);

if (targetAgent && agentsToTest.length === 0) {
  console.log(`ERROR: Unknown agent "${targetAgent}". Valid: explainer, trainer, diagnostician`);
  process.exit(1);
}

let allPassed = true;
let tested = 0;

for (const [agentKey, agentDef] of agentsToTest) {
  tested++;
  const config = safeConfig(agentDef.prefix);

  console.log(`${agentDef.label}:`);
  console.log(`  Type: ${agentDef.type}`);
  console.log(`  Enabled: ${config.enabled}`);
  console.log(`  Base URL: ${config.baseURL || 'MISSING'}`);
  console.log(`  Endpoint: ${agentDef.endpoint}`);
  console.log(`  API Key configured: ${config.configured}`);

  if (!config.configured) {
    console.log(`  Result: SKIP (${config.reason})`);
    console.log('');
    continue;
  }

  if (config.hasQuotes) console.log(`  WARNING: Key contains quote characters!`);
  if (config.hasNewline) console.log(`  WARNING: Key contains newline characters!`);
  if (config.trimChanged) console.log(`  WARNING: Key changed after trim (had whitespace)`);

  // Make the actual HTTP request
  const fullUrl = `${config.baseURL}${agentDef.endpoint}`;
  console.log(`  Request: POST ${fullUrl}`);
  console.log(`  Auth header configured: yes`);

  try {
    const body = agentDef.buildBody(config);
    const bodyJson = JSON.stringify(body);
    const urlObj = new URL(fullUrl);

    const httpResult = await new Promise((resolve, reject) => {
      const postData = bodyJson;
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 80,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env[`${agentDef.prefix}_API_KEY`]}`,
          'Content-Length': Buffer.byteLength(postData),
          'Accept': agentDef.type === 'Chatflow' ? 'text/event-stream' : 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const resBody = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, body: resBody });
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(postData);
      req.end();
    });

    console.log(`  HTTP status: ${httpResult.status}`);
    console.log(`  Content-Type: ${httpResult.headers['content-type'] || 'N/A'}`);

    if (httpResult.status === 200 || httpResult.status === 201) {
      const validation = agentDef.validateResponse(httpResult, httpResult.body);
      if (validation.pass) {
        console.log(`  Authentication: success`);
        console.log(`  Phase reached: ${validation.phase}`);
        console.log(`  Result: PASS`);
      } else {
        console.log(`  Authentication: success (HTTP OK)`);
        console.log(`  Response validation: FAILED`);
        console.log(`  Reason: ${validation.reason}`);
        console.log(`  Phase: ${validation.phase}`);
        console.log(`  Result: FAIL (response validation)`);
        allPassed = false;
      }
    } else if (httpResult.status === 401 || httpResult.status === 403) {
      console.log(`  Authentication: failed`);
      console.log(`  Error source: Dify upstream`);
      console.log(`  Likely causes:`);
      console.log(`    - Wrong ${agentDef.label} application key`);
      console.log(`    - Stale environment value`);
      console.log(`    - Key overridden by another environment source`);
      console.log(`    - Wrong Authorization header`);
      console.log(`  Result: FAIL (authentication)`);
      allPassed = false;
    } else if (httpResult.status === 404) {
      console.log(`  Authentication: success (HTTP ${httpResult.status} means auth passed)`);
      console.log(`  Error: endpoint not found (check if ${agentDef.type} type matches: ${agentDef.endpoint})`);
      console.log(`  Result: FAIL (endpoint)`);
      allPassed = false;
    } else {
      console.log(`  Authentication: success (non-401 response)`);
      console.log(`  Result: FAIL (HTTP ${httpResult.status})`);
      allPassed = false;
    }
  } catch (err) {
    console.log(`  Error: ${err.message}`);
    console.log(`  Error source: network`);
    if (err.code === 'ECONNREFUSED') {
      console.log(`  Likely causes: Dify Docker not running or wrong port`);
    } else if (err.message === 'timeout') {
      console.log(`  Likely causes: Dify too slow to respond or network issue`);
    }
    console.log(`  Result: FAIL (network)`);
    allPassed = false;
  }

  console.log('');
}

// ---------- Summary ----------
console.log('==========================================');
if (allPassed && tested > 0) {
  console.log('  OVERALL: ALL PASSED');
  console.log('==========================================');
  process.exit(0);
} else if (tested === 0) {
  console.log('  OVERALL: NO AGENTS TESTED');
  console.log('==========================================');
  process.exit(1);
} else {
  console.log('  OVERALL: SOME TESTS FAILED');
  console.log('==========================================');
  process.exit(1);
}

})();
