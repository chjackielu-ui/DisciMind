// 管理端导航由后端返回的显式 RBAC 权限裁剪；页面仍复用既有 dashboard 布局。

function routePath(hash) {
  return String(hash || '').replace(/^#/, '').split('?')[0]
}

function routeParam(hash, key) {
  const query = String(hash || '').split('?')[1] || ''
  return new URLSearchParams(query).get(key)
}

const ADMIN_MENU_DEFINITIONS = [
  {
    id: 'admin-dashboard', label: '首页', icon: 'home', hash: '#/admin/dashboard',
    permission: 'admin.dashboard.view',
  },
  {
    id: 'admin-users', label: '用户管理', icon: 'user', hash: '#/admin/users?role=student',
    permission: 'admin.users.view',
    matchHash: (hash) => routePath(hash) === '/admin/users',
    children: [
      { label: '学生管理', hash: '#/admin/users?role=student', permission: 'admin.users.view', matchHash: (hash) => routePath(hash) === '/admin/users' && !['teacher', 'admin'].includes(routeParam(hash, 'role')) },
      { label: '教师管理', hash: '#/admin/users?role=teacher', permission: 'admin.users.view', matchHash: (hash) => routePath(hash) === '/admin/users' && routeParam(hash, 'role') === 'teacher' },
      { label: '管理员管理', hash: '#/admin/users?role=admin', permission: 'admin.users.view', matchHash: (hash) => routePath(hash) === '/admin/users' && routeParam(hash, 'role') === 'admin' },
    ],
  },
  {
    id: 'admin-teaching', label: '教学管理', icon: 'book', hash: '#/admin/courses',
    permission: 'admin.teaching.view',
    matchHash: (hash) => hash === '/admin/courses' || /^\/admin\/courses\/\d+/.test(hash) || hash === '/admin/classes' || hash === '/admin/teaching-classes',
    children: [
      { label: '课程管理', hash: '#/admin/courses', permission: 'admin.teaching.view' },
      { label: '行政班管理', hash: '#/admin/classes', permission: 'admin.teaching.view' },
      { label: '教学班管理', hash: '#/admin/teaching-classes', permission: 'admin.teaching.view' },
    ],
  },
  {
    id: 'admin-ai-operations', label: 'AI 配置', icon: 'sparkles', hash: '#/admin/ai-config?tab=providers',
    matchHash: (hash) => ['/admin/ai-config', '/admin/environment'].includes(routePath(hash)),
    children: [
      { label: '供应商配置', hash: '#/admin/ai-config?tab=providers', permission: 'admin.ai.providers.view', matchHash: (hash) => routePath(hash) === '/admin/ai-config' && !['models'].includes(routeParam(hash, 'tab')) },
      { label: '模型管理', hash: '#/admin/ai-config?tab=models', permission: 'admin.ai.models.view', matchHash: (hash) => routePath(hash) === '/admin/ai-config' && routeParam(hash, 'tab') === 'models' },
      { label: '密钥与环境', hash: '#/admin/environment', permission: 'admin.system.view', matchHash: (hash) => routePath(hash) === '/admin/environment' },
    ],
  },
  {
    id: 'admin-content-governance', label: '内容与审核', icon: 'document', hash: '#/admin/knowledge',
    matchHash: (hash) => ['/admin/knowledge', '/admin/agent-reviews'].includes(routePath(hash)),
    children: [
      { label: '知识文档', hash: '#/admin/knowledge', permission: 'admin.knowledge.view' },
      { label: '智能体审核', hash: '#/admin/agent-reviews?tab=agents', permission: 'admin.agents.view', matchHash: (hash) => routePath(hash) === '/admin/agent-reviews' && !['knowledge', 'reports'].includes(routeParam(hash, 'tab')) },
      { label: '知识库审核', hash: '#/admin/agent-reviews?tab=knowledge', permission: 'admin.knowledge.view', matchHash: (hash) => routePath(hash) === '/admin/agent-reviews' && routeParam(hash, 'tab') === 'knowledge' },
      { label: '举报处理', hash: '#/admin/agent-reviews?tab=reports', permission: 'admin.risks.view', matchHash: (hash) => routePath(hash) === '/admin/agent-reviews' && routeParam(hash, 'tab') === 'reports' },
    ],
  },
  {
    id: 'admin-system', label: '系统管理', icon: 'settings', hash: '#/admin/permissions',
    matchHash: (hash) => ['/admin/logs', '/admin/notifications', '/admin/permissions', '/admin/profile'].includes(routePath(hash)),
    children: [
      { label: '角色与权限', hash: '#/admin/permissions', permission: 'admin.system.view' },
      { label: '通知管理', hash: '#/admin/notifications', permission: 'admin.system.view' },
      { label: '操作日志', hash: '#/admin/logs', permission: 'admin.audit.view' },
      { label: '个人信息', hash: '#/admin/profile' },
    ],
  },
]

function permitted(item, permissions) {
  return !item.permission || permissions.has(item.permission)
}

function filterMenu(permissions) {
  return ADMIN_MENU_DEFINITIONS.map((item) => {
    const children = (item.children || []).filter((child) => permitted(child, permissions))
    if (!permitted(item, permissions) && !children.length) return null
    const next = { ...item, children }
    if (!permitted(item, permissions) && children.length) next.hash = children[0].hash
    if (!children.length) delete next.children
    return next
  }).filter(Boolean)
}

export let ADMIN_MENU_ITEMS = filterMenu(new Set())

export function configureAdminMenu(permissionKeys = []) {
  ADMIN_MENU_ITEMS = filterMenu(new Set(permissionKeys))
  return ADMIN_MENU_ITEMS
}

export function firstAllowedAdminHash() {
  const first = ADMIN_MENU_ITEMS[0]
  return first?.children?.[0]?.hash || first?.hash || '#/admin/profile'
}
