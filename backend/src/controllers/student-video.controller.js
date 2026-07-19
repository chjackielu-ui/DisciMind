// 学生端视频推荐控制器

const { success, fail } = require('../utils/response');
const studentVideoService = require('../services/student-video.service');
const videoSearchService = require('../services/video-search.service');
const learningMediaService = require('../services/student-learning-media.service');
const learningPackageService = require('../services/student-learning-package.service');

function getUserId(req) {
  return req.user?.user_id;
}

// ========================
// 1. 获取视频推荐
// ========================

async function getVideoRecommendations(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await studentVideoService.getVideoRecommendations(userId, req.query);
    return success(res, data, '获取视频推荐成功');
  } catch (err) {
    console.error('[student-video.controller] getVideoRecommendations 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 2. 获取知识点视频
// ========================

async function getKnowledgePointVideos(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const kpId = parseInt(req.params.knowledge_point_id, 10);
    if (isNaN(kpId) || kpId < 1) {
      return fail(res, 40001, 'knowledge_point_id 参数不合法');
    }

    const data = await studentVideoService.getKnowledgePointVideos(userId, kpId);
    return success(res, data, '获取知识点视频成功');
  } catch (err) {
    console.error('[student-video.controller] getKnowledgePointVideos 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 3. 记录视频学习行为
// ========================

async function recordWatch(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const videoId = parseInt(req.params.video_id, 10);
    if (isNaN(videoId) || videoId < 1) {
      return fail(res, 40001, 'video_id 参数不合法');
    }

    const data = await studentVideoService.recordWatch(userId, videoId, req.body);
    return success(res, data, '记录学习行为成功');
  } catch (err) {
    console.error('[student-video.controller] recordWatch 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 4. 搜索视频（按关键词检索，生成 embed_url）
// ========================

async function searchVideos(req, res) {
  try {
    const userId = req.user?.user_id;
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const keyword = (req.body?.keyword || '').trim();
    const limit = req.body?.limit;
    if (!keyword) {
      return fail(res, 40001, '请提供搜索关键词 keyword');
    }

    const data = await videoSearchService.searchVideos({ keyword, limit });
    return success(res, data, '视频搜索成功');
  } catch (err) {
    console.error('[student-video.controller] searchVideos 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 5. B 站封面代理（图片标签无法携带 Authorization，故在路由层只做域名白名单校验）
// ========================

async function proxyVideoCover(req, res) {
  try {
    const url = req.query?.url;
    if (!url) return fail(res, 40001, '请提供封面地址 url');

    const { buffer, contentType } = await videoSearchService.fetchCoverImage(url);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  } catch (err) {
    console.error('[student-video.controller] proxyVideoCover 异常:', err.message);
    return res.status(err.code ? 400 : 502).json({
      code: err.code || 50001,
      message: err.message || '封面代理失败',
      data: null,
    });
  }
}

async function generateCoursePpt(req, res) {
  try {
    return success(res, await learningMediaService.createPpt(req.user, req.params.course_id, req.body || {}), 'PPT生成完成');
  } catch (err) {
    console.error('[student-video.controller] generateCoursePpt 异常:', err.message);
    return fail(res, err.code || 50001, err.code ? err.message : 'PPT生成服务暂不可用');
  }
}

async function getCoursePptTask(req, res) {
  try { return success(res, await learningMediaService.getPptTask(req.user, req.params.task_id)); }
  catch (err) { return fail(res, err.code || 50001, err.code ? err.message : 'PPT任务读取失败'); }
}

async function createVideoGenerationTask(req, res) {
  try { return success(res, await learningMediaService.createVideoTask(req.user, req.body || {}), '视频素材任务已创建'); }
  catch (err) { return fail(res, err.code || 50001, err.code ? err.message : '视频任务创建失败'); }
}

async function getVideoGenerationTask(req, res) {
  try { return success(res, await learningMediaService.getVideoTask(req.user, req.params.task_id)); }
  catch (err) { return fail(res, err.code || 50001, err.code ? err.message : '视频任务读取失败'); }
}

async function getGeneratedSlideAudio(req, res) {
  try {
    const file = await learningMediaService.getAudioFile(req.user, req.params.task_id, req.params.page);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(file.absolutePath);
  } catch (err) { return fail(res, err.code || 50001, err.code ? err.message : '配音文件读取失败'); }
}

async function completeVideoGeneration(req, res) {
  try { return success(res, await learningMediaService.completeVideoTask(req.user, req.params.task_id, req.file), 'MP4视频已保存'); }
  catch (err) {
    if (req.file?.path) require('fs/promises').unlink(req.file.path).catch(() => {});
    return fail(res, err.code || 50001, err.code ? err.message : '视频保存失败');
  }
}

async function getGeneratedVideo(req, res) {
  try {
    const file = await learningMediaService.getVideoFile(req.user, req.params.task_id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(file.absolutePath);
  } catch (err) { return fail(res, err.code || 50001, err.code ? err.message : '视频文件读取失败'); }
}

async function createKnowledgeResourcePackage(req, res) {
  try {
    const data = await learningPackageService.createPackage(
      req.user,
      req.params.course_id,
      req.params.knowledge_point_id,
      req.body || {},
    );
    return success(res, data, '个性化单知识点学习资源包任务已创建');
  } catch (err) {
    return fail(res, err.code || 50001, err.code ? err.message : '学习资源包任务创建失败');
  }
}

async function getKnowledgeResourcePackage(req, res) {
  try {
    return success(res, await learningPackageService.getPackage(req.user, req.params.task_id));
  } catch (err) {
    return fail(res, err.code || 50001, err.code ? err.message : '学习资源包状态读取失败');
  }
}

async function retryKnowledgeResourcePackage(req, res) {
  try {
    return success(res, await learningPackageService.retryPackage(req.user, req.params.task_id, req.body || {}), '失败资源已重新加入生成队列');
  } catch (err) {
    return fail(res, err.code || 50001, err.code ? err.message : '学习资源包重试失败');
  }
}

module.exports = {
  getVideoRecommendations,
  getKnowledgePointVideos,
  recordWatch,
  searchVideos,
  proxyVideoCover,
  generateCoursePpt,
  getCoursePptTask,
  createVideoGenerationTask,
  getVideoGenerationTask,
  getGeneratedSlideAudio,
  completeVideoGeneration,
  getGeneratedVideo,
  createKnowledgeResourcePackage,
  getKnowledgeResourcePackage,
  retryKnowledgeResourcePackage,
};
