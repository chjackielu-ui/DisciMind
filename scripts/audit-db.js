const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { loadEnv } = require('./src/config/env');
const { getDatabaseConfig } = require('./src/config/database');
loadEnv();
const adapter = new PrismaMariaDb(getDatabaseConfig());
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('=== Template count ===');
  const count = await prisma.learningWorkflowTemplate.count();
  console.log('Total templates:', count);

  console.log('\n=== All templates ===');
  const all = await prisma.learningWorkflowTemplate.findMany({
    select: {
      template_id: true, template_key: true, title: true,
      source_type: true, owner_type: true, is_published: true,
      is_default: true, status: true, course_id: true
    }
  });
  for (const t of all) {
    console.log(`  [${t.template_id}] ${t.template_key} | ${t.title} | source=${t.source_type} owner=${t.owner_type} published=${t.is_published} default=${t.is_default} status=${t.status} course=${t.course_id}`);
  }

  console.log('\n=== Version count ===');
  const versions = await prisma.learningWorkflowVersion.count();
  console.log('Total versions:', versions);

  console.log('\n=== Session count ===');
  const sessions = await prisma.learningSession.count();
  console.log('Total sessions:', sessions);

  // Check users
  const users = await prisma.user.findMany({
    select: { user_id: true, username: true, role: true },
    where: { role: 'STUDENT' }
  });
  console.log('\n=== Student users ===');
  for (const u of users) {
    console.log(`  [${u.user_id}] ${u.username} role=${u.role}`);
  }

  // Check courses
  const courses = await prisma.course.findMany({
    select: { course_id: true, course_name: true, status: true }
  });
  console.log('\n=== Courses ===');
  for (const c of courses) {
    console.log(`  [${c.course_id}] ${c.course_name} status=${c.status}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
