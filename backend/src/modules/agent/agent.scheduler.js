/**
 * Agent 当前按请求或异步任务队列执行，不另起常驻定时器。
 * 统一生命周期接口供服务启动/关闭流程做能力探测。
 */
module.exports = Object.freeze({
  mode: 'request_and_task_queue',
  start: async () => ({ running: true, schedulerRequired: false }),
  stop: async () => ({ running: false, schedulerRequired: false }),
});
