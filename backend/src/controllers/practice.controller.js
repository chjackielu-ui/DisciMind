// 学生自主练习控制器

const { success, fail } = require('../utils/response');
const practiceService = require('../services/practice.service');

function getUserId(req) {
  return req.user?.user_id;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    const err = new Error(`${name} 参数不合法`);
    err.code = 40001;
    throw err;
  }
  return parsed;
}

function handleError(res, scope, err) {
  console.error(`[practice.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function startPractice(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await practiceService.startPractice(userId, req.body || {});
    return success(res, data, '开始练习成功');
  } catch (err) {
    return handleError(res, 'startPractice', err);
  }
}

async function submitPractice(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await practiceService.submitPractice(userId, req.body || {});
    return success(res, data, '提交练习成功');
  } catch (err) {
    return handleError(res, 'submitPractice', err);
  }
}

async function askAiForQuestion(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const questionId = parsePositiveInt(req.params.questionId || req.params.question_id, 'questionId');
    const data = await practiceService.askAiForQuestion(userId, questionId, req.body || {});
    return success(res, data, 'AI 讲解生成成功');
  } catch (err) {
    return handleError(res, 'askAiForQuestion', err);
  }
}

async function generateAnalysis(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const questionId = parsePositiveInt(req.params.questionId || req.params.question_id, 'questionId');
    const data = await practiceService.generateAnalysis(userId, questionId, req.body || {});
    return success(res, data, 'AI 解析生成成功');
  } catch (err) {
    return handleError(res, 'generateAnalysis', err);
  }
}

function writeSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

async function streamAskAiForQuestion(req, res) {
  const userId = getUserId(req);
  if (!userId) return fail(res, 40101, '无法获取用户身份');

  const questionId = parsePositiveInt(req.params.questionId || req.params.question_id, 'questionId');
  const sessionId = parsePositiveInt(
    req.body.sessionId ?? req.body.session_id ?? req.body.practiceSessionId ?? req.body.practice_session_id,
    'sessionId',
  );
  const followUp = String(req.body.question || req.body.message || '请帮我讲解这道题。').trim();
  if (!followUp) return fail(res, 40001, '追问内容不能为空');

  // 准备上下文
  let prepared;
  try {
    prepared = await practiceService.buildPracticeAiMessages(userId, questionId, sessionId);
  } catch (err) {
    return handleError(res, 'streamAskAiForQuestion.prepare', err);
  }

  // 追加学生追问
  prepared.messages.push({ role: 'user', content: followUp });

  const abortController = new AbortController();
  let clientClosed = false;
  let completed = false;

  req.on('close', () => {
    if (!completed) {
      clientClosed = true;
      abortController.abort();
    }
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  writeSse(res, 'meta', { question_id: questionId, session_id: sessionId });
  writeSse(res, 'status', { message: '正在思考中...' });

  try {
    const stream = await practiceService.createPracticeAiCompletionStream(
      prepared.messages,
      abortController.signal,
    );

    for await (const chunk of stream) {
      if (clientClosed) break;
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      writeSse(res, 'delta', { content: delta });
    }

    completed = true;
    if (!clientClosed) {
      writeSse(res, 'done', { message: '回答完成' });
      res.end();
    }
  } catch (err) {
    if (abortController.signal.aborted || clientClosed) {
      completed = true;
      return;
    }
    console.error('[practice.controller] streamAskAiForQuestion 异常:', err.message);
    completed = true;
    writeSse(res, 'error', { message: err.message || 'AI 回答失败，请稍后重试' });
    res.end();
  }
}

async function getWrongQuestions(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await practiceService.getWrongQuestions(userId, req.query || {});
    return success(res, data, '获取错题列表成功');
  } catch (err) {
    return handleError(res, 'getWrongQuestions', err);
  }
}

async function markWrongQuestionMastered(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const wrongQuestionId = parsePositiveInt(req.params.id, 'id');
    const data = await practiceService.markWrongQuestionMastered(userId, wrongQuestionId);
    return success(res, data, '错题已标记掌握');
  } catch (err) {
    return handleError(res, 'markWrongQuestionMastered', err);
  }
}

async function startSimilarPractice(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const wrongQuestionId = parsePositiveInt(req.params.id, 'id');
    const data = await practiceService.startSimilarPractice(userId, wrongQuestionId, req.body || {});
    return success(res, data, '相似题练习已生成');
  } catch (err) {
    return handleError(res, 'startSimilarPractice', err);
  }
}

module.exports = {
  startPractice,
  submitPractice,
  askAiForQuestion,
  streamAskAiForQuestion,
  generateAnalysis,
  getWrongQuestions,
  markWrongQuestionMastered,
  startSimilarPractice,
};
