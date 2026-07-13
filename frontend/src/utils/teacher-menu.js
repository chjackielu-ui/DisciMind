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
    hash: '#/teacher/homework',
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
    label: '智能教案',
    icon: 'document',
    hash: '#/teacher/lesson-plan',
  },
  {
    id: 'teacher-knowledge',
    label: '知识库',
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
