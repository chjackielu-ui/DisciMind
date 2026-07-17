// 统一题目标签颜色组件
// 供学生端页面和组件共同使用

import { escapeHtml } from '../../utils/format.js'

// ========================
// 题型标签
// ========================

const TYPE_COLORS = {
  single_choice:   { bg: 'rgba(47,102,144,0.10)', text: '#2F6690', border: 'rgba(47,102,144,0.20)' },
  multiple_choice: { bg: 'rgba(58,124,165,0.10)', text: '#3A7CA5', border: 'rgba(58,124,165,0.20)' },
  true_false:      { bg: 'rgba(8,145,178,0.10)',  text: '#0891B2', border: 'rgba(8,145,178,0.20)' },
  fill_blank:      { bg: 'rgba(124,58,237,0.10)', text: '#7C3AED', border: 'rgba(124,58,237,0.20)' },
  short_answer:    { bg: 'rgba(234,88,12,0.10)',  text: '#EA580C', border: 'rgba(234,88,12,0.20)' },
}

const TYPE_LABELS = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_blank: '填空题',
  short_answer: '简答题',
}

/**
 * 题型标签 HTML
 * @param {string} type - 标准化后的题型值
 * @param {string} size - 'sm' | 'md'
 */
export function questionTypeTagHtml(type, size = 'sm') {
  const colors = TYPE_COLORS[type] || { bg: 'rgba(47,102,144,0.08)', text: '#2F6690', border: 'rgba(47,102,144,0.14)' }
  const label = TYPE_LABELS[type] || type || '未知'
  const cls = size === 'md' ? 'qtag qtag-md' : 'qtag'
  return `<span class="${cls}" style="--qt-bg:${colors.bg};--qt-text:${colors.text};--qt-border:${colors.border}">${escapeHtml(label)}</span>`
}

// ========================
// 难度标签
// ========================

const DIFFICULTY_COLORS = {
  basic:   { bg: 'rgba(76,175,132,0.12)',  text: '#2C7A63', border: 'rgba(76,175,132,0.22)' },
  easy:    { bg: 'rgba(76,175,132,0.12)',  text: '#2C7A63', border: 'rgba(76,175,132,0.22)' },
  medium:  { bg: 'rgba(47,102,144,0.10)',  text: '#2F6690', border: 'rgba(47,102,144,0.20)' },
  normal:  { bg: 'rgba(47,102,144,0.10)',  text: '#2F6690', border: 'rgba(47,102,144,0.20)' },
  hard:    { bg: 'rgba(234,88,12,0.10)',   text: '#C2410C', border: 'rgba(234,88,12,0.20)' },
  comprehensive: { bg: 'rgba(220,38,38,0.10)', text: '#B91C1C', border: 'rgba(220,38,38,0.20)' },
}

const DIFFICULTY_LABELS = {
  basic: '基础',
  easy: '基础',
  medium: '普通',
  normal: '普通',
  hard: '提高',
  comprehensive: '综合',
}

/**
 * 难度标签 HTML
 */
export function difficultyTagHtml(level, size = 'sm') {
  const key = String(level || '').toLowerCase()
  const colors = DIFFICULTY_COLORS[key] || { bg: 'rgba(47,102,144,0.08)', text: '#2F6690', border: 'rgba(47,102,144,0.14)' }
  const label = DIFFICULTY_LABELS[key] || level || '未设置'
  const cls = size === 'md' ? 'qtag qtag-md' : 'qtag'
  return `<span class="${cls}" style="--qt-bg:${colors.bg};--qt-text:${colors.text};--qt-border:${colors.border}">${escapeHtml(label)}</span>`
}

// ========================
// 来源标签
// ========================

const SOURCE_COLORS = {
  seed:     { bg: 'rgba(100,116,139,0.10)',  text: '#475569', border: 'rgba(100,116,139,0.20)' },
  teacher:  { bg: 'rgba(30,64,175,0.10)',    text: '#1E40AF', border: 'rgba(30,64,175,0.20)' },
  ai:       { bg: 'rgba(124,58,237,0.10)',   text: '#7C3AED', border: 'rgba(124,58,237,0.20)' },
  pending:  { bg: 'rgba(234,88,12,0.10)',    text: '#C2410C', border: 'rgba(234,88,12,0.20)' },
}

const SOURCE_LABELS = {
  seed: '种子题库',
  teacher: '教师创建',
  ai: 'AI生成',
  pending: '待审核',
}

export function sourceTagHtml(source, size = 'sm') {
  const key = String(source || '').toLowerCase()
  const colors = SOURCE_COLORS[key] || { bg: 'rgba(100,116,139,0.08)', text: '#475569', border: 'rgba(100,116,139,0.14)' }
  const label = SOURCE_LABELS[key] || source || '未知来源'
  const cls = size === 'md' ? 'qtag qtag-md' : 'qtag'
  return `<span class="${cls}" style="--qt-bg:${colors.bg};--qt-text:${colors.text};--qt-border:${colors.border}">${escapeHtml(label)}</span>`
}

// ========================
// 状态标签
// ========================

const STATUS_COLORS = {
  mastered:   { bg: 'rgba(76,175,132,0.12)',  text: '#2C7A63', border: 'rgba(76,175,132,0.22)' },
  unresolved: { bg: 'rgba(234,88,12,0.10)',   text: '#C2410C', border: 'rgba(234,88,12,0.20)' },
  removed:    { bg: 'rgba(100,116,139,0.10)',  text: '#475569', border: 'rgba(100,116,139,0.18)' },
  completed:  { bg: 'rgba(76,175,132,0.12)',  text: '#2C7A63', border: 'rgba(76,175,132,0.22)' },
  pending:    { bg: 'rgba(148,163,184,0.10)',  text: '#64748B', border: 'rgba(148,163,184,0.18)' },
  wrong:      { bg: 'rgba(234,88,12,0.10)',   text: '#C2410C', border: 'rgba(234,88,12,0.20)' },
  answered:   { bg: 'rgba(47,102,144,0.10)',  text: '#2F6690', border: 'rgba(47,102,144,0.20)' },
  unanswered: { bg: 'rgba(148,163,184,0.08)',  text: '#94A3B8', border: 'rgba(148,163,184,0.14)' },
}

const STATUS_LABELS = {
  mastered: '已掌握',
  unresolved: '未掌握',
  removed: '已移除',
  completed: '已完成',
  pending: '未完成',
  wrong: '已加入错题本',
  answered: '已作答',
  unanswered: '未作答',
}

export function statusTagHtml(status, size = 'sm') {
  const key = String(status || '').toLowerCase()
  const colors = STATUS_COLORS[key] || { bg: 'rgba(47,102,144,0.08)', text: '#2F6690', border: 'rgba(47,102,144,0.14)' }
  const label = STATUS_LABELS[key] || status || '未知'
  const cls = size === 'md' ? 'qtag qtag-md' : 'qtag'
  return `<span class="${cls}" style="--qt-bg:${colors.bg};--qt-text:${colors.text};--qt-border:${colors.border}">${escapeHtml(label)}</span>`
}

// ========================
// 知识点标签
// ========================

export function knowledgePointTagHtml(name) {
  if (!name) return ''
  return `<span class="qtag kp-tag">${escapeHtml(name)}</span>`
}

// ========================
// 科目推荐标签
// ========================

export function subjectRecommendTag(type) {
  const map = {
    recommend: { label: '推荐练习', cls: 'subject-tag-recommend' },
    sufficient: { label: '题库充足', cls: 'subject-tag-sufficient' },
    ai_fill: { label: 'AI可补题', cls: 'subject-tag-ai' },
  }
  const item = map[type]
  if (!item) return ''
  return `<span class="subject-recommend-tag ${item.cls}">${item.label}</span>`
}
