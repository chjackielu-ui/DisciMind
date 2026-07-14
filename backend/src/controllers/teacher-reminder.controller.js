const { success, fail } = require('../utils/response');
const service = require('../services/teacher-reminder.service');
function handle(res, scope, error) { console.error(`[teacher-reminder] ${scope}:`, error.message); return fail(res, error.code || 50001, error.code ? error.message : '提醒服务暂时不可用'); }
const action = (name, message) => async (req, res) => { try { return success(res, await service[name](req.user, req.params.id, req.body || {}), message); } catch (error) { return handle(res, name, error); } };
module.exports = {
  list: async (req,res)=>{try{return success(res,await service.list(req.user,req.query||{}));}catch(error){return handle(res,'list',error);}},
  create: async (req,res)=>{try{return success(res,await service.create(req.user,req.body||{}),'提醒已创建');}catch(error){return handle(res,'create',error);}},
  detail: action('detail'), update: action('update','提醒已更新'), remove: action('cancel','提醒已取消'),
  complete: action('complete','提醒已完成'), snooze: action('snooze','提醒已稍后提醒'), dismiss: action('dismiss','提醒已关闭'),
  checkDue: async (req,res)=>{try{return success(res,await service.checkDue(req.user));}catch(error){return handle(res,'checkDue',error);}},
};
