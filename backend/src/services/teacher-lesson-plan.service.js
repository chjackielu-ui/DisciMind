// 教师端智能教案生成服务
// 负责：数据采集、关键词提取、词云分析、教案内容生成、DOCX 导出

const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs/promises');
const keywordCloudService = require('./teacher-keyword-cloud.service');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, HeadingLevel, BorderStyle, WidthType,
  AlignmentType, LevelFormat,
} = require('docx');

// ---------- 常量 ----------
const STORAGE_ROOT = path.resolve(__dirname, '../../storage/lesson-plans');
const ACCENT = '1F4E79';
const DARK = '1F2933';
const MUTED = '5F6B73';
const LIGHT_BG = 'EAF0F3';

// ---------- 辅助函数 ----------
function toLower(v) { return v == null ? null : String(v).toLowerCase(); }

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

function escapeHtml(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 词云关键词分析（核心）----------
// 统一使用 teacher-keyword-cloud.service 的算法，与学情词云保持一致
async function extractKeywords(courseId, teachingClassId, limit = 20) {
  const cloudResult = await keywordCloudService.computeKeywordCloud({
    courseId,
    teachingClassId,
    limit,
  });

  // 将统一输出格式映射为教案模块所需的字段名
  return cloudResult.word_cloud.map(item => ({
    word: item.keyword,
    frequency: item.count,
    difficulty: item.difficulty,
    category: item.category,
    source: 'keyword_cloud',
    score: item.score,
    student_count: item.student_count,
    related_kp: item.related_kp,
  }));
}

// ---------- 学情数据采集 ----------
async function collectLearningData(courseId, teachingClassId) {
  // 学生人数
  const studentCount = await prisma.studentCourseEnrollment.count({
    where: { course_id: courseId, enrollment_status: 'active' },
  });

  // 平均掌握度
  const masteryAgg = await prisma.studentMasteryRecord.aggregate({
    _avg: { mastery_score: true },
    where: { course_id: courseId },
  });
  const avgMastery = Math.round(masteryAgg._avg.mastery_score || 0);

  // 薄弱知识点
  const weakKps = await prisma.studentMasteryRecord.findMany({
    where: { course_id: courseId, mastery_level: 'WEAK' },
    include: { knowledge_point: true },
    take: 10,
  });

  // 提问数
  const questionCount = await prisma.studentQuestionRecord.count({
    where: { course_id: courseId },
  });

  // 错题数
  const wrongCount = await prisma.wrongQuestion.count({
    where: { course_id: courseId, status: { not: 'REMOVED' } },
  });

  return {
    student_count: studentCount,
    average_mastery: avgMastery,
    weak_knowledge_points: weakKps.map(w => w.knowledge_point?.knowledge_point_name).filter(Boolean),
    question_count: questionCount,
    wrong_question_count: wrongCount,
  };
}

// ---------- 生成教案内容 ----------
function generateLessonPlanContent(params, keywords, learningData) {
  const {
    course_name, course_code, subject_category,
    teacher_name, class_name, teaching_date,
    period, lesson_type, venue, teaching_material,
    topic,
  } = params;

  const dateStr = teaching_date || now().slice(0, 10);

  // --- 学情分析 ---
  const weakKpText = learningData.weak_knowledge_points.length > 0
    ? learningData.weak_knowledge_points.slice(0, 5).join('、')
    : '暂无明确薄弱数据，建议通过课堂提问进一步诊断';
  const studentAnalysis = `${course_name}课程当前班级共${learningData.student_count}名学生。`
    + `班级平均掌握度为${learningData.average_mastery}分，`
    + (learningData.average_mastery >= 70 ? '整体基础较好。' : '整体基础一般，需要加强基础巩固。')
    + `近期学生提问共${learningData.question_count}条，错题记录${learningData.wrong_question_count}条。`
    + `薄弱知识点主要集中在：${weakKpText}。`
    + '学生整体学习主动性较好，但部分学生在概念理解和计算应用方面仍存在困难，'
    + '需要在本节课中通过案例分析和对比讲解进行强化。';

  // --- 上一节课复盘模块（核心）---
  const keywordRows = keywords.map((k, i) => ({
    index: i + 1,
    word: k.word,
    frequency: k.frequency,
    category: k.category,
    difficulty: k.difficulty,
    note: k.difficulty === '高' ? '需重点讲解' : k.difficulty === '中' ? '需关注' : '简要提及',
  }));

  const highDiffKeywords = keywords.filter(k => k.difficulty === '高');
  const midDiffKeywords = keywords.filter(k => k.difficulty === '中');
  const confusionKeywords = keywords.filter(k => k.category === '易错理解类');
  const conceptKeywords = keywords.filter(k => k.category === '核心概念类');

  // 复盘结论
  let reviewConclusion = '';
  if (keywords.length === 0) {
    reviewConclusion = '目前暂无充足的上一节课关键词数据。建议教师在课堂开始时通过快速提问或小测验了解学生掌握情况，再动态调整本节课教学内容。';
  } else {
    const topWords = keywords.slice(0, 3).map(k => `"${k.word}"`).join('、');
    const highWords = highDiffKeywords.map(k => `"${k.word}"`).join('、');
    const confWords = confusionKeywords.map(k => `"${k.word}"`).join('、');

    reviewConclusion = `基于对上一节课相关学习数据的词云分析，共提取关键词${keywords.length}个。`
      + `其中高频关键词为${topWords}，出现频次最高，说明学生对这些内容的关注度和困惑度最为集中。`
      + (highWords ? `难度评价为"高"的关键词有${highWords}，对应知识点理解难度大，是需要优先解决的教学重点。` : '')
      + (confWords ? `易错理解类关键词有${confWords}，反映出学生在这些概念上存在理解偏差，需要通过对比讲解或案例分析来澄清。` : '')
      + `整体来看，上节课内容中${highDiffKeywords.length > 0 ? `${highDiffKeywords.length}个高难度知识点` : '核心知识点的理解深度尚可'}`
      + `${midDiffKeywords.length > 0 ? `，${midDiffKeywords.length}个中等难度知识点需要进一步巩固` : ''}。`
      + '建议本节课首先对上节课核心内容进行简要复盘，再针对高频困惑点展开深入讲解。';
  }

  // 调整策略
  let adjustStrategy = '';
  if (keywords.length > 0) {
    const priorityReview = highDiffKeywords.slice(0, 3).map(k => `"${k.word}"`).join('、');
    const needCase = confusionKeywords.slice(0, 2).map(k => `"${k.word}"`).join('、');

    adjustStrategy = `基于词云复盘分析，本节课的教学调整策略如下：\n`
      + (priorityReview ? `1. 优先复讲内容：${priorityReview}等高频难点知识点应在课堂导入或复盘环节进行简要回顾。\n` : '')
      + (needCase ? `2. 案例强化：针对${needCase}等易混淆概念，建议设计对比案例或类比讲解，帮助学生澄清理解偏差。\n` : '')
      + `3. 练习设计：增加与高频关键词相关的变式练习，让学生在应用中巩固理解。\n`
      + `4. 重点关注：对${learningData.student_count}名学生中掌握度较低（低于60分）的群体，在课堂互动环节给予更多关注和提问机会。\n`
      + `5. 板书配合：在高频关键词对应的知识点讲解时，配合板书图示或思维导图，强化视觉记忆。`;
  } else {
    adjustStrategy = '由于缺乏上节课关键词数据，建议通过课前小测或提问了解学生基础后灵活调整。';
  }

  // --- 教学目标 ---
  const knowledgeGoal = `掌握${topic || course_name}的核心概念与基本方法，理解其在${subject_category || '本学科'}中的应用场景。`;
  const abilityGoal = `能够运用${topic || course_name}的相关知识分析和解决实际问题，培养逻辑思维和知识迁移能力。`;
  const emotionGoal = `激发学生对${topic || course_name}的学习兴趣，培养严谨治学的科学态度和团队协作精神。`;

  // --- 教学重点 ---
  const keyPoints = [
    `掌握${topic || course_name}的核心概念与基本原理`,
    ...(highDiffKeywords.length > 0 ? [`理解并解决${highDiffKeywords.slice(0, 2).map(k => k.word).join('、')}等高频难点问题`] : []),
    `能够运用所学知识进行实际案例分析`,
  ].slice(0, 3);

  // --- 教学难点 ---
  const difficulties = [
    ...(confusionKeywords.length > 0 ? [`辨析${confusionKeywords.slice(0, 2).map(k => k.word).join('、')}等易混淆概念`] : [`对${topic || course_name}核心概念的深入理解和灵活应用`]),
    `将理论知识转化为解决实际问题的能力`,
    ...(highDiffKeywords.length > 0 ? [`突破${highDiffKeywords[0]?.word || '关键难点'}的学习障碍`] : []),
  ].slice(0, 3);

  // --- 教学方法 ---
  const methods = ['讲授法', '案例分析法', '问题驱动法', '分组讨论法', '练习反馈法'];
  methods.push('AI辅助教学法');

  // --- 教学准备 ---
  const teacherPrep = `准备${topic || course_name}相关的多媒体课件、教学案例、练习题及课堂互动材料；提前查看上节课词云分析数据；准备板书设计大纲。`;
  const studentPrep = `复习上节课所学内容；预习本节课${topic || course_name}相关教材内容；整理上节课遗留问题。`;

  // --- 教学过程 ---
  const teachingProcess = [
    {
      stage: '导入（5分钟）',
      teacherActivity: `通过提问或情境导入，引出本节课主题"${topic || course_name}"，激发学生兴趣。`,
      studentActivity: '思考教师提出的问题，进入学习状态。',
      intent: '激活学生已有知识，为新内容学习做铺垫。',
    },
    {
      stage: '复盘承接（8分钟）',
      teacherActivity: `基于词云分析结果，简要回顾上节课${highDiffKeywords.slice(0, 2).map(k => k.word).join('、')}等关键内容，针对性解答学生的共同困惑。`,
      studentActivity: '回顾上节课知识，对照自己的理解查漏补缺。',
      intent: '衔接上节课内容，解决遗留问题，为本节课学习扫清障碍。',
    },
    {
      stage: '新知讲授（15分钟）',
      teacherActivity: `系统讲解${topic || course_name}的核心概念、原理和方法，结合案例进行分析，重点突破高频关键词对应的难点。`,
      studentActivity: '认真听讲，做好笔记，积极思考教师提出的问题。',
      intent: '传授新知识，确保学生建立正确的知识框架。',
    },
    {
      stage: '互动探究（10分钟）',
      teacherActivity: '设计小组讨论或课堂练习任务，巡视指导，解答学生疑问。',
      studentActivity: '分组讨论或独立完成练习，展示成果，互相评价。',
      intent: '通过互动深化理解，培养学生合作学习和独立思考能力。',
    },
    {
      stage: '练习巩固（7分钟）',
      teacherActivity: '布置与本节课重难点相关的练习题，重点关注易错理解类关键词对应的练习。',
      studentActivity: '独立完成练习题，检验学习效果。',
      intent: '通过练习巩固所学知识，及时发现和纠正理解偏差。',
    },
    {
      stage: '总结提升（3分钟）',
      teacherActivity: `总结本节课${topic || course_name}的核心内容，强调重点难点，预告下节课内容。`,
      studentActivity: '回顾本节课所学，构建知识框架。',
      intent: '帮助学生形成完整的知识结构，提升学习效果。',
    },
    {
      stage: '作业布置（2分钟）',
      teacherActivity: '布置分层作业，说明作业要求和提交时间。',
      studentActivity: '记录作业内容，明确作业要求。',
      intent: '巩固课堂所学，为下节课做准备。',
    },
  ];

  // --- 评价设计 ---
  const evaluation = {
    process: '通过课堂提问、小组讨论表现、课堂练习完成情况等维度进行过程性评价。',
    result: '通过课后作业和阶段测验检验学生学习效果。',
    data: '结合学习平台记录的答题数据、提问数据、词云分析数据等进行数据辅助评价。',
  };

  // --- 板书设计 ---
  const boardDesign = `主题：${topic || course_name}\n\n`
    + `一、核心概念\n  1. ${conceptKeywords.slice(0, 2).map(k => k.word).join('\n  2. ')}\n\n`
    + `二、知识结构\n` + (keywords.slice(0, 4).map((k, i) => `  ${i + 1}. ${k.word}`).join('\n')) + '\n\n'
    + `三、重点难点\n  ${highDiffKeywords.map(k => k.word).join(' / ')}\n\n`
    + `四、方法与步骤\n\n`
    + `五、结论与应用`;

  // --- 作业设计 ---
  const homework = {
    basic: `完成${topic || course_name}相关基础练习题，巩固核心概念。`,
    advanced: `完成${topic || course_name}综合应用题，培养知识迁移能力。`,
    preview: `预习下节课内容，整理预习中遇到的问题。`,
  };

  // --- 课后反思 ---
  const reflection = `教学目标达成情况：____________________\n\n`
    + `教学重点落实情况：____________________\n\n`
    + `教学难点突破情况：____________________\n\n`
    + `学生参与与反馈情况：____________________\n\n`
    + `词云复盘与本节教学衔接效果：____________________\n\n`
    + `后续改进建议：____________________`;

  // 构建完整教案
  return {
    basicInfo: {
      course_name, course_code, subject_category,
      teacher_name, class_name, teaching_date: dateStr,
      period, lesson_type, venue, teaching_material, topic,
    },
    student_analysis: studentAnalysis,
    review_module: {
      keyword_source: '上一节课学生提问记录、错题文本、学习平台问答文本、学生讨论区发言、课后困惑反馈、AI 提问关键词',
      keyword_table: keywordRows,
      keyword_analysis: {
        concept_keywords: conceptKeywords.map(k => ({ word: k.word, frequency: k.frequency, difficulty: k.difficulty })),
        method_keywords: keywords.filter(k => k.category === '方法步骤类').map(k => ({ word: k.word, frequency: k.frequency, difficulty: k.difficulty })),
        mistake_keywords: confusionKeywords.map(k => ({ word: k.word, frequency: k.frequency, difficulty: k.difficulty })),
        emotion_keywords: keywords.filter(k => k.category === '情绪反馈类').map(k => ({ word: k.word, frequency: k.frequency, difficulty: k.difficulty })),
      },
      review_conclusion: reviewConclusion,
      adjust_strategy: adjustStrategy,
    },
    teaching_goals: {
      knowledge: knowledgeGoal,
      ability: abilityGoal,
      emotion: emotionGoal,
    },
    key_points: keyPoints,
    difficulties: difficulties,
    methods: methods,
    preparation: {
      teacher: teacherPrep,
      student: studentPrep,
    },
    teaching_process: teachingProcess,
    evaluation: evaluation,
    board_design: boardDesign,
    homework: homework,
    reflection: reflection,
  };
}

// ---------- 生成 DOCX ----------
function buildDocx(plan) {
  const { basicInfo, student_analysis, review_module, teaching_goals, key_points, difficulties, methods, preparation, teaching_process, evaluation, board_design, homework, reflection } = plan;
  const children = [];

  // 字体设置
  const font = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' };

  // 辅助函数
  const p = (text, opts = {}) => new Paragraph({
    spacing: { after: opts.after ?? 120, line: opts.line ?? 300 },
    alignment: opts.alignment,
    heading: opts.heading,
    bullet: opts.bullet,
    children: [new TextRun({ text: String(text ?? ''), bold: opts.bold, italics: opts.italics, color: opts.color || DARK, size: opts.size || 22, font })],
  });

  const h1 = (text) => p(text, { heading: HeadingLevel.HEADING_1, bold: true, color: ACCENT, size: 28, after: 200 });
  const h2 = (text) => p(text, { heading: HeadingLevel.HEADING_2, bold: true, color: ACCENT, size: 24, after: 160 });
  const h3 = (text) => p(text, { heading: HeadingLevel.HEADING_3, bold: true, color: DARK, size: 22, after: 120 });
  const bullet = (text) => p(text, { bullet: { level: 0 }, after: 80, size: 21 });

  function metaTable(rows) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, bottom: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, left: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, right: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, insideHorizontal: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 }, insideVertical: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 } },
      rows: rows.map(([label, value]) => new TableRow({
        children: [
          new TableCell({ shading: { fill: LIGHT_BG }, width: { size: 22, type: WidthType.PERCENTAGE }, children: [p(label, { bold: true, color: ACCENT, after: 0, size: 20 })] }),
          new TableCell({ width: { size: 78, type: WidthType.PERCENTAGE }, children: [p(value || '-', { after: 0, size: 20 })] }),
        ],
      })),
    });
  }

  // ---- 标题页 ----
  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 100 }, children: [new TextRun({ text: '教  案', bold: true, size: 44, color: ACCENT, font })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: `${basicInfo.course_name} · ${basicInfo.topic || basicInfo.course_name}`, size: 28, color: MUTED, font })] }),
    p(''),
  );

  // ---- 基本信息 ----
  children.push(h1('一、基本信息'));
  children.push(metaTable([
    ['课程名称', basicInfo.course_name],
    ['授课主题', basicInfo.topic || basicInfo.course_name],
    ['授课教师', basicInfo.teacher_name],
    ['授课班级', basicInfo.class_name],
    ['授课日期', basicInfo.teaching_date],
    ['课时安排', basicInfo.period],
    ['课型', basicInfo.lesson_type],
    ['授课地点', basicInfo.venue],
    ['使用教材/资源', basicInfo.teaching_material],
  ]));

  // ---- 学情分析 ----
  children.push(h1('二、学情分析'));
  children.push(p(student_analysis, { after: 160 }));

  // ---- 上节课复盘模块 ----
  children.push(h1('三、上一节课复盘模块'));
  children.push(h2('1. 词云数据来源'));
  children.push(p(review_module.keyword_source, { after: 120 }));

  children.push(h2('2. 关键词提取表'));
  // 关键词表格
  const kwWidths = [8, 25, 15, 22, 15, 15];
  const kwHeaderRow = new TableRow({
    children: kwWidths.map((w, i) => new TableCell({
      shading: { fill: ACCENT },
      width: { size: w, type: WidthType.PERCENTAGE },
      children: [p(['序号', '关键词', '出现频次', '关键词类型', '难度判断', '教师备注'][i], { bold: true, color: '#FFFFFF', after: 0, size: 20 })],
    })),
  });
  const kwRows = review_module.keyword_table.map(row => new TableRow({
    children: [
      ['8%', '25%', '15%', '22%', '15%', '15%'].map((w, i) => new TableCell({
        width: { size: parseInt(w), type: WidthType.PERCENTAGE },
        children: [p([String(row.index), row.word, String(row.frequency), row.category, row.difficulty, row.note][i], { after: 0, size: 19 })],
      })),
    ],
  }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, bottom: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, left: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, right: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, insideHorizontal: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 }, insideVertical: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 } },
    rows: [kwHeaderRow, ...kwRows],
  }));

  children.push(h2('3. 关键词归类分析'));

  // 核心概念类
  if (review_module.keyword_analysis.concept_keywords.length > 0) {
    children.push(h3('(1) 核心概念类'));
    review_module.keyword_analysis.concept_keywords.forEach(k => {
      children.push(bullet(`${k.word}（频次：${k.frequency}，难度：${k.difficulty}）`));
    });
  }
  // 方法步骤类
  const methodKws = review_module.keyword_analysis.method_keywords;
  if (methodKws.length > 0) {
    children.push(h3('(2) 方法步骤类'));
    methodKws.forEach(k => children.push(bullet(`${k.word}（频次：${k.frequency}，难度：${k.difficulty}）`)));
  }
  // 易错理解类
  if (review_module.keyword_analysis.mistake_keywords.length > 0) {
    children.push(h3('(3) 易错理解类'));
    review_module.keyword_analysis.mistake_keywords.forEach(k => children.push(bullet(`${k.word}（频次：${k.frequency}，难度：${k.difficulty}）`)));
  }
  // 情绪反馈类
  if (review_module.keyword_analysis.emotion_keywords.length > 0) {
    children.push(h3('(4) 情绪反馈类'));
    review_module.keyword_analysis.emotion_keywords.forEach(k => children.push(bullet(`${k.word}（频次：${k.frequency}，难度：${k.difficulty}）`)));
  }

  children.push(h2('4. 上一节课复盘结论'));
  children.push(p(review_module.review_conclusion, { after: 160 }));

  children.push(h2('5. 基于词云复盘的本节课调整策略'));
  review_module.adjust_strategy.split('\n').filter(l => l.trim()).forEach(line => {
    children.push(p(line.replace(/^\d+\.\s*/, ''), { bullet: { level: 0 }, after: 80, size: 21 }));
  });

  // ---- 教学目标 ----
  children.push(h1('四、教学目标'));
  children.push(h3('知识目标'));
  children.push(p(teaching_goals.knowledge, { after: 100 }));
  children.push(h3('能力目标'));
  children.push(p(teaching_goals.ability, { after: 100 }));
  children.push(h3('素养/情感目标'));
  children.push(p(teaching_goals.emotion, { after: 100 }));

  // ---- 教学重点 ----
  children.push(h1('五、教学重点'));
  key_points.forEach(kp => children.push(bullet(kp)));

  // ---- 教学难点 ----
  children.push(h1('六、教学难点'));
  difficulties.forEach(d => children.push(bullet(d)));

  // ---- 教学方法 ----
  children.push(h1('七、教学方法与教学策略'));
  methods.forEach(m => children.push(bullet(m)));

  // ---- 教学准备 ----
  children.push(h1('八、教学准备'));
  children.push(h3('教师准备'));
  children.push(p(preparation.teacher, { after: 100 }));
  children.push(h3('学生准备'));
  children.push(p(preparation.student, { after: 100 }));

  // ---- 教学过程 ----
  children.push(h1('九、教学过程设计'));

  // 教学过程表格
  const processHeaderRow = new TableRow({
    children: [
      ['12%', '35%', '30%', '23%'].map((w, i) => new TableCell({
        shading: { fill: ACCENT },
        width: { size: parseInt(w), type: WidthType.PERCENTAGE },
        children: [p(['教学环节', '教师活动', '学生活动', '设计意图'][i], { bold: true, color: '#FFFFFF', after: 0, size: 19 })],
      })),
    ],
  });
  const processRows = teaching_process.map(s => new TableRow({
    children: [
      ['12%', '35%', '30%', '23%'].map((w, i) => new TableCell({
        width: { size: parseInt(w), type: WidthType.PERCENTAGE },
        children: [p([s.stage, s.teacherActivity, s.studentActivity, s.intent][i], { after: 0, size: 19 })],
      })),
    ],
  }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, bottom: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, left: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, right: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, insideHorizontal: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 }, insideVertical: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 } },
    rows: [processHeaderRow, ...processRows],
  }));

  // ---- 课堂评价 ----
  children.push(h1('十、课堂评价设计'));
  children.push(h3('过程性评价'));
  children.push(p(evaluation.process, { after: 100 }));
  children.push(h3('结果性评价'));
  children.push(p(evaluation.result, { after: 100 }));
  children.push(h3('数据辅助评价'));
  children.push(p(evaluation.data, { after: 100 }));

  // ---- 板书设计 ----
  children.push(h1('十一、板书设计'));
  board_design.split('\n').forEach(line => {
    if (line.trim()) children.push(p(line.trim(), { after: 60, size: 21 }));
  });

  // ---- 作业设计 ----
  children.push(h1('十二、作业设计'));
  children.push(h3('基础作业'));
  children.push(p(homework.basic, { after: 100 }));
  children.push(h3('提升作业'));
  children.push(p(homework.advanced, { after: 100 }));
  children.push(h3('预习作业'));
  children.push(p(homework.preview, { after: 100 }));

  // ---- 课后反思 ----
  children.push(h1('十三、课后反思'));
  reflection.split('\n').forEach(line => {
    if (line.trim()) children.push(p(line.trim(), { after: 80, size: 21 }));
  });

  // 声明
  children.push(p(''));
  children.push(p('教案由 DisciMind 学研智擎智能教案生成系统辅助生成，内容仅供参考，请教师根据实际情况调整。', { color: MUTED, size: 18, italics: true, after: 40 }));

  return new Document({
    creator: 'DisciMind / 学研智擎',
    title: `${basicInfo.course_name}教案`,
    description: `${basicInfo.course_name}课程教案，${basicInfo.topic || ''}`,
    numbering: { config: [{ reference: 'lp-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 180 } } } }] }] },
    styles: {
      default: { document: { run: { font, size: 22, color: DARK }, paragraph: { spacing: { line: 300 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: ACCENT }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: DARK }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1200, bottom: 1200, left: 1200, header: 720, footer: 720 },
        },
      },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'DisciMind 智能教案  ·  学研智擎', color: MUTED, size: 18, font })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '— 第 ', color: MUTED, size: 18, font }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 18 }), new TextRun({ text: ' 页 —', color: MUTED, size: 18, font })] })] }) },
      children,
    }],
  });
}

// ---------- API 服务函数 ----------

async function generateLessonPlan(user, body) {
  const { course_id, teaching_class_id, topic, teaching_date, period, lesson_type, venue, teaching_material } = body;

  if (!course_id) throw Object.assign(new Error('请选择课程'), { code: 40001 });

  // 获取课程信息
  const course = await prisma.course.findUnique({ where: { course_id } });
  if (!course) throw Object.assign(new Error('课程不存在'), { code: 40002 });

  // 获取教师信息
  const teacherProfile = await prisma.userProfile.findUnique({ where: { user_id: user.user_id } });
  const teacherName = teacherProfile?.real_name || user.username || '未知教师';

  // 获取班级信息
  let className = '';
  if (teaching_class_id) {
    const tc = await prisma.teachingClass.findUnique({ where: { teaching_class_id } });
    if (tc) className = tc.teaching_class_name;
  }

  // 获取学情数据
  const learningData = await collectLearningData(course_id, teaching_class_id);

  // 提取关键词
  const keywords = await extractKeywords(course_id, teaching_class_id, 15);

  // 组装参数
  const params = {
    course_name: course.course_name,
    course_code: course.course_code,
    subject_category: course.subject_category,
    teacher_name: teacherName,
    class_name: className || `课程班级`,
    teaching_date: teaching_date || now().slice(0, 10),
    period: period || '1课时（45分钟）',
    lesson_type: lesson_type || '新授课',
    venue: venue || '',
    teaching_material: teaching_material || course.course_name + '教材及相关参考资料',
    topic: topic || course.course_name,
  };

  // 生成教案内容
  const plan = generateLessonPlanContent(params, keywords, learningData);

  return {
    plan,
    keywords,
    learning_data: learningData,
    generated_at: now(),
  };
}

async function exportLessonPlanDocx(user, body) {
  const result = await generateLessonPlan(user, body);
  const { plan } = result;

  // 生成 DOCX
  const document = buildDocx(plan);
  const buffer = await Packer.toBuffer(document);

  // 存储文件
  const dir = path.resolve(STORAGE_ROOT, String(user.user_id));
  await fs.mkdir(dir, { recursive: true });
  const ts = Date.now().toString(36);
  const fileName = `教案_${plan.basicInfo.course_name}_${(plan.basicInfo.teaching_date || '').replace(/[/\\]/g, '-')}_${ts}.docx`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);

  return {
    file_path: filePath,
    file_name: fileName,
    file_size: buffer.length,
    plan,
    generated_at: result.generated_at,
  };
}

// ---------- 异步任务接口 ----------

const tasks = require('../modules/async-task/async-task.service');

async function createGenerationTask(user, body) {
  const { course_id, teaching_class_id, topic, teaching_date, period, lesson_type, venue, teaching_material } = body;

  if (!course_id) throw Object.assign(new Error('请选择课程'), { code: 40001 });

  const course = await prisma.course.findUnique({ where: { course_id } });
  if (!course) throw Object.assign(new Error('课程不存在'), { code: 40002 });

  const operationId = `lesson-plan-${course_id}-${Date.now()}`;
  const task = await tasks.createTask(user.user_id, {
    operationId,
    taskType: 'LESSON_PLAN_GENERATION',
    title: `生成教案：${topic || course.course_name}`,
    description: `为 ${course.course_name} 课程生成智能教案`,
    status: 'QUEUED',
    stage: '等待生成',
    progressMode: 'DETERMINATE',
    progress: 0,
    relatedResourceType: 'COURSE',
    relatedResourceId: course_id,
    cancellable: false,
    metadataJson: {
      course_id,
      teaching_class_id: teaching_class_id || null,
      topic: topic || course.course_name,
      teaching_date: teaching_date || new Date().toISOString().slice(0, 10),
      period: period || '1课时（45分钟）',
      lesson_type: lesson_type || '新授课',
      venue: venue || '',
      teaching_material: teaching_material || `${course.course_name}教材及相关参考资料`,
    },
  });

  return task;
}

async function getGenerationTaskStatus(user, taskId) {
  return tasks.getTask(user.user_id, taskId);
}

module.exports = {
  extractKeywords,
  collectLearningData,
  generateLessonPlanContent,
  buildDocx,
  generateLessonPlan,
  exportLessonPlanDocx,
  createGenerationTask,
  getGenerationTaskStatus,
};
