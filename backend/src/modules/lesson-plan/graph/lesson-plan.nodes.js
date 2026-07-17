/**
 * 教师端智能教案生成 — Graph 节点实现
 *
 * 6 个节点：
 *   resolve_params → collect_learning_data → analyze_keywords
 *   → generate_content → build_docx → persist_and_finalize
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, HeadingLevel, BorderStyle, WidthType,
  AlignmentType, LevelFormat,
} = require('docx');
const prisma = require('../../../config/prisma');
const tasks = require('../../async-task/async-task.service');
const keywordCloudService = require('../../../services/teacher-keyword-cloud.service');

// ---- 常量 ----
const STORAGE_ROOT = path.resolve(__dirname, '../../../../storage/lesson-plans');
const ACCENT = '1F4E79';
const DARK = '1F2933';
const MUTED = '5F6B73';
const LIGHT_BG = 'EAF0F3';
const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' };

// ---- 进度回调 ----
async function progress(taskId, value, stage) {
  if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: value, stage });
}

// ===================================================================
// Node 1: resolve_params — 解析任务参数，加载课程/教师/班级信息
// ===================================================================
async function resolveParams(state) {
  const task = state.taskId
    ? await prisma.asyncTask.findUnique({ where: { id: Number(state.taskId) } })
    : null;
  const metadata = task?.metadataJson || {};
  const courseId = Number(metadata.course_id || state.courseId);
  const teachingClassId = metadata.teaching_class_id
    ? Number(metadata.teaching_class_id)
    : (state.teachingClassId || null);

  if (!courseId) {
    throw Object.assign(new Error('缺少课程 ID'), { code: 'MISSING_COURSE_ID', permanent: true });
  }

  const course = await prisma.course.findUnique({ where: { course_id: courseId } });
  if (!course) throw Object.assign(new Error('课程不存在'), { code: 'COURSE_NOT_FOUND', permanent: true });

  const userId = Number(state.userId || task?.userId);
  const teacherProfile = await prisma.userProfile.findUnique({ where: { user_id: userId } });
  const teacherName = teacherProfile?.real_name || '教师';

  let className = '课程班级';
  if (teachingClassId) {
    const tc = await prisma.teachingClass.findUnique({ where: { teaching_class_id: teachingClassId } });
    if (tc) className = tc.teaching_class_name;
  }

  await progress(state.taskId, 5, '正在解析教案参数');

  return {
    courseId,
    teachingClassId,
    userId,
    params: {
      courseName: course.course_name,
      courseCode: course.course_code,
      subjectCategory: course.subject_category,
      teacherName,
      className,
      teachingDate: metadata.teaching_date || new Date().toISOString().slice(0, 10),
      period: metadata.period || '1课时（45分钟）',
      lessonType: metadata.lesson_type || '新授课',
      venue: metadata.venue || '',
      teachingMaterial: metadata.teaching_material || `${course.course_name}教材及相关参考资料`,
      topic: metadata.topic || course.course_name,
    },
    stage: 'collect_learning_data',
  };
}

// ===================================================================
// Node 2: collect_learning_data — 采集学情数据
// ===================================================================
async function collectLearningData(state) {
  await progress(state.taskId, 10, '正在采集学情数据');

  const { runCollector } = require('../../learning-agent/agents/lesson-plan-collector.agent');
  const result = await runCollector({
    courseId: state.courseId,
    teachingClassId: state.teachingClassId,
  });

  if (result.normalizedOutput?.is_fallback) {
    console.warn(`[LessonPlan] Collector fallback: ${result.normalizedOutput.message}`);
  }

  return {
    learningData: result.normalizedOutput,
    stage: 'analyze_keywords',
  };
}

// ===================================================================
// Node 3: analyze_keywords — 词云提取 + LLM 深度分析
// ===================================================================
async function analyzeKeywords(state) {
  await progress(state.taskId, 25, '正在提取词云关键词');

  // 第一层：统计提取（仅使用学科专属助手对话数据源）
  const keywordCloud = await keywordCloudService.computeKeywordCloud({
    courseId: state.courseId,
    teachingClassId: state.teachingClassId || undefined,
    limit: 20,
    sources: ['ai_subject_conversation'],
  });

  // 空数据兜底：学科专属助手无对话数据时，跳过 LLM 分析，提供有效空结构
  if (!keywordCloud.word_cloud || keywordCloud.word_cloud.length === 0) {
    console.warn(`[LessonPlan] 学科专属助手无关键词数据 (courseId=${state.courseId})，跳过深度分析，使用空复盘结构`);
    const emptyAnalysis = {
      keyword_sources: ['当前课程暂无学科专属助手对话数据'],
      top_keywords: [],
      category_breakdown: {},
      high_frequency_concepts: [],
      common_misunderstandings: [],
      method_barriers: [],
      emotional_feedback_summary: '暂无学生情绪反馈数据',
      student_focus_points: [],
      student_confusion_points: [],
      student_error_prone_steps: [],
      review_conclusion: '当前课程暂无学生学科专属助手对话数据，无法生成基于真实提问的上节课复盘分析。建议教师在课堂开始时通过快速提问或小测验了解学生掌握情况，再动态调整本节课教学内容。',
      teaching_adjustments: [
        '由于缺乏学生学科助手对话数据，建议课堂开始时通过3-5分钟快速提问了解学生基础',
        '可结合通用学科知识体系设计教学内容',
        '重点讲解课程核心概念和常见难点',
        '在课堂互动中关注学生反馈，及时调整教学节奏',
        '课后建议学生多使用学科专属助手进行答疑，积累后续复盘数据',
      ],
    };
    return {
      keywordCloud: { word_cloud: [], total_students: 0, total_questions: 0 },
      keywordAnalysis: emptyAnalysis,
      hasStudentQuestions: false,  // 无学生提问数据 → 后续跳过复盘模块
      stage: 'generate_content',
    };
  }

  await progress(state.taskId, 40, '正在进行关键词深度分析');

  // 第二层：LLM 深度语义分析
  const { runAnalyzer } = require('../../learning-agent/agents/lesson-plan-analyzer.agent');
  const analysisResult = await runAnalyzer({
    keywordCloud,
    learningData: state.learningData,
    courseName: state.params.courseName,
  });

  if (analysisResult.normalizedOutput?.is_fallback) {
    console.warn(`[LessonPlan] Analyzer fallback: ${analysisResult.normalizedOutput.message}`);
  }

  return {
    keywordCloud,
    keywordAnalysis: analysisResult.normalizedOutput,
    hasStudentQuestions: true,  // 有学生提问数据 → 正常生成复盘模块
    stage: 'generate_content',
  };
}

// ===================================================================
// Node 4: generate_content — LLM 生成完整教案 JSON
// ===================================================================
async function generateContent(state) {
  await progress(state.taskId, 50, '正在生成教案内容');

  const { runGenerator } = require('../../learning-agent/agents/lesson-plan-generator.agent');
  const genResult = await runGenerator({
    params: state.params,
    learningData: state.learningData,
    keywordAnalysis: state.keywordAnalysis,
    hasStudentQuestions: state.hasStudentQuestions !== false,  // 传递标记给 Generator
  });

  if (genResult.normalizedOutput?.is_fallback) {
    throw Object.assign(
      new Error(genResult.normalizedOutput.message || '教案生成失败'),
      { code: 'GENERATION_FAILED', permanent: true },
    );
  }

  // 无学生提问数据时：移除复盘模块，确保不输出空模块名和空内容
  const lessonPlan = genResult.normalizedOutput;
  if (state.hasStudentQuestions === false && lessonPlan.review_module) {
    delete lessonPlan.review_module;
  }

  await progress(state.taskId, 75, '教案内容已生成');

  return {
    lessonPlan,
    stage: 'build_docx',
  };
}

// ===================================================================
// Node 5: build_docx — 程序化构建 DOCX 文件
// ===================================================================
function buildDocxDocument(plan) {
  const { basic_info, student_analysis, review_module, teaching_goals, key_points,
    difficulties, teaching_methods, teaching_preparation, teaching_process,
    evaluation_design, board_design, homework_design, reflection } = plan;

  const children = [];

  // 辅助段落
  const p = (text, opts = {}) => new Paragraph({
    spacing: { after: opts.after ?? 120, line: opts.line ?? 300 },
    alignment: opts.alignment,
    heading: opts.heading,
    bullet: opts.bullet,
    children: [new TextRun({ text: String(text ?? ''), bold: opts.bold, italics: opts.italics,
      color: opts.color || DARK, size: opts.size || 22, font: FONT })],
  });
  const h1 = (text) => p(text, { heading: HeadingLevel.HEADING_1, bold: true, color: ACCENT, size: 28, after: 200 });
  const h2 = (text) => p(text, { heading: HeadingLevel.HEADING_2, bold: true, color: ACCENT, size: 24, after: 160 });
  const h3 = (text) => p(text, { heading: HeadingLevel.HEADING_3, bold: true, color: DARK, size: 22, after: 120 });
  const bullet = (text) => p(text, { bullet: { level: 0 }, after: 80, size: 21 });

  function metaTable(rows) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
        bottom: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
        left: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
        right: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
        insideHorizontal: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 },
      },
      rows: rows.map(([label, value]) => new TableRow({
        children: [
          new TableCell({ shading: { fill: LIGHT_BG }, width: { size: 22, type: WidthType.PERCENTAGE },
            children: [p(label, { bold: true, color: ACCENT, after: 0, size: 20 })] }),
          new TableCell({ width: { size: 78, type: WidthType.PERCENTAGE },
            children: [p(value || '-', { after: 0, size: 20 })] }),
        ],
      })),
    });
  }

  // 兼容旧版（字符串类型）和新版（对象类型）的字段读取
  const sa = typeof student_analysis === 'string'
    ? { knowledge_foundation: student_analysis, cognitive_characteristics: '', common_problems: '', class_participation: '', teaching_entry_point: '' }
    : (student_analysis || {});
  const bd = typeof board_design === 'string'
    ? { theme: '', core_concepts: board_design, key_steps: '', common_mistakes: '', summary: '' }
    : (board_design || {});
  const ref = typeof reflection === 'string'
    ? { goal_achievement: reflection, key_points_implementation: '', difficulty_breakthrough: '', student_participation: '', review_teaching_connection: '', improvement_suggestions: '' }
    : (reflection || {});
  const methodsArr = Array.isArray(teaching_methods) && teaching_methods.length > 0 && typeof teaching_methods[0] === 'string'
    ? teaching_methods.map(m => ({ name: m, description: '' }))
    : (teaching_methods || []);

  // ---- 封面 ----
  children.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 100 },
      children: [new TextRun({ text: '教  案', bold: true, size: 44, color: ACCENT, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
      children: [new TextRun({ text: `${basic_info.course_name} · ${basic_info.topic || basic_info.course_name}`, size: 28, color: MUTED, font: FONT })] }),
    p(''),
  );

  // ===== 一、基本信息 =====
  children.push(h1('一、基本信息'));
  children.push(metaTable([
    ['课程名称', basic_info.course_name],
    ['授课主题', basic_info.topic],
    ['授课教师', basic_info.teacher_name],
    ['授课班级', basic_info.class_name],
    ['授课日期', basic_info.teaching_date],
    ['课时安排', basic_info.period],
    ['课型', basic_info.lesson_type],
    ['授课地点', basic_info.venue],
    ['使用教材/资源', basic_info.teaching_material],
  ]));

  // ===== 二、学情分析 =====
  children.push(h1('二、学情分析'));
  children.push(h3('学生已有知识基础')); children.push(p(sa.knowledge_foundation || '', { after: 100 }));
  children.push(h3('学生认知特点与学习习惯')); children.push(p(sa.cognitive_characteristics || '', { after: 100 }));
  children.push(h3('学生常见问题与薄弱点')); children.push(p(sa.common_problems || '', { after: 100 }));
  children.push(h3('班级整体参与度与差异情况')); children.push(p(sa.class_participation || '', { after: 100 }));
  children.push(h3('本节课教学切入点')); children.push(p(sa.teaching_entry_point || '', { after: 100 }));

  // ===== 三、上一节课复盘模块（有学生提问数据时才生成）=====
  if (review_module) {
    children.push(h1('三、上一节课复盘模块'));
    children.push(h2('1. 数据来源'));
    children.push(p(review_module.keyword_sources, { after: 120 }));
    children.push(h2('2. 关键词分析摘要'));
    children.push(p(review_module.keyword_summary, { after: 120 }));

    children.push(h2('3. 关键词归类'));
    if (review_module.concept_keywords && review_module.concept_keywords.length) {
      children.push(h3('核心概念类'));
      review_module.concept_keywords.forEach(k => children.push(bullet(k)));
    }
    if (review_module.method_keywords && review_module.method_keywords.length) {
      children.push(h3('方法步骤类'));
      review_module.method_keywords.forEach(k => children.push(bullet(k)));
    }
    if (review_module.mistake_keywords && review_module.mistake_keywords.length) {
      children.push(h3('易错理解类'));
      review_module.mistake_keywords.forEach(k => children.push(bullet(k)));
    }
    if (review_module.emotion_keywords && review_module.emotion_keywords.length) {
      children.push(h3('情绪反馈类'));
      review_module.emotion_keywords.forEach(k => children.push(bullet(k)));
    }

    // 结构化复盘子模块
    if (review_module.student_focus_points && review_module.student_focus_points.length) {
      children.push(h2('4. 学生最关注的知识点'));
      review_module.student_focus_points.forEach(fp => {
        children.push(bullet(`${fp.knowledge_point}（${fp.student_count}名学生提问${fp.question_frequency}次）：${fp.analysis}`));
      });
    }
    if (review_module.student_confusion_points && review_module.student_confusion_points.length) {
      children.push(h2('5. 学生最集中的困惑点'));
      review_module.student_confusion_points.forEach(cp => {
        children.push(bullet(`${cp.topic}（影响${cp.affected_student_count}人）：${cp.confusion_description}`));
      });
    }
    if (review_module.student_error_prone_steps && review_module.student_error_prone_steps.length) {
      children.push(h2('6. 学生最容易出错的环节'));
      review_module.student_error_prone_steps.forEach(es => {
        children.push(bullet(`${es.step} [严重度:${es.severity}]：${es.error_pattern}`));
      });
    }

    children.push(h2('7. 复盘结论'));
    children.push(p(review_module.review_conclusion, { after: 160 }));
    children.push(h2('8. 基于词云复盘的本节课调整策略'));
    (review_module.teaching_adjustments || []).forEach(a => children.push(bullet(a)));
  }

  // ===== 四、教学目标 =====
  children.push(h1('四、教学目标'));
  children.push(h3('知识目标')); children.push(p(teaching_goals.knowledge, { after: 100 }));
  children.push(h3('能力目标')); children.push(p(teaching_goals.ability, { after: 100 }));
  children.push(h3('素养/情感目标')); children.push(p(teaching_goals.emotion, { after: 100 }));

  // ===== 五、教学重点 =====
  children.push(h1('五、教学重点'));
  (key_points || []).forEach(kp => children.push(bullet(kp)));

  // ===== 六、教学难点 =====
  children.push(h1('六、教学难点'));
  (difficulties || []).forEach(d => children.push(bullet(d)));

  // ===== 七、教学方法与教学策略 =====
  children.push(h1('七、教学方法与教学策略'));
  methodsArr.forEach(m => {
    children.push(h3(m.name));
    if (m.description) children.push(p(m.description, { after: 80 }));
  });

  // ===== 八、教学准备 =====
  children.push(h1('八、教学准备'));
  children.push(h3('教师准备')); children.push(p(teaching_preparation.teacher, { after: 100 }));
  children.push(h3('学生准备')); children.push(p(teaching_preparation.student, { after: 100 }));

  // ===== 九、教学过程设计 =====
  children.push(h1('九、教学过程设计'));
  if (teaching_process && teaching_process.length) {
    const hasTiming = teaching_process.some(s => s.time_suggestion);
    const hasContent = teaching_process.some(s => s.teaching_content);
    const colCount = 4 + (hasTiming ? 1 : 0) + (hasContent ? 1 : 0);
    const timeWidth = hasTiming ? '10%' : '0%';
    const contentWidth = hasContent ? '20%' : '0%';
    const remainWidth = hasTiming && hasContent ? ['10%', '18%', '26%', '24%', '22%']
      : hasTiming ? ['10%', '32%', '32%', '26%']
      : ['38%', '33%', '29%'];

    const headers = [];
    if (hasTiming) headers.push('时间');
    headers.push('教学环节');
    if (hasContent) headers.push('教学内容');
    headers.push('教师活动', '学生活动', '设计意图');

    const widths = [];
    if (hasTiming) widths.push('10%');
    if (hasContent) {
      widths.push('12%', '18%');
    } else {
      widths.push('12%');
    }
    widths.push(...['30%', '25%', hasTiming && hasContent ? '15%' : '21%']);

    const pHeaderCells = widths.map((w, i) => new TableCell({
      shading: { fill: ACCENT }, width: { size: parseInt(w), type: WidthType.PERCENTAGE },
      children: [p(headers[i], { bold: true, color: '#FFFFFF', after: 0, size: 19 })],
    }));
    const pHeaderRow = new TableRow({ children: pHeaderCells });
    const pRows = teaching_process.map(s => {
      const vals = [];
      if (hasTiming) vals.push(s.time_suggestion || '-');
      vals.push(s.stage);
      if (hasContent) vals.push(s.teaching_content || '-');
      vals.push(s.teacher_activity, s.student_activity, s.design_intent);
      const cells = widths.map((w, i) => new TableCell({
        width: { size: parseInt(w), type: WidthType.PERCENTAGE },
        children: [p(vals[i], { after: 0, size: 19 })],
      }));
      return new TableRow({ children: cells });
    });
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, bottom: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, left: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, right: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 }, insideHorizontal: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 }, insideVertical: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 } },
      rows: [pHeaderRow, ...pRows],
    }));
  }

  // ===== 十、课堂评价设计 =====
  children.push(h1('十、课堂评价设计'));
  children.push(h3('过程性评价')); children.push(p(evaluation_design.process, { after: 100 }));
  children.push(h3('结果性评价')); children.push(p(evaluation_design.result, { after: 100 }));
  children.push(h3('数据辅助评价')); children.push(p(evaluation_design.data_assisted, { after: 100 }));

  // ===== 十一、板书设计 =====
  children.push(h1('十一、板书设计'));
  if (bd.theme) { children.push(h3('主题')); children.push(p(bd.theme, { after: 80 })); }
  if (bd.core_concepts) { children.push(h3('核心概念')); (bd.core_concepts || '').split('\n').filter(l => l.trim()).forEach(l => children.push(p(l.trim(), { after: 60, size: 21 }))); }
  if (bd.key_steps) { children.push(h3('关键步骤')); (bd.key_steps || '').split('\n').filter(l => l.trim()).forEach(l => children.push(p(l.trim(), { after: 60, size: 21 }))); }
  if (bd.common_mistakes) { children.push(h3('易错提醒')); children.push(p(bd.common_mistakes, { after: 60, size: 21, color: '#dc2626' })); }
  if (bd.summary) { children.push(h3('总结归纳')); children.push(p(bd.summary, { after: 80 })); }

  // ===== 十二、作业设计 =====
  children.push(h1('十二、作业设计'));
  children.push(h3('基础作业')); children.push(p(homework_design.basic, { after: 100 }));
  children.push(h3('提升作业')); children.push(p(homework_design.advanced, { after: 100 }));
  children.push(h3('分层作业')); children.push(p(homework_design.tiered || '（根据学生掌握水平差异化布置）', { after: 100 }));
  children.push(h3('预习作业')); children.push(p(homework_design.preview, { after: 100 }));

  // ===== 十三、课后反思 =====
  children.push(h1('十三、课后反思'));
  const refFields = [
    ['教学目标达成情况', ref.goal_achievement || '____________________'],
    ['教学重点落实情况', ref.key_points_implementation || '____________________'],
    ['教学难点突破情况', ref.difficulty_breakthrough || '____________________'],
    ['学生参与与反馈情况', ref.student_participation || '____________________'],
    ['词云复盘与本节教学衔接效果', ref.review_teaching_connection || '____________________'],
    ['后续改进建议', ref.improvement_suggestions || '____________________'],
  ];
  refFields.forEach(([label, value]) => {
    children.push(h3(label));
    children.push(p(value, { after: 80, size: 21 }));
  });

  // 声明
  children.push(p(''));
  children.push(p('教案由 DisciMind 学研智擎智能教案生成系统辅助生成，内容仅供参考，请教师根据实际情况调整。', { color: MUTED, size: 18, italics: true, after: 40 }));

  return new Document({
    creator: 'DisciMind / 学研智擎',
    title: `${basic_info.course_name}教案`,
    description: `${basic_info.course_name}课程教案`,
    numbering: { config: [{ reference: 'lp-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 180 } } } }] }] },
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: DARK }, paragraph: { spacing: { line: 300 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: ACCENT }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: DARK }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 } },
      },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'DisciMind 智能教案  ·  学研智擎', color: MUTED, size: 18, font: FONT })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '— 第 ', color: MUTED, size: 18, font: FONT }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 18 }), new TextRun({ text: ' 页 —', color: MUTED, size: 18, font: FONT })] })] }) },
      children,
    }],
  });
}

// ===================================================================
// 导出前内容结构校验
// ===================================================================
const REQUIRED_MODULES = [
  'basic_info', 'student_analysis', 'teaching_goals',
  'key_points', 'difficulties', 'teaching_methods', 'teaching_preparation',
  'teaching_process', 'evaluation_design', 'board_design', 'homework_design', 'reflection',
];
// review_module 不再作为必需模块：无学生提问数据时允许省略

function validateLessonPlanContent(plan) {
  const missing = [];
  for (const module of REQUIRED_MODULES) {
    if (plan[module] === undefined || plan[module] === null) {
      missing.push(module);
    }
  }
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`教案内容不完整，缺少模块: ${missing.join('、')}`),
      { code: 'LESSON_PLAN_INCOMPLETE', permanent: true },
    );
  }
  // 校验关键子字段
  const basicInfoRequired = ['course_name', 'teacher_name', 'class_name', 'teaching_date', 'topic'];
  for (const field of basicInfoRequired) {
    if (!plan.basic_info[field]) {
      throw Object.assign(
        new Error(`教案基本信息缺少必填字段: ${field}`),
        { code: 'LESSON_PLAN_MISSING_FIELD', permanent: true },
      );
    }
  }
  // 复盘模块校验：有 review_module 时才校验其内容完整性
  if (plan.review_module) {
    if (!plan.review_module.review_conclusion || plan.review_module.review_conclusion.trim().length < 20) {
      throw Object.assign(
        new Error('复盘结论内容过短，无法生成有效教案'),
        { code: 'LESSON_PLAN_REVIEW_TOO_SHORT', permanent: true },
      );
    }
  }
  if (!Array.isArray(plan.teaching_process) || plan.teaching_process.length < 3) {
    throw Object.assign(
      new Error(`教学过程至少需要3个环节，当前仅${plan.teaching_process?.length || 0}个`),
      { code: 'LESSON_PLAN_PROCESS_INCOMPLETE', permanent: true },
    );
  }
  return true;
}

async function buildDocx(state) {
  await progress(state.taskId, 80, '正在生成 DOCX 文件');

  const plan = state.lessonPlan;
  if (!plan || plan.is_fallback) {
    throw Object.assign(new Error('教案内容未就绪，无法生成 DOCX'), { code: 'CONTENT_NOT_READY', permanent: true });
  }

  // 导出前内容结构校验
  validateLessonPlanContent(plan);
  await progress(state.taskId, 82, '教案内容结构校验通过');

  const document = buildDocxDocument(plan);
  const buffer = await Packer.toBuffer(document);

  // 校验
  if (!buffer || buffer.length === 0) {
    throw Object.assign(new Error('DOCX 文件生成为空'), { code: 'DOCX_EMPTY', permanent: true });
  }
  if (buffer.length > 20 * 1024 * 1024) {
    throw Object.assign(new Error('DOCX 文件超过 20 MB 限制'), { code: 'DOCX_TOO_LARGE', permanent: true });
  }

  // 校验 ZIP 签名
  const sig = buffer.slice(0, 4);
  if (!sig.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw Object.assign(new Error('DOCX 文件格式无效'), { code: 'DOCX_INVALID', permanent: true });
  }

  await progress(state.taskId, 90, '正在保存 DOCX');

  const dir = path.resolve(STORAGE_ROOT, String(state.userId));
  await fs.mkdir(dir, { recursive: true });

  const ts = Date.now().toString(36);
  const safeFileName = `教案_${(state.params.courseName || '未命名').replace(/[\\/:*?"<>|]/g, '_')}_${String(state.params.teachingDate || '').replace(/[/\\]/g, '-')}_${ts}.docx`;
  const filePath = path.join(dir, safeFileName);

  await fs.writeFile(filePath, buffer);

  return {
    docxPath: filePath,
    docxFileName: safeFileName,
    docxSize: buffer.length,
    stage: 'persist_and_finalize',
  };
}

// ===================================================================
// Node 6: persist_and_finalize — 更新任务状态 + 返回结果
// ===================================================================
async function persistAndFinalize(state) {
  await progress(state.taskId, 95, '正在完成教案生成');

  const downloadApiUrl = `/api/teacher/lesson-plan/download?path=${encodeURIComponent(state.docxPath)}&name=${encodeURIComponent(state.docxFileName)}`;

  if (state.taskId) {
    const existingTask = await prisma.asyncTask.findUnique({ where: { id: Number(state.taskId) } });
    await tasks.updateTask(state.taskId, {
      status: 'SUCCEEDED',
      progress: 100,
      stage: '教案已生成，可下载 DOCX',
      resultType: 'LESSON_PLAN',
      resultId: state.courseId,
      resultUrl: `#/teacher/lesson-plan?download=1`,
      metadataJson: {
        ...(existingTask?.metadataJson || {}),
        docx_path: state.docxPath,
        docx_file_name: state.docxFileName,
        docx_size_bytes: state.docxSize,
        docx_download_url: downloadApiUrl,
        result_json: state.lessonPlan,
      },
    });
  }

  return {
    ...state,
    stage: 'completed',
  };
}

module.exports = {
  resolveParams,
  collectLearningData,
  analyzeKeywords,
  generateContent,
  buildDocx,
  persistAndFinalize,
};
