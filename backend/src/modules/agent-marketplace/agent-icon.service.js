const crypto = require('crypto');

const ICON_KEYS = Object.freeze([
  'book-open', 'book', 'graduation-cap', 'lecture', 'exam', 'clipboard-check',
  'knowledge', 'library', 'search', 'file-search', 'pen-tool', 'writing',
  'code', 'terminal', 'database', 'chart-bar', 'chart-line', 'analytics',
  'calculator', 'flask', 'microscope', 'brain', 'workflow', 'calendar-plan',
  'target', 'lightbulb', 'translate', 'presentation',
]);

const ICON_COLORS = Object.freeze([
  '#2563EB', '#0F766E', '#7C3AED', '#C2410C', '#BE123C', '#0369A1', '#4D7C0F', '#475569',
]);

const ICON_BACKGROUNDS = Object.freeze([
  '#EFF6FF', '#F0FDFA', '#F5F3FF', '#FFF7ED', '#FFF1F2', '#F0F9FF', '#F7FEE7', '#F8FAFC',
]);

function stableIndex(value, length) {
  const digest = crypto.createHash('sha256').update(String(value || 'discimind-agent')).digest();
  return digest.readUInt32BE(0) % length;
}

function defaultIconKey(agent, version) {
  const systemKey = String(agent?.systemKey || '').toLowerCase();
  const name = String(version?.name || '').toLowerCase();
  if (/exam|paper|试卷|考试/.test(`${systemKey} ${name}`)) return 'exam';
  if (/handout|lecture|讲义|课件/.test(`${systemKey} ${name}`)) return 'lecture';
  if (/code|program|编程|代码/.test(`${systemKey} ${name}`)) return 'code';
  if (/search|research|检索|科研/.test(`${systemKey} ${name}`)) return 'search';
  if (/data|analysis|数据|分析/.test(`${systemKey} ${name}`)) return 'analytics';
  if (/write|paper|写作|论文/.test(`${systemKey} ${name}`)) return 'writing';
  if (/plan|规划|计划/.test(`${systemKey} ${name}`)) return 'calendar-plan';
  if (agent?.agentType === 'FILE_GENERATOR') return 'file-search';
  return ICON_KEYS[stableIndex(agent?.systemKey || agent?.id || name, ICON_KEYS.length)];
}

function resolveAgentIcon(agent, version) {
  const seed = agent?.systemKey || agent?.id || version?.name || 'agent';
  const colorIndex = stableIndex(seed, ICON_COLORS.length);
  return {
    key: ICON_KEYS.includes(agent?.iconKey) ? agent.iconKey : defaultIconKey(agent, version),
    color: ICON_COLORS.includes(String(agent?.iconColor || '').toUpperCase()) ? String(agent.iconColor).toUpperCase() : ICON_COLORS[colorIndex],
    background: ICON_BACKGROUNDS.includes(String(agent?.iconBackground || '').toUpperCase()) ? String(agent.iconBackground).toUpperCase() : ICON_BACKGROUNDS[colorIndex],
    avatarUrl: agent?.avatarUrl || version?.avatarUrl || null,
    updatedAt: agent?.iconUpdatedAt || agent?.updatedAt || null,
  };
}

module.exports = { ICON_KEYS, ICON_COLORS, ICON_BACKGROUNDS, defaultIconKey, resolveAgentIcon };
