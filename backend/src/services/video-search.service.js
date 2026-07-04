// 视频搜索服务
// 通过哔哩哔哩公开搜索接口检索视频，构造 embed_url 供前端 iframe 播放
// 说明：B 站 API 存在反爬风控（412），无法保证稳定可用，提供多级降级方案

const https = require('https');

const BILIBILI_APIS = [
  'https://api.bilibili.com/x/web-interface/search/type',
  'https://api.bilibili.com/x/web-interface/search/all/v2',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://search.bilibili.com/';

/**
 * 发起 HTTPS GET 请求
 */
function httpsGet(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': REFERER,
        'Accept': 'application/json, text/plain, */*',
      },
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('B站 API 返回格式异常')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

/**
 * 将 B 站时长格式 "mm:ss" 或 "HH:mm:ss" 转为秒数
 */
function parseDuration(str) {
  if (!str) return null;
  const parts = String(str).split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/**
 * 从 B 站 API 响应中提取视频列表
 */
function extractVideosFromResponse(response) {
  if (response.code === 0) {
    // /search/type 返回 data.result
    if (response.data?.result && Array.isArray(response.data.result)) {
      return response.data.result;
    }
    // /search/all/v2 返回 data.data
    if (response.data?.data) {
      for (const section of response.data.data) {
        if (section?.items && Array.isArray(section.items)) {
          return section.items.filter(i => i.bvid);
        }
      }
    }
  }
  return null;
}

/**
 * 搜索哔哩哔哩视频
 */
async function searchVideos(query = {}) {
  const keyword = (query.keyword || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(query.limit, 10) || 10));

  if (!keyword) {
    return { list: [], total: 0, keyword: '' };
  }

  const searchUrl = `${BILIBILI_APIS[0]}?search_type=video&keyword=${encodeURIComponent(keyword)}&page=1&page_size=${limit}`;
  let biliResults = null;

  // 尝试调用 B 站 API
  for (const apiBase of BILIBILI_APIS) {
    try {
      const url = apiBase.includes('search/type')
        ? `${apiBase}?search_type=video&keyword=${encodeURIComponent(keyword)}&page=1&page_size=${limit}`
        : `${apiBase}?keyword=${encodeURIComponent(keyword)}&page=1`;
      const response = await httpsGet(url);
      biliResults = extractVideosFromResponse(response);
      if (biliResults && biliResults.length > 0) break;
    } catch (err) {
      console.warn(`[video-search] API ${apiBase} 失败:`, err.message);
    }
  }

  // B 站 API 全部失败 → 返回搜索建议（降级）
  if (!biliResults || biliResults.length === 0) {
    return {
      list: [],
      total: 0,
      keyword,
      suggestion: {
        title: `${keyword} 视频讲解`,
        search_url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`,
        source: 'bilibili_search',
        note: '暂时无法直接从 B 站获取视频列表，点击下方按钮前往 B 站搜索并观看。',
      },
    };
  }

  const list = biliResults.slice(0, limit).map((v) => {
    const title = String(v.title || '').replace(/<[^>]*>/g, '');
    const bvid = v.bvid || '';
    return {
      video_id: null,
      title,
      bvid,
      source: 'bilibili',
      embed_url: bvid ? `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0` : '',
      video_url: v.arcurl || (bvid ? `https://www.bilibili.com/video/${bvid}` : ''),
      cover_url: v.pic || null,
      author: v.author || null,
      duration: parseDuration(v.duration),
      knowledge_point_name: null,
      course_name: null,
      recommend_reason: null,
    };
  });

  return { list, total: list.length, keyword, suggestion: null };
}

module.exports = { searchVideos };
