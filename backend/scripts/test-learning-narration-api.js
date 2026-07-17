require('dotenv').config();
const WebSocket = require('ws');
const prisma = require('../src/config/prisma');

const base = `http://localhost:${process.env.PORT || 3000}`;

async function api(path, options = {}) {
  const response = await fetch(`${base}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.message || `HTTP ${response.status}`);
  return body.data;
}

async function stream(ticket, wsPath) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}${wsPath}?ticket=${encodeURIComponent(ticket)}`);
    let audioBytes = 0;
    let firstAudioMs = null;
    const events = [];
    socket.on('message', (raw, binary) => {
      if (binary) {
        audioBytes += raw.length;
        if (firstAudioMs == null) firstAudioMs = Date.now() - started;
        return;
      }
      const event = JSON.parse(raw.toString());
      events.push(event.type);
      if (event.type === 'narration.error') reject(new Error(`${event.code}: ${event.message}`));
      if (event.type === 'narration.job.done') resolve({ audioBytes, firstAudioMs, totalMs: Date.now() - started, events });
    });
    socket.on('error', reject);
  });
}

async function main() {
  const account = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  if (!account || !password) throw new Error('TEST_USERNAME and TEST_PASSWORD environment variables are required');
  const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ account, password }) });
  const token = login.accessToken || login.token;
  const user = await prisma.user.findUnique({ where: { username: account }, select: { user_id: true } });
  const run = await prisma.learningSessionNodeRun.findFirst({
    where: { session: { student_user_id: user.user_id }, output_content: { not: null } },
    orderBy: { node_run_id: 'desc' }, select: { node_run_id: true, session_id: true },
  });
  if (!run) throw new Error('No completed learning node found for API integration test');
  const headers = { Authorization: `Bearer ${token}` };
  const input = { sessionId: run.session_id, nodeRunId: run.node_run_id, contentBlockId: `node_${run.node_run_id}_main`, purpose: 'node_content' };
  const firstJob = await api('/learning-narration/jobs', { method: 'POST', headers, body: JSON.stringify(input) });
  const first = await stream(firstJob.ticket, firstJob.wsPath);
  const secondJob = await api('/learning-narration/jobs', { method: 'POST', headers, body: JSON.stringify(input) });
  const second = await stream(secondJob.ticket, secondJob.wsPath);
  console.log(JSON.stringify({
    ok: first.audioBytes > 0 && second.audioBytes === first.audioBytes,
    sessionId: run.session_id, nodeRunId: run.node_run_id,
    first: { ...first, events: [...new Set(first.events)] },
    cachedReplay: { ...second, events: [...new Set(second.events)] },
    cacheReplayFaster: second.firstAudioMs < first.firstAudioMs,
    oneTimeTicketIssued: Boolean(firstJob.ticket && secondJob.ticket),
  }));
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }));
  process.exitCode = 1;
});
