const prisma = require('../config/prisma');
const { getAccessibleCourseIds, getAccessibleTeachingClassIds, ensureCourseAccess } = require('./teacher-access.service');

async function getProfile(user) {
  const [record, courseIds, classIds] = await Promise.all([
    prisma.user.findUnique({ where: { user_id: user.user_id }, include: { profile: true } }),
    getAccessibleCourseIds(user),
    getAccessibleTeachingClassIds(user, { status: 'active' }),
  ]);
  if (!record) throw Object.assign(new Error('用户不存在'), { code: 40002 });
  const courses = await prisma.course.findMany({
    where: courseIds === null ? {} : { course_id: { in: courseIds } },
    select: { course_id: true, course_name: true, course_code: true, status: true },
    orderBy: { course_name: 'asc' },
  });
  const classes = classIds.length ? await prisma.teachingClass.findMany({
    where: { teaching_class_id: { in: classIds } },
    select: { teaching_class_id: true, teaching_class_name: true, schedule: true, location: true, course_id: true },
    orderBy: { teaching_class_name: 'asc' },
  }) : [];
  return {
    user_id: record.user_id,
    username: record.username,
    role: String(record.role).toLowerCase(),
    name: record.profile?.real_name || record.username,
    teacher_no: record.profile?.teacher_no || null,
    avatar_url: record.profile?.avatar_url || null,
    college: record.profile?.college || null,
    professional_title: record.profile?.professional_title || null,
    email: record.email,
    phone: record.phone,
    last_login_at: record.last_login_at,
    default_course_id: record.profile?.default_course_id || null,
    preferences: record.profile?.teacher_preferences || {
      message_preferences: { task_submission: true, knowledge_review: true, risk_alert: true, ai_task: true },
      ai_preferences: { response_style: 'structured', auto_include_sources: true },
      default_analytics_range: '7d',
    },
    courses,
    teaching_classes: classes,
    statistics: { course_count: courses.length, teaching_class_count: classes.length },
  };
}

async function updateProfile(user, body = {}) {
  const userData = {};
  if (body.email !== undefined) userData.email = body.email || null;
  if (body.phone !== undefined) userData.phone = body.phone || null;
  const profileData = {};
  if (body.name !== undefined) profileData.real_name = String(body.name).trim();
  if (body.college !== undefined) profileData.college = body.college || null;
  if (body.professional_title !== undefined) profileData.professional_title = body.professional_title || null;
  if (body.default_course_id !== undefined) {
    const courseId = body.default_course_id ? Number(body.default_course_id) : null;
    if (courseId) await ensureCourseAccess(user, courseId);
    profileData.default_course_id = courseId;
  }
  if (body.preferences !== undefined) {
    const current = await prisma.userProfile.findUnique({ where: { user_id: user.user_id }, select: { teacher_preferences: true } });
    profileData.teacher_preferences = { ...(current?.teacher_preferences || {}), ...(body.preferences || {}) };
  }
  await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length) await tx.user.update({ where: { user_id: user.user_id }, data: userData });
    if (Object.keys(profileData).length) await tx.userProfile.update({ where: { user_id: user.user_id }, data: profileData });
  });
  return getProfile(user);
}

module.exports = { getProfile, updateProfile };
