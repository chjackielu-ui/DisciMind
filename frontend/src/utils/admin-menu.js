// 管理员端统一侧边导航菜单
// 参考学生端 STUDENT_MENU_ITEMS 结构设计
// 包含二级导航（children）支持，与 dashboard.js sub-nav-panel 渲染联动

export const ADMIN_MENU_ITEMS = [
  {
    id: 'admin-dashboard',
    label: '首页',
    icon: 'home',
    hash: '#/admin/dashboard',
  },
  {
    id: 'admin-users',
    label: '用户管理',
    icon: 'user',
    hash: '#/admin/users',
  },
  {
    id: 'admin-teaching',
    label: '教学管理',
    icon: 'book',
    hash: '#/admin/courses',
    prefixMatch: '/admin/courses',
    matchHash: (h) => h === '/admin/courses' || /^\/admin\/courses\/\d+/.test(h) || h === '/admin/classes',
    children: [
      { label: '课程管理', hash: '#/admin/courses' },
      { label: '班级管理', hash: '#/admin/classes' },
    ],
  },
  {
    id: 'admin-agent-reviews',
    label: '智能体审核',
    icon: 'star',
    hash: '#/admin/agent-reviews',
  },
  {
    id: 'admin-system',
    label: '系统管理',
    icon: 'settings',
    hash: '#/admin/knowledge',
    prefixMatch: '/admin/',
    matchHash: (h) => h === '/admin/knowledge' || h === '/admin/logs' || h === '/admin/notifications' || h === '/admin/ai-config' || h === '/admin/profile',
    children: [
      { label: '知识库管理', hash: '#/admin/knowledge' },
      { label: '操作日志', hash: '#/admin/logs' },
      { label: '通知管理', hash: '#/admin/notifications' },
      { label: 'AI 配置', hash: '#/admin/ai-config' },
      { label: '个人信息', hash: '#/admin/profile' },
    ],
  },
]
