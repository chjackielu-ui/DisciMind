export const STUDENT_MENU_ITEMS = [
  { label: '首页', icon: 'home', hash: '#/student/dashboard' },
  { label: '我的课程', icon: 'book', hash: '#/student/courses', matchHash: (h) => h === '/student/courses' || /^\/student\/courses\/\d+/.test(h) || /^\/student\/tasks\/\d+\/answer$/.test(h) || /^\/student\/submissions\/\d+\/result$/.test(h) },
  { label: '智能学习', icon: 'star', hash: '#/student/practice', matchHash: (h) => h === '/student/practice' || /^\/student\/practice\/sessions\/\d+$/.test(h) || h === '/student/wrong-questions' || h === '/student/recommendations' || h === '/student/videos' || h === '/student/documents' },
  { label: 'AI对话', icon: 'message', hash: '#/student/ai-chat' },
  { label: '学习分析', icon: 'user', hash: '#/student/portrait' },
  { label: '个人主页', icon: 'user', hash: '#/student/profile' },
]
