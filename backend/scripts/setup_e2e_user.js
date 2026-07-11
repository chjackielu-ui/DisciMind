require('dotenv').config();
const prisma = require('../src/config/prisma');

async function main() {
  // Find e2etest user
  const user = await prisma.user.findUnique({ where: { username: 'e2etest' } });
  if (!user) { console.log('User not found'); return; }
  console.log('User:', user.username, user.user_id);

  // Find a valid teaching class
  const tc = await prisma.teachingClass.findFirst();
  console.log('Teaching class:', tc?.teaching_class_id, tc?.teaching_class_name);
  if (!tc) { console.log('No teaching class found'); return; }

  // Enroll user
  const existing = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: user.user_id, course_id: tc.course_id },
  });
  if (existing) {
    console.log('Already enrolled in course', tc.course_id);
  } else {
    await prisma.studentCourseEnrollment.create({
      data: {
        student_user_id: user.user_id,
        course_id: tc.course_id,
        teaching_class_id: tc.teaching_class_id,
        enrollment_status: 'active',
      },
    });
    console.log('Enrolled in course', tc.course_id, 'class', tc.teaching_class_id);
  }

  // Find a knowledge point for this course
  const kp = await prisma.knowledgePoint.findFirst({
    where: { course_id: tc.course_id },
  });
  console.log('Knowledge point:', kp?.knowledge_point_id, kp?.knowledge_point_name);

  await prisma.$disconnect();
  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
