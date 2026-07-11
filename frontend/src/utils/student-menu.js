export const STUDENT_MENU_ITEMS = [
  { id: 'student-dashboard', label: '首页', icon: 'home', hash: '#/student/dashboard' },
  { id: 'student-courses', label: '我的课程', icon: 'book', hash: '#/student/courses', matchHash: (h) => h === '/student/courses' || /^\/student\/courses\/\d+/.test(h) || /^\/student\/tasks\/\d+\/answer$/.test(h) || /^\/student\/submissions\/\d+\/result$/.test(h) },
  { id: 'student-practice', label: '智能学习', icon: 'star', hash: '#/student/practice', matchHash: (h) => h === '/student/practice' || /^\/student\/practice\/sessions\/\d+$/.test(h) || h === '/student/trainer' || /^\/student\/trainer\/sessions\/\d+$/.test(h) || h === '/student/agents/trainer' || h === '/student/wrong-questions' || h === '/student/recommendations' || h === '/student/videos' || h === '/student/documents' },
  { id: 'student-learning-flows', label: '学习流', icon: 'workflow', hash: '#/student/learning-flows', matchHash: (h) => h === '/student/learning-flows' || /^\/student\/learning-flow\/editor\//.test(h) || /^\/student\/learning\/session\//.test(h) },
  { id: 'student-ai-chat', label: 'AI对话', icon: 'message', hash: '#/student/ai-chat' },
  { id: 'student-agent-market', label: '智能体广场', icon: 'star', hash: '#/student/agents', matchHash: (h) => h.startsWith('/student/agents') || h.startsWith('/student/generated-artifacts'), children: [
    { label: '发现智能体', hash: '#/student/agents' },
    { label: '我的智能体', hash: '#/student/agents/mine' },
    { label: '我的知识库', hash: '#/student/agents/knowledge' },
    { label: '我的收藏', hash: '#/student/agents/favorites' },
    { label: '生成文件', hash: '#/student/generated-artifacts', matchHash: (h) => h.startsWith('/student/generated-artifacts') },
    { label: '创建智能体', hash: '#/student/agents/create' },
  ]},
  { id: 'student-portrait', label: '学习分析', icon: 'chart', hash: '#/student/portrait' },
  { id: 'student-profile', label: '个人主页', icon: 'user', hash: '#/student/profile' },
]
