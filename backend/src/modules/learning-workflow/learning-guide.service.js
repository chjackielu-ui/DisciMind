// 学习引导老师 — DeepSeek 语句块流式 SSE 服务
// 职责：Dify 执行期间提供教师式陪伴引导，不替代正式教学
// DeepSeek 和 Dify 使用完全独立的 HTTP Client

const OpenAI = require('openai');
const { loadEnv } = require('../../config/env');
const { GUIDE_SYSTEM_PROMPT, buildGuideUserMessage } = require('./learning-guide.prompt');

const BLOCK_DELIMITER = '<<<BLOCK>>>';
const MAX_BLOCK_CHARS = 120; // 单个语句块中文字符上限
const GUIDE_TIMEOUT_MS = 15000; // DeepSeek API 超时
const FIRST_BLOCK_TIMEOUT_MS = 8000; // 首个语句块超时

// ========================
// DeepSeek Client (懒加载)
// ========================

let _deepseekClient = null;
let _deepseekModel = null;

function getDeepSeekClient() {
  if (_deepseekClient) return { client: _deepseekClient, model: _deepseekModel };

  loadEnv();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';

  if (!apiKey || apiKey.startsWith('请')) {
    throw Object.assign(new Error('DeepSeek API Key 未配置'), { code: 'GUIDE_AGENT_CONFIG_ERROR', retryable: false });
  }

  _deepseekClient = new OpenAI({ apiKey, baseURL });
  _deepseekModel = model;
  return { client: _deepseekClient, model: _deepseekModel };
}

// ========================
// 语句块拆分
// ========================

function countChineseChars(text) {
  return (String(text).match(/[一-鿿㐀-䶿]/g) || []).length;
}

function splitByPunctuation(text) {
  // 按句号、问号、感叹号、分号分块，每块 1-3 句
  const sentences = String(text).split(/(?<=[。！？；\n])/).filter(Boolean);
  const blocks = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current + sentence;
    const sentenceCount = (candidate.match(/[。！？]/g) || []).length + 1;

    if (sentenceCount > 3 || countChineseChars(candidate) > MAX_BLOCK_CHARS) {
      if (current.trim()) blocks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

function extractBlocksFromText(fullText) {
  if (!fullText || !fullText.trim()) return [];

  // 如果包含分隔符，按分隔符拆分
  if (fullText.includes(BLOCK_DELIMITER)) {
    return fullText
      .split(BLOCK_DELIMITER)
      .map(b => b.trim())
      .filter(b => b.length > 0);
  }

  // 否则按标点分块
  return splitByPunctuation(fullText);
}

function filterDuplicateBlocks(blocks) {
  const seen = new Set();
  return blocks.filter((block) => {
    const key = block.slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ========================
// SSE 写入工具
// ========================

function writeSse(res, event, data) {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data ?? {})}\n\n`);
    return true;
  } catch {
    return false;
  }
}

// ========================
// 主流程：流式生成引导语句块
// ========================

async function streamGuideBlocks({ req, res, sessionId, nodeId, phase, context }) {
  const requestId = `guide_${sessionId}_${nodeId}_${Date.now()}`;

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const { client, model } = getDeepSeekClient();
  const userMessage = buildGuideUserMessage({ phase, ...context });

  // 发送 guide_start
  writeSse(res, 'guide_start', {
    requestId,
    agent: 'learning_guide',
    phase,
    model,
    nodeId,
  });

  let finished = false;
  let blocks = [];
  let blockIndex = 0;
  const startedAt = Date.now();
  let firstBlockSent = false;

  // 首块超时定时器
  const firstBlockTimer = setTimeout(() => {
    if (!firstBlockSent && !finished) {
      writeSse(res, 'guide_block', {
        requestId,
        blockId: `${requestId}_fallback`,
        index: 1,
        phase,
        text: '学习任务已经建立，正式内容正在准备。',
      });
      firstBlockSent = true;
      blockIndex = 1;
    }
  }, FIRST_BLOCK_TIMEOUT_MS);

  const cleanup = () => {
    finished = true;
    clearTimeout(firstBlockTimer);
  };

  // 客户端断开处理
  const onDisconnect = () => {
    if (!finished) {
      cleanup();
    }
  };
  req.on('close', onDisconnect);
  res.on('close', onDisconnect);

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: GUIDE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 600,
      stream: true,
      stream_options: { include_usage: true },
    }, {
      timeout: GUIDE_TIMEOUT_MS,
      signal: req.signal,
    });

    let buffer = '';

    for await (const chunk of stream) {
      if (finished) break;

      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;

      buffer += delta;

      // 检查是否有完整语句块
      if (buffer.includes(BLOCK_DELIMITER)) {
        const parts = buffer.split(BLOCK_DELIMITER);
        // 最后一部分可能不完整（后续 chunk 继续补充）
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed || trimmed.length < 2) continue;

          blockIndex++;
          const block = {
            requestId,
            blockId: `${requestId}_${blockIndex}`,
            index: blockIndex,
            phase,
            text: trimmed,
          };

          blocks.push(block);
          writeSse(res, 'guide_block', block);
          firstBlockSent = true;
        }
      }
    }

    // 处理残留内容
    const finalBlocks = extractBlocksFromText(buffer);
    for (const blockText of finalBlocks) {
      if (blockText.length < 2) continue;
      blockIndex++;
      const block = {
        requestId,
        blockId: `${requestId}_${blockIndex}`,
        index: blockIndex,
        phase,
        text: blockText,
      };
      blocks.push(block);
      writeSse(res, 'guide_block', block);
      firstBlockSent = true;
    }

    // 去重检查
    blocks = filterDuplicateBlocks(blocks);

    // 发送 guide_done
    writeSse(res, 'guide_done', {
      requestId,
      blockCount: blocks.length,
      elapsedMs: Date.now() - startedAt,
    });

    cleanup();
    if (!res.writableEnded) res.end();

    return {
      requestId,
      phase,
      blocks,
      blockCount: blocks.length,
      elapsedMs: Date.now() - startedAt,
      model,
    };
  } catch (err) {
    cleanup();

    // 如果已经发送了部分引导内容，不报错
    if (blocks.length > 0) {
      writeSse(res, 'guide_done', {
        requestId,
        blockCount: blocks.length,
        partial: true,
        note: '部分引导内容已生成',
      });
      if (!res.writableEnded) res.end();
      return {
        requestId,
        phase,
        blocks,
        blockCount: blocks.length,
        partial: true,
      };
    }

    // 完全失败时发送降级消息
    const fallbackText = '学习任务已经建立，正式内容正在准备。';
    writeSse(res, 'guide_block', {
      requestId,
      blockId: `${requestId}_fallback`,
      index: 1,
      phase,
      text: fallbackText,
    });
    writeSse(res, 'guide_done', {
      requestId,
      blockCount: 1,
      fallback: true,
    });

    // 记录错误但不影响用户
    const isAuthError = err?.status === 401 || err?.status === 403;
    const isModelError = String(err?.message || '').includes('model');
    const errorCode = isAuthError ? 'GUIDE_DEEPSEEK_AUTH_FAILED'
      : isModelError ? 'GUIDE_DEEPSEEK_MODEL_ERROR'
      : err?.code || 'GUIDE_AGENT_FAILED';

    console.error(`[LearningGuide][${requestId}] error:`, errorCode, err?.message || err);

    if (!res.writableEnded) res.end();

    // 即使是降级也返回 blocks 供持久化
    return {
      requestId,
      phase,
      blocks: [{ index: 1, text: fallbackText }],
      blockCount: 1,
      fallback: true,
      errorCode,
    };
  }
}

// ========================
// 非流式生成引导（用于已持久化恢复等场景不需要流式时可调用）
// ========================

async function generateGuideBlocksSync(phase, context) {
  const { client, model } = getDeepSeekClient();
  const userMessage = buildGuideUserMessage({ phase, ...context });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: GUIDE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 600,
    }, { timeout: GUIDE_TIMEOUT_MS });

    const content = response.choices?.[0]?.message?.content || '';
    const rawBlocks = extractBlocksFromText(content);
    const blocks = filterDuplicateBlocks(rawBlocks);

    return {
      agent: 'learning_guide',
      model,
      phase,
      blocks: blocks.map((text, i) => ({ index: i + 1, text })),
      blockCount: blocks.length,
    };
  } catch (err) {
    console.error('[LearningGuide] sync generation error:', err?.message || err);
    return {
      agent: 'learning_guide',
      model,
      phase,
      blocks: [{ index: 1, text: '学习任务已经建立，正式内容正在准备。' }],
      blockCount: 1,
      fallback: true,
    };
  }
}

module.exports = {
  streamGuideBlocks,
  generateGuideBlocksSync,
  BLOCK_DELIMITER,
};
