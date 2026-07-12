const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const { STORAGE_ROOT, MAX_FILE_BYTES, safeArtifactPath, resolveStoredPath } = require('./document-export.service');

const PDF_MIME = 'application/pdf';
const BROWSERS = [process.env.PDF_CHROMIUM_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);

async function browserPath() { for (const item of BROWSERS) { try { await fs.access(item); return item; } catch {} } throw Object.assign(new Error('未找到可用 Chromium'), { code: 'PDF_CHROMIUM_MISSING', permanent: true }); }
function safeHtml(preview, title) { return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${String(title).replace(/[<>&]/g,'')}</title><style>@page{size:A4;margin:18mm}body{font-family:"Microsoft YaHei","Noto Sans CJK SC",SimSun,sans-serif;color:#1f2937;line-height:1.65;font-size:12pt}h1,h2,h3{color:#315b74;break-after:avoid}section,table{break-inside:avoid}img{max-width:100%}</style></head><body>${preview}</body></html>`; }
async function run(executable, args, timeoutMs=120000){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{windowsHide:true,stdio:'ignore'});const timer=setTimeout(()=>{child.kill();reject(Object.assign(new Error('PDF 导出超时'),{code:'PDF_TIMEOUT'}))},timeoutMs);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Object.assign(new Error('Chromium PDF 导出失败'),{code:'PDF_EXPORT_FAILED'}))})})}
async function exportPdf(artifactId, { taskId } = {}) {
  const artifact = await prisma.generatedArtifact.findUnique({ where: { id: Number(artifactId) } });
  if (!artifact?.previewHtml || artifact.deletedAt) throw Object.assign(new Error('Artifact 内容未准备好'), { code: 'ARTIFACT_CONTENT_NOT_READY' });
  const record = await prisma.generatedArtifactExport.upsert({
    where: { artifactId_format: { artifactId: artifact.id, format: 'PDF' } },
    create: { artifactId: artifact.id, ownerUserId: artifact.ownerUserId, format: 'PDF', status: 'EXPORTING', mimeType: PDF_MIME },
    update: { status: 'EXPORTING', mimeType: PDF_MIME, errorCode: null, errorMessage: null, deletedAt: null },
  });
  const previousPath = record.storagePath ? resolveStoredPath(record.storagePath) : null;
  const name = `${artifact.id}-${crypto.randomUUID()}.pdf`;
  const target = safeArtifactPath(artifact.ownerUserId, artifact.id, name);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'discimind-pdf-'));
  const html = path.join(tempDir, 'document.html');
  const temporary = path.join(tempDir, 'document.pdf');
  try {
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: 10, stage: '正在排版 PDF' });
    await fs.writeFile(html, safeHtml(artifact.previewHtml, artifact.title), 'utf8');
    await fs.mkdir(target.directory, { recursive: true });
    await run(await browserPath(), ['--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--no-pdf-header-footer', `--user-data-dir=${path.join(tempDir, 'profile')}`, '--host-resolver-rules=MAP * 0.0.0.0', `--print-to-pdf=${temporary}`, `file:///${html.replace(/\\/g, '/')}`]);
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: 80, stage: '正在校验 PDF' });
    const buffer = await fs.readFile(temporary);
    if (buffer.length < 5 || buffer.length > MAX_FILE_BYTES || buffer.subarray(0, 5).toString() !== '%PDF-') throw Object.assign(new Error('PDF 文件无效或过大'), { code: 'PDF_INVALID' });
    const tmpTarget = `${target.absolute}.tmp`;
    await fs.writeFile(tmpTarget, buffer, { flag: 'wx' });
    await fs.rename(tmpTarget, target.absolute);
    const relative = path.relative(STORAGE_ROOT, target.absolute).replace(/\\/g, '/');
    const updated = await prisma.generatedArtifactExport.update({ where: { id: record.id }, data: { status: 'READY', storagePath: relative, fileSizeBytes: BigInt(buffer.length), mimeType: PDF_MIME, lastAccessedAt: new Date(), errorCode: null, errorMessage: null } });
    if (previousPath && previousPath !== target.absolute) await fs.unlink(previousPath).catch(() => {});
    return updated;
  } catch (error) {
    await prisma.generatedArtifactExport.update({ where: { id: record.id }, data: { status: 'FAILED', errorCode: String(error.code || 'PDF_EXPORT_FAILED'), errorMessage: 'PDF 导出失败，请稍后重试。' } }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
module.exports={PDF_MIME,safeHtml,browserPath,exportPdf};
