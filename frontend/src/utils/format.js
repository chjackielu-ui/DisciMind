// 前端格式化工具
// 枚举中文映射、日期格式化、数字格式化等

// ========================
// 枚举中文映射
// ========================

export const ROLE_MAP = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
}

export const MASTERY_LEVEL_MAP = {
  weak: '薄弱',
  general: '一般',
  good: '良好',
  excellent: '优秀',
}

export const TASK_TYPE_MAP = {
  homework: '作业',
  quiz: '测验',
  study_task: '学习任务',
  review_plan: '复习计划',
}

export const RECOMMEND_TYPE_MAP = {
  knowledge_point: '知识点',
  question: '习题',
  learning_path: '学习路线',
  video: '视频',
  review_plan: '复习计划',
}

export const WRONG_STATUS_MAP = {
  unresolved: '未掌握',
  mastered: '已掌握',
  removed: '已移除',
}

export const DIFFICULTY_MAP = {
  basic: '基础',
  medium: '中等',
  hard: '较难',
}

export const SUBMISSION_STATUS_MAP = {
  in_progress: '进行中',
  submitted: '已提交',
  graded: '已批改',
}

// ========================
// 枚举转换函数
// ========================

/**
 * 安全地将任意值转为小写字符串
 */
export function toLower(val) {
  if (val == null) return ''
  return String(val).toLowerCase()
}

/**
 * 获取枚举中文名
 */
export function masteryLabel(level) {
  return MASTERY_LEVEL_MAP[toLower(level)] || level || '未知'
}

export function taskTypeLabel(type) {
  return TASK_TYPE_MAP[toLower(type)] || type || '未知'
}

export function recommendTypeLabel(type) {
  return RECOMMEND_TYPE_MAP[toLower(type)] || type || '未知'
}

export function wrongStatusLabel(status) {
  return WRONG_STATUS_MAP[toLower(status)] || status || '未知'
}

export function difficultyLabel(level) {
  return DIFFICULTY_MAP[toLower(level)] || level || '未知'
}

export function roleLabel(role) {
  return ROLE_MAP[toLower(role)] || role || '未知'
}

// ========================
// 日期格式化
// ========================

/**
 * 格式化 ISO 日期字符串为友好显示
 */
export function formatDate(isoStr, mode = 'datetime') {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return '-'
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')

    if (mode === 'date') return `${year}-${month}-${day}`
    if (mode === 'time') return `${hours}:${minutes}`
    if (mode === 'short') return `${month}-${day} ${hours}:${minutes}`
    return `${year}-${month}-${day} ${hours}:${minutes}`
  } catch {
    return '-'
  }
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(isoStr) {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return '-'
    const now = new Date()
    const diff = now - d
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 30) return `${days}天前`
    return formatDate(isoStr, 'date')
  } catch {
    return '-'
  }
}

/**
 * 判断截止时间是否已过期
 */
export function isOverdue(isoStr) {
  if (!isoStr) return false
  try {
    return new Date(isoStr) < new Date()
  } catch {
    return false
  }
}

// ========================
// 数字格式化
// ========================

/**
 * 格式化百分比
 */
export function formatPercent(val, decimals = 0) {
  if (val == null || isNaN(val)) return '-'
  return Math.round(val * Math.pow(10, decimals)) / Math.pow(10, decimals) + '%'
}

/**
 * 格式化学习时长（秒 → 可读文本）
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0分钟'
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (hours > 0 && mins > 0) return `${hours}小时${mins}分钟`
  if (hours > 0) return `${hours}小时`
  return `${mins}分钟`
}

/**
 * 格式化分数
 */
export function formatScore(score) {
  if (score == null || score === '') return '暂未评估'
  if (typeof score === 'number') return Math.round(score * 10) / 10
  return score
}

// ========================
// HTML 工具
// ========================

/**
 * HTML 转义
 */
export function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

/**
 * 截断文本
 */
export function truncate(str, maxLen = 80) {
  if (!str || str.length <= maxLen) return str || ''
  return str.slice(0, maxLen) + '...'
}
