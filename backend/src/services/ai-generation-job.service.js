// AI 错题生成任务服务
// 负责分批调用 AI 生成错题变式/相似题，管理任务状态和进度

const prisma = require('../config/prisma');
const aiService = require('./ai.service');

const JOB_STATUS = {
  PENDING: 'PENDING',
  GENERATING: 'GENERATING',
  PARSING: 'PARSING',
  VALIDATING: 'VALIDATING',
  SAVING: 'SAVING',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

const BATCH_SIZE = 3; // 每批最多3道来源题
const MAX_RETRIES = 2;

// ========================
// 任务生命周期
// ========================

/**
 * 创建 AI 生成任务
 */
async function createJob(userId, { mode, sourceQuestions, count, difficulty, sourceType }) {
  if (!Array.isArray(sourceQuestions) || sourceQuestions.length === 0) {
    throw Object.assign(new Error('sourceQuestions 不能为空'), { code: 40001 });
  }

  const targetCount = Math.max(1, Math.min(Number(count) || sourceQuestions.length, 100));
  const batches = Math.ceil(Math.min(sourceQuestions.length, targetCount) / BATCH_SIZE);

  const job = await prisma.aiGenerationJob.create({
    data: {
      user_id: userId,
      mode: String(mode).toUpperCase(),
      status: JOB_STATUS.PENDING,
      source_type: sourceType || 'WRONG_QUESTION',
      total_batches: batches,
      current_batch: 0,
      target_count: targetCount,
      difficulty: difficulty || 'SAME',
      progress_data: {
        questions: [],
        failedBatches: [],
        completedBatches: [],
      },
    },
  });

  return formatJob(job);
}

/**
 * 获取任务状态
 */
async function getJob(userId, jobId) {
  const job = await prisma.aiGenerationJob.findUnique({
    where: { job_id: jobId },
  });

  if (!job) {
    throw Object.assign(new Error('生成任务不存在'), { code: 40002 });
  }
  if (job.user_id !== userId) {
    throw Object.assign(new Error('无权查看该任务'), { code: 40301 });
  }

  return formatJob(job);
}

/**
 * 取消任务
 */
async function cancelJob(userId, jobId) {
  const job = await prisma.aiGenerationJob.findUnique({
    where: { job_id: jobId },
  });
  if (!job) {
    throw Object.assign(new Error('生成任务不存在'), { code: 40002 });
  }
  if (job.user_id !== userId) {
    throw Object.assign(new Error('无权操作该任务'), { code: 40301 });
  }

  const cancellable = [JOB_STATUS.PENDING, JOB_STATUS.GENERATING, JOB_STATUS.PARSING];
  if (!cancellable.includes(job.status)) {
    throw Object.assign(new Error('该任务状态不允许取消'), { code: 40001 });
  }

  const updated = await prisma.aiGenerationJob.update({
    where: { job_id: jobId },
    data: { status: JOB_STATUS.CANCELLED },
  });

  return formatJob(updated);
}

/**
 * 重试任务中的失败批次
 */
async function retryJob(userId, jobId) {
  const job = await prisma.aiGenerationJob.findUnique({
    where: { job_id: jobId },
  });
  if (!job || job.user_id !== userId) {
    throw Object.assign(new Error('生成任务不存在或无权操作'), { code: 40301 });
  }

  const progressData = job.progress_data || {};
  const failedBatches = progressData.failedBatches || [];

  if (failedBatches.length === 0) {
    throw Object.assign(new Error('没有失败的批次需要重试'), { code: 40001 });
  }

  // 重置状态
  await prisma.aiGenerationJob.update({
    where: { job_id: jobId },
    data: {
      status: JOB_STATUS.PENDING,
      progress_data: {
        ...progressData,
        retryBatches: failedBatches,
        retryCount: (progressData.retryCount || 0) + 1,
      },
    },
  });

  // 异步启动执行
  executeJob(userId, jobId).catch((err) => {
    console.error('[ai-generation-job] retry execution failed:', err.message);
  });

  return { job_id: jobId, status: 'PENDING', message: '重试已启动' };
}

// ========================
// 任务执行
// ========================

/**
 * 执行 AI 生成任务（异步，不阻塞 HTTP 响应）
 */
async function executeJob(userId, jobId) {
  try {
    const job = await prisma.aiGenerationJob.findUnique({
      where: { job_id: jobId },
    });
    if (!job || job.status === JOB_STATUS.CANCELLED) return;

    // 更新状态为生成中
    await updateJobStatus(jobId, JOB_STATUS.GENERATING, { current_batch: 0 });

    const progressData = job.progress_data || {};
    const retryBatches = progressData.retryBatches || [];
    const sourceQuestions = progressData.sourceQuestions || [];

    // 确定要处理的批次（重试模式 vs 全量模式）
    let batchesToProcess;
    if (retryBatches.length > 0) {
      batchesToProcess = retryBatches;
    } else {
      // 将 sourceQuestions 分批
      batchesToProcess = [];
      for (let i = 0; i < sourceQuestions.length; i += BATCH_SIZE) {
        batchesToProcess.push(sourceQuestions.slice(i, i + BATCH_SIZE));
      }
    }

    const allGenerated = [];
    const allFailed = [];

    for (let batchIndex = 0; batchIndex < batchesToProcess.length; batchIndex++) {
      // 检查是否被取消
      const currentJob = await prisma.aiGenerationJob.findUnique({
        where: { job_id: jobId },
      });
      if (currentJob?.status === JOB_STATUS.CANCELLED) return;

      const batch = batchesToProcess[batchIndex];
      await updateJobStatus(jobId, JOB_STATUS.GENERATING, {
        current_batch: batchIndex + 1,
      });

      let retryCount = 0;
      let batchSuccess = false;

      while (retryCount <= MAX_RETRIES && !batchSuccess) {
        try {
          // 调用 AI 生成
          const generated = await callAiGeneration(job, batch, userId);

          if (generated.length > 0) {
            allGenerated.push(...generated);
            progressData.completedBatches = [
              ...(progressData.completedBatches || []),
              batchIndex,
            ];
            batchSuccess = true;
          } else if (retryCount >= MAX_RETRIES) {
            allFailed.push({ batchIndex, questions: batch, retries: retryCount });
          }
        } catch (err) {
          console.error(
            `[ai-generation-job] batch ${batchIndex} failed (retry ${retryCount}):`,
            err.message,
          );
          retryCount++;
          if (retryCount > MAX_RETRIES) {
            allFailed.push({
              batchIndex,
              questions: batch,
              retries: retryCount,
              error: err.message,
            });
          }
        }
      }

      // 更新进度
      await prisma.aiGenerationJob.update({
        where: { job_id: jobId },
        data: {
          current_batch: batchIndex + 1,
          success_count: allGenerated.length,
          fail_count: allFailed.length,
          progress_data: {
            ...progressData,
            completedBatches: progressData.completedBatches || [],
            failedBatches: allFailed.map((f) => f.batchIndex),
          },
        },
      });
    }

    // 完成
    const finalStatus =
      allFailed.length > 0 && allGenerated.length > 0
        ? JOB_STATUS.PARTIAL_SUCCESS
        : allFailed.length > 0
          ? JOB_STATUS.FAILED
          : JOB_STATUS.COMPLETED;

    await updateJobStatus(jobId, finalStatus, {
      success_count: allGenerated.length,
      fail_count: allFailed.length,
      result_data: {
        generated_question_ids: allGenerated.map((q) => q.question_id),
        failed_batches: allFailed,
      },
    });
  } catch (err) {
    console.error('[ai-generation-job] job execution failed:', err.message);
    await updateJobStatus(jobId, JOB_STATUS.FAILED, {
      error_message: err.message,
    });
  }
}

/**
 * 调用 AI 生成单批题目
 */
async function callAiGeneration(job, batch, userId) {
  const mode = job.mode;
  const difficulty = job.difficulty || 'SAME';

  if (mode === 'VARIANT') {
    return aiService.generateWrongQuestionVariants({
      sourceQuestions: batch,
      difficulty,
      count: Math.ceil(job.target_count / job.total_batches),
      userId,
    });
  } else if (mode === 'SIMILAR') {
    // 相似题：每个源题生成指定数量
    const perSource = Math.max(1, Math.ceil((job.target_count || 1) / batch.length));
    const allResults = [];
    for (const sq of batch) {
      const results = await aiService.generateWrongQuestionSimilar({
        sourceQuestion: sq,
        count: perSource,
        userId,
      });
      allResults.push(...results);
    }
    return allResults;
  }

  throw Object.assign(new Error(`不支持的生成模式: ${mode}`), { code: 40001 });
}

// ========================
// 辅助函数
// ========================

async function updateJobStatus(jobId, status, extra = {}) {
  return prisma.aiGenerationJob.update({
    where: { job_id: jobId },
    data: { status, ...extra },
  });
}

function formatJob(job) {
  const progressData = job.progress_data || {};
  return {
    job_id: job.job_id,
    mode: job.mode,
    status: job.status,
    source_type: job.source_type,
    total_batches: job.total_batches,
    current_batch: job.current_batch,
    success_count: job.success_count,
    fail_count: job.fail_count,
    target_count: job.target_count,
    difficulty: job.difficulty,
    progress: job.total_batches > 0
      ? Math.round((job.current_batch / job.total_batches) * 100)
      : 0,
    result_data: job.result_data,
    error_message: job.error_message,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
  };
}

module.exports = {
  JOB_STATUS,
  createJob,
  getJob,
  cancelJob,
  retryJob,
  executeJob,
};
