const prisma = require('../src/config/prisma');

const apply = process.argv.includes('--apply');
const suspicious = (value) => /\uFFFD|[\u0080-\u009f]|[ÃÂÐÑæåçäé]|\?{2,}/.test(String(value || ''));

function recoverUtf8(value) {
  const source = String(value || '');
  if (!suspicious(source)) return { value: source, changed: false, recoverable: true };
  const decoded = Buffer.from(source, 'latin1').toString('utf8');
  const valid = decoded && !/\uFFFD|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded) && /[\u3400-\u9fff]/.test(decoded);
  return { value: valid ? decoded : source, changed: valid && decoded !== source, recoverable: valid };
}

async function main() {
  const resources = await prisma.knowledgeDocument.findMany({
    where: { deleted_at: null },
    select: { document_id: true, title: true, original_filename: true, file_ext: true, metadata_json: true },
  });
  const report = [];
  for (const resource of resources) {
    if (resource.metadata_json?.encoding_repair_v1 || (!suspicious(resource.title) && !suspicious(resource.original_filename))) continue;
    const title = recoverUtf8(resource.title);
    const filename = recoverUtf8(resource.original_filename);
    const recoverable = title.recoverable && filename.recoverable;
    const extension = String(resource.file_ext || 'file').replace(/^\./, '').toLowerCase();
    const nextTitle = recoverable ? title.value : `${extension.toUpperCase()} 参考资料（原文件名编码不可恢复）`;
    const nextFilename = recoverable ? filename.value : `resource-${resource.document_id}.${extension}`;
    const backup = {
      original_title: resource.title,
      original_filename: resource.original_filename,
      recoverable,
      repaired_at: new Date().toISOString(),
      reason: recoverable ? 'reversed_multipart_latin1_decode' : 'source_name_irreversibly_corrupted',
    };
    report.push({ id: resource.document_id, from: resource.title, to: nextTitle, recoverable });
    if (apply) {
      await prisma.knowledgeDocument.update({
        where: { document_id: resource.document_id },
        data: {
          title: nextTitle,
          original_filename: nextFilename,
          metadata_json: { ...(resource.metadata_json || {}), encoding_repair_v1: backup },
        },
      });
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: report.length, report }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
