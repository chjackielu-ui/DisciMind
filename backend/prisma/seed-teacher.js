// DisciMind 教师端种子数据增强脚本
// 新增多教师场景所需数据：额外教师、批量学生、班级关系
// 可重复运行，使用 upsert/findFirst 保证幂等

const { PrismaClient } = require('@prisma/client')
const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
const bcrypt = require('bcryptjs')
const { loadEnv } = require('../src/config/env')
const { getDatabaseConfig } = require('../src/config/database')

loadEnv()

const adapter = new PrismaMariaDb(getDatabaseConfig())
const prisma = new PrismaClient({ adapter })
const PASSWORD_HASH = bcrypt.hashSync('123456', 10)

function log(msg) { console.log(`[seed-teacher] ${msg}`) }

async function upsertUser(username, data) {
  return prisma.user.upsert({
    where: { username },
    update: { role: data.role, status: data.status || 'ACTIVE', phone: data.phone, email: data.email },
    create: { username, password_hash: PASSWORD_HASH, role: data.role, status: data.status || 'ACTIVE', phone: data.phone, email: data.email },
  })
}

async function upsertProfile(userId, data) {
  return prisma.userProfile.upsert({
    where: { user_id: userId },
    update: data,
    create: { user_id: userId, ...data },
  })
}

async function main() {
  log('========== 教师端种子数据增强开始 ==========')

  // 1. 创建额外教师
  log('1/5 创建额外教师用户')
  const teacherDefs = [
    { username: 'teacher_li', real_name: '李教授', teacher_no: 'T2024002', college: '计算机与软件工程学院', major: '计算机科学与技术', gender: 'MALE', phone: '13800000004', email: 'li@discimind.demo' },
    { username: 'teacher_wang', real_name: '王老师', teacher_no: 'T2024003', college: '计算机与软件工程学院', major: '软件工程', gender: 'FEMALE', phone: '13800000005', email: 'wang@discimind.demo' },
    { username: 'teacher_zhang', real_name: '张老师', teacher_no: 'T2024004', college: '数学与统计学院', major: '应用数学', gender: 'MALE', phone: '13800000006', email: 'zhang@discimind.demo' },
  ]

  const teachers = []
  for (const def of teacherDefs) {
    const user = await upsertUser(def.username, { role: 'TEACHER', phone: def.phone, email: def.email })
    await upsertProfile(user.user_id, {
      real_name: def.real_name,
      teacher_no: def.teacher_no,
      college: def.college,
      major: def.major,
      gender: def.gender,
    })
    teachers.push({ ...user, ...def })
    log(`  教师: ${def.real_name} (${def.username})`)
  }

  // 2. 创建行政班级（如果不存在）
  log('2/5 完善行政班级')
  const adminClassDefs = [
    { class_name: '软件2401班', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { class_name: '软件2402班', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { class_name: '软件2403班', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { class_name: '软件2404班', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { class_name: '计科2401班', college: '计算机与软件工程学院', major: '计算机科学与技术', grade: '2024' },
    { class_name: '计科2402班', college: '计算机与软件工程学院', major: '计算机科学与技术', grade: '2024' },
    { class_name: '数学2401班', college: '数学与统计学院', major: '应用数学', grade: '2024' },
  ]

  const adminClasses = {}
  for (const def of adminClassDefs) {
    const ac = await prisma.adminClass.upsert({
      where: { class_name_grade: { class_name: def.class_name, grade: def.grade } },
      update: { college: def.college, major: def.major },
      create: def,
    })
    adminClasses[def.class_name] = ac
  }
  log(`  行政班级: ${Object.keys(adminClasses).length} 个`)

  // 3. 创建大量学生
  log('3/5 创建批量学生')
  const studentDefs = [
    { username: 'stu_zs', real_name: '张三', student_no: '2024001', admin_class: '软件2401班', gender: 'MALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_ls', real_name: '李四', student_no: '2024002', admin_class: '软件2401班', gender: 'MALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_ww', real_name: '王五', student_no: '2024003', admin_class: '软件2401班', gender: 'MALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_zhao', real_name: '赵六', student_no: '2024004', admin_class: '软件2402班', gender: 'FEMALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_qian', real_name: '钱七', student_no: '2024005', admin_class: '软件2402班', gender: 'FEMALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_sun', real_name: '孙八', student_no: '2024006', admin_class: '软件2402班', gender: 'MALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_zhou', real_name: '周九', student_no: '2024007', admin_class: '软件2403班', gender: 'MALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_wu', real_name: '吴十', student_no: '2024008', admin_class: '软件2403班', gender: 'FEMALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_zheng', real_name: '郑十一', student_no: '2024009', admin_class: '软件2404班', gender: 'FEMALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_feng', real_name: '冯十二', student_no: '2024010', admin_class: '软件2404班', gender: 'MALE', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
    { username: 'stu_chen', real_name: '陈十三', student_no: '2024011', admin_class: '计科2401班', gender: 'MALE', college: '计算机与软件工程学院', major: '计算机科学与技术', grade: '2024' },
    { username: 'stu_chu', real_name: '褚十四', student_no: '2024012', admin_class: '计科2402班', gender: 'FEMALE', college: '计算机与软件工程学院', major: '计算机科学与技术', grade: '2024' },
    { username: 'stu_wei', real_name: '卫十五', student_no: '2024013', admin_class: '计科2402班', gender: 'MALE', college: '计算机与软件工程学院', major: '计算机科学与技术', grade: '2024' },
    { username: 'stu_jiang', real_name: '蒋十六', student_no: '2024014', admin_class: '数学2401班', gender: 'FEMALE', college: '数学与统计学院', major: '应用数学', grade: '2024' },
    { username: 'stu_han', real_name: '韩十七', student_no: '2024015', admin_class: '数学2401班', gender: 'MALE', college: '数学与统计学院', major: '应用数学', grade: '2024' },
  ]

  const newStudents = []
  for (const def of studentDefs) {
    const existingUser = await prisma.user.findUnique({ where: { username: def.username } })
    if (existingUser) {
      // 更新 profile 中的班级信息
      const ac = adminClasses[def.admin_class]
      if (ac) {
        await prisma.userProfile.update({
          where: { user_id: existingUser.user_id },
          data: { admin_class_id: ac.admin_class_id },
        })
      }
      newStudents.push(existingUser)
      continue
    }
    const user = await prisma.user.create({
      data: {
        username: def.username,
        password_hash: PASSWORD_HASH,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    const ac = adminClasses[def.admin_class]
    await prisma.userProfile.create({
      data: {
        user_id: user.user_id,
        real_name: def.real_name,
        student_no: def.student_no,
        college: def.college,
        major: def.major,
        grade: def.grade,
        gender: def.gender,
        admin_class_id: ac ? ac.admin_class_id : null,
      },
    })
    newStudents.push(user)
    log(`  学生: ${def.real_name} (${def.username}, ${def.admin_class})`)
  }
  log(`  共 ${newStudents.length} 名学生`)

  // 4. 关联教师与课程
  log('4/5 关联教师与课程')
  const allCourses = await prisma.course.findMany()

  // 每个教师关联部分课程
  const teacherAssignments = [
    { teacher: 'teacher_li', courses: ['ML001', 'OS001', 'DS001', 'NET001'] },
    { teacher: 'teacher_wang', courses: ['WEB001', 'JS001', 'DB001', 'PY001'] },
    { teacher: 'teacher_zhang', courses: ['PROB001', 'AI001', 'SE001'] },
  ]

  for (const assignment of teacherAssignments) {
    const teacher = teachers.find(t => t.username === assignment.teacher)
    if (!teacher) continue
    for (const courseCode of assignment.courses) {
      const course = allCourses.find(c => c.course_code === courseCode)
      if (!course) continue
      await prisma.courseTeacherRelation.upsert({
        where: {
          course_id_teacher_user_id: {
            course_id: course.course_id,
            teacher_user_id: teacher.user_id,
          },
        },
        update: { teacher_role: 'MAIN_TEACHER' },
        create: {
          course_id: course.course_id,
          teacher_user_id: teacher.user_id,
          teacher_role: 'MAIN_TEACHER',
        },
      })
      log(`  关联: ${teacher.real_name} → ${course.course_name}`)
    }
  }

  // 5. 为学生选课（加入教学班级）
  log('5/5 为学生选课')
  const allTeachingClasses = await prisma.teachingClass.findMany({
    include: { course: true },
  })

  let enrollmentCount = 0
  for (const student of newStudents) {
    // 为每个学生选 2-4 门课
    const shuffled = [...allTeachingClasses].sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, 2 + Math.floor(Math.random() * 3))

    for (const tc of selected) {
      // 检查是否已有选课
      const existing = await prisma.studentCourseEnrollment.findFirst({
        where: { student_user_id: student.user_id, course_id: tc.course_id },
      })
      if (!existing) {
        await prisma.studentCourseEnrollment.create({
          data: {
            student_user_id: student.user_id,
            course_id: tc.course_id,
            teaching_class_id: tc.teaching_class_id,
            enrollment_status: 'active',
          },
        })
        enrollmentCount++
      }
    }
  }
  log(`  完成 ${enrollmentCount} 条选课记录`)

  log('========== 教师端种子数据增强完成 ==========')
  log(`  新增教师: ${teachers.length} 人`)
  log(`  新增学生: ${newStudents.length} 人`)
  log(`  行政班级: ${Object.keys(adminClasses).length} 个`)
  log(`  选课记录: ${enrollmentCount} 条`)
  log(`  默认密码: 123456`)
}

main()
  .then(async () => { await prisma.$disconnect() })
  .catch(async (err) => {
    console.error('[seed-teacher] 错误:', err)
    await prisma.$disconnect()
    process.exit(1)
  })
