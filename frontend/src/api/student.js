// 学生端接口封装

import { get } from './request.js'

/**
 * 获取学生首页仪表盘综合数据
 * @returns {Promise} { code, message, data: { user, overview, portrait, courses, weak_knowledge_points, recommendations, recent_tasks } }
 */
export function getStudentDashboard() {
  return get('/student/dashboard')
}
