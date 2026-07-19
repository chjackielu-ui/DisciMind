// DisciMind 评委演示数据入口。
//
// 设计目标：
// 1. 可在空库或已有业务数据的数据库中重复执行；
// 2. 只更新带有固定演示标识的数据，不清空、不重置用户业务数据；
// 3. 复用完整的 408 比赛演示种子，并补齐三端通知与 AI 安全治理看板数据。

const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')
const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
const { loadEnv } = require('../src/config/env')
const { getDatabaseConfig } = require('../src/config/database')
const { seedCompetitionDemo } = require('./seeds/seedCompetitionDemo')
const { seedPermissionCatalog } = require('../src/services/admin-permission.seed')
const { STANDARD_CONTROLS } = require('../src/services/admin-ai-safety.service')

loadEnv()

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(getDatabaseConfig()),
})

const DEMO_PASSWORD = '123456'
const JUDGE_PREFIX = 'judge-demo:'

function log(message) {
  console.log(`[judge-seed] ${message}`)
}

function daysAgo(days, hour = 9) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(hour, 0, 0, 0)
  return date
}

function daysFromNow(days, hour = 18) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)
  return date
}

async function upsertUser(username, data) {
  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) {
    return prisma.user.update({
      where: { user_id: existing.user_id },
      data: { role: data.role, status: 'ACTIVE' },
    })
  }

  return prisma.user.create({
    data: {
      username,
      password_hash: await bcrypt.hash(DEMO_PASSWORD, 10),
      role: data.role,
      status: 'ACTIVE',
      phone: data.phone,
      email: data.email,
    },
  })
}

async function upsertProfile(userId, data) {
  return prisma.userProfile.upsert({
    where: { user_id: userId },
    update: data,
    create: { user_id: userId, ...data },
  })
}

async function ensureDemoAccounts() {
  const adminUser = await upsertUser('admin_demo', {
    role: 'ADMIN',
    phone: '13800000001',
    email: 'admin@discimind.demo',
  })
  const teacherUser = await upsertUser('teacher_demo', {
    role: 'TEACHER',
    phone: '13800000002',
    email: 'teacher@discimind.demo',
  })
  const studentUser = await upsertUser('student_demo', {
    role: 'STUDENT',
    phone: '13800000003',
    email: 'student@discimind.demo',
  })

  const adminClass = await prisma.adminClass.upsert({
    where: { class_name_grade: { class_name: '软件2403班', grade: '2024' } },
    update: {
      college: '计算机与软件工程学院',
      major: '软件工程',
      status: 'active',
    },
    create: {
      class_name: '软件2403班',
      college: '计算机与软件工程学院',
      major: '软件工程',
      grade: '2024',
      advisor_user_id: teacherUser.user_id,
      status: 'active',
    },
  })

  await upsertProfile(adminUser.user_id, {
    real_name: '管理员演示',
    college: '计算机与软件工程学院',
  })
  await upsertProfile(teacherUser.user_id, {
    real_name: '教师演示',
    teacher_no: 'T2024001',
    college: '计算机与软件工程学院',
    major: '计算机科学与技术',
    professional_title: '副教授',
    teacher_preferences: {
      message_notifications: true,
      ai_style: 'structured',
      analytics_range: '30d',
    },
  })
  await upsertProfile(studentUser.user_id, {
    real_name: '学生演示',
    student_no: 'S2024001',
    college: '计算机与软件工程学院',
    major: '软件工程',
    grade: '2024',
    admin_class_id: adminClass.admin_class_id,
  })

  return { adminUser, teacherUser, studentUser }
}

async function seedJudgeNotifications({ adminUser, teacherUser, studentUser }) {
  const course = await prisma.course.findUnique({ where: { course_code: 'CS408-DS' } })
  const task = course
    ? await prisma.learningTask.findFirst({
        where: { course_id: course.course_id, status: 'PUBLISHED' },
        orderBy: { deadline: 'asc' },
      })
    : null

  const notifications = [
    {
      idempotency_key: `${JUDGE_PREFIX}student:learning-path`,
      receiver_user_id: studentUser.user_id,
      sender_user_id: teacherUser.user_id,
      notification_type: 'TASK_PUBLISHED',
      title: '新的个性化学习任务已发布',
      content: '系统结合数据结构知识图谱和近期掌握度，为你生成了薄弱点巩固任务。',
      target_type: task ? 'learning_task' : 'course',
      target_id: task?.task_id || course?.course_id || null,
      business_type: 'judge_demo_learning',
      business_id: task?.task_id || course?.course_id || null,
    },
    {
      idempotency_key: `${JUDGE_PREFIX}teacher:class-risk`,
      receiver_user_id: teacherUser.user_id,
      sender_user_id: null,
      notification_type: 'STUDENT_RISK',
      title: '软件2403班学情风险提醒',
      content: '知识图谱分析发现部分学生在“快速排序与堆排序”节点掌握度偏低，建议安排分层干预。',
      target_type: 'course',
      target_id: course?.course_id || null,
      business_type: 'judge_demo_teaching',
      business_id: course?.course_id || null,
    },
    {
      idempotency_key: `${JUDGE_PREFIX}admin:ai-safety`,
      receiver_user_id: adminUser.user_id,
      sender_user_id: null,
      notification_type: 'SYSTEM_NOTICE',
      title: 'AI 安全治理标准已完成例行检查',
      content: '九项标准化安全控制已同步，当前存在一项高风险事件等待管理员复核。',
      target_type: 'ai_safety',
      target_id: null,
      business_type: 'judge_demo_governance',
      business_id: null,
    },
  ]

  for (const item of notifications) {
    const update = { ...item, deleted_at: null }
    delete update.idempotency_key
    await prisma.notification.upsert({
      where: { idempotency_key: item.idempotency_key },
      update,
      create: item,
    })
  }

  const reminderTitle = '评委演示：检查数据结构薄弱点干预方案'
  const existingReminder = await prisma.teacherReminder.findFirst({
    where: {
      teacherUserId: teacherUser.user_id,
      title: reminderTitle,
      businessType: 'judge_demo',
    },
  })
  const reminderData = {
    description: '查看班级知识图谱热力分布，确认分层练习与课堂讲解安排。',
    reminderType: 'class_risk',
    priority: 'high',
    courseId: course?.course_id || null,
    teachingClassId: task?.teaching_class_id || null,
    businessType: 'judge_demo',
    businessId: task?.task_id || null,
    startAt: daysFromNow(1, 9),
    remindAt: daysFromNow(1, 8),
    endAt: daysFromNow(1, 10),
    notes: '评委演示固定数据，可安全重复注入。',
  }
  if (existingReminder) {
    await prisma.teacherReminder.update({
      where: { id: existingReminder.id },
      data: reminderData,
    })
  } else {
    await prisma.teacherReminder.create({
      data: {
        teacherUserId: teacherUser.user_id,
        title: reminderTitle,
        status: 'pending',
        ...reminderData,
      },
    })
  }
}

async function seedAiSafetyDemo({ adminUser, studentUser }) {
  const rules = new Map()
  for (const control of STANDARD_CONTROLS) {
    const ruleKey = `standard:${control.key}`
    const payload = {
      name: control.name,
      risk_type: control.domain,
      severity: control.severity,
      detection_type: 'governance_control',
      condition_json: {
        standard_control: control.key,
        nist_function: control.nist_function,
        requirements: control.requirements,
        regulatory_basis: control.regulatory_basis,
      },
      action_json: {
        response: 'record_escalate_review',
        owner: 'ai_safety_officer',
        evidence_required: true,
      },
      published_at: daysAgo(14),
      updated_by: adminUser.user_id,
    }
    const rule = await prisma.aiRiskRule.upsert({
      where: { rule_key: ruleKey },
      // 保留管理员对既有规则的启停选择和版本状态。
      update: payload,
      create: {
        rule_key: ruleKey,
        ...payload,
        status: 'published',
        enabled: true,
        created_by: adminUser.user_id,
      },
    })
    rules.set(control.key, rule)
  }

  const eventDefs = [
    {
      event_key: `${JUDGE_PREFIX}risk:prompt-injection`,
      control: 'prompt-and-access-security',
      risk_type: 'security',
      severity: 'high',
      title: '检测到疑似提示词注入请求',
      description: '学生端请求包含绕过系统约束的指令，安全网关已阻断工具调用并等待人工复核。',
      status: 'open',
      detected_at: daysAgo(1, 15),
      confirmed: true,
    },
    {
      event_key: `${JUDGE_PREFIX}risk:privacy`,
      control: 'data-privacy',
      risk_type: 'privacy',
      severity: 'medium',
      title: '输入内容包含潜在个人信息',
      description: '脱敏组件识别出学号模式，相关内容已在进入模型前完成替换。',
      status: 'confirmed',
      detected_at: daysAgo(2, 11),
      confirmed: true,
    },
    {
      event_key: `${JUDGE_PREFIX}risk:grounding`,
      control: 'reliability-and-grounding',
      risk_type: 'reliability',
      severity: 'low',
      title: '低置信度教学结论已转人工复核',
      description: '系统未找到足够的课程知识库依据，已停止直接输出并由教师确认后关闭。',
      status: 'resolved',
      detected_at: daysAgo(4, 10),
      resolved_at: daysAgo(3, 14),
      confirmed: false,
      resolution: '教师复核后补充了课程来源，相关回答已重新生成。',
    },
  ]

  for (const item of eventDefs) {
    const { control, ...eventData } = item
    const event = await prisma.aiRiskEvent.upsert({
      where: { event_key: item.event_key },
      update: {
        ...eventData,
        risk_rule_id: rules.get(control)?.id || null,
        assignee_id: adminUser.user_id,
      },
      create: {
        ...eventData,
        risk_rule_id: rules.get(control)?.id || null,
        user_id: studentUser.user_id,
        assignee_id: adminUser.user_id,
      },
    })

    const evidenceSourceId = `${JUDGE_PREFIX}evidence:${control}`
    const evidence = await prisma.aiRiskEventEvidence.findFirst({
      where: { risk_event_id: event.id, source_id: evidenceSourceId },
    })
    if (!evidence) {
      await prisma.aiRiskEventEvidence.create({
        data: {
          risk_event_id: event.id,
          evidence_type: 'redacted_request_excerpt',
          source_type: 'judge_seed',
          source_id: evidenceSourceId,
          evidence_redacted: '演示证据已脱敏：仅保留风险类型、检测规则与处置结果。',
          evidence_json: { demo: true, control, contains_personal_data: false },
        },
      })
    }

    const action = await prisma.aiRiskAction.findFirst({
      where: { risk_event_id: event.id, request_id: `${JUDGE_PREFIX}action:${control}` },
    })
    if (!action) {
      await prisma.aiRiskAction.create({
        data: {
          risk_event_id: event.id,
          action_type: item.status === 'resolved' ? 'human_review_completed' : 'block_and_escalate',
          status: item.status === 'resolved' ? 'completed' : 'pending',
          action_summary: item.status === 'resolved' ? '已完成人工复核并补充可信来源。' : '已阻断高风险输出并分派管理员复核。',
          actor_user_id: adminUser.user_id,
          request_id: `${JUDGE_PREFIX}action:${control}`,
        },
      })
    }
  }
}

async function scopedCounts() {
  const demoUsers = await prisma.user.findMany({
    where: { username: { in: ['admin_demo', 'teacher_demo', 'student_demo', 'teacher_408'] } },
    select: { user_id: true, username: true },
  })
  const userIdByName = new Map(demoUsers.map((item) => [item.username, item.user_id]))
  const courses = await prisma.course.findMany({
    where: { course_code: { startsWith: 'CS408-' } },
    select: { course_id: true },
  })
  const courseIds = courses.map((item) => item.course_id)
  const studentId = userIdByName.get('student_demo') || -1
  const teacherId = userIdByName.get('teacher_demo') || -1

  const [classes, enrollments, tasks, questions, mastery, notifications, reminders, safetyRules, riskEvents] = await Promise.all([
    prisma.teachingClass.count({ where: { course_id: { in: courseIds } } }),
    prisma.studentCourseEnrollment.count({ where: { student_user_id: studentId, course_id: { in: courseIds } } }),
    prisma.learningTask.count({ where: { course_id: { in: courseIds } } }),
    prisma.question.count({ where: { course_id: { in: courseIds } } }),
    prisma.studentMasteryRecord.count({ where: { student_user_id: studentId, course_id: { in: courseIds } } }),
    prisma.notification.count({ where: { idempotency_key: { startsWith: JUDGE_PREFIX } } }),
    prisma.teacherReminder.count({ where: { teacherUserId: teacherId, businessType: 'judge_demo' } }),
    prisma.aiRiskRule.count({ where: { rule_key: { startsWith: 'standard:' } } }),
    prisma.aiRiskEvent.count({ where: { event_key: { startsWith: `${JUDGE_PREFIX}risk:` } } }),
  ])

  return {
    demo_users: demoUsers.length,
    courses_408: courses.length,
    teaching_classes_408: classes,
    student_demo_enrollments_408: enrollments,
    tasks_408: tasks,
    questions_408: questions,
    student_demo_mastery_records_408: mastery,
    judge_notifications: notifications,
    judge_teacher_reminders: reminders,
    ai_safety_standard_rules: safetyRules,
    ai_safety_demo_events: riskEvents,
  }
}

function countDelta(before, after) {
  return Object.fromEntries(
    Object.keys(after).map((key) => [key, after[key] - (before[key] || 0)]),
  )
}

async function main() {
  log('开始注入评委演示数据（幂等模式，不删除现有数据）')
  const before = await scopedCounts()
  const accounts = await ensureDemoAccounts()

  await seedPermissionCatalog(prisma, {
    assignUncoveredAdmins: true,
    grantedBy: accounts.adminUser.user_id,
  })
  await seedCompetitionDemo({
    prisma,
    upsertUser,
    upsertProfile,
    ...accounts,
    log,
  })
  await seedJudgeNotifications(accounts)
  await seedAiSafetyDemo(accounts)

  const after = await scopedCounts()
  log(`新增计数：${JSON.stringify(countDelta(before, after))}`)
  log(`当前演示数据：${JSON.stringify(after)}`)
  log('演示账号：admin_demo / teacher_demo / student_demo，密码均为 123456（已有账号密码不会被重置）')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error('[judge-seed] 注入失败：', error)
    await prisma.$disconnect()
    process.exit(1)
  })

