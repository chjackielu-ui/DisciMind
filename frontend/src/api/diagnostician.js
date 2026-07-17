// 诊断师 (Diagnostician) API 封装
// 对后端 POST /api/agent/diagnostician/analyze 接口

import { post } from './request.js'

export const DIAGNOSTICIAN_MODES = Object.freeze({
  MENTAL_MODEL: 'mental_model',
  STRATEGY_INTERVENTION: 'strategy_intervention',
  GROWTH_REPORT: 'growth_report',
})

/**
 * 调用诊断师分析
 * @param {Object} params
 * @param {string} params.mode - 模式: mental_model | strategy_intervention | growth_report
 * @param {number} [params.knowledgePointId] - 知识点 ID
 * @param {number} [params.sessionId] - 练习会话 ID
 * @param {Object} [params.reportPeriod] - 报告时间范围 { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * @param {number} [params.studentId] - 目标学生 ID（教师/管理员需要）
 * @returns {Promise<Object>} { code, message, data: { mode, requestId, result, interventions, diagnosticReportId } }
 */
export function analyzeDiagnostician(params = {}) {
  const body = {
    mode: params.mode,
    knowledgePointId: params.knowledgePointId,
    sessionId: params.sessionId,
    reportPeriod: params.reportPeriod,
    studentId: params.studentId,
    requestId: params.requestId,
  }

  // 去除 undefined 字段
  Object.keys(body).forEach((key) => {
    if (body[key] === undefined) delete body[key]
  })

  return post('/agent/diagnostician/analyze', body)
}

/**
 * 获取学生心智模型
 */
export function getMentalModel(knowledgePointId, sessionId) {
  return analyzeDiagnostician({
    mode: DIAGNOSTICIAN_MODES.MENTAL_MODEL,
    knowledgePointId,
    sessionId,
  })
}

/**
 * 获取策略干预建议
 */
export function getStrategyIntervention(knowledgePointId, sessionId) {
  return analyzeDiagnostician({
    mode: DIAGNOSTICIAN_MODES.STRATEGY_INTERVENTION,
    knowledgePointId,
    sessionId,
  })
}

/**
 * 获取成长报告
 */
export function getGrowthReport({ knowledgePointId, reportPeriod } = {}) {
  return analyzeDiagnostician({
    mode: DIAGNOSTICIAN_MODES.GROWTH_REPORT,
    knowledgePointId,
    reportPeriod,
  })
}
