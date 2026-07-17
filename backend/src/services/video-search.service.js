// 视频搜索服务
// 通过哔哩哔哩公开搜索接口检索视频，构造 embed_url 供前端 iframe 播放
// 说明：B 站 API 存在反爬风控（412），无法保证稳定可用，提供多级降级方案

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BILIBILI_APIS = [
  'https://api.bilibili.com/x/web-interface/search/type',
  'https://api.bilibili.com/x/web-interface/search/all/v2',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://search.bilibili.com/';
const COVER_PROXY_PATH = '/api/student/videos/cover-proxy';
const MAX_COVER_BYTES = 5 * 1024 * 1024;

function normalizeBilibiliImageUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://')) return raw.replace(/^http:\/\//i, 'https://');
  return raw;
}

function isAllowedBilibiliImageUrl(input) {
  try {
    const parsed = new URL(normalizeBilibiliImageUrl(input));
    const host = parsed.hostname.toLowerCase();
    const allowedHost = host === 'hdslb.com' ||
      host.endsWith('.hdslb.com') ||
      host === 'biliimg.com' ||
      host.endsWith('.biliimg.com');
    return allowedHost && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function buildCoverProxyUrl(input) {
  const normalized = normalizeBilibiliImageUrl(input);
  if (!normalized || !isAllowedBilibiliImageUrl(normalized)) return null;
  return `${COVER_PROXY_PATH}?url=${encodeURIComponent(normalized)}`;
}

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

function fetchBuffer(url, timeout = 8000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(parsed, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://www.bilibili.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout,
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 3) {
        res.resume();
        const nextUrl = new URL(location, parsed).toString();
        fetchBuffer(nextUrl, timeout, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`封面请求失败（HTTP ${status}）`));
        return;
      }

      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_COVER_BYTES) {
          req.destroy(new Error('封面图片过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: String(res.headers['content-type'] || 'image/jpeg').split(';')[0],
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('封面请求超时')); });
  });
}

async function fetchCoverImage(rawUrl) {
  const url = normalizeBilibiliImageUrl(rawUrl);
  if (!url || !isAllowedBilibiliImageUrl(url)) {
    throw Object.assign(new Error('封面地址不在允许的 B 站图片域名内'), { code: 40001 });
  }
  const result = await fetchBuffer(url);
  if (!/^image\//i.test(result.contentType)) {
    throw Object.assign(new Error('封面资源不是图片'), { code: 40001 });
  }
  return result;
}

function cleanSearchKeyword(input) {
  const text = String(input || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[A-D][\.\、:：]\s*[^A-D]{0,80}/gi, ' ')
    .replace(/【[^】]{1,12}】/g, ' ')
    .replace(/（\s*|\s*）/g, ' ')
    .replace(/[()（）[\]{}<>《》"“”'‘’]/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stopWords = new Set([
    '已知',
    '下列',
    '以下',
    '关于',
    '说法',
    '正确',
    '错误',
    '选择',
    '的是',
    '哪个',
    '什么',
    '题目',
    '答案',
    '解析',
  ]);

  const tokens = text
    .split(/[\s,，;；。?？!！、]+/)
    .map((item) => item.trim())
    .filter((item) => item && !stopWords.has(item));

  const keyword = tokens.join(' ').trim() || text;
  return keyword.length > 60 ? keyword.slice(0, 60).trim() : keyword;
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
  const keyword = cleanSearchKeyword(query.keyword);
  const limit = Math.min(20, Math.max(1, parseInt(query.limit, 10) || 10));

  if (!keyword) {
    return { list: [], total: 0, keyword: '' };
  }

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
      cover_url: normalizeBilibiliImageUrl(v.pic) || null,
      cover_proxy_url: buildCoverProxyUrl(v.pic),
      author: v.author || null,
      duration: parseDuration(v.duration),
      knowledge_point_name: null,
      course_name: null,
      recommend_reason: null,
    };
  });

  return { list, total: list.length, keyword, suggestion: null };
}

module.exports = { searchVideos, fetchCoverImage, normalizeBilibiliImageUrl, buildCoverProxyUrl };
