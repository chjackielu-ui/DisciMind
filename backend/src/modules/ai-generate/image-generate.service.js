const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../../config/prisma');
const providerFactory = require('../ai/provider.factory');

const UPLOAD_ROOT = path.resolve(__dirname, '../../../../storage/uploads');
const DEFAULT_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function config() {
  const apiKey = String(process.env.IMAGE_GENERATION_API_KEY || process.env.ALIYUN_API_KEY || process.env.BAILIAN_API_KEY || '').trim();
  return {
    enabled: String(process.env.IMAGE_GENERATION_ENABLED || 'false').toLowerCase() === 'true' && Boolean(apiKey),
    apiKey,
    endpoint: String(process.env.IMAGE_GENERATION_ENDPOINT || DEFAULT_ENDPOINT).trim(),
    model: String(process.env.IMAGE_GENERATION_MODEL || 'qwen-image-2.0').trim(),
    size: String(process.env.IMAGE_GENERATION_SIZE || '1664*928').trim(),
    timeoutMs: Math.max(30_000, Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 180_000)),
    maxSlides: Math.max(1, Math.min(20, Number(process.env.IMAGE_GENERATION_MAX_SLIDES || 8))),
  };
}

async function generate(input) {
  const modelId = Number(input?.modelId);
  if (!Number.isInteger(modelId) || modelId <= 0) throw Object.assign(new Error('请选择图片生成模型'), { code: 40001 });
  const model = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: modelId } });
  if (!model?.provider_id || !model.enabled || model.model_type !== 'image') {
    throw Object.assign(new Error('图片生成模型不存在、已停用或类型不匹配'), { code: 40401 });
  }
  const { adapter, provider } = await providerFactory.getProvider(model.provider_id);
  const result = await adapter.generateImage({
    model: model.model_code || model.model_name,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    n: input.n,
    size: input.size,
    responseFormat: input.responseFormat,
    signal: input.signal,
  });
  return { ...result, provider: provider.provider_code, model: model.model_code || model.model_name };
}

function safeUserId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function promptForSlide(slide = {}) {
  const subject = String(slide.imagePrompt || slide.imageSuggestion || '').trim();
  if (!subject) return '';
  return `${subject}。用于高校课程PPT的16:9教学配图，主体清晰，构图简洁，留出适量呼吸空间，专业、准确、现代，不出现文字、标志、水印和界面元素。`.slice(0, 1100);
}

async function downloadImage(url, destination, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('生成图片体积过大');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('生成图片内容无效');
    await fs.writeFile(destination, buffer, { flag: 'wx' });
    return buffer.length;
  } finally {
    clearTimeout(timer);
  }
}

async function generateOne(prompt, options = {}) {
  const runtime = config();
  if (!runtime.enabled) return { skipped: true, reason: 'IMAGE_GENERATION_NOT_CONFIGURED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);
  try {
    const response = await fetch(runtime.endpoint, {
      method: 'POST',
      signal: options.signal || controller.signal,
      headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: runtime.model,
        input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
        parameters: {
          negative_prompt: '低分辨率，低画质，构图混乱，文字，水印，标志，界面截图，过度饱和，明显AI伪影。',
          prompt_extend: true,
          watermark: false,
          size: runtime.size,
          n: 1,
        },
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || `图片生成失败（HTTP ${response.status}）`);
    const imageUrl = payload?.output?.choices?.[0]?.message?.content?.find((item) => item?.image)?.image;
    if (!imageUrl) throw new Error(payload?.message || '图片生成服务未返回图片地址');
    return { imageUrl, provider: 'aliyun-bailian', model: runtime.model, requestId: payload?.request_id || null };
  } finally {
    clearTimeout(timer);
  }
}

async function enrichSlides(slidesModel, options = {}) {
  const runtime = config();
  const slides = Array.isArray(slidesModel?.slides) ? slidesModel.slides.map((item) => ({ ...item })) : [];
  if (!runtime.enabled || !slides.length) {
    return { model: { ...slidesModel, slides }, generated: 0, failed: 0, skipped: slides.length, enabled: runtime.enabled };
  }
  const userId = safeUserId(options.userId);
  const folder = path.join(UPLOAD_ROOT, 'generated-ppt-images', String(userId || 'system'));
  await fs.mkdir(folder, { recursive: true });
  let generated = 0;
  let failed = 0;
  let attempted = 0;
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    const prompt = promptForSlide(slide);
    if (!prompt || slide.imageUrl || index === 0 || attempted >= runtime.maxSlides) continue;
    attempted += 1;
    try {
      const result = await generateOne(prompt, { signal: options.signal });
      if (result.skipped) continue;
      const hash = crypto.createHash('sha256').update(`${runtime.model}|${runtime.size}|${prompt}`).digest('hex').slice(0, 24);
      const fileName = `${hash}.png`;
      const absolute = path.join(folder, fileName);
      try {
        await fs.access(absolute);
      } catch {
        await downloadImage(result.imageUrl, absolute, runtime.timeoutMs);
      }
      slide.imageUrl = `/uploads/generated-ppt-images/${userId || 'system'}/${fileName}`;
      generated += 1;
    } catch (error) {
      failed += 1;
      console.warn('[image-generate] slide fallback', { page: slide.page || index + 1, message: error.message });
    }
  }
  return { model: { ...slidesModel, slides }, generated, failed, skipped: Math.max(0, slides.length - attempted), enabled: true };
}

module.exports = { config, generate, generateOne, enrichSlides, promptForSlide };
