#!/usr/bin/env node

/**
 * 诊断师 (Diagnostician) 真实 Dify 冒烟测试
 *
 * 用法：
 *   RUN_DIFY_SMOKE=true node scripts/smoke-diagnostician.js
 *
 * 可通过环境变量覆盖测试参数：
 *   DISCIMIND_BASE_URL   — 后端地址，默认 http://localhost:3000
 *   SMOKE_STUDENT_USERNAME — 测试学生用户名（必填）
 *   SMOKE_STUDENT_PASSWORD — 测试学生密码（必填）
 *   SMOKE_KNOWLEDGE_POINT_ID — 知识点 ID，默认 1
 *   SMOKE_SESSION_ID         — 会话 ID（strategy_intervention 使用），默认 1
 *   SMOKE_REPORT_FROM         — 报告起始日期，默认 2026-07-01
 *   SMOKE_REPORT_TO           — 报告结束日期，默认 2026-07-09
 */

const path = require('path');

// ---------- 加载 backend/.env ----------
const backendDotEnv = path.resolve(__dirname, '../backend/.env');
try {
  require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: backendDotEnv });
} catch {
  // Fallback: dotenv might be in a different location or already loaded
  try { require('dotenv').config({ path: backendDotEnv }); } catch { /* ignore */ }
}

const BASE_URL = (process.env.DISCIMIND_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const API_BASE = `${BASE_URL}/api`;
const ENABLED = process.env.RUN_DIFY_SMOKE === 'true';

const STUDENT_USERNAME = process.env.SMOKE_STUDENT_USERNAME;
const STUDENT_PASSWORD = process.env.SMOKE_STUDENT_PASSWORD;
if (ENABLED && (!STUDENT_USERNAME || !STUDENT_PASSWORD)) throw new Error('SMOKE_STUDENT_USERNAME and SMOKE_STUDENT_PASSWORD are required');
const KNOWLEDGE_POINT_ID = Number(process.env.SMOKE_KNOWLEDGE_POINT_ID || 1);
const SESSION_ID = process.env.SMOKE_SESSION_ID ? Number(process.env.SMOKE_SESSION_ID) : 1;
const REPORT_FROM = process.env.SMOKE_REPORT_FROM || '2026-07-01';
const REPORT_TO = process.env.SMOKE_REPORT_TO || '2026-07-09';

const TESTS = [
  { mode: 'mental_model', label: '心智建模', payload: { knowledgePointId: KNOWLEDGE_POINT_ID } },
  {
    mode: 'strategy_intervention',
    label: '策略干预',
    payload: { knowledgePointId: KNOWLEDGE_POINT_ID, sessionId: SESSION_ID },
  },
  {
    mode: 'growth_report',
    label: '成长报告',
    payload: { knowledgePointId: KNOWLEDGE_POINT_ID, reportPeriod: { from: REPORT_FROM, to: REPORT_TO } },
  },
];

const ERROR_TESTS = [
  {
    label: '缺失 student_id (学生自调用)',
    payload: {},
    expectedStatus: 400,
    expectedCodeContains: 'INVALID',
  },
  {
    label: '非法 mode',
    payload: { mode: 'invalid_mode', knowledgePointId: 1 },
    expectedStatus: 400,
    expectedCodeContains: 'INVALID_MODE',
  },
  {
    label: 'growth_report 缺失 reportPeriod',
    payload: { mode: 'growth_report' },
    expectedStatus: 400,
    expectedCodeContains: 'INVALID',
  },
];

let accessToken = null;

// ---------- helpers ----------

function redact(value) {
  if (value == null) return value;
  const s = String(value);
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '***' + s.slice(-4);
}

async function fetchJson(url, options = {}) {
  const mergedHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    ...options,
    headers: mergedHeaders,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 500) };
  }
  return { status: response.status, body };
}

function checkEnv() {
  const keys = [
    'DIFY_DIAGNOSTICIAN_ENABLED',
    'DIFY_DIAGNOSTICIAN_BASE_URL',
    'DIFY_DIAGNOSTICIAN_API_KEY',
  ];
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ 缺少环境变量: ${missing.join(', ')}`);
    return false;
  }
  console.log('✅ 诊断师环境变量已配置（Key 内容已脱敏）');
  console.log(`   BASE_URL: ${process.env.DIFY_DIAGNOSTICIAN_BASE_URL}`);
  console.log(`   API_KEY: ${redact(process.env.DIFY_DIAGNOSTICIAN_API_KEY)}`);
  console.log(`   ENABLED: ${process.env.DIFY_DIAGNOSTICIAN_ENABLED}`);
  return true;
}

async function login() {
  console.log(`\n🔑 登录 ${STUDENT_USERNAME} ...`);
  const { status, body } = await fetchJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ account: STUDENT_USERNAME, password: STUDENT_PASSWORD }),
  });
  if (status !== 200 || !body.data?.accessToken) {
    throw new Error(`登录失败: HTTP ${status}, ${JSON.stringify(body).slice(0, 200)}`);
  }
  accessToken = body.data.accessToken;
  console.log(`✅ 登录成功，获取到 JWT Token`);
  return accessToken;
}

async function runAnalyze(mode, extraPayload = {}, label = mode) {
  const startTime = Date.now();
  const payload = { mode, ...extraPayload };

  console.log(`\n--- ${label} (${mode}) ---`);
  console.log(`   请求: ${JSON.stringify({ mode, ...extraPayload })}`);

  const { status, body } = await fetchJson(`${API_BASE}/agent/diagnostician/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - startTime;

  console.log(`   HTTP ${status} | code=${body.code} | ${elapsed}ms`);
  console.log(`   响应概要: ${JSON.stringify({
    code: body.code,
    message: body.message,
    hasData: body.data != null,
    dataMode: body.data?.mode,
    dataRequestId: body.data?.requestId,
    hasResult: body.data?.result != null,
    interventionCount: body.data?.interventions?.length,
    diagnosticReportId: body.data?.diagnosticReportId,
  })}`);

  if (body.data?.result) {
    const r = body.data.result;
    if (mode === 'mental_model') {
      const m = r.mental_model_summary;
      console.log(`   mental_model_summary: ${m ? '✅' : '❌ 缺失'}`);
      if (m) {
        console.log(`     mastery_level: ${m.mastery_level} (0-100: ${m.mastery_level >= 0 && m.mastery_level <= 100 ? '✅' : '⚠️ 超出范围'})`);
        console.log(`     confidence_level: ${m.confidence_level}`);
        console.log(`     analogy_responsiveness: ${m.analogy_responsiveness} (0-1: ${m.analogy_responsiveness >= 0 && m.analogy_responsiveness <= 1 ? '✅' : '⚠️'})`);
        console.log(`     detected_misconceptions: ${Array.isArray(m.detected_misconceptions) ? `✅ ${m.detected_misconceptions.length} 条` : '⚠️'}`);
        console.log(`     recommended_strategies: ${Array.isArray(m.recommended_strategies) ? `✅ ${m.recommended_strategies.length} 条` : '⚠️'}`);
        console.log(`     cognitive_speed: ${m.cognitive_speed}`);
      }
    } else if (mode === 'strategy_intervention') {
      console.log(`   target_agent: ${r.target_agent || '⚠️ 缺失'}`);
      console.log(`   instruction.action: ${r.instruction?.action || '⚠️ 缺失'}`);
      console.log(`   parallel_instruction_to_explainer: ${r.parallel_instruction_to_explainer ? '✅' : '⚠️ 缺失'}`);
      console.log(`   all_interventions: ${Array.isArray(r.all_interventions) ? `✅ ${r.all_interventions.length} 条` : '⚠️'}`);
    } else if (mode === 'growth_report') {
      console.log(`   knowledge_growth: ${Array.isArray(r.knowledge_growth) ? `✅ ${r.knowledge_growth.length} 条` : '⚠️'}`);
      console.log(`   error_evolution: ${r.error_evolution && typeof r.error_evolution === 'object' ? '✅' : '⚠️'}`);
      console.log(`   effective_strategies: ${Array.isArray(r.effective_strategies) ? `✅ ${r.effective_strategies.length} 条` : '⚠️'}`);
      console.log(`   narrative_summary: ${r.narrative_summary ? '✅' : '⚠️ 缺失'}`);
      console.log(`   next_actions: ${Array.isArray(r.next_actions) ? `✅ ${r.next_actions.length} 条` : '⚠️'}`);
      console.log(`   data_quality: ${r.data_quality ? '✅' : '⚠️ 缺失'}`);
    }
  }

  const passed = status === 200 && body.code === 0 && body.data?.result != null;
  console.log(`   ${passed ? '✅ 通过' : '❌ 失败'}`);

  return {
    mode,
    label,
    status,
    code: body.code,
    message: body.message,
    elapsed,
    passed,
    data: body.data,
  };
}

async function runErrorTest(label, payload, expectedStatus, expectedCodeContains) {
  console.log(`\n--- 错误分支: ${label} ---`);
  console.log(`   请求: ${JSON.stringify(payload)}`);

  const { status, body } = await fetchJson(`${API_BASE}/agent/diagnostician/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });

  const codeOk = !expectedStatus || status === expectedStatus;
  const codeStr = String(body.code || '');
  const containsOk = !expectedCodeContains || codeStr.includes(expectedCodeContains);
  const passed = codeOk && containsOk;

  console.log(`   HTTP ${status} | code=${body.code} | message="${body.message}"`);
  console.log(`   期望 HTTP ${expectedStatus}, code 包含 "${expectedCodeContains}" → ${passed ? '✅ 通过' : '❌ 失败'}`);

  // 检查是否泄露敏感信息
  const bodyStr = JSON.stringify(body);
  const apiKey = process.env.DIFY_DIAGNOSTICIAN_API_KEY || '';
  if (apiKey && bodyStr.includes(apiKey)) {
    console.log(`   🔴 严重：响应中泄露了 API Key！`);
    return { label, status, code: body.code, passed: false, leaked: true };
  }

  return { label, status, code: body.code, message: body.message, passed };
}

// ---------- main ----------

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  诊断师 (Diagnostician) 冒烟测试');
  console.log('═══════════════════════════════════════════');
  console.log(`  后端: ${BASE_URL}`);
  console.log(`  用户: ${STUDENT_USERNAME}`);
  console.log(`  知识点 ID: ${KNOWLEDGE_POINT_ID}`);
  console.log(`  会话 ID: ${SESSION_ID}`);
  console.log('');

  if (!ENABLED) {
    console.log('⏭️  跳过: 设置 RUN_DIFY_SMOKE=true 才会执行真实 Dify 调用。');
    console.log('   如需运行，请执行:');
    console.log('   RUN_DIFY_SMOKE=true node scripts/smoke-diagnostician.js');
    return;
  }

  // 1. 检查环境变量
  if (!checkEnv()) {
    process.exit(1);
  }

  // 2. 检查后端是否在线
  try {
    const { status } = await fetchJson(`${API_BASE}/health`);
    if (status !== 200) throw new Error(`后端健康检查失败: HTTP ${status}`);
    console.log('✅ 后端服务可达');
  } catch (err) {
    console.error(`❌ 后端服务不可达: ${err.message}`);
    process.exit(1);
  }

  // 3. 登录
  try {
    await login();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  // 4. 运行三种模式测试
  const results = [];
  for (const test of TESTS) {
    const result = await runAnalyze(test.mode, test.payload, test.label);
    results.push(result);
  }

  // 5. 运行错误分支测试
  const errorResults = [];
  for (const test of ERROR_TESTS) {
    const result = await runErrorTest(test.label, test.payload, test.expectedStatus, test.expectedCodeContains);
    errorResults.push(result);
  }

  // 6. 汇总
  console.log('\n═══════════════════════════════════════════');
  console.log('  测试汇总');
  console.log('═══════════════════════════════════════════');

  const allPassed = [...results, ...errorResults].every((r) => r.passed);
  const leaked = errorResults.some((r) => r.leaked);

  console.log('');
  console.log('业务模式测试:');
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.label} (${r.mode}): HTTP ${r.status}, code=${r.code}, ${r.elapsed}ms`);
  }

  console.log('');
  console.log('错误分支测试:');
  for (const r of errorResults) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.label}: HTTP ${r.status}, code=${r.code}`);
  }

  console.log('');
  if (leaked) {
    console.log('🔴 检测到 API Key 泄露！');
  }
  if (allPassed && !leaked) {
    console.log('✅ 所有测试通过');
  } else {
    console.log('❌ 存在失败测试');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n💥 脚本异常: ${err.message}`);
  process.exit(1);
});
