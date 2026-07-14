// 教师端标准侧边导航菜单
// 参考学生端 STUDENT_MENU_ITEMS 结构设计
// 所有菜单项平铺无 children（无下拉展开），顺序对齐学生端业务逻辑

export const TEACHER_MENU_ITEMS = [
  {
    id: 'teacher-dashboard',
    label: '工作台',
    icon: 'home',
    hash: '#/teacher/dashboard',
  },
  {
    id: 'teacher-system',
    label: '系统管理',
    icon: 'layout',
    hash: '#/teacher/system',
    matchHash: (h) => h === '/teacher/system' || h === '/teacher/courses' || /^\/teacher\/courses\/\d+/.test(h) || h === '/teacher/students' || /^\/teacher\/students\/\d+/.test(h) || h === '/teacher/classes',
  },
  {
    id: 'teacher-homework',
    label: '作业考试',
    icon: 'edit',
    hash: '#/teacher/tasks',
    matchHash: (h) => h === '/teacher/homework' || h === '/teacher/tasks' || /^\/teacher\/tasks\//.test(h),
  },
  {
    id: 'teacher-questions',
    label: '题库管理',
    icon: 'star',
    hash: '#/teacher/questions',
    matchHash: (h) => h === '/teacher/questions' || /^\/teacher\/questions\//.test(h),
  },
  {
    id: 'teacher-analytics',
    label: '学情分析',
    icon: 'chart',
    hash: '#/teacher/analytics',
  },
  {
    id: 'teacher-lesson-plan',
    label: '智慧备课',
    icon: 'document',
    hash: '#/teacher/preparation',
    matchHash: (h) => h === '/teacher/preparation' || h === '/teacher/preparation/immersive' || h === '/teacher/lesson-plan' || h === '/teacher/artifacts',
  },
  {
    id: 'teacher-artifacts',
    label: '产物中心',
    icon: 'folder',
    hash: '#/teacher/artifacts',
  },
  {
    id: 'teacher-ai',
    label: '教师 AI',
    icon: 'message',
    hash: '#/teacher/ai',
    matchHash: (h) => h === '/teacher/ai',
  },
  {
    id: 'teacher-agent-market',
    label: '智能体广场',
    icon: 'sparkles',
    hash: '#/teacher/agents',
    matchHash: (h) => /^\/teacher\/agents(?:\/|$)/.test(h),
  },
  {
    id: 'teacher-knowledge',
    label: '资源审核',
    icon: 'book',
    hash: '#/teacher/knowledge',
  },
  {
    id: 'teacher-profile',
    label: '个人中心',
    icon: 'user',
    hash: '#/teacher/profile',
  },
]
