#!/usr/bin/env node

// Development/acceptance helper: finish one prepared resource-package video in a
// workstation browser. Production students use the same button in the web UI;
// this script must not be scheduled on a 2C2G server.

const fs = require('fs');
const { openBrowser } = require('@remotion/renderer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

function chromeExecutable() {
  const candidates = [
    process.env.BROWSER_RENDER_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome or Edge was not found; set BROWSER_RENDER_CHROME');
  return executable;
}

async function evaluate(session, expression) {
  const response = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  const payload = response.value;
  if (payload.exceptionDetails) {
    throw new Error(payload.exceptionDetails.exception?.description || payload.exceptionDetails.text || 'Browser evaluation failed');
  }
  return payload.result?.value;
}

async function waitFor(session, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(session, expression)) return;
    await sleep(1000);
  }
  throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
}

async function main() {
  const packageId = positiveInteger(process.argv[2], 'packageId');
  const courseId = positiveInteger(process.argv[3], 'courseId');
  const account = required('BROWSER_RENDER_ACCOUNT');
  const password = required('BROWSER_RENDER_PASSWORD');
  const origin = String(process.env.BROWSER_RENDER_ORIGIN || 'http://127.0.0.1:5173').replace(/\/$/, '');
  const timeoutMs = Math.max(60_000, Number(process.env.BROWSER_RENDER_TIMEOUT_MS || 20 * 60_000));

  console.log(`[browser-render] opening ${chromeExecutable()}`);
  const browser = await openBrowser('chrome', {
    browserExecutable: chromeExecutable(),
    chromeMode: 'chrome-for-testing',
    chromiumOptions: { headless: true },
    logLevel: 'error',
  });
  const created = await browser.connection.send('Target.createTarget', { url: 'about:blank' });
  const targetId = created.value.targetId;
  let target = null;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    target = browser._targets.get(targetId) || null;
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('Browser target could not be created');

  const session = await target.createCDPSession();
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Page.navigate', { url: `${origin}/` });
  await waitFor(session, 'document.readyState === "complete"', 30_000, 'Initial page');

  const login = await evaluate(session, `(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify(${JSON.stringify({ account, password })})
    });
    return response.json();
  })()`);
  if (login?.code !== 0 || !login?.data?.accessToken || !login?.data?.user) {
    throw new Error(login?.message || 'Student login failed');
  }
  const auth = {
    token: login.data.accessToken,
    user: login.data.user,
    sessionId: login.data.sessionId || login.data.user.sessionId || login.data.user.session_id,
  };
  await evaluate(session, `(() => {
    const auth = ${JSON.stringify(auth)};
    sessionStorage.setItem('discimind_access_token', auth.token);
    sessionStorage.setItem('discimind_user', JSON.stringify(auth.user));
    if (auth.sessionId) sessionStorage.setItem('discimind_session_id', String(auth.sessionId));
    sessionStorage.setItem('discimind_session_authenticated', 'true');
    sessionStorage.setItem('discimind_last_activity_at', String(Date.now()));
    return true;
  })()`);

  const route = `${origin}/#/student/courses/${courseId}?section=learning-media&packageId=${packageId}`;
  await session.send('Page.navigate', { url: route });
  await waitFor(session, 'document.readyState === "complete"', 30_000, 'Course page');
  await waitFor(session, `(() => Array.from(document.querySelectorAll('button')).some((button) => button.textContent.includes('渲染并保存MP4')))()`, 120_000, 'Prepared video manifest');
  console.log('[browser-render] manifest hydrated; starting WebCodecs MP4 render');

  const clicked = await evaluate(session, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.includes('渲染并保存MP4'));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Render button was unavailable');

  const deadline = Date.now() + timeoutMs;
  let lastProgress = '';
  while (Date.now() < deadline) {
    await sleep(3000);
    const state = await evaluate(session, `(async () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const renderButton = buttons.find((item) => /^(?:渲染并保存MP4|正在渲染\s*\d+%|重新渲染)$/.test((item.textContent || '').trim()));
      const token = sessionStorage.getItem('discimind_access_token');
      let serverStatus = null;
      try {
        const response = await fetch('/api/student/resource-packages/${packageId}', {headers: {Authorization: 'Bearer ' + token}});
        const result = await response.json();
        serverStatus = result?.data?.videoTask?.status || null;
      } catch {}
      return {
        renderText: (renderButton?.textContent || '').trim(),
        hasDownload: buttons.some((item) => (item.textContent || '').trim() === '下载MP4'),
        hasRetryUpload: buttons.some((item) => (item.textContent || '').includes('重新上传')),
        error: (document.querySelector('.learning-media-error')?.textContent || '').trim(),
        serverStatus,
      };
    })()`);
    if (state.renderText !== lastProgress) {
      lastProgress = state.renderText;
      console.log(`[browser-render] ${state.renderText || 'waiting'}; server=${state.serverStatus || 'unknown'}`);
    }
    if (state.serverStatus === 'success' && state.hasDownload && !state.hasRetryUpload) {
      console.log(`RESULT ${JSON.stringify({ ok: true, packageId, serverStatus: state.serverStatus })}`);
      return;
    }
    if (state.error && !/^正在渲染/.test(state.renderText) && !state.hasDownload) {
      throw new Error(state.error);
    }
  }
  throw new Error(`Browser rendering timed out after ${Math.round(timeoutMs / 60_000)} minutes`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`RESULT ${JSON.stringify({ ok: false, error: error.message })}`);
    process.exit(1);
  });
