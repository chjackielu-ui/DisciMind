export const STUDENT_MENU_ITEMS = [
  { id: 'student-dashboard', label: '首页', icon: 'home', hash: '#/student/dashboard' },
  { id: 'student-courses', label: '我的课程', icon: 'book', hash: '#/student/courses', matchHash: (h) => h === '/student/courses' || /^\/student\/courses\/\d+/.test(h) || /^\/student\/tasks\/\d+\/answer$/.test(h) || /^\/student\/submissions\/\d+\/result$/.test(h) },
  { id: 'student-practice', label: '智能学习', icon: 'star', hash: '#/student/practice', matchHash: (h) => h === '/student/practice' || /^\/student\/practice\/sessions\/\d+$/.test(h) || h === '/student/trainer' || /^\/student\/trainer\/sessions\/\d+$/.test(h) || h === '/student/agents/trainer' || h === '/student/wrong-questions' || h === '/student/recommendations' || h === '/student/videos' || h === '/student/documents' },
  { id: 'student-ai-chat', label: 'AI对话', icon: 'message', hash: '#/student/ai-chat' },
  { id: 'student-portrait', label: '学习分析', icon: 'chart', hash: '#/student/portrait' },
  { id: 'student-profile', label: '个人主页', icon: 'user', hash: '#/student/profile' },
]
