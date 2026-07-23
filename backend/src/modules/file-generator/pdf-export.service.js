const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const { STORAGE_ROOT, MAX_FILE_BYTES, safeArtifactPath, resolveStoredPath } = require('./document-export.service');

const PDF_MIME = 'application/pdf';
const BROWSERS = [
  process.env.PDF_CHROMIUM_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

async function browserPaths() {
  const available = [];
  for (const item of [...new Set(BROWSERS)]) {
    try {
      await fs.access(item);
      available.push(item);
    } catch {}
  }
  if (!available.length) {
    throw Object.assign(new Error('未找到可用 Chromium'), { code: 'PDF_CHROMIUM_MISSING', permanent: true });
  }
  return available;
}
async function browserPath() { return (await browserPaths())[0]; }
function safeHtml(preview, title) {
  const safeTitle = String(title || '').replace(/[<>&"']/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${safeTitle}</title><style>
  @page{size:Letter;margin:20mm 18mm 19mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"Microsoft YaHei","Noto Sans CJK SC",SimSun,sans-serif;color:#1f2937;line-height:1.5;font-size:10.5pt;overflow-wrap:anywhere}main{width:100%}h1,h2,h3{color:#315b74;break-after:avoid-page;page-break-after:avoid}h1{margin:0 0 14px}h2{margin:18px 0 8px}h3{margin:14px 0 6px}p{margin:7px 0}ul,ol{margin:6px 0 10px;padding-left:24px}p,li{orphans:2;widows:2}pre,code{white-space:pre-wrap;word-break:break-word}table{width:100%;border-collapse:collapse;table-layout:fixed;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid-page}th,td{padding:5px 7px;word-break:break-word;vertical-align:middle}img{display:block;max-width:100%;height:auto;break-inside:avoid-page}math{max-width:100%;font-size:1.05em}.katex-display{display:block;max-width:100%;overflow-x:auto;text-align:center}
  </style></head><body><main>${preview}</main></body></html>`;
}
async function stampPdf(buffer) {
  const document = await PDFDocument.load(buffer, { updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = document.getPages();
  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const header = 'DisciMind';
    const footer = `DisciMind  |  ${index + 1} / ${pages.length}`;
    page.drawText(header, { x: width - 40 - font.widthOfTextAtSize(header, 8), y: height - 24, size: 8, font, color: rgb(0.37, 0.44, 0.48) });
    page.drawText(footer, { x: (width - font.widthOfTextAtSize(footer, 8)) / 2, y: 18, size: 8, font, color: rgb(0.37, 0.44, 0.48) });
  });
  return Buffer.from(await document.save());
}
async function run(executable, args, timeoutMs=120000, signal){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{windowsHide:true,stdio:'ignore'});let settled=false;const finish=fn=>value=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);fn(value)};const onAbort=()=>{child.kill();finish(reject)(Object.assign(new Error('任务已取消'),{name:'AbortError',code:'TASK_CANCELLED'}))};const timer=setTimeout(()=>{child.kill();finish(reject)(Object.assign(new Error('PDF 导出超时'),{code:'PDF_TIMEOUT'}))},timeoutMs);signal?.addEventListener('abort',onAbort,{once:true});child.once('error',finish(reject));child.once('exit',code=>finish(code===0?resolve:reject)(code===0?undefined:Object.assign(new Error('Chromium PDF 导出失败'),{code:'PDF_EXPORT_FAILED'})))})}
async function renderPdfWithFallback({ html, temporary, tempDir, signal, candidates, runBrowser = run }) {
  const available = candidates || await browserPaths();
  const sandboxed = available.map((executable) => ({ executable, noSandbox: false }));
  const unsandboxed = available.map((executable) => ({ executable, noSandbox: true }));
  const attempts = [...sandboxed, ...unsandboxed];
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    await fs.unlink(temporary).catch(() => {});
    const { executable, noSandbox } = attempts[index];
    const args = [
      '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
      '--no-first-run', '--no-default-browser-check', '--no-pdf-header-footer',
      ...(noSandbox ? ['--no-sandbox'] : []),
      `--user-data-dir=${path.join(tempDir, `profile-${index + 1}`)}`,
      '--host-resolver-rules=MAP * 0.0.0.0',
      `--print-to-pdf=${temporary}`,
      `file:///${html.replace(/\\/g, '/')}`,
    ];
    try {
      await runBrowser(executable, args, 120000, signal);
      const output = await fs.stat(temporary);
      if (!output.isFile() || output.size === 0) {
        throw Object.assign(new Error('Chromium 未生成 PDF 文件'), { code: 'PDF_OUTPUT_MISSING' });
      }
      return executable;
    } catch (error) {
      if (error?.code === 'TASK_CANCELLED' || error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw Object.assign(new Error('所有可用 Chromium 均无法完成 PDF 导出'), {
    code: lastError?.code || 'PDF_EXPORT_FAILED',
    cause: lastError,
  });
}
async function exportPdf(artifactId, { taskId, signal } = {}) {
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
  const tmpTarget = `${target.absolute}.tmp`;
  try {
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: 10, stage: '正在排版 PDF' });
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    await fs.writeFile(html, safeHtml(artifact.previewHtml, artifact.title), 'utf8');
    await fs.mkdir(target.directory, { recursive: true });
    await renderPdfWithFallback({ html, temporary, tempDir, signal });
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: 80, stage: '正在校验 PDF' });
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    let buffer = await fs.readFile(temporary);
    buffer = await stampPdf(buffer);
    const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
    if (buffer.length < 100 || buffer.length > MAX_FILE_BYTES || buffer.subarray(0, 5).toString() !== '%PDF-' || !tail.includes('%%EOF')) throw Object.assign(new Error('PDF 文件无效或过大'), { code: 'PDF_INVALID' });
    await fs.writeFile(tmpTarget, buffer, { flag: 'wx' });
    await fs.rename(tmpTarget, target.absolute);
    const relative = path.relative(STORAGE_ROOT, target.absolute).replace(/\\/g, '/');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const updated = await prisma.generatedArtifactExport.update({ where: { id: record.id }, data: { status: 'READY', storagePath: relative, fileSizeBytes: BigInt(buffer.length), checksum, mimeType: PDF_MIME, lastAccessedAt: new Date(), errorCode: null, errorMessage: null } });
    if (previousPath && previousPath !== target.absolute) await fs.unlink(previousPath).catch(() => {});
    return updated;
  } catch (error) {
    await fs.unlink(tmpTarget).catch(() => {});
    await prisma.generatedArtifactExport.update({ where: { id: record.id }, data: { status: 'FAILED', errorCode: String(error.code || 'PDF_EXPORT_FAILED'), errorMessage: 'PDF 导出失败，请稍后重试。' } }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
module.exports={PDF_MIME,safeHtml,browserPath,browserPaths,stampPdf,renderPdfWithFallback,exportPdf};
