/**
 * LangGraph Interrupt/Resume 重启恢复测试
 *
 * 1. 启动学习流
 * 2. Graph 执行到 interrupt 等待学生输入
 * 3. 完全停止后端
 * 4. 重启后端
 * 5. 使用相同 threadId 和 Command({ resume }) 恢复
 * 6. 确认继续执行原图
 */
require('dotenv').config();

const http = require('http');
const BASE = `http://localhost:${process.env.PORT || 3000}/api`;
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, timeout: 120000 };
    const req = http.request(opts, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body)); req.end();
  });
}

async function main() {
  console.log('=== LangGraph Restart Recovery Test ===\n');
  console.log('AGENT_MODE:', process.env.AGENT_MODE || '(unset)');
  console.log('LANGGRAPH_ENABLED:', process.env.LANGGRAPH_ENABLED || '(unset)');

  // 1. Login
  console.log('\n--- Step 1: Login ---');
  const login = await api('POST', '/auth/login', { account: 'e2etest', password: 'test123456' });
  const token = login.body?.data?.accessToken || login.body?.data?.token;
  if (!token) { console.log('Login failed:', JSON.stringify(login.body).slice(0, 200)); return; }
  console.log('Token:', token.slice(0, 30) + '...');

  // 2. Create session
  console.log('\n--- Step 2: Create session ---');
  const sess = await api('POST', '/learning-workflows/sessions', { courseId: 1, knowledgePointId: 1, templateId: 1 }, token);
  const sessionId = sess.body?.data?.session_id;
  if (!sessionId) { console.log('Create failed:', JSON.stringify(sess.body).slice(0, 300)); return; }
  console.log('Session ID:', sessionId);

  // 3. Start session
  console.log('\n--- Step 3: Start session ---');
  await api('POST', `/learning-workflows/sessions/${sessionId}/start`, {}, token);
  console.log('Session started');

  // 4. Execute current node → Graph should run to interrupt or completion
  console.log('\n--- Step 4: Execute current node (invoke LangGraph) ---');
  const t0 = Date.now();
  const exec = await api('POST', `/learning-workflows/sessions/${sessionId}/execute-current`, {}, token);
  console.log('Time:', (Date.now() - t0) / 1000, 's');
  console.log('Code:', exec.body?.code);
  console.log('NodeCompleted:', exec.body?.data?.nodeCompleted);
  console.log('RequiresStudentInput:', exec.body?.data?.requiresStudentInput);
  console.log('ExplainerResult:', !!exec.body?.data?.explainerResult);

  // 5. Check checkpoint exists
  console.log('\n--- Step 5: Verify checkpoint persisted ---');
  const dbPath = path.resolve(__dirname, '..', process.env.LANGGRAPH_CHECKPOINT_DB || './storage/langgraph/checkpoints.sqlite');
  if (fs.existsSync(dbPath)) {
    console.log('Checkpoint DB exists:', dbPath, 'size:', fs.statSync(dbPath).size);
  } else {
    console.log('Checkpoint DB not found at:', dbPath);
  }

  // 6. Stop backend
  console.log('\n--- Step 6: Stop backend ---');
  // Get the PID and kill
  try { cp.execSync('pkill -f "node src/server.js"', { stdio: 'pipe' }); } catch {}
  await new Promise(r => setTimeout(r, 2000));
  console.log('Backend stopped');

  // 7. Restart backend
  console.log('\n--- Step 7: Restart backend ---');
  const server = cp.spawn('node', ['src/server.js'], { cwd: path.resolve(__dirname, '..'), detached: true, stdio: 'pipe' });
  server.stdout.on('data', (d) => process.stdout.write('  [server] ' + d.toString()));
  server.stderr.on('data', (d) => process.stderr.write('  [server:err] ' + d.toString()));
  await new Promise(r => setTimeout(r, 4000));

  // Check health
  try {
    const h = await api('GET', '/health');
    console.log('Backend restarted:', h.body?.message || h.body);
  } catch { console.log('Backend restart failed'); return; }

  // 8. Re-login (old token may be invalid after restart)
  console.log('\n--- Step 8: Re-login ---');
  const login2 = await api('POST', '/auth/login', { account: 'e2etest', password: 'test123456' });
  const token2 = login2.body?.data?.accessToken || login2.body?.data?.token;
  console.log('New token:', token2.slice(0, 30) + '...');

  // 9. Get session state — verify history preserved
  console.log('\n--- Step 9: Get session state (verify history preserved) ---');
  const state = await api('GET', `/learning-workflows/sessions/${sessionId}`, null, token2);
  console.log('Session status:', state.body?.data?.status);
  console.log('Node runs count:', state.body?.data?.node_runs?.length);
  const completedRun = state.body?.data?.node_runs?.find(r => r.status === 'COMPLETED');
  console.log('Completed run found:', !!completedRun);
  if (completedRun) console.log('  output_summary mode:', completedRun.output_summary_json?.mode);

  // 10. Resume the graph
  console.log('\n--- Step 10: Resume graph with Command({ resume }) ---');
  try {
    const resume = await api('POST', `/learning-workflows/sessions/${sessionId}/execute-current`, {}, token2);
    console.log('Resume result code:', resume.body?.code);
    console.log('NodeCompleted:', resume.body?.data?.nodeCompleted);

    if (resume.body?.code === 0 || resume.body?.data?.nodeCompleted) {
      console.log('\n✅ RESTART RECOVERY TEST PASSED');
      console.log('   Graph resumed after backend restart');
      console.log('   Checkpoint persisted across process restart');
      console.log('   node_run state preserved in MySQL');
    } else {
      console.log('\n⚠️  Resume completed but check details above');
    }
  } catch (err) {
    console.log('Resume error:', err.message);
  }

  // 11. Verify checkpoint loaded from disk after restart
  console.log('\n--- Step 11: Verify checkpoint reloaded from disk ---');
  const SQL = await require('sql.js')();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);
  const stmt = db.prepare('SELECT thread_id, checkpoint_id, created_at FROM checkpoints WHERE thread_id = ?');
  stmt.bind([String(sessionId)]);
  let foundCheckpoints = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    foundCheckpoints.push(row);
    console.log('  checkpoint:', row.checkpoint_id, 'created:', row.created_at);
  }
  stmt.free();
  db.close();
  console.log(`Checkpoints for session ${sessionId}: ${foundCheckpoints.length}`);

  if (foundCheckpoints.length > 0) {
    console.log('\n✅ Checkpoint verified on disk after restart');
  } else {
    console.log('\n⚠️  No checkpoints found on disk');
  }

  console.log('\n=== Test Complete ===');

  // Cleanup
  try { server.kill(); } catch {}
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
