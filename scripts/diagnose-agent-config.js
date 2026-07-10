// Agent 配置诊断 — 仅开发环境使用
// 用法: node scripts/diagnose-agent-config.js [explainer|diagnostician|all]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');

const AGENTS = {
  explainer: {
    prefix: 'DIFY_EXPLAINER',
    endpoint: '/chat-messages',
    label: 'Explainer (讲解者)',
  },
  diagnostician: {
    prefix: 'DIFY_DIAGNOSTICIAN',
    endpoint: '/workflows/run',
    label: 'Diagnostician (诊断师)',
  },
};

function maskKey(key) {
  if (!key) return 'NOT SET';
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

async function diagnoseAgent(agentKey) {
  const agent = AGENTS[agentKey];
  if (!agent) { console.log(`未知 Agent: ${agentKey}`); return; }

  const prefix = agent.prefix;
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  const appId = process.env[`${prefix}_APP_ID`] || process.env[`${prefix}_WORKFLOW_ID`];

  console.log(`\n=== ${agent.label} 诊断 ===`);
  console.log(`Base URL: ${baseUrl || 'NOT SET'}`);
  console.log(`API Key: ${maskKey(apiKey)}`);
  console.log(`App/Workflow ID: ${appId || 'NOT SET'}`);

  if (!baseUrl) { console.log('[FAIL] Base URL 未配置'); return; }
  if (!apiKey) { console.log('[FAIL] API Key 未配置'); return; }

  // 检查 Base URL 可达性
  try {
    const healthUrl = baseUrl.replace(/\/+$/, '') + '/';
    const response = await axios.get(healthUrl, { timeout: 5000, validateStatus: () => true });
    console.log(`Endpoint reachable: yes (HTTP ${response.status})`);
  } catch (e) {
    console.log(`Endpoint reachable: no (${e.code || e.message})`);
    return;
  }

  // 检查 API 路径
  const apiUrl = baseUrl.replace(/\/+$/, '') + agent.endpoint;
  console.log(`Dify API URL: ${apiUrl}`);

  // 测试鉴权
  try {
    const testBody = agentKey === 'explainer'
      ? { inputs: {}, query: 'ping', response_mode: 'streaming', user: 'discimind-diag-explainer-0' }
      : { inputs: { test: true }, response_mode: 'blocking', user: 'discimind-diag-diagnostician-0' };

    const authResp = await axios.post(apiUrl, testBody, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true,
    });

    if (authResp.status === 200 || authResp.status === 201) {
      console.log(`Authentication: success (HTTP ${authResp.status})`);
      // 检查流式响应
      if (agentKey === 'explainer') {
        const ct = authResp.headers['content-type'] || '';
        console.log(`Content-Type: ${ct}`);
        console.log(`Streaming response: ${ct.includes('text/event-stream') || ct.includes('stream') ? 'success' : 'unexpected: ' + ct}`);
      } else {
        console.log(`Response received: success`);
      }
    } else if (authResp.status === 401) {
      console.log(`Authentication: failed (HTTP 401 - API Key 无效)`);
    } else if (authResp.status === 404) {
      console.log(`Authentication: failed (HTTP 404 - 端点或应用不存在)`);
    } else {
      console.log(`Authentication: failed (HTTP ${authResp.status})`);
      const data = authResp.data;
      if (typeof data === 'object') {
        console.log(`Response: ${JSON.stringify(data).slice(0, 300)}`);
      }
    }
  } catch (e) {
    console.log(`Dify API check failed: ${e.code || e.message}`);
  }
}

async function main() {
  const target = process.argv[2] || 'all';
  console.log('DisciMind Agent Configuration Diagnostic');
  console.log('========================================');

  if (target === 'all' || target === 'explainer') await diagnoseAgent('explainer');
  if (target === 'all' || target === 'diagnostician') await diagnoseAgent('diagnostician');

  console.log('\n诊断完成。');
}

main().catch(console.error);
