const PERMISSION_DEFINITIONS = Object.freeze([
  { key: 'admin.dashboard.view', module: 'dashboard', name: '查看管理驾驶舱' },
  { key: 'admin.users.view', module: 'users', name: '查看用户' },
  { key: 'admin.users.manage', module: 'users', name: '管理用户' },
  { key: 'admin.teaching.view', module: 'teaching', name: '查看教学管理' },
  { key: 'admin.teaching.manage', module: 'teaching', name: '管理教学业务' },
  { key: 'admin.ai.providers.view', module: 'ai.providers', name: '查看 AI 供应商' },
  { key: 'admin.ai.providers.manage', module: 'ai.providers', name: '管理 AI 供应商' },
  { key: 'admin.ai.secrets.manage', module: 'ai.secrets', name: '管理 AI 密钥', sensitive: true },
  { key: 'admin.ai.models.view', module: 'ai.models', name: '查看 AI 模型' },
  { key: 'admin.ai.models.manage', module: 'ai.models', name: '管理 AI 模型' },
  { key: 'admin.agents.view', module: 'agents', name: '查看 Agent' },
  { key: 'admin.agents.manage', module: 'agents', name: '管理 Agent' },
  { key: 'admin.agents.publish', module: 'agents', name: '发布和回滚 Agent', sensitive: true },
  { key: 'admin.traces.view', module: 'traces', name: '查看 AI 证据链' },
  { key: 'admin.workflows.view', module: 'workflows', name: '查看学习流治理' },
  { key: 'admin.workflows.manage', module: 'workflows', name: '管理学习流治理' },
  { key: 'admin.knowledge.view', module: 'knowledge', name: '查看知识治理' },
  { key: 'admin.knowledge.manage', module: 'knowledge', name: '管理知识治理' },
  { key: 'admin.interventions.view', module: 'interventions', name: '查看教学问题与干预' },
  { key: 'admin.interventions.manage', module: 'interventions', name: '管理教学问题与干预' },
  { key: 'admin.evaluations.view', module: 'evaluations', name: '查看 Agent 评测' },
  { key: 'admin.evaluations.manage', module: 'evaluations', name: '管理 Agent 评测' },
  { key: 'admin.experiments.view', module: 'experiments', name: '查看灰度实验' },
  { key: 'admin.experiments.manage', module: 'experiments', name: '管理灰度实验' },
  { key: 'admin.assets.view', module: 'assets', name: '查看教学资产' },
  { key: 'admin.assets.manage', module: 'assets', name: '管理教学资产' },
  { key: 'admin.risks.view', module: 'risks', name: '查看 AI 风险' },
  { key: 'admin.risks.manage', module: 'risks', name: '处置 AI 风险', sensitive: true },
  { key: 'admin.audit.view', module: 'audit', name: '查看审计日志' },
  { key: 'admin.system.view', module: 'system', name: '查看系统配置' },
  { key: 'admin.system.manage', module: 'system', name: '管理系统与权限', sensitive: true },
]);

const ALL_PERMISSIONS = Object.freeze(PERMISSION_DEFINITIONS.map((item) => item.key));

const role = (code, name, description, permissions) => Object.freeze({
  code,
  name,
  description,
  permissions: Object.freeze([...permissions]),
});

const VIEW_PERMISSIONS = ALL_PERMISSIONS.filter((key) => key.endsWith('.view'));

const ROLE_DEFINITIONS = Object.freeze([
  role('super_admin', '超级管理员', '平台内置全权限角色。', ALL_PERMISSIONS),
  role('platform_admin', '平台管理员', '负责平台、用户、教学与 AI 运营，不包含密钥管理。', ALL_PERMISSIONS.filter((key) => key !== 'admin.ai.secrets.manage')),
  role('teaching_admin', '教学管理员', '负责教学、学习流、知识、干预、评测与教学资产。', [
    'admin.dashboard.view', 'admin.users.view', 'admin.teaching.view', 'admin.teaching.manage',
    'admin.traces.view', 'admin.workflows.view', 'admin.workflows.manage',
    'admin.knowledge.view', 'admin.knowledge.manage', 'admin.interventions.view',
    'admin.interventions.manage', 'admin.evaluations.view', 'admin.evaluations.manage',
    'admin.assets.view', 'admin.assets.manage', 'admin.audit.view',
  ]),
  role('ai_ops_admin', 'AI 运营管理员', '负责供应商、密钥、模型、Agent、评测与灰度发布。', [
    'admin.dashboard.view', 'admin.ai.providers.view', 'admin.ai.providers.manage',
    'admin.ai.secrets.manage', 'admin.ai.models.view', 'admin.ai.models.manage',
    'admin.agents.view', 'admin.agents.manage', 'admin.agents.publish', 'admin.traces.view',
    'admin.workflows.view', 'admin.workflows.manage', 'admin.evaluations.view',
    'admin.evaluations.manage', 'admin.experiments.view', 'admin.experiments.manage',
    'admin.audit.view', 'admin.system.view',
  ]),
  role('security_auditor', '安全审计管理员', '负责安全风险确认、处置和审计，不具有密钥读取或替换权限。', [
    'admin.dashboard.view', 'admin.ai.providers.view', 'admin.ai.models.view',
    'admin.agents.view', 'admin.traces.view', 'admin.risks.view',
    'admin.risks.manage', 'admin.audit.view', 'admin.system.view',
  ]),
  role('read_only_auditor', '只读审计员', '可查看管理数据与审计证据，不可执行写操作。', VIEW_PERMISSIONS),
]);

const ROLE_BY_CODE = Object.freeze(Object.fromEntries(ROLE_DEFINITIONS.map((item) => [item.code, item])));

module.exports = { PERMISSION_DEFINITIONS, ALL_PERMISSIONS, ROLE_DEFINITIONS, ROLE_BY_CODE };
