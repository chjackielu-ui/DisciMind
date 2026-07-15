function skill(definition) {
  const allowedRoles = Object.freeze([...(definition.allowedRoles || ['student', 'teacher', 'admin'])]);
  const outputTypes = Object.freeze([...(definition.outputTypes || ['markdown_answer'])]);
  return Object.freeze({
    ...definition,
    description: definition.description || definition.name,
    intents: Object.freeze([...(definition.intents || [])]),
    requiredInputs: Object.freeze([...(definition.requiredInputs || ['query'])]),
    optionalInputs: Object.freeze([...(definition.optionalInputs || [])]),
    tools: Object.freeze([...(definition.tools || [])]),
    agents: Object.freeze([...(definition.agents || [])]),
    workflow: Object.freeze([...(definition.workflow || [])]),
    outputTypes,
    allowedRoles,
    // Compatibility fields used by the existing capability endpoint.
    roles: allowedRoles,
    output: outputTypes[0],
    triggers: Object.freeze([...(definition.triggers || [])]),
    riskLevel: definition.riskLevel || 'low',
  });
}

const SKILLS = Object.freeze([
  skill({ id: 'realtime_research', name: '实时信息检索', description: '对需要时效性的公开信息执行原生联网检索并核验来源。', intents: ['realtime_research'], requiredInputs: ['query'], optionalInputs: ['searchOptions'], tools: ['web_search'], agents: [], triggers: ['最新', '实时', '新闻', '价格', '天气', '版本'], workflow: ['识别时效性', '执行原生联网搜索', '核验来源', '带引用回答'], outputTypes: ['answer_with_sources'] }),
  skill({ id: 'knowledge_explain', name: '课程知识讲解', description: '处理课程概念、教材、知识库和学科例题问答。', intents: ['course_concept_qa', 'course_knowledge_qa'], requiredInputs: ['query'], optionalInputs: ['courseId', 'knowledgePointId', 'knowledgeBaseIds'], tools: ['knowledge_retrieve'], agents: ['subject_qa'], triggers: ['解释', '是什么', '原理', '举例', '知识库'], workflow: ['识别课程与知识点', '检索授权资料', '调用匹配的学科 Agent', '生成带来源回答'], outputTypes: ['markdown_answer', 'answer_with_sources'] }),
  skill({ id: 'student_learning_analytics', name: '本人学习数据分析', description: '只使用登录学生本人的 owner-bound 数据工具读取与分析真实学习数据。', intents: ['student_context', 'student_wrong_questions', 'student_learning_records', 'student_score_trend', 'student_mastery', 'student_recent_sessions', 'student_learning_time', 'student_task_completion', 'student_learning_analytics'], requiredInputs: ['authenticatedUser'], optionalInputs: ['courseId', 'knowledgePointId', 'days'], tools: ['get_current_student_context', 'get_student_wrong_questions', 'get_student_learning_records', 'get_student_score_trend', 'get_student_mastery', 'get_student_recent_sessions', 'get_student_learning_time', 'get_student_task_completion', 'create_chart_artifact'], agents: [], triggers: ['掌握', '薄弱', '错题', '学习情况', '成绩', '学习时长', '任务完成'], workflow: ['绑定登录学生', '读取真实记录', '计算统计指标', '按需生成图表', '标注统计口径'], outputTypes: ['analysis', 'chart_spec', 'table'], allowedRoles: ['student'] }),
  skill({ id: 'attachment_summary', name: '上传文件处理', description: '总结当前消息中已通过权限校验的附件内容。', intents: ['attachment_summary'], requiredInputs: ['query', 'attachments'], optionalInputs: ['courseId'], tools: [], agents: [], triggers: ['上传', '附件', 'PDF'], workflow: ['校验附件', '读取已提取文本', '生成总结'], outputTypes: ['markdown_answer'] }),
  skill({ id: 'chat_question_generation', name: '对话内出题', description: '只在当前对话中生成题目，不创建或导出文件。', intents: ['chat_question_generation'], requiredInputs: ['query'], optionalInputs: ['courseId', 'knowledgePointId', 'questionCount'], tools: [], agents: [], triggers: ['出题', '道题', '不生成文件'], workflow: ['识别范围', '生成题目', '检查题目质量'], outputTypes: ['structured_questions', 'markdown_answer'] }),
  skill({ id: 'artifact_generation', name: '受控成果生成', description: '为 DOCX、PDF 或 XLSX 等持久成果创建可恢复确认并在确认后生成。', intents: ['file_generation'], requiredInputs: ['query', 'authenticatedUser'], optionalInputs: ['courseId', 'knowledgePointId', 'knowledgeBaseIds', 'attachments'], tools: ['create_docx_artifact', 'create_xlsx_artifact'], agents: ['question_generation'], triggers: ['生成', '导出', '下载', 'DOCX', 'PDF', 'XLSX'], workflow: ['识别文件意图', '收集必要参数', '等待用户确认', '生成结构化内容', '保存成果'], outputTypes: ['artifact_confirmation', 'docx', 'pdf', 'xlsx'], riskLevel: 'high' }),
  skill({ id: 'visual_analysis', name: '图表可视化', description: '把受控工具返回的真实结构化指标转换为 ChartSpec 1.0。', intents: ['student_score_trend', 'student_mastery', 'student_learning_time', 'student_task_completion', 'student_learning_analytics'], requiredInputs: ['learningData'], optionalInputs: ['title', 'range'], tools: ['create_chart_artifact'], agents: [], triggers: ['图表', '可视化', '趋势', '对比'], workflow: ['规范数据', '构建 ChartSpec', '预检参数', '创建图表成果'], outputTypes: ['chart_spec', 'table', 'analysis'], riskLevel: 'medium' }),
  skill({ id: 'knowledge_cards', name: '知识卡片', description: '将真实课程概念整理为可保存的复习卡片。', intents: ['knowledge_cards'], requiredInputs: ['query'], optionalInputs: ['courseId', 'knowledgePointId', 'knowledgeBaseIds'], tools: ['create_knowledge_cards'], agents: [], triggers: ['卡片', '闪卡', '记忆', '复习卡'], workflow: ['提取概念', '生成问答卡', '预检结构', '保存成果'], outputTypes: ['knowledge_cards'], riskLevel: 'medium' }),
  // Existing teacher capabilities remain available and now expose the same contract fields.
  skill({ id: 'class_analytics', name: '班级学情分析', description: '在教师授权范围内聚合班级真实学情。', intents: ['class_analytics'], requiredInputs: ['courseId'], optionalInputs: ['teachingClassId', 'range'], tools: ['teacher_class_analytics', 'create_chart_artifact'], agents: [], triggers: ['班级', '学情', '风险学生'], workflow: ['校验教学班', '聚合真实数据', '生成图表与结论'], outputTypes: ['analysis', 'chart_spec'], allowedRoles: ['teacher', 'admin'], riskLevel: 'medium' }),
  skill({ id: 'lesson_preparation', name: '智慧备课', description: '检索授权课程资料并协作生成备课内容。', intents: ['lesson_preparation'], requiredInputs: ['query', 'courseId'], optionalInputs: ['knowledgePointId', 'knowledgeBaseIds'], tools: ['knowledge_retrieve', 'execute_agent', 'create_docx_artifact'], agents: ['lesson_preparation'], triggers: ['备课', '教案', '课堂设计'], workflow: ['解析教学目标', '检索资料', '协作生成', '成果确认'], outputTypes: ['lesson_material'], allowedRoles: ['teacher', 'admin'], riskLevel: 'medium' }),
  // Compatibility skill ids retained for callers and existing tests.
  skill({ id: 'question_generation', name: '受控试卷生成', description: '生成需要持久化的试卷内容，必须经过成果确认。', intents: ['file_generation'], requiredInputs: ['query'], optionalInputs: ['courseId', 'knowledgePointId'], tools: ['knowledge_retrieve'], agents: ['question_generation'], triggers: ['练习卷', '试卷', '考卷'], workflow: ['确定范围', '创建持久确认', '用户确认', '进入文件生成图'], outputTypes: ['exam_artifact'], riskLevel: 'high' }),
  skill({ id: 'document_generation', name: 'Word 文档生成', description: '生成经过确认的 DOCX 成果。', intents: ['file_generation'], requiredInputs: ['title', 'sections'], optionalInputs: [], tools: ['create_docx_artifact'], agents: [], triggers: ['Word', 'DOCX', '文档', '讲义'], workflow: ['收集需求', '确认写入', '生成文档'], outputTypes: ['docx'], riskLevel: 'high' }),
  skill({ id: 'spreadsheet_generation', name: 'Excel 数据表生成', description: '生成经过确认的 XLSX 成果。', intents: ['file_generation'], requiredInputs: ['title', 'columns', 'rows'], optionalInputs: ['sheetName'], tools: ['create_xlsx_artifact'], agents: [], triggers: ['Excel', 'XLSX', '表格', '清单'], workflow: ['校验结构', '确认写入', '生成工作簿'], outputTypes: ['xlsx'], riskLevel: 'high' }),
]);

const BY_ID = new Map(SKILLS.map(item => [item.id, item]));

function scoreSkill(value, text) {
  return value.triggers.reduce((score, trigger) => score + (String(text).toLowerCase().includes(String(trigger).toLowerCase()) ? 1 : 0), 0);
}

function getSkillsByIds(ids = [], role) {
  const normalizedRole = String(role || '').toLowerCase();
  return [...new Set(ids.map(String))].map(id => BY_ID.get(id)).filter(item => item?.allowedRoles.includes(normalizedRole));
}

function selectSkills(text, role, limit = 3, requestedIds = []) {
  const explicit = getSkillsByIds(requestedIds, role);
  if (explicit.length) return explicit.slice(0, Math.max(1, Number(limit) || 3));
  const normalizedRole = String(role || '').toLowerCase();
  return SKILLS.filter(value => value.allowedRoles.includes(normalizedRole))
    .map(value => ({ ...value, score: scoreSkill(value, text) }))
    .filter(value => value.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(5, Number(limit) || 3)));
}

function listSkills(role) {
  const normalized = String(role || '').toLowerCase();
  return SKILLS.filter(value => value.allowedRoles.includes(normalized));
}

module.exports = { SKILLS, scoreSkill, getSkillsByIds, selectSkills, listSkills };
