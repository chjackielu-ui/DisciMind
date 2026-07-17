const dify = require('./dify.service');
const { sseError } = require('../../utils/public-error');

async function chat(req, res, next) {
  if (String(req.body?.response_mode || '').toLowerCase() !== 'streaming') {
    try {
      const data = await dify.chat(req.user, req.body, { signal: req.signal });
      return res.json({ code: 0, message: 'ok', data });
    } catch (error) { return next(error); }
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    for await (const chunk of dify.streamChat(req.user, req.body, { signal: controller.signal })) {
      if (res.destroyed || controller.signal.aborted) break;
      res.write(`event: delta\ndata: ${JSON.stringify({ content: chunk.content, upstream_event: chunk.event || null })}\n\n`);
    }
    if (!res.destroyed) res.write('event: done\ndata: {"status":"completed"}\n\n');
  } catch (error) {
    if (!res.destroyed) res.write(`event: error\ndata: ${JSON.stringify(sseError(error, req, 'Dify 对话暂时不可用'))}\n\n`);
  } finally {
    req.off('aborted', abort);
    res.off('close', abort);
    if (!res.writableEnded) res.end();
  }
}

async function workflow(req, res, next) {
  try {
    const data = await dify.workflow(req.user, req.body, { signal: req.signal });
    return res.json({ code: 0, message: 'ok', data });
  } catch (error) { return next(error); }
}

async function health(_req, res) {
  const data = await dify.health();
  return res.status(data.healthy || !data.configured ? 200 : 503).json({ code: 0, message: 'ok', data });
}

module.exports = { chat, workflow, health };
