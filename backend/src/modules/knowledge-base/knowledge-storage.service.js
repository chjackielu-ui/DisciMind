const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const OSS = require('ali-oss');

const STORAGE_ROOT = path.resolve(__dirname, '../../../storage/agent-knowledge');

let cachedClient = null;
let cachedClientKey = null;

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function storageError(code, message, status = 502, cause = null, retryable = true) {
  return Object.assign(new Error(message), { code, status, cause, retryable });
}

function config(overrides = {}) {
  return {
    driver: String(overrides.driver || process.env.KNOWLEDGE_STORAGE_DRIVER || 'local').trim().toLowerCase(),
    region: overrides.region ?? process.env.KNOWLEDGE_OSS_REGION ?? '',
    endpoint: overrides.endpoint ?? process.env.KNOWLEDGE_OSS_ENDPOINT ?? '',
    bucket: overrides.bucket ?? process.env.KNOWLEDGE_OSS_BUCKET ?? '',
    accessKeyId: overrides.accessKeyId ?? process.env.KNOWLEDGE_OSS_ACCESS_KEY_ID ?? '',
    accessKeySecret: overrides.accessKeySecret ?? process.env.KNOWLEDGE_OSS_ACCESS_KEY_SECRET ?? '',
    stsToken: overrides.stsToken ?? process.env.KNOWLEDGE_OSS_STS_TOKEN ?? '',
    prefix: String(overrides.prefix ?? process.env.KNOWLEDGE_OSS_PREFIX ?? 'agent-knowledge').replace(/^\/+|\/+$/g, ''),
    internal: overrides.internal ?? enabled(process.env.KNOWLEDGE_OSS_INTERNAL),
    secure: overrides.secure ?? !['0', 'false', 'no', 'off'].includes(String(process.env.KNOWLEDGE_OSS_SECURE || 'true').trim().toLowerCase()),
    timeout: Math.max(1000, Number(overrides.timeout ?? process.env.KNOWLEDGE_OSS_TIMEOUT_MS ?? 30_000)),
  };
}

function createOssClient(options = {}) {
  if (options.client) return options.client;
  const current = config(options);
  if (current.driver !== 'oss') {
    throw storageError('KNOWLEDGE_OSS_NOT_ENABLED', '知识库对象存储未启用。', 500, null, false);
  }
  if (!current.bucket || !current.accessKeyId || !current.accessKeySecret || (!current.region && !current.endpoint)) {
    throw storageError('KNOWLEDGE_OSS_NOT_CONFIGURED', '知识库对象存储配置不完整，请联系管理员。', 500, null, false);
  }
  const key = crypto.createHash('sha256').update(JSON.stringify({
    region: current.region,
    endpoint: current.endpoint,
    bucket: current.bucket,
    accessKeyId: current.accessKeyId,
    accessKeySecret: current.accessKeySecret,
    stsToken: current.stsToken,
    internal: current.internal,
    secure: current.secure,
    timeout: current.timeout,
  })).digest('hex');
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient = new OSS({
    ...(current.region ? { region: current.region } : {}),
    ...(current.endpoint ? { endpoint: current.endpoint } : {}),
    bucket: current.bucket,
    accessKeyId: current.accessKeyId,
    accessKeySecret: current.accessKeySecret,
    ...(current.stsToken ? { stsToken: current.stsToken } : {}),
    internal: current.internal,
    secure: current.secure,
    timeout: current.timeout,
  });
  cachedClientKey = key;
  return cachedClient;
}

function safeExtension(value) {
  const extension = String(value || '').toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

function buildObjectKey({ userId, knowledgeBaseId, extension, id = crypto.randomUUID() }, options = {}) {
  const current = config(options);
  const objectId = String(id);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(objectId)) {
    throw storageError('KNOWLEDGE_STORAGE_KEY_INVALID', '知识库文件对象标识无效。', 400, null, false);
  }
  const segments = [current.prefix, String(Number(userId)), String(Number(knowledgeBaseId)), `${objectId}${safeExtension(extension)}`]
    .filter(Boolean);
  if (!Number.isInteger(Number(userId)) || !Number.isInteger(Number(knowledgeBaseId))) {
    throw storageError('KNOWLEDGE_STORAGE_KEY_INVALID', '知识库文件存储参数无效。', 400, null, false);
  }
  const objectKey = segments.join('/');
  if (objectKey.length > 1024 || `oss://${current.bucket}/${objectKey}`.length > 500) {
    throw storageError('KNOWLEDGE_STORAGE_KEY_TOO_LONG', '知识库文件对象路径过长。', 400, null, false);
  }
  return objectKey;
}

function localAbsolutePath(fileUrl) {
  const absolutePath = path.resolve(__dirname, '../../..', String(fileUrl || ''));
  if (!absolutePath.startsWith(`${STORAGE_ROOT}${path.sep}`)) {
    throw storageError('KNOWLEDGE_FILE_PATH_INVALID', '源文件路径无效，请重新上传。', 409, null, false);
  }
  return absolutePath;
}

async function storeUpload(input, options = {}) {
  const current = config(options);
  const objectKey = buildObjectKey(input, current);
  if (current.driver === 'oss') {
    const client = createOssClient({ ...current, client: options.client });
    let result;
    try {
      result = await client.put(objectKey, input.buffer, { mime: input.mimeType || 'application/octet-stream' });
    } catch (error) {
      throw storageError('KNOWLEDGE_OSS_UPLOAD_FAILED', '知识库文件上传对象存储失败。', 502, error);
    }
    const headers = result?.res?.headers || {};
    const etag = String(result?.etag || headers.etag || '').replace(/^"|"$/g, '') || null;
    const versionId = result?.versionId || headers['x-oss-version-id'] || null;
    return {
      storageType: 'OSS',
      fileUrl: `oss://${current.bucket}/${objectKey}`,
      storageKey: objectKey,
      storageBucket: current.bucket,
      storageEtag: etag,
      storageVersionId: versionId,
    };
  }
  if (current.driver !== 'local') {
    throw storageError('KNOWLEDGE_STORAGE_DRIVER_INVALID', '知识库文件存储驱动配置无效。', 500, null, false);
  }
  const absolutePath = path.resolve(STORAGE_ROOT, String(Number(input.userId)), String(Number(input.knowledgeBaseId)), path.posix.basename(objectKey));
  if (!absolutePath.startsWith(`${STORAGE_ROOT}${path.sep}`)) {
    throw storageError('KNOWLEDGE_FILE_PATH_INVALID', '知识库文件存储路径无效。', 500, null, false);
  }
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  try {
    await fs.writeFile(absolutePath, input.buffer, { flag: 'wx' });
  } catch (error) {
    throw storageError('KNOWLEDGE_LOCAL_UPLOAD_FAILED', '知识库文件保存失败。', 500, error);
  }
  return {
    storageType: 'LOCAL',
    fileUrl: path.relative(path.resolve(__dirname, '../../..'), absolutePath).replace(/\\/g, '/'),
    storageKey: null,
    storageBucket: null,
    storageEtag: null,
    storageVersionId: null,
  };
}

function objectKeyFromDocument(document) {
  if (document.storage_key) return document.storage_key;
  const prefix = `oss://${document.storage_bucket || config().bucket}/`;
  return String(document.file_url || '').startsWith(prefix) ? String(document.file_url).slice(prefix.length) : null;
}

async function materializeDocument(document, options = {}) {
  if (String(document.storage_type || 'LOCAL').toUpperCase() !== 'OSS') {
    const absolutePath = localAbsolutePath(document.file_url);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) throw storageError('KNOWLEDGE_FILE_MISSING', '源文件丢失，请重新上传。', 404, null, false);
    return { absolutePath, size: stat.size, cleanup: async () => {} };
  }
  const objectKey = objectKeyFromDocument(document);
  if (!objectKey) throw storageError('KNOWLEDGE_OSS_KEY_MISSING', '对象存储文件定位信息缺失。', 409, null, false);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discimind-kb-'));
  const absolutePath = path.join(directory, `source${safeExtension(document.file_ext)}`);
  const cleanup = async () => fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  try {
    const client = createOssClient(options);
    await client.get(objectKey, absolutePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new Error('downloaded object is not a file');
    return { absolutePath, size: stat.size, cleanup };
  } catch (error) {
    await cleanup();
    if (error.code === 'KNOWLEDGE_OSS_NOT_CONFIGURED') throw error;
    throw storageError('KNOWLEDGE_OSS_DOWNLOAD_FAILED', '知识库源文件暂时无法读取。', 502, error);
  }
}

async function deleteDocumentObject(document, options = {}) {
  if (!document) return;
  if (String(document.storage_type || 'LOCAL').toUpperCase() !== 'OSS') {
    const absolutePath = localAbsolutePath(document.file_url);
    await fs.unlink(absolutePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return;
  }
  const objectKey = objectKeyFromDocument(document);
  if (!objectKey) return;
  try {
    await createOssClient(options).delete(objectKey, document.storage_version_id ? { versionId: document.storage_version_id } : undefined);
  } catch (error) {
    if (!['NoSuchKey', 'NoSuchVersion'].includes(error.code) && Number(error.status || error.statusCode) !== 404) {
      throw storageError('KNOWLEDGE_OSS_DELETE_FAILED', '知识库文件删除失败，请稍后重试。', 502, error);
    }
  }
}

async function headDocumentObject(document, options = {}) {
  if (String(document.storage_type || 'LOCAL').toUpperCase() !== 'OSS') {
    const stat = await fs.stat(localAbsolutePath(document.file_url));
    return { exists: stat.isFile(), size: stat.size, etag: null, versionId: null };
  }
  const objectKey = objectKeyFromDocument(document);
  if (!objectKey) return { exists: false, size: 0, etag: null, versionId: null };
  try {
    const result = await createOssClient(options).head(objectKey);
    const headers = result?.res?.headers || result?.meta || {};
    return {
      exists: true,
      size: Number(headers['content-length'] || headers.contentLength || 0),
      etag: String(headers.etag || '').replace(/^"|"$/g, '') || null,
      versionId: headers['x-oss-version-id'] || null,
    };
  } catch (error) {
    if (Number(error.status || error.statusCode) === 404 || error.code === 'NoSuchKey') return { exists: false, size: 0, etag: null, versionId: null };
    throw storageError('KNOWLEDGE_OSS_HEAD_FAILED', '知识库对象存储状态检查失败。', 502, error);
  }
}

async function checkAvailability(options = {}) {
  const current = config(options);
  if (current.driver === 'local') {
    try {
      await fs.mkdir(STORAGE_ROOT, { recursive: true });
      await fs.access(STORAGE_ROOT);
      return { available: true, driver: 'local', bucket: null, error: null };
    } catch {
      return { available: false, driver: 'local', bucket: null, error: '本地知识库存储目录不可用' };
    }
  }
  try {
    const result = await createOssClient(options).list({ 'max-keys': 1 });
    return { available: Boolean(result), driver: 'oss', bucket: current.bucket, error: null };
  } catch (error) {
    return { available: false, driver: 'oss', bucket: current.bucket || null, error: error.message };
  }
}

module.exports = {
  STORAGE_ROOT,
  config,
  createOssClient,
  buildObjectKey,
  localAbsolutePath,
  storeUpload,
  materializeDocument,
  deleteDocumentObject,
  headDocumentObject,
  checkAvailability,
};
