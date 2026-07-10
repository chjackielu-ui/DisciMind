// 学习引导老师 — 系统提示词
// 职责：在 Dify Agent 执行期间为学生提供陪伴式引导，不替代正式教学

const GUIDE_SYSTEM_PROMPT = `你是 DisciMind 学研智擎中的"学习引导老师"。

你的职责不是替代正式教学 Agent，而是在学生学习的各个阶段提供简洁、自然、有陪伴感的引导。

必须遵守：
1. 使用简体中文。
2. 可以称呼学生为"同学"，但不要每个语句块都重复称呼。
3. 语气亲切、沉稳、专业，不幼稚。
4. 只使用输入中已经提供的信息。
5. 不得编造正式 Agent 的结果。
6. 不生成正式习题答案（包括选项分析、排除理由、正确选项暗示）。
7. 不输出 Markdown 标题、JSON、编号列表。
8. 使用 <<<BLOCK>>> 分隔语句块。
9. 每个语句块 25～100 个中文字符，每块 1～3 句完整语句。

-- 阶段特定规则 --

enter（进入节点）：
输出 3～5 个语句块，总长度不超过 350 个中文字符。
欢迎学生，说明知识点，说明当前节点目标，简述接下来的学习流程。

waiting（等待准备）：
输出 2～3 个语句块，提供一条准备思考，不要只说等待。

ready（内容就绪）：
输出 1～2 个语句块，告诉学生内容已准备好，引导开始阅读。

transition（节点切换）：
输出 2～3 个语句块，总结当前阶段，简要预告下一节点。

before_question（出题前提示）：
输出 1～2 个语句块，总长度 50～180 字。
提供一条思考方向，提醒关注考点。
严禁：直接给出答案、说"正确答案是"、明确排除具体选项。
如果输入含“当前提示层级”：第 1 层只给宽泛思路；第 2 层可以指出应回忆的概念或步骤；任何层级都不能泄露答案。

after_answer_correct（回答正确后）：
输出 2～3 个语句块，总长度 80～200 字。
第一块简单肯定，第二块说明答对的关键，第三块衔接下一题。
不重复完整解析。

after_answer_wrong（回答错误后）：
输出 2～3 个语句块，总长度 80～250 字。
第一块不责备，第二块简述误区并引导阅读正式解析，第三块提示下一题注意什么。

round_summary（若干题后小结）：
输出 2～3 个语句块，总长度 100～250 字。
总结当前表现，指出一个优势和一个待改进点。

node_complete（节点完成）：
输出 2～4 个语句块，总长度 100～300 字。
总结本轮练习，说明为什么进入下一节点。

paused / resumed / failed：继续使用原有规则。`;

function buildGuideUserMessage(context) {
  const phase = context.phase || 'enter';
  const courseName = context.courseName || '未知课程';
  const knowledgePointName = context.knowledgePointName || '未知知识点';
  const flowName = context.flowName || '';
  const currentNodeName = context.currentNodeName || '当前节点';
  const currentNodeType = context.currentNodeType || '';
  const currentNodeIndex = context.currentNodeIndex != null ? context.currentNodeIndex : 1;
  const totalNodeCount = context.totalNodeCount != null ? context.totalNodeCount : 1;
  const estimatedMinutes = context.estimatedMinutes || 5;
  const nextNodeName = context.nextNodeName || '';
  const formalAgentName = context.formalAgentName || '教学Agent';
  const formalAgentStatus = context.formalAgentStatus || 'preparing';
  const currentMastery = context.currentMastery;

  const baseInfo = [
    `课程：${courseName}`,
    `知识点：${knowledgePointName}`,
    `学习流：${flowName || '自定义学习流'}`,
    `当前节点：${currentNodeName}（第 ${currentNodeIndex}/${totalNodeCount} 个节点）`,
    `节点类型：${currentNodeType}`,
    `预计用时：${estimatedMinutes} 分钟`,
    `正式教学 Agent：${formalAgentName}`,
    `Agent 状态：${formalAgentStatus}`,
  ];

  if (nextNodeName) {
    baseInfo.push(`下一节点：${nextNodeName}`);
  }
  if (currentMastery != null) {
    baseInfo.push(`当前掌握度：${Math.round(currentMastery)}%`);
  }

  const phaseDescriptions = {
    enter: '学生刚刚进入本节点，请进行欢迎和节点介绍。',
    waiting: '正式教学 Agent 正在后台准备内容，请在等待期间引导学生思考。',
    ready: '正式教学 Agent 已完成内容生成，请引导学生开始阅读。',
    transition: '当前节点已完成，即将进入下一节点，请总结当前阶段并简要预告下一节点。',
    paused: '学生已暂停学习，请告知进度已保存。',
    resumed: '学生已恢复学习，请告知将从当前节点继续。',
    failed: '正式教学 Agent 执行失败，请安抚学生并给出可操作建议。',
    before_question: '即将展示一道练习题，请提供答题方向和考点提示。严禁给出正确答案或排除具体选项。',
    after_answer_correct: '学生回答正确，请肯定并说明关键点。',
    after_answer_wrong: '学生回答错误，请安慰并引导阅读正式解析。',
    round_summary: '已完成多道练习，请总结当前表现。',
    node_complete: '练习节点已完成，请总结本轮练习并说明后续安排。',
  };

  // Add extra context for Trainer phases
  let extraLines = [];
  if (context.question) {
    const q = context.question;
    extraLines.push(`题目序号：第 ${q.sequence || 1} 题`);
    extraLines.push(`题目类型：${q.type || '选择题'}`);
    extraLines.push(`题目内容：${q.stem || ''}`.slice(0, 200));
    if (q.options && q.options.length > 0) {
      extraLines.push(`选项：${q.options.map(o => o.key + '. ' + (o.text || '')).join('；')}`.slice(0, 200));
    }
    extraLines.push(`难度：${q.difficulty || 'medium'}`);
  }
  if (context.progress) {
    extraLines.push(`已答题数：${context.progress.answeredCount || 0}`);
    extraLines.push(`计划题数：${context.progress.plannedQuestionCount ?? '未知'}`);
    if (context.progress.correctCount != null) extraLines.push(`答对题数：${context.progress.correctCount}`);
    if (context.progress.minQuestionCount != null) extraLines.push(`最少题数：${context.progress.minQuestionCount}`);
    if (context.progress.maxQuestionCount != null) extraLines.push(`最多题数：${context.progress.maxQuestionCount}`);
    if (context.progress.targetMastery != null) extraLines.push(`目标掌握度：${context.progress.targetMastery}%`);
    if (context.progress.currentMastery != null) extraLines.push(`练习当前掌握度：${Math.round(context.progress.currentMastery)}%`);
  }
  if (context.answeredCount != null && context.plannedQuestionCount == null) {
    extraLines.push(`已完成：${context.answeredCount} 题`);
  }
  if (context.studentAnswer) {
    extraLines.push(`学生答案：${context.studentAnswer}`);
    extraLines.push(`正确答案：${context.correctAnswer || ''}`);
    extraLines.push(`是否正确：${context.isCorrect ? '是' : '否'}`);
  }
  if (context.analysisSummary) {
    extraLines.push(`解析摘要：${String(context.analysisSummary).slice(0, 150)}`);
  }
  if (context.accuracy != null) {
    extraLines.push(`当前正确率：${Math.round(context.accuracy * 100)}%`);
  }
  if (context.reason) {
    extraLines.push(`完成原因：${context.reason}`);
  }
  if (context.errorType) extraLines.push(`本题错误类型：${context.errorType}`);
  if (context.attemptCount != null) extraLines.push(`当前尝试次数：${context.attemptCount}`);
  if (Array.isArray(context.recentQuestions) && context.recentQuestions.length) {
    extraLines.push(`最近答题：${context.recentQuestions.map((item) => `${item.questionKey || '题目'}:${item.isCorrect ? '正确' : '错误'}`).join('；')}`);
  }
  if (context.hintLevel != null) extraLines.push(`当前提示层级：第 ${context.hintLevel} 层`);

  const extraInfo = extraLines.length > 0 ? '\n\n补充信息：\n' + extraLines.join('\n') : '';

  return `${baseInfo.join('\n')}${extraInfo}

当前阶段：${phase}
阶段说明：${phaseDescriptions[phase] || '请根据上下文提供引导。'}

请使用 <<<BLOCK>>> 分隔每个语句块。`;
}

module.exports = {
  GUIDE_SYSTEM_PROMPT,
  buildGuideUserMessage,
};
