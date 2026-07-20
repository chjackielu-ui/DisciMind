// 只注入/刷新学生端课程体验数据，不重复生成其它演示业务记录。

const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { loadEnv } = require('../src/config/env');
const { getDatabaseConfig } = require('../src/config/database');
const { seedStudentLearningExperience } = require('./seeds/seedStudentLearningExperience');
const { seedAgentMarketplace } = require('./seeds/seedAgentMarketplace');
const { buildSyllabusRecommendations } = require('../src/services/student-cold-start.service');

loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(getDatabaseConfig()) });

async function main() {
  const [adminUser, teacherUser, studentUser, adminClass, semester] = await Promise.all([
    prisma.user.findUnique({ where: { username: 'admin_demo' } }),
    prisma.user.findUnique({ where: { username: 'teacher_demo' } }),
    prisma.user.findUnique({ where: { username: 'student_demo' } }),
    prisma.adminClass.findFirst({ where: { class_name: '软件2403班', grade: '2024' } }),
    prisma.academicSemester.findUnique({ where: { code: '2025-2026-2' } }),
  ]);
  if (!adminUser || !teacherUser || !studentUser || !adminClass || !semester) {
    throw new Error('缺少基础演示数据；请先执行 node prisma/seed.js。');
  }
  const log = (message) => console.log(`[seed:student] ${message}`);
  const summary = await seedStudentLearningExperience({ prisma, teacherUser, studentUser, adminClass, semester, log });
  const starterCourse = await prisma.course.findUnique({ where: { course_code: 'ML001' } });
  if (starterCourse) await buildSyllabusRecommendations(prisma, studentUser.user_id, starterCourse.course_id);
  await seedAgentMarketplace({ prisma, adminUser, studentUser, log });
  console.log(JSON.stringify({ courses: summary.length, chapters: summary.reduce((sum, item) => sum + item.chapters, 0), knowledgePoints: summary.reduce((sum, item) => sum + item.points, 0) }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('[seed:student] failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  });
