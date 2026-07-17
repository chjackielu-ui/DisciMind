const fs = require('fs');
const path = require('path');
const axios = require('axios');
const prisma = require('../config/prisma');
const { loadEnv } = require('../config/env');

loadEnv();

function configured(...names) {
  return names.some((name) => String(process.env[name] || '').trim().length > 0);
}

async function writable(target) {
  try {
    const resolved = path.resolve(process.cwd(), target || '.');
    const directory = path.extname(resolved) ? path.dirname(resolved) : resolved;
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.access(directory, fs.constants.W_OK);
    return true;
  } catch { return false; }
}

async function executableExists(value) {
  if (!value) return false;
  try { await fs.promises.access(path.resolve(value), fs.constants.R_OK); return true; } catch { return false; }
}

async function httpReachable(url, suffix = '') {
  if (!url) return false;
  try {
    const target = `${String(url).replace(/\/+$/, '')}${suffix}`;
    await axios.get(target, { timeout: 2500, maxRedirects: 1, validateStatus: (status) => status > 0 && status < 500 });
    return true;
  } catch { return false; }
}

async function getEnvironmentStatus() {
  let databaseAvailable = false;
  try { await prisma.$queryRaw`SELECT 1`; databaseAvailable = true; } catch {}
  const qdrantConfigured = configured('QDRANT_URL');
  const difyConfigured = configured('DIFY_API_BASE_URL', 'DIFY_CHATFLOW_BASE_URL', 'DIFY_TRAINER_BASE_URL');
  const [qdrantAvailable, difyAvailable, langgraphWritable, libreOfficeAvailable, chromiumConfiguredAvailable] = await Promise.all([
    qdrantConfigured ? httpReachable(process.env.QDRANT_URL, '/collections') : false,
    difyConfigured ? httpReachable(process.env.DIFY_API_BASE_URL || process.env.DIFY_CHATFLOW_BASE_URL || process.env.DIFY_TRAINER_BASE_URL) : false,
    writable(process.env.LANGGRAPH_CHECKPOINT_DB || './storage/langgraph/checkpoints.sqlite'),
    executableExists(process.env.LIBREOFFICE_PATH),
    executableExists(process.env.PDF_CHROMIUM_PATH),
  ]);
  const windowsChromeCandidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  ];
  const chromiumAutoAvailable = (await Promise.all(windowsChromeCandidates.map(executableExists))).some(Boolean);
  return {
    checked_at: new Date(),
    database: { configured: configured('DATABASE_URL', 'DATABASE_HOST'), available: databaseAvailable },
    ai_encryption: { configured: configured('AI_CONFIG_ENCRYPTION_KEY'), available: configured('AI_CONFIG_ENCRYPTION_KEY') },
    qdrant: { configured: qdrantConfigured, available: qdrantAvailable },
    dify: { configured: difyConfigured && configured('DIFY_API_KEY', 'DIFY_CHATFLOW_API_KEY', 'DIFY_TRAINER_API_KEY'), available: difyAvailable },
    libreoffice: { configured: configured('LIBREOFFICE_PATH'), available: libreOfficeAvailable },
    langgraph_checkpoint: { configured: configured('LANGGRAPH_CHECKPOINT_DB'), available: langgraphWritable },
    chromium_pdf: { configured: configured('PDF_CHROMIUM_PATH') || chromiumAutoAvailable, available: chromiumConfiguredAvailable || chromiumAutoAvailable },
    speech: { configured: configured('BAILIAN_TTS_API_KEY', 'BAILIAN_TTS_WORKSPACE_ID'), available: configured('BAILIAN_TTS_API_KEY', 'BAILIAN_TTS_WORKSPACE_ID') },
    providers: {
      bailian: { configured: configured('BAILIAN_API_KEY') }, qwen: { configured: configured('QWEN_API_KEY') },
      deepseek: { configured: configured('DEEPSEEK_API_KEY') }, spark: { configured: configured('SPARK_API_KEY', 'SPARK_API_SECRET', 'SPARK_APP_ID') },
    },
  };
}

module.exports = { getEnvironmentStatus };

