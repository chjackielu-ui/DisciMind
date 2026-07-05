// 学生自主练习控制器

const { success, fail } = require('../utils/response');
const practiceService = require('../services/practice.service');
const wrongQuestionService = require('../services/wrong-question.service');
const wrongQuestionTagService = require('../services/wrong-question-tag.service');
const wrongQuestionCollectionService = require('../services/wrong-question-collection.service');
const aiGenerationJobService = require('../services/ai-generation-job.service');

function getUserId(req) {
  return req.user?.user_id;
}

function parsePositiveInt(value, name, required = true) {
  if (value == null || value === '') {
    if (required) {
      const err = new Error(`${name} 参数不合法`);
      err.code = 40001;
      throw err;
    }
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    if (required) {
      const err = new Error(`${name} 参数不合法`);
      err.code = 40001;
      throw err;
    }
    return null;
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

async function getActiveAttempt(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await practiceService.getActiveAttempt(userId);
    return success(res, data, '获取活动考试成功');
  } catch (err) {
    return handleError(res, 'getActiveAttempt', err);
  }
}

async function getPracticeSession(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const sessionId = parsePositiveInt(req.params.sessionId || req.params.session_id, 'sessionId');
    const data = await practiceService.getPracticeSessionDetail(userId, sessionId);
    return success(res, data, '获取答题会话成功');
  } catch (err) {
    return handleError(res, 'getPracticeSession', err);
  }
}

async function savePracticeAnswer(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const sessionId = parsePositiveInt(req.params.sessionId || req.params.session_id, 'sessionId');
    const itemId = parsePositiveInt(req.params.itemId || req.params.item_id || req.params.questionId || req.params.question_id, 'itemId');
    const data = await practiceService.savePracticeAnswer(userId, sessionId, itemId, req.body || {});
    return success(res, data, '答案已保存');
  } catch (err) {
    return handleError(res, 'savePracticeAnswer', err);
  }
}

async function submitPracticeItem(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const sessionId = parsePositiveInt(req.params.sessionId || req.params.session_id, 'sessionId');
    const itemId = parsePositiveInt(req.params.itemId || req.params.item_id || req.params.questionId || req.params.question_id, 'itemId');
    const data = await practiceService.submitPracticeItem(userId, sessionId, itemId, req.body || {});
    return success(res, data, '本题已提交');
  } catch (err) {
    return handleError(res, 'submitPracticeItem', err);
  }
}

async function submitPracticeSession(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const sessionId = parsePositiveInt(req.params.sessionId || req.params.session_id, 'sessionId');
    const data = await practiceService.submitPracticeSession(userId, sessionId, req.body || {});
    return success(res, data, '整卷提交成功');
  } catch (err) {
    return handleError(res, 'submitPracticeSession', err);
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

/**
 * POST /api/practice/task-attempt — 为教师任务创建/恢复答题 attempt
 */
async function startTaskAttempt(req, res) {
  try {
    const userId = getUserId(req);
    const { taskId } = req.body;
    if (!taskId) return fail(res, 40001, 'taskId 不能为空');
    const result = await practiceService.startTaskAttempt(userId, Number(taskId));
    return success(res, result, result.isResumed ? '已恢复答题进度' : '开始答题');
  } catch (err) {
    return handleError(res, 'startTaskAttempt', err);
  }
}

/**
 * POST /api/practice/wrong-questions/start-practice — 从错题创建练习
 */
async function startWrongQuestionPractice(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await practiceService.startWrongQuestionPractice(userId, req.body || {});
    return success(res, data, '错题练习创建成功');
  } catch (err) {
    return handleError(res, 'startWrongQuestionPractice', err);
  }
}

// ========================
// 错题本升级接口
// ========================

async function getWrongQuestionOverview(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const courseId = parsePositiveInt(req.query.courseId ?? req.query.course_id, 'courseId', false);
    const data = await wrongQuestionService.getOverview(userId, courseId);
    return success(res, data, '获取错题概览成功');
  } catch (err) {
    return handleError(res, 'getWrongQuestionOverview', err);
  }
}

async function getWrongQuestionTaxonomy(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const courseId = parsePositiveInt(req.query.courseId ?? req.query.course_id, 'courseId', false);
    const data = await wrongQuestionService.getTaxonomy(userId, courseId);
    return success(res, data, '获取错题分类树成功');
  } catch (err) {
    return handleError(res, 'getWrongQuestionTaxonomy', err);
  }
}

async function queryWrongQuestions(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await wrongQuestionService.queryWrongQuestions(userId, req.query || {});
    return success(res, data, '获取错题列表成功');
  } catch (err) {
    return handleError(res, 'queryWrongQuestions', err);
  }
}

async function getWrongQuestionDetail(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const id = parsePositiveInt(req.params.id, 'id');
    const data = await wrongQuestionService.getWrongQuestionDetail(userId, id);
    return success(res, data, '获取错题详情成功');
  } catch (err) {
    return handleError(res, 'getWrongQuestionDetail', err);
  }
}

async function updateWrongQuestion(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const id = parsePositiveInt(req.params.id, 'id');
    const data = await wrongQuestionService.updateWrongQuestion(userId, id, req.body || {});
    return success(res, data, '更新错题成功');
  } catch (err) {
    return handleError(res, 'updateWrongQuestion', err);
  }
}

async function batchUpdateWrongQuestions(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const { ids, ...data } = req.body || {};
    const result = await wrongQuestionService.batchUpdateWrongQuestions(userId, ids, data);
    return success(res, result, '批量更新成功');
  } catch (err) {
    return handleError(res, 'batchUpdateWrongQuestions', err);
  }
}

// ========================
// 标签管理
// ========================

async function getWrongQuestionTags(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await wrongQuestionTagService.getUserTags(userId);
    return success(res, data, '获取标签列表成功');
  } catch (err) {
    return handleError(res, 'getWrongQuestionTags', err);
  }
}

async function createWrongQuestionTag(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await wrongQuestionTagService.createTag(userId, req.body || {});
    return success(res, data, '创建标签成功');
  } catch (err) {
    return handleError(res, 'createWrongQuestionTag', err);
  }
}

async function updateWrongQuestionTag(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const tagId = parsePositiveInt(req.params.id, 'id');
    const data = await wrongQuestionTagService.updateTag(userId, tagId, req.body || {});
    return success(res, data, '更新标签成功');
  } catch (err) {
    return handleError(res, 'updateWrongQuestionTag', err);
  }
}

async function deleteWrongQuestionTag(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const tagId = parsePositiveInt(req.params.id, 'id');
    const data = await wrongQuestionTagService.deleteTag(userId, tagId);
    return success(res, data, '删除标签成功');
  } catch (err) {
    return handleError(res, 'deleteWrongQuestionTag', err);
  }
}

async function addTagToWrongQuestion(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const wrongQuestionId = parsePositiveInt(req.params.id, 'id');
    const { tagId } = req.body || {};
    const data = await wrongQuestionTagService.addTagToWrongQuestion(
      userId,
      wrongQuestionId,
      parsePositiveInt(tagId, 'tagId'),
    );
    return success(res, data, '添加标签成功');
  } catch (err) {
    return handleError(res, 'addTagToWrongQuestion', err);
  }
}

async function removeTagFromWrongQuestion(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const wrongQuestionId = parsePositiveInt(req.params.id, 'id');
    const tagId = parsePositiveInt(req.params.tagId, 'tagId');
    const data = await wrongQuestionTagService.removeTagFromWrongQuestion(
      userId,
      wrongQuestionId,
      tagId,
    );
    return success(res, data, '移除标签成功');
  } catch (err) {
    return handleError(res, 'removeTagFromWrongQuestion', err);
  }
}

// ========================
// 错题系列管理
// ========================

async function getWrongQuestionCollections(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await wrongQuestionCollectionService.getUserCollections(userId);
    return success(res, data, '获取错题系列成功');
  } catch (err) {
    return handleError(res, 'getWrongQuestionCollections', err);
  }
}

async function getWrongQuestionCollectionDetail(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const collectionId = parsePositiveInt(req.params.id, 'id');
    const data = await wrongQuestionCollectionService.getCollectionDetail(userId, collectionId);
    return success(res, data, '获取系列详情成功');
  } catch (err) {
    return handleError(res, 'getWrongQuestionCollectionDetail', err);
  }
}

async function createWrongQuestionCollection(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await wrongQuestionCollectionService.createCollection(userId, req.body || {});
    return success(res, data, '创建错题系列成功');
  } catch (err) {
    return handleError(res, 'createWrongQuestionCollection', err);
  }
}

async function updateWrongQuestionCollection(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const collectionId = parsePositiveInt(req.params.id, 'id');
    const data = await wrongQuestionCollectionService.updateCollection(
      userId,
      collectionId,
      req.body || {},
    );
    return success(res, data, '更新错题系列成功');
  } catch (err) {
    return handleError(res, 'updateWrongQuestionCollection', err);
  }
}

async function deleteWrongQuestionCollection(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const collectionId = parsePositiveInt(req.params.id, 'id');
    const data = await wrongQuestionCollectionService.deleteCollection(userId, collectionId);
    return success(res, data, '删除错题系列成功');
  } catch (err) {
    return handleError(res, 'deleteWrongQuestionCollection', err);
  }
}

// ========================
// AI 生成任务
// ========================

async function createAiGenerationJob(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const job = await aiGenerationJobService.createJob(userId, req.body || {});
    // 异步启动执行
    aiGenerationJobService.executeJob(userId, job.job_id).catch((err) => {
      console.error('[practice.controller] AI generation job execution error:', err.message);
    });
    return success(res, job, 'AI 生成任务已创建');
  } catch (err) {
    return handleError(res, 'createAiGenerationJob', err);
  }
}

async function getAiGenerationJob(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const jobId = parsePositiveInt(req.params.jobId, 'jobId');
    const data = await aiGenerationJobService.getJob(userId, jobId);
    return success(res, data, '获取生成任务成功');
  } catch (err) {
    return handleError(res, 'getAiGenerationJob', err);
  }
}

async function retryAiGenerationJob(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const jobId = parsePositiveInt(req.params.jobId, 'jobId');
    const data = await aiGenerationJobService.retryJob(userId, jobId);
    return success(res, data, '重试已启动');
  } catch (err) {
    return handleError(res, 'retryAiGenerationJob', err);
  }
}

async function cancelAiGenerationJob(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const jobId = parsePositiveInt(req.params.jobId, 'jobId');
    const data = await aiGenerationJobService.cancelJob(userId, jobId);
    return success(res, data, '任务已取消');
  } catch (err) {
    return handleError(res, 'cancelAiGenerationJob', err);
  }
}

module.exports = {
  startPractice,
  submitPractice,
  getActiveAttempt,
  getPracticeSession,
  savePracticeAnswer,
  submitPracticeItem,
  submitPracticeSession,
  askAiForQuestion,
  streamAskAiForQuestion,
  generateAnalysis,
  getWrongQuestions,
  markWrongQuestionMastered,
  startSimilarPractice,
  startTaskAttempt,
  // 错题本升级
  getWrongQuestionOverview,
  getWrongQuestionTaxonomy,
  queryWrongQuestions,
  getWrongQuestionDetail,
  updateWrongQuestion,
  batchUpdateWrongQuestions,
  // 标签
  getWrongQuestionTags,
  createWrongQuestionTag,
  updateWrongQuestionTag,
  deleteWrongQuestionTag,
  addTagToWrongQuestion,
  removeTagFromWrongQuestion,
  // 错题系列
  getWrongQuestionCollections,
  getWrongQuestionCollectionDetail,
  createWrongQuestionCollection,
  updateWrongQuestionCollection,
  deleteWrongQuestionCollection,
  // AI 生成
  createAiGenerationJob,
  getAiGenerationJob,
  retryAiGenerationJob,
  cancelAiGenerationJob,
  // 错题练习
  startWrongQuestionPractice,
};
