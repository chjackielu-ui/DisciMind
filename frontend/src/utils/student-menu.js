export const STUDENT_MENU_ITEMS = [
  { label: '首页', icon: 'home', hash: '#/student/dashboard' },
  { label: '我的课程', icon: 'book', hash: '#/student/courses', matchHash: (h) => h === '/student/courses' || /^\/student\/courses\/\d+/.test(h) || /^\/student\/tasks\/\d+\/answer$/.test(h) || /^\/student\/submissions\/\d+\/result$/.test(h) },
  { label: '智能练习', icon: 'star', hash: '#/student/practice', matchHash: (h) => h === '/student/practice' || /^\/student\/practice\/sessions\/\d+$/.test(h) },
  { label: '错题本', icon: 'alert', hash: '#/student/wrong-questions' },
  { label: '推荐学习', icon: 'star', hash: '#/student/recommendations' },
  { label: '学科答疑', icon: 'message', hash: '#/student/ai-chat' },
  { label: '知识库', icon: 'book', hash: '#/student/documents' },
  { label: '视频推荐', icon: 'star', hash: '#/student/videos' },
  { label: '学习画像', icon: 'user', hash: '#/student/portrait' },
  { label: '个人主页', icon: 'user', hash: '#/student/profile' },
]
