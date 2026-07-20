// 学生端知识库文档服务
// 负责上传文档、解析文档、查看文档列表/详情、删除文档

const prisma = require('../config/prisma');
const fs = require('fs');
const path = require('path');
const DOCUMENT_STORAGE_ROOT = path.resolve(__dirname, '../../../storage/uploads/documents');
const PROJECT_STORAGE_ROOT = path.resolve(__dirname, '../../../storage');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function resolveDocumentStoragePath(fileUrl) {
  const relativeUrl = String(fileUrl || '').replace(/\\/g, '/').replace(/^\/+/, '');
  // LibreOffice 生成的学习流课件预览存放于项目级转换目录，
  // 仍须限制在该目录内，不能接受任意绝对文件路径。
  if (relativeUrl.startsWith('lesson-plans/conversions/')) {
    const resolvedConversion = path.resolve(PROJECT_STORAGE_ROOT, relativeUrl);
    if (!resolvedConversion.startsWith(`${PROJECT_STORAGE_ROOT}${path.sep}`)) {
      throw Object.assign(new Error('文档文件路径无效'), { code: 40002 });
    }
    return resolvedConversion;
  }
  const filename = path.basename(relativeUrl);
  if (!filename || filename === '.' || filename === '..') {
    throw Object.assign(new Error('文档文件路径无效'), { code: 40002 });
  }
  const resolved = path.resolve(DOCUMENT_STORAGE_ROOT, filename);
  if (path.dirname(resolved) !== DOCUMENT_STORAGE_ROOT) {
    throw Object.assign(new Error('文档文件路径无效'), { code: 40002 });
  }
  return resolved;
}

async function assertDocumentAccess(document, userId) {
  if (document.owner_user_id === userId) return;
  if (document.visibility === 'PRIVATE' || document.review_status !== 'APPROVED') {
    throw Object.assign(new Error('无权查看该文档'), { code: 40301 });
  }
  if (document.course_id) await ensureStudentInCourse(userId, document.course_id);
}

async function ensureStudentInCourse(userId, courseId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: userId,
      course_id: courseId,
      enrollment_status: 'active',
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('未加入该课程或课程不存在'), { code: 40301 });
  }
  return enrollment;
}

function parsePagination(query) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.page_size, 10);
  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 50) pageSize = 50;
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}

// ========================
// 辅助：文本分块
// ========================

/**
 * 简单文本分块：按字符数切分，保持段落完整
 */
function chunkText(text, chunkSize = 600, overlap = 100) {
  if (!text || text.trim().length === 0) return [];

  // 按段落分割
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  const chunks = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();

    // 如果当前块加上新段落会超过限制，先保存当前块
    if (currentChunk.length + trimmed.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        chunk_index: chunkIndex + 1,
        chunk_text: currentChunk.trim(),
      });
      chunkIndex++;

      // 保留 overlap 字符作为下一块的开始
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + '\n\n' + trimmed;
      } else {
        currentChunk = trimmed;
      }
    } else {
      if (currentChunk.length > 0) {
        currentChunk += '\n\n' + trimmed;
      } else {
        currentChunk = trimmed;
      }
    }
  }

  // 保存最后一块
  if (currentChunk.trim().length > 0) {
    chunks.push({
      chunk_index: chunkIndex + 1,
      chunk_text: currentChunk.trim(),
    });
  }

  // 如果某些块仍然太大，强制按字符切分
  const finalChunks = [];
  let idx = 0;
  for (const chunk of chunks) {
    if (chunk.chunk_text.length <= chunkSize * 1.5) {
      finalChunks.push({ ...chunk, chunk_index: idx + 1 });
      idx++;
    } else {
      // 强制按字符切分
      let pos = 0;
      while (pos < chunk.chunk_text.length) {
        const end = Math.min(pos + chunkSize, chunk.chunk_text.length);
        finalChunks.push({
          chunk_index: idx + 1,
          chunk_text: chunk.chunk_text.slice(pos, end),
        });
        idx++;
        pos = end - (overlap > 0 ? overlap : 0);
        if (pos >= chunk.chunk_text.length) break;
      }
    }
  }

  return finalChunks;
}

/**
 * 估算文本 token 数量（简单按字符数估算）
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length * 0.8);
}

// ========================
// 文件解析
// ========================

/**
 * 解析文档文本内容
 */
async function parseFileContent(filePath, fileExt) {
  const ext = fileExt.toLowerCase();

  try {
    if (ext === '.txt' || ext === '.md') {
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        text: content,
        pageCount: 1,
      };
    }

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return {
        text: data.text || '',
        pageCount: data.numpages || 1,
      };
    }

    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return {
        text: result.value || '',
        pageCount: 1,
      };
    }

    if (ext === '.doc') {
      throw new Error('暂不支持 .doc 格式，请转换为 .docx 或 PDF 后上传');
    }

    throw new Error(`不支持的文件格式: ${ext}`);
  } catch (err) {
    if (err.message.includes('暂不支持') || err.message.includes('不支持的文件格式')) {
      throw err;
    }
    // 对于解析库错误，包装一下
    throw new Error(`文件解析失败: ${err.message}`);
  }
}

// ========================
// 1. 上传文档
// ========================

async function uploadDocument(userId, fileInfo, body) {
  const {
    originalname,
    filename: storedFilename,
    path: filePath,
    size: fileSize,
    mimetype,
  } = fileInfo;

  const fileExt = path.extname(originalname || '').toLowerCase();
  const courseId = body.course_id ? parseInt(body.course_id, 10) : null;
  const knowledgePointId = body.knowledge_point_id ? parseInt(body.knowledge_point_id, 10) : null;
  const visibility = body.visibility || 'private';
  const title = body.title || originalname;

  // 校验 valid visibility 值
  const validVisibilities = ['private', 'class', 'college', 'school'];
  if (!validVisibilities.includes(visibility)) {
    throw Object.assign(new Error('visibility 参数不合法，可选：private / class / college / school'), { code: 40001 });
  }

  // 校验课程权限
  if (courseId) {
    await ensureStudentInCourse(userId, courseId);

    // 校验知识点属于该课程
    if (knowledgePointId) {
      const kp = await prisma.knowledgePoint.findUnique({
        where: { knowledge_point_id: knowledgePointId },
      });
      if (!kp || kp.course_id !== courseId) {
        throw Object.assign(new Error('知识点不属于该课程'), { code: 40001 });
      }
    }
  }

  // 确保个人知识库存在
  let knowledgeBase = await prisma.knowledgeBase.findFirst({
    where: {
      owner_user_id: userId,
      scope_type: 'PERSONAL',
    },
  });

  if (!knowledgeBase) {
    knowledgeBase = await prisma.knowledgeBase.create({
      data: {
        name: `个人知识库-${userId}`,
        scope_type: 'PERSONAL',
        owner_user_id: userId,
        status: 'active',
      },
    });
  }

  // 确定审核状态
  const reviewStatus = visibility === 'private' ? 'APPROVED' : 'PENDING';

  // 创建文档记录
  const fileUrl = `/uploads/documents/${path.basename(filePath)}`;

  const document = await prisma.knowledgeDocument.create({
    data: {
      knowledge_base_id: knowledgeBase.knowledge_base_id,
      title,
      original_filename: originalname,
      file_ext: fileExt,
      file_size_bytes: fileSize,
      mime_type: mimetype,
      storage_type: 'LOCAL',
      file_url: fileUrl,
      scope_type: courseId ? 'COURSE' : 'PERSONAL',
      visibility: visibility.toUpperCase(),
      course_id: courseId,
      owner_user_id: userId,
      parse_status: 'UPLOADED',
      review_status: reviewStatus,
    },
  });

  return {
    document_id: document.document_id,
    title: document.title,
    original_filename: document.original_filename,
    file_size: document.file_size_bytes,
    file_ext: document.file_ext,
    parse_status: toLower(document.parse_status),
    review_status: toLower(document.review_status),
    visibility: toLower(document.visibility),
    created_at: document.created_at ? document.created_at.toISOString() : null,
  };
}

// ========================
// 2. 解析文档
// ========================

async function parseDocument(userId, documentId) {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { document_id: documentId },
  });

  if (!document) {
    throw Object.assign(new Error('文档不存在'), { code: 40002 });
  }

  if (document.owner_user_id !== userId) {
    throw Object.assign(new Error('无权操作该文档'), { code: 40301 });
  }

  // 检查状态
  const validStatuses = ['UPLOADED', 'FAILED'];
  if (!validStatuses.includes(document.parse_status)) {
    throw Object.assign(new Error(`文档当前状态为 ${toLower(document.parse_status)}，无法重复解析`), { code: 40001 });
  }

  // 更新状态为 parsing
  await prisma.knowledgeDocument.update({
    where: { document_id: documentId },
    data: { parse_status: 'PARSING', error_message: null },
  });

  try {
    // 构建完整文件路径
    const absolutePath = document.file_url ? resolveDocumentStoragePath(document.file_url) : null;

    // 检查文件是否存在
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      throw new Error('源文件丢失，请重新上传');
    }

    // 解析文件
    const { text, pageCount } = await parseFileContent(absolutePath, document.file_ext);

    if (!text || text.trim().length === 0) {
      throw new Error('文档内容为空，无法解析');
    }

    // 更新状态为 parsed
    await prisma.knowledgeDocument.update({
      where: { document_id: documentId },
      data: { parse_status: 'PARSED' },
    });

    // 文本清洗
    const cleanedText = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n') // 合并过多的换行
      .replace(/[ \t]{2,}/g, ' ')  // 合并过多空格
      .trim();

    // 分块
    await prisma.knowledgeDocument.update({
      where: { document_id: documentId },
      data: { parse_status: 'CHUNKING' },
    });

    const chunks = chunkText(cleanedText, 600, 100);

    if (chunks.length === 0) {
      throw new Error('文本分块结果为空');
    }

    // 删除旧 chunks（如果重新解析）
    await prisma.knowledgeDocumentChunk.deleteMany({
      where: { document_id: documentId },
    });

    // 批量插入 chunks
    const chunkRecords = chunks.map((chunk) => ({
      document_id: documentId,
      chunk_index: chunk.chunk_index,
      chunk_text: chunk.chunk_text,
      page_number: pageCount > 1 ? Math.ceil(chunk.chunk_index / Math.ceil(chunks.length / pageCount)) : null,
      token_count: estimateTokens(chunk.chunk_text),
    }));

    await prisma.knowledgeDocumentChunk.createMany({ data: chunkRecords });

    // 更新状态为 chunked
    await prisma.knowledgeDocument.update({
      where: { document_id: documentId },
      data: { parse_status: 'CHUNKED' },
    });

    return {
      document_id: documentId,
      title: document.title,
      parse_status: 'chunked',
      chunk_count: chunks.length,
      page_count: pageCount,
      total_chars: cleanedText.length,
    };

  } catch (err) {
    // 解析失败
    await prisma.knowledgeDocument.update({
      where: { document_id: documentId },
      data: {
        parse_status: 'FAILED',
        error_message: err.message,
      },
    });

    throw Object.assign(new Error(`文档解析失败: ${err.message}`), { code: 50003 });
  }
}

// ========================
// 3. 获取文档列表
// ========================

async function listDocuments(userId, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const { course_id, review_status, parse_status, visibility } = query;

  const where = { owner_user_id: userId };

  if (course_id) {
    where.course_id = parseInt(course_id, 10);
  }
  if (review_status) {
    where.review_status = review_status.toUpperCase();
  }
  if (parse_status) {
    where.parse_status = parse_status.toUpperCase();
  }
  if (visibility) {
    where.visibility = visibility.toUpperCase();
  }

  const [documents, total] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: true,
        _count: { select: { chunks: true } },
      },
    }),
    prisma.knowledgeDocument.count({ where }),
  ]);

  const list = documents.map((doc) => ({
    document_id: doc.document_id,
    title: doc.title,
    original_filename: doc.original_filename,
    file_ext: doc.file_ext,
    file_size: doc.file_size_bytes,
    parse_status: toLower(doc.parse_status),
    review_status: toLower(doc.review_status),
    visibility: toLower(doc.visibility),
    course_id: doc.course_id,
    course_name: doc.course?.course_name || null,
    chunk_count: doc._count.chunks,
    created_at: doc.created_at ? doc.created_at.toISOString() : null,
    updated_at: doc.updated_at ? doc.updated_at.toISOString() : null,
  }));

  return { list, total, page, page_size: pageSize };
}

// ========================
// 4. 获取文档详情
// ========================

async function getDocument(userId, documentId) {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { document_id: documentId },
    include: {
      course: true,
      chunks: {
        orderBy: { chunk_index: 'asc' },
        take: 10,
      },
      _count: { select: { chunks: true } },
    },
  });

  if (!document) {
    throw Object.assign(new Error('文档不存在'), { code: 40002 });
  }

  await assertDocumentAccess(document, userId);

  return {
    document_id: document.document_id,
    title: document.title,
    original_filename: document.original_filename,
    file_ext: document.file_ext,
    file_size: document.file_size_bytes,
    mime_type: document.mime_type,
    parse_status: toLower(document.parse_status),
    review_status: toLower(document.review_status),
    visibility: toLower(document.visibility),
    course_id: document.course_id,
    course_name: document.course?.course_name || null,
    error_message: document.error_message || null,
    chunk_count: document._count.chunks,
    chunks_preview: document.chunks.map((chunk) => ({
      chunk_index: chunk.chunk_index,
      chunk_text: chunk.chunk_text ? chunk.chunk_text.slice(0, 200) : '',
      token_count: chunk.token_count,
    })),
    download_url: `/api/student/documents/${document.document_id}/download`,
    created_at: document.created_at ? document.created_at.toISOString() : null,
    updated_at: document.updated_at ? document.updated_at.toISOString() : null,
  };
}

async function getDocumentDownload(userId, documentId) {
  const document = await prisma.knowledgeDocument.findUnique({ where: { document_id: documentId } });
  if (!document) throw Object.assign(new Error('文档不存在'), { code: 40002 });
  await assertDocumentAccess(document, userId);
  const absolutePath = resolveDocumentStoragePath(document.file_url);
  if (!fs.existsSync(absolutePath)) throw Object.assign(new Error('源文件不存在'), { code: 40002 });
  return {
    absolutePath,
    originalFilename: path.basename(document.original_filename || document.title || `document-${documentId}`),
    mimeType: document.mime_type,
  };
}

// ========================
// 5. 删除文档
// ========================

async function deleteDocument(userId, documentId) {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { document_id: documentId },
  });

  if (!document) {
    throw Object.assign(new Error('文档不存在'), { code: 40002 });
  }

  if (document.owner_user_id !== userId) {
    throw Object.assign(new Error('无权删除该文档'), { code: 40301 });
  }

  // 删除物理文件
  try {
    const absolutePath = resolveDocumentStoragePath(document.file_url);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (fileErr) {
    console.error('[student-document.service] 删除物理文件失败:', fileErr.message);
  }

  // 删除数据库记录（chunks 会通过 onDelete: Cascade 自动删除）
  await prisma.knowledgeDocument.delete({
    where: { document_id: documentId },
  });

  return { deleted: true, document_id: documentId };
}

module.exports = {
  uploadDocument,
  parseDocument,
  listDocuments,
  getDocument,
  getDocumentDownload,
  deleteDocument,
  resolveDocumentStoragePath,
};
