const { WebSocketServer, WebSocket } = require('ws');

function attachLearningNarrationGateway(server, jobService) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 });
  const onUpgrade = (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/ws/learning-narration') return;
    const job = jobService.consumeTicket(url.searchParams.get('ticket'));
    if (!job) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, job));
  };
  server.on('upgrade', onUpgrade);
  wss.on('connection', (ws, request, job) => {
    let closed = false;
    const sink = {
      control(event) { if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); },
      audio(chunk) { if (!closed && ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true }); },
    };
    ws.on('message', (raw, isBinary) => {
      if (isBinary || raw.length > 1024) return;
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'narration.cancel') jobService.cancelJob(job.userId, job.id).catch(() => {});
      } catch {}
    });
    ws.once('close', () => { closed = true; if (job.status === 'RUNNING') jobService.cancelJob(job.userId, job.id, { reason: 'client_disconnect' }).catch(() => {}); });
    ws.once('error', () => { closed = true; });
    jobService.streamJob(job, sink)
      .catch((err) => {
        if (!closed && ws.readyState === WebSocket.OPEN) ws.close(4000, err.message || 'job error');
      })
      .finally(() => { if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'done'); });
  });
  return {
    close() {
      server.off('upgrade', onUpgrade);
      for (const client of wss.clients) client.close(1001, 'server shutdown');
      wss.close();
    },
  };
}

module.exports = { attachLearningNarrationGateway };
