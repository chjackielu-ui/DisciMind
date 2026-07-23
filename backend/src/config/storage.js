const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_STORAGE_ROOTS = Object.freeze([
  Object.freeze({ key: 'project_storage', absolutePath: path.join(PROJECT_ROOT, 'storage') }),
  Object.freeze({ key: 'backend_storage', absolutePath: path.join(BACKEND_ROOT, 'storage') }),
]);

let cachedReport = null;
let cachedAt = 0;
let pendingInspection = null;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function healthCacheMs() {
  return positiveNumber(process.env.STORAGE_HEALTH_CACHE_MS, 30_000);
}

function warnFreeBytes() {
  return positiveNumber(process.env.STORAGE_WARN_FREE_MB, 1024) * 1024 * 1024;
}

async function diskSpace(directory) {
  if (typeof fs.statfs !== 'function') return { freeBytes: null, totalBytes: null };
  const stat = await fs.statfs(directory);
  const blockSize = Number(stat.bsize || 0);
  const availableBlocks = Number(stat.bavail ?? stat.bfree ?? 0);
  const totalBlocks = Number(stat.blocks || 0);
  return {
    freeBytes: Number.isFinite(blockSize * availableBlocks) ? blockSize * availableBlocks : null,
    totalBytes: Number.isFinite(blockSize * totalBlocks) ? blockSize * totalBlocks : null,
  };
}

async function inspectRoot(root) {
  const probeName = `.discimind-storage-probe-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const probePath = path.join(root.absolutePath, probeName);
  let probeCreated = false;
  try {
    await fs.mkdir(root.absolutePath, { recursive: true });
    const stat = await fs.stat(root.absolutePath);
    if (!stat.isDirectory()) throw Object.assign(new Error('存储根路径不是目录'), { code: 'STORAGE_NOT_DIRECTORY' });
    const probeContent = `${Date.now()}:${root.key}`;
    await fs.writeFile(probePath, probeContent, { encoding: 'utf8', flag: 'wx' });
    probeCreated = true;
    if (await fs.readFile(probePath, 'utf8') !== probeContent) {
      throw Object.assign(new Error('存储读写校验不一致'), { code: 'STORAGE_READ_MISMATCH' });
    }
    await fs.unlink(probePath);
    probeCreated = false;
    const space = await diskSpace(root.absolutePath).catch(() => ({ freeBytes: null, totalBytes: null }));
    return {
      key: root.key,
      writable: true,
      lowSpace: space.freeBytes !== null && space.freeBytes < warnFreeBytes(),
      ...space,
      errorCode: null,
    };
  } catch (error) {
    return {
      key: root.key,
      writable: false,
      lowSpace: false,
      freeBytes: null,
      totalBytes: null,
      errorCode: String(error.code || 'STORAGE_PROBE_FAILED').slice(0, 80),
    };
  } finally {
    if (probeCreated) await fs.unlink(probePath).catch(() => null);
  }
}

async function runInspection(roots) {
  const items = await Promise.all(roots.map(inspectRoot));
  const ready = items.every((item) => item.writable);
  const lowSpace = items.some((item) => item.lowSpace);
  return {
    provider: 'LOCAL',
    ready,
    status: ready ? (lowSpace ? 'degraded' : 'ready') : 'unavailable',
    checkedAt: new Date().toISOString(),
    roots: items,
  };
}

async function inspectLocalStorage(options = {}) {
  const roots = options.roots || DEFAULT_STORAGE_ROOTS;
  const usesDefaultRoots = roots === DEFAULT_STORAGE_ROOTS;
  const now = Date.now();
  if (usesDefaultRoots && !options.force && cachedReport && now - cachedAt < healthCacheMs()) return cachedReport;
  if (usesDefaultRoots && !options.force && pendingInspection) return pendingInspection;
  const inspection = runInspection(roots);
  if (!usesDefaultRoots) return inspection;
  pendingInspection = inspection;
  try {
    cachedReport = await inspection;
    cachedAt = Date.now();
    return cachedReport;
  } finally {
    pendingInspection = null;
  }
}

async function assertLocalStorageReady() {
  const report = await inspectLocalStorage({ force: true });
  if (!report.ready) {
    const failed = report.roots.filter((item) => !item.writable).map((item) => `${item.key}:${item.errorCode}`).join(', ');
    throw Object.assign(new Error(`本地持久化目录不可用：${failed}`), { code: 'LOCAL_STORAGE_NOT_READY', report });
  }
  return report;
}

function publicStorageHealth(report) {
  return {
    provider: report.provider,
    status: report.status,
    roots: report.roots.map((item) => ({
      key: item.key,
      writable: item.writable,
      lowSpace: item.lowSpace,
      errorCode: item.errorCode,
    })),
    checkedAt: report.checkedAt,
  };
}

module.exports = {
  DEFAULT_STORAGE_ROOTS,
  inspectLocalStorage,
  assertLocalStorageReady,
  publicStorageHealth,
};
