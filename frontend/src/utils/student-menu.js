export const STUDENT_MENU_ITEMS = [
  { label: '首页', icon: 'home', hash: '#/student/dashboard' },
  { label: '我的课程', icon: 'book', hash: '#/student/courses', matchHash: (h) => h === '/student/courses' || /^\/student\/courses\/\d+/.test(h) },
  { label: '错题本', icon: 'alert', hash: '#/student/wrong-questions' },
  { label: '推荐学习', icon: 'star', hash: '#/student/recommendations' },
  { label: '学习画像', icon: 'user', hash: '#/student/portrait' },
  { label: '个人主页', icon: 'user', hash: '#/student/profile' },
  { label: 'AI 问答', icon: 'message', hash: '#/student/ai-chat' },
]
