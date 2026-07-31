const { success, fail } = require('../../utils/response');
const service = require('./compiler.service');
const schemas = require('./compiler.schemas');
function userId(req) { return Number(req.user?.user_id); }
function handle(res, error) { console.error('[compiler]', error); return fail(res, error.code || 50001, error.message || '在线编译器请求失败', null, { status: error.status, publicCode: error.status === 503 ? 'JUDGE0_UNAVAILABLE' : undefined }); }
async function run(req, res) { try { return success(res, await service.run(userId(req), schemas.parse(schemas.runSchema, req.body)), '编译运行完成'); } catch (error) { return handle(res, error); } }
async function judge(req, res) { try { return success(res, await service.judge(userId(req), schemas.parse(schemas.judgeSchema, req.body)), '样例判题完成'); } catch (error) { return handle(res, error); } }
async function history(req, res) { try { return success(res, await service.history(userId(req), schemas.parse(schemas.historySchema, req.query)), '获取编译历史成功'); } catch (error) { return handle(res, error); } }
async function topic(req, res) { try { return success(res, await service.topicDetail(userId(req), req.params.topicId), '获取编程习题成功'); } catch (error) { return handle(res, error); } }
module.exports = { run, judge, history, topic };
