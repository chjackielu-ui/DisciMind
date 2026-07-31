const prisma = require('../../config/prisma');
const { executeCode } = require('./judge0.service');

const MAX_TEST_CASES = 20;
const MAX_STORED_TEXT = 65_536;

function publicError(message, code = 40001, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.expose = true;
  return error;
}

function limitText(value, maximum = MAX_STORED_TEXT) { return String(value || '').slice(0, maximum); }
function normalizeOutput(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n').trim();
}

function extractTestCases(correctAnswer) {
  const source = Array.isArray(correctAnswer) ? correctAnswer : correctAnswer?.testCases || correctAnswer?.test_cases || correctAnswer?.samples || [];
  if (!Array.isArray(source)) return [];
  return source.slice(0, MAX_TEST_CASES).map((item, index) => ({
    index: index + 1,
    input: limitText(item?.input ?? item?.stdin ?? item?.standardInput ?? item?.standard_input ?? '', 32_768),
    expectedOutput: limitText(item?.expectedOutput ?? item?.expected_output ?? item?.standardOutput ?? item?.standard_output ?? item?.output ?? item?.stdout ?? '', 32_768),
  }));
}

async function getProgrammingTopic(userId, topicId, db = prisma) {
  const topic = await db.question.findFirst({
    where: { question_id: Number(topicId), question_type: 'PROGRAMMING', status: 'active' },
    select: { question_id: true, course_id: true, title: true, content: true, difficulty_level: true, score: true, correct_answer: true, course: { select: { course_name: true, course_code: true } } },
  });
  if (!topic) throw publicError('编程习题不存在', 40401, 404);
  const enrollment = await db.studentCourseEnrollment.findFirst({ where: { student_user_id: Number(userId), course_id: topic.course_id, enrollment_status: 'active' }, select: { enrollment_id: true } });
  if (!enrollment) throw publicError('你没有访问该课程编程习题的权限', 40301, 403);
  return topic;
}

async function saveRecord(userId, input, result, db = prisma) {
  return db.compileRecord.create({ data: { user_id: Number(userId), topic_id: input.topicId ? Number(input.topicId) : null, language: input.language || 'c', source_code: input.sourceCode, compile_msg: limitText(result.compileMessage), run_output: limitText(result.runOutput), status: Number(result.statusCode) } });
}

function resultMessage(result) { return [result.compileMessage, result.stderr, result.message].filter(Boolean).join('\n'); }

async function run(userId, input, options = {}) {
  if (input.topicId) await getProgrammingTopic(userId, input.topicId, options.db || prisma);
  let result;
  try {
    result = await (options.execute || executeCode)({ language: input.language, sourceCode: input.sourceCode, stdin: input.stdin });
  } catch (error) {
    await saveRecord(userId, input, { compileMessage: `沙箱调用失败：${error.message || 'Judge0 unavailable'}`, runOutput: '', statusCode: 3 }, options.db || prisma).catch(() => {});
    throw publicError('编译沙箱暂时不可用，请稍后重试', 50001, 503);
  }
  const record = await saveRecord(userId, input, { compileMessage: resultMessage(result), runOutput: result.stdout, statusCode: result.statusCode }, options.db || prisma);
  return { ...result, recordId: record.id };
}

function verdictFor(result, expectedOutput) {
  if (result.status === 'COMPILE_ERROR') return 'COMPILE_ERROR';
  if (result.status === 'TIME_LIMIT_EXCEEDED') return 'TIME_LIMIT_EXCEEDED';
  if (!['SUCCESS', 'WRONG_ANSWER'].includes(result.status)) return 'RUNTIME_ERROR';
  return normalizeOutput(result.stdout) === normalizeOutput(expectedOutput) ? 'PASSED' : 'WRONG_ANSWER';
}
function overallStatus(results) {
  if (results.some((item) => item.verdict === 'COMPILE_ERROR')) return 0;
  if (results.some((item) => item.verdict === 'TIME_LIMIT_EXCEEDED')) return 2;
  if (results.some((item) => item.verdict === 'RUNTIME_ERROR')) return 3;
  return 1;
}

async function judge(userId, input, options = {}) {
  const db = options.db || prisma;
  const topic = await getProgrammingTopic(userId, input.topicId, db);
  const testCases = extractTestCases(topic.correct_answer);
  if (!testCases.length) throw publicError('该编程习题尚未配置测试样例');
  const results = [];
  for (const testCase of testCases) {
    try {
      const executed = await (options.execute || executeCode)({ language: input.language, sourceCode: input.sourceCode, stdin: testCase.input });
      results.push({ index: testCase.index, input: testCase.input, expectedOutput: testCase.expectedOutput, actualOutput: executed.stdout, verdict: verdictFor(executed, testCase.expectedOutput), compileMessage: resultMessage(executed), timeMs: executed.timeMs, memoryKb: executed.memoryKb });
    } catch (error) {
      results.push({ index: testCase.index, input: testCase.input, expectedOutput: testCase.expectedOutput, actualOutput: '', verdict: 'RUNTIME_ERROR', compileMessage: `沙箱调用失败：${error.message || 'Judge0 unavailable'}`, timeMs: null, memoryKb: null });
    }
  }
  const statusCode = overallStatus(results);
  const passedCount = results.filter((item) => item.verdict === 'PASSED').length;
  const compileMessage = [...new Set(results.map((item) => item.compileMessage).filter(Boolean))].join('\n\n');
  const record = await saveRecord(userId, input, { compileMessage, runOutput: JSON.stringify(results.map(({ compileMessage: _message, ...item }) => item)), statusCode }, db);
  return { topic: { id: topic.question_id, title: topic.title }, passedCount, totalCount: results.length, allPassed: passedCount === results.length, statusCode, compileMessage, results, recordId: record.id };
}

async function topicDetail(userId, topicId, options = {}) {
  const topic = await getProgrammingTopic(userId, topicId, options.db || prisma);
  return { id: topic.question_id, courseId: topic.course_id, courseName: topic.course?.course_name || '', courseCode: topic.course?.course_code || '', title: topic.title, description: topic.content, difficulty: topic.difficulty_level, score: topic.score, testCases: extractTestCases(topic.correct_answer) };
}

async function history(userId, query, options = {}) {
  const db = options.db || prisma;
  const where = { user_id: Number(userId) };
  if (query.topicId) where.topic_id = Number(query.topicId);
  const skip = (query.page - 1) * query.pageSize;
  const [records, total] = await Promise.all([
    db.compileRecord.findMany({ where, orderBy: [{ create_time: 'desc' }, { id: 'desc' }], skip, take: query.pageSize, include: { topic: { select: { title: true } } } }),
    db.compileRecord.count({ where }),
  ]);
  return { list: records.map((record) => ({ id: record.id, topicId: record.topic_id, topicTitle: record.topic?.title || null, language: record.language || 'c', sourceCode: record.source_code, compileMessage: record.compile_msg, runOutput: record.run_output, status: record.status, createdAt: record.create_time })), total, page: query.page, pageSize: query.pageSize };
}

module.exports = { run, judge, history, topicDetail, extractTestCases, normalizeOutput, verdictFor, overallStatus };
