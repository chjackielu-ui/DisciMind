// 学生端视频推荐控制器

const { success, fail } = require('../utils/response');
const studentVideoService = require('../services/student-video.service');
const videoSearchService = require('../services/video-search.service');

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

module.exports = {
  getVideoRecommendations,
  getKnowledgePointVideos,
  recordWatch,
  searchVideos,
  proxyVideoCover,
};
