const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require('docx');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const { examPaperSchema, studyHandoutSchema } = require('./file-content.schemas');

const STORAGE_ROOT = path.resolve(__dirname, '../../../storage/generated-artifacts');
const MAX_FILE_BYTES = Number(process.env.GENERATED_ARTIFACT_MAX_MB || 20) * 1024 * 1024;
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ACCENT = '315B74';
const MUTED = '5F6B73';
const LIGHT = 'EAF0F3';
const CONTENT_WIDTH_DXA = 9360;
const TABLE_INDENT_DXA = 0;
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

function exportError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function safeArtifactPath(ownerUserId, artifactId, fileName) {
  const directory = path.resolve(STORAGE_ROOT, String(Number(ownerUserId)), String(Number(artifactId)));
  const absolute = path.resolve(directory, fileName);
  if (!directory.startsWith(`${STORAGE_ROOT}${path.sep}`) || !absolute.startsWith(`${directory}${path.sep}`)) {
    throw exportError('文件存储路径不安全', 'ARTIFACT_PATH_UNSAFE', { permanent: true });
  }
  return { directory, absolute };
}

function resolveStoredPath(storagePath) {
  if (!storagePath) return null;
  const normalized = String(storagePath).replace(/\//g, path.sep);
  const absolute = path.resolve(STORAGE_ROOT, normalized);
  if (!absolute.startsWith(`${STORAGE_ROOT}${path.sep}`)) {
    throw exportError('文件存储路径不安全', 'ARTIFACT_PATH_UNSAFE', { permanent: true });
  }
  return absolute;
}

function paragraph(text, options = {}) {
  return new Paragraph({
    spacing: { after: options.after ?? 120, line: options.line ?? 300 },
    alignment: options.alignment,
    heading: options.heading,
    numbering: options.numbering,
    keepNext: options.keepNext,
    children: [new TextRun({
      text: String(text ?? ''),
      bold: options.bold,
      italics: options.italics,
      color: options.color,
      size: options.size,
      break: options.break,
    })],
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return paragraph(text, { heading: level, bold: true, color: ACCENT, after: level === HeadingLevel.HEADING_1 ? 200 : 140, keepNext: true });
}

function bullet(text, level = 0) {
  return paragraph(text, { numbering: { reference: 'discimind-bullets', level }, after: 80, line: 300 });
}

function metadataTable(rows) {
  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    indent: { size: TABLE_INDENT_DXA, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [2700, 6660],
    borders: {
      top: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
      bottom: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
      left: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
      right: { style: BorderStyle.SINGLE, color: 'C9D5DB', size: 2 },
      insideHorizontal: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, color: 'DCE5E9', size: 1 },
    },
    rows: rows.map(([label, value]) => new TableRow({ children: [
      new TableCell({ shading: { fill: LIGHT }, width: { size: 2700, type: WidthType.DXA }, margins: CELL_MARGINS, verticalAlign: VerticalAlign.CENTER, children: [paragraph(label, { bold: true, color: ACCENT, after: 0 })] }),
      new TableCell({ width: { size: 6660, type: WidthType.DXA }, margins: CELL_MARGINS, verticalAlign: VerticalAlign.CENTER, children: [paragraph(value, { after: 0 })] }),
    ] })),
  });
}

function titleBlock(content, artifact) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 100 },
      children: [new TextRun({ text: content.title, bold: true, size: 48, color: ACCENT })],
    }),
    paragraph(content.course, { alignment: AlignmentType.CENTER, size: 22, color: MUTED, after: 280 }),
    metadataTable([
      ['课程', content.course],
      ['知识点', content.knowledgePoints.join('、')],
      ['文档类型', artifact.artifactType === 'EXAM_PAPER' ? '试卷' : '学习讲义'],
      ['生成时间', generatedAt],
    ]),
    paragraph('', { after: 80 }),
  ];
}

function examChildren(content, artifact) {
  if (artifact.artifactRole === 'ANSWER_KEY') {
    const children = [heading('参考答案与解析')];
    for (const question of content.questions) {
      children.push(paragraph(`${question.id}. ${question.stem}`, { bold: true, after: 60 }));
      if (artifact.requirementsJson?.includeAnswers) children.push(paragraph(`答案：${Array.isArray(question.answer) ? question.answer.join('、') : question.answer}`, { bold: true, color: ACCENT, after: 60 }));
      if (artifact.requirementsJson?.includeAnalysis) children.push(paragraph(`解析：${question.analysis}`, { after: 140 }));
    }
    return children;
  }
  if (artifact.artifactRole === 'ANSWER_SHEET') {
    const children = [heading('考生信息'), metadataTable([['姓名', '________________'], ['学号', '________________'], ['班级', '________________']]), heading('答题区')];
    for (const question of content.questions) {
      children.push(paragraph(`${question.id}（${question.score.toFixed(2).replace(/\.00$/, '')} 分）`, { bold: true, after: 80 }));
      const lineCount = question.type === 'PROGRAMMING' ? 12 : ['SHORT_ANSWER', 'CALCULATION'].includes(question.type) ? 6 : 2;
      for (let index = 0; index < lineCount; index += 1) children.push(paragraph('________________________________________________________________', { color: 'CBD5E1', after: 80 }));
    }
    return children;
  }
  const children = [
    heading('作答说明'),
    ...content.instructions.map((item) => bullet(item)),
    metadataTable([
      ['难度', content.difficulty],
      ['建议时长', `${content.duration} 分钟`],
      ['总分', `${content.totalScore} 分`],
      ['题目数', `${content.questions.length} 题`],
    ]),
  ];
  for (const section of content.sections) {
    children.push(heading(section.title));
    for (const questionId of section.questionIds) {
      const question = content.questions.find((item) => item.id === questionId);
      if (!question) continue;
      children.push(paragraph(`${question.id}. ${question.stem}（${question.score.toFixed(2).replace(/\.00$/, '')} 分）`, { bold: true, after: 80 }));
      question.options.forEach((option, index) => children.push(paragraph(`${String.fromCharCode(65 + index)}. ${option}`, { after: 60 })));
      children.push(paragraph('', { after: 100 }));
    }
  }
  return children;
}

function handoutChildren(content, artifact) {
  const requirements = artifact.requirementsJson || {};
  const children = [heading('学习目标'), ...content.learningObjectives.map((item) => bullet(item))];
  children.push(heading('先备知识'));
  children.push(...content.prerequisites.map((item) => bullet(item)));
  children.push(heading('知识结构'));
  children.push(...content.sections.map((item) => bullet(item.title)));
  children.push(heading('公式与原理'));
  children.push(...content.principles.map((item) => paragraph(item)));
  for (const section of content.sections) {
    children.push(heading(section.title));
    children.push(...section.content.map((item) => paragraph(item)));
  }
  if (content.examples.length) {
    children.push(heading('示例'));
    for (const example of content.examples) {
      children.push(paragraph(example.title, { bold: true, color: ACCENT, after: 60 }));
      children.push(paragraph(example.content));
    }
  }
  children.push(heading('重点速览'));
  children.push(...content.keyPoints.map((item) => bullet(item)));
  children.push(heading('常见错误'));
  children.push(...content.commonMistakes.map((item) => bullet(item)));
  if (content.practice.length) {
    children.push(heading('练习'));
    content.practice.forEach((item, index) => {
      children.push(paragraph(`${index + 1}. ${item.question}`, { bold: true, after: 60 }));
      if (requirements.includeAnswers !== false) {
        children.push(paragraph(`答案：${item.answer}`, { color: ACCENT, after: 60 }));
        if (requirements.includeAnalysis !== false) children.push(paragraph(`解析：${item.analysis}`));
      }
    });
  }
  children.push(heading('总结'));
  children.push(...content.summary.map((item) => bullet(item)));
  children.push(heading('参考资料'));
  children.push(...content.references.map((item) => bullet(item)));
  return children;
}

function buildDocument(artifact) {
  const schema = artifact.artifactType === 'EXAM_PAPER' ? examPaperSchema : studyHandoutSchema;
  const rawContent = artifact.contentSchemaJson || {};
  // Artifacts created before principles/references were introduced remain
  // downloadable; new generation still validates both fields strictly.
  const compatibleContent = artifact.artifactType === 'STUDY_HANDOUT'
    ? {
      ...rawContent,
      principles: rawContent.principles?.length ? rawContent.principles : (rawContent.keyPoints || []).slice(0, 8),
      references: rawContent.references?.length ? rawContent.references : ['DisciMind 历史讲义内容，请结合课程教材核验。'],
    }
    : rawContent;
  const content = schema.parse(compatibleContent);
  const body = artifact.artifactType === 'EXAM_PAPER' ? examChildren(content, artifact) : handoutChildren(content, artifact);
  body.push(
    paragraph(`来源与使用说明：${content.sourceNotice || '本内容由 AI 辅助生成，请结合课程资料核验。'}`, { color: MUTED, size: 18, keepNext: true, after: 40 }),
    paragraph('AI 声明：本文件用于学习辅助，不替代教师指导或正式考核材料。', { color: MUTED, size: 18, italics: true, after: 0 }),
  );
  return new Document({
    creator: 'DisciMind / 学研智擎',
    title: content.title,
    description: 'DisciMind generated educational artifact',
    numbering: { config: [{ reference: 'discimind-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 }, spacing: { after: 80, line: 300 } } } }] }] },
    styles: {
      default: { document: { run: { font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' }, size: 22, color: '1F2933' }, paragraph: { spacing: { line: 300 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: ACCENT }, paragraph: { spacing: { before: 360, after: 200 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: ACCENT }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: '1F4D78' }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 },
        },
      },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${content.course}  ·  ${artifact.artifactType === 'EXAM_PAPER' ? '考试材料' : '学习讲义'}`, color: MUTED, size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DisciMind 学研智擎  |  第 ', color: MUTED, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 18 }), new TextRun({ text: ' / ', color: MUTED, size: 18 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], color: MUTED, size: 18 }), new TextRun({ text: ' 页', color: MUTED, size: 18 })] })] }) },
      children: [...titleBlock(content, artifact), ...body],
    }],
  });
}

async function validateDocxFile(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size <= 0) throw exportError('DOCX 文件为空', 'DOCUMENT_INVALID', { permanent: true });
  if (stat.size > MAX_FILE_BYTES) throw exportError('DOCX 文件超过大小限制', 'DOCUMENT_TOO_LARGE', { permanent: true });
  const buffer = await fs.readFile(filePath);
  if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0) {
    throw exportError('DOCX ZIP 容器无效', 'DOCUMENT_INVALID', { permanent: true });
  }
  const manifest = buffer.toString('latin1');
  if (!manifest.includes('[Content_Types].xml') || !manifest.includes('word/document.xml') || !manifest.includes('word/styles.xml')) {
    throw exportError('DOCX OpenXML 必需部件缺失', 'DOCUMENT_INVALID', { permanent: true });
  }
  return stat;
}

async function exportArtifact(artifactId, { taskId, signal } = {}) {
  const artifact = await prisma.generatedArtifact.findUnique({ where: { id: Number(artifactId) } });
  if (!artifact || artifact.deletedAt) throw exportError('Artifact 不存在', 'ARTIFACT_NOT_FOUND', { permanent: true });
  if (!artifact.contentSchemaJson || !artifact.previewHtml) throw exportError('结构化内容尚未生成', 'ARTIFACT_CONTENT_NOT_READY', { permanent: true });
  const effectiveTaskId = taskId;
  const previousPath = artifact.storagePath ? resolveStoredPath(artifact.storagePath) : null;
  const fileName = `${artifact.id}-${crypto.randomUUID()}.docx`;
  const target = safeArtifactPath(artifact.ownerUserId, artifact.id, fileName);
  const temporary = safeArtifactPath(artifact.ownerUserId, artifact.id, `.${fileName}.tmp`);
  try {
    if (effectiveTaskId) await tasks.updateTask(effectiveTaskId, { status: 'RUNNING', progress: 10, stage: '正在排版 DOCX' });
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    const document = buildDocument(artifact);
    const buffer = await Packer.toBuffer(document);
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    if (buffer.length > MAX_FILE_BYTES) throw exportError('DOCX 文件超过 20 MB 限制', 'DOCUMENT_TOO_LARGE', { permanent: true });
    await fs.mkdir(target.directory, { recursive: true });
    await fs.writeFile(temporary.absolute, buffer, { flag: 'wx' });
    if (effectiveTaskId) await tasks.updateTask(effectiveTaskId, { status: 'RUNNING', progress: 75, stage: '正在校验 DOCX' });
    const stat = await validateDocxFile(temporary.absolute);
    await fs.rename(temporary.absolute, target.absolute);
    const relative = path.relative(STORAGE_ROOT, target.absolute).replace(/\\/g, '/');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const updated = await prisma.generatedArtifact.update({
      where: { id: artifact.id },
      data: { storagePath: relative, fileName, mimeType: WORD_MIME, checksum, fileSizeBytes: BigInt(stat.size), status: 'READY' },
    });
    if (previousPath && previousPath !== target.absolute) await fs.unlink(previousPath).catch(() => null);
    if (effectiveTaskId) await tasks.updateTask(effectiveTaskId, {
      status: 'SUCCEEDED', progress: 100, stage: 'DOCX 已就绪', resultType: 'ARTIFACT',
      resultId: artifact.id, resultUrl: `#/artifacts/${artifact.id}?format=DOCX`,
    });
    return updated;
  } catch (error) {
    await fs.unlink(temporary.absolute).catch(() => null);
    throw error;
  }
}

module.exports = {
  STORAGE_ROOT,
  MAX_FILE_BYTES,
  WORD_MIME,
  safeArtifactPath,
  resolveStoredPath,
  buildDocument,
  validateDocxFile,
  exportArtifact,
};
