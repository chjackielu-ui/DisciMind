/*
 * 一次性清理历史空白学习流与内容完全相同的重复副本。
 * 有学习会话的记录改为 archived，保留会话快照和历史报告；无会话记录会被彻底删除。
 * 运行：cd backend && node ../scripts/cleanup-unnamed-learning-flows.js
 */
const prisma = require('../backend/src/config/prisma');

async function main() {
  const candidates = await prisma.learningWorkflowTemplate.findMany({
    where: { source_type: { notIn: ['SYSTEM', 'TEACHER'] }, status: { in: ['active', 'archived'] } },
    select: {
      template_id: true, title: true, owner_user_id: true, course_id: true, knowledge_point_id: true, updated_at: true,
      versions: {
        select: { graph_json: true, settings_json: true },
        orderBy: { version_number: 'desc' },
        take: 1,
      },
    },
  });
  const invalid = candidates.filter((item) => {
    const title = String(item.title || '').trim();
    return !title || title === '未命名学习流';
  });
  // 只把标题（含中英文括号、空白）和最新流程内容均一致的项目视为重复，
  // 手动编辑过的同名学习流不会被误清理。
  const invalidIds = new Set(invalid.map((item) => item.template_id));
  const duplicateIds = new Set();
  const seen = new Set();
  const normalizeCopyTitle = (title) => String(title || '').trim().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
  const isCopyTitle = (title) => /\(副本\)$/u.test(normalizeCopyTitle(title));
  const semanticFingerprint = (version) => {
    const graph = version.graph_json || {};
    return JSON.stringify({
      entryNodeId: graph.entryNodeId,
      nodes: (graph.nodes || []).map(({ id, type, title, config }) => ({ id, type, title, config })),
      edges: (graph.edges || []).map(({ source, target, condition, label }) => ({ source, target, condition, label })),
      settings: version.settings_json,
    });
  };
  const comparable = candidates
    .filter((item) => !invalidIds.has(item.template_id) && item.versions[0] && isCopyTitle(item.title))
    .sort((left, right) => {
      const leftScope = Number(Boolean(left.knowledge_point_id)) * 2 + Number(Boolean(left.course_id));
      const rightScope = Number(Boolean(right.knowledge_point_id)) * 2 + Number(Boolean(right.course_id));
      return rightScope - leftScope || new Date(right.updated_at) - new Date(left.updated_at);
    });
  for (const item of comparable) {
    const normalizedTitle = normalizeCopyTitle(item.title);
    const version = item.versions[0];
    const key = [item.owner_user_id, normalizedTitle, semanticFingerprint(version)].join('|');
    if (seen.has(key)) duplicateIds.add(item.template_id);
    else seen.add(key);
  }

  let deleted = 0;
  let archived = 0;
  async function cleanup(item, kind) {
    const sessionCount = await prisma.learningSession.count({
      where: { workflow_template_id: item.template_id },
    });
    if (sessionCount > 0) {
      await prisma.learningWorkflowTemplate.update({
        where: { template_id: item.template_id },
        data: { status: 'archived', title: `已归档${kind}学习流 #${item.template_id}` },
      });
      archived += 1;
    } else {
      await prisma.learningWorkflowTemplate.delete({ where: { template_id: item.template_id } });
      deleted += 1;
    }
  }
  for (const item of invalid) await cleanup(item, '空白');
  for (const id of duplicateIds) await cleanup({ template_id: id }, '重复');
  console.log(JSON.stringify({ invalid: invalid.length, duplicates: duplicateIds.size, deleted, archived }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
