const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const { loadEnv } = require('../config/env');
const knowledgeStorage = require('../modules/knowledge-base/knowledge-storage.service');
const knowledgeVectorStore = require('../modules/knowledge-base/knowledge-vector-store.service');

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

async function getEnvironmentStatus() {
  let databaseAvailable = false;
  try { await prisma.$queryRaw`SELECT 1`; databaseAvailable = true; } catch {}
  const qdrantConfigured = configured('QDRANT_URL');
  const [qdrantHealth, knowledgeStorageHealth, langgraphWritable, libreOfficeAvailable, chromiumConfiguredAvailable] = await Promise.all([
    qdrantConfigured
      ? knowledgeVectorStore.checkAvailability({ driver: 'qdrant', timeout: 2500 })
      : { available: false, driver: 'qdrant', error: null },
    knowledgeStorage.checkAvailability({ timeout: 2500 }),
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
    qdrant: { configured: qdrantConfigured, available: qdrantHealth.available },
    knowledge_storage: {
      configured: knowledgeStorage.config().driver === 'local'
        || configured('KNOWLEDGE_OSS_BUCKET', 'KNOWLEDGE_OSS_ACCESS_KEY_ID'),
      available: knowledgeStorageHealth.available,
      driver: knowledgeStorageHealth.driver,
    },
    dify: { configured: false, available: false, retired: true },
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
