/**
 * Learning Agent Routes
 *
 * 学习流 LangGraph Agent 运行接口
 * 挂载路径: /api/learning-flows/:workflowId/runs (复用现有前缀)
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const authMiddleware = require('../../../middlewares/auth.middleware');
const roleMiddleware = require('../../../middlewares/role.middleware');
const { createRun, resumeRun, skipCurrentNode, getRun, uploadRunFiles } = require('../services/learning-run.service');
const { createAgentError } = require('../../agent/common/agent.errors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// 文件上传配置
// ---------------------------------------------------------------------------

const uploadDir = path.resolve(__dirname, '../../../../../storage/uploads/learning');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
];
const IMAGE_EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_COUNT = 3;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = IMAGE_EXTENSION_BY_MIME[file.mimetype] || '.png';
      cb(null, `learning_${uniqueSuffix}${ext}`);
    },
  }),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILE_COUNT,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype) && IMAGE_EXTENSION_BY_MIME[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${file.mimetype}。仅支持 JPEG、PNG、GIF、WebP、BMP`));
    }
  },
});

// ---------------------------------------------------------------------------
// 所有路由需要 student 角色
// ---------------------------------------------------------------------------

router.use(authMiddleware);
router.use(roleMiddleware(['student']));

// ---------------------------------------------------------------------------
// POST /api/learning-flows/:workflowId/runs
// 创建新的学习运行
// ---------------------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const { workflowId } = req.params;
    const userId = req.user.user_id;

    // 使用现有的 learning-workflow 系统创建/获取 session
    const runtimeService = require('../../learning-workflow/workflow-runtime.service');
    const session = await runtimeService.createSession({
      userId,
      courseId: req.body.courseId,
      knowledgePointId: req.body.knowledgePointId,
      templateId: workflowId,
      versionId: req.body.versionId,
      completionMode: req.body.completionMode,
      targetMastery: req.body.targetMastery,
      adjustmentMode: req.body.adjustmentMode,
      estimatedMinutes: req.body.estimatedMinutes,
    });

    // 启动 session
    await runtimeService.startSession(session.session_id, userId);

    // 创建 LangGraph 运行
    const runResult = await createRun(session.session_id, userId);

    res.json({
      code: 200,
      message: 'ok',
      data: runResult,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/learning-flows/:workflowId/runs/:runId
// 获取运行状态
// ---------------------------------------------------------------------------

router.get('/:runId', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const userId = req.user.user_id;

    const runState = await getRun(runId, userId);

    res.json({
      code: 200,
      message: 'ok',
      data: runState,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/learning-flows/:workflowId/runs/:runId/resume
// 恢复运行（学生交互后提交）
// ---------------------------------------------------------------------------

router.post('/:runId/resume', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const userId = req.user.user_id;
    const { studentInput, answerData } = req.body;

    let input = studentInput;
    if (answerData) {
      input = JSON.stringify(answerData);
    }

    if (!input) {
      throw createAgentError('INVALID_INPUT', '请提供 studentInput 或 answerData', 400);
    }

    const result = await resumeRun(runId, userId, input);

    res.json({
      code: 200,
      message: 'ok',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/learning-flows/:workflowId/runs/:runId/skip
// 跳过当前节点
// ---------------------------------------------------------------------------

router.post('/:runId/skip', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const userId = req.user.user_id;
    const { reason } = req.body;

    const result = await skipCurrentNode(runId, userId, reason || 'user_skipped');

    res.json({
      code: 200,
      message: 'ok',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/learning-flows/:workflowId/runs/:runId/files
// 上传文件到学习运行（多模态输入）
// ---------------------------------------------------------------------------

router.post('/:runId/files', upload.array('files', MAX_FILE_COUNT), async (req, res, next) => {
  try {
    const { runId } = req.params;
    const userId = req.user.user_id;

    if (!req.files || req.files.length === 0) {
      throw createAgentError('INVALID_INPUT', '请上传至少一个文件', 400);
    }

    const fileRefs = await uploadRunFiles(runId, userId, req.files);

    res.json({
      code: 200,
      message: 'ok',
      data: {
        files: fileRefs,
        count: fileRefs.length,
      },
    });
  } catch (err) {
    // 清理上传的文件
    if (req.files) {
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 文件上传错误处理
// ---------------------------------------------------------------------------

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        code: 400,
        message: `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`,
        data: null,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        code: 400,
        message: `文件数量超过限制（最多 ${MAX_FILE_COUNT} 张）`,
        data: null,
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        code: 400,
        message: '不期望的文件字段名',
        data: null,
      });
    }
    return res.status(400).json({
      code: 400,
      message: `文件上传错误: ${err.message}`,
      data: null,
    });
  }
  next(err);
});

module.exports = router;
