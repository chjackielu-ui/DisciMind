const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const prisma = require('../src/config/prisma')
const access = require('../src/services/teacher-access.service')
const analytics = require('../src/services/teacher-analytics-workbench.service')
const preparation = require('../src/services/teacher-preparation.service')
const teacherKnowledge = require('../src/services/teacher-knowledge.service')
const studentResources = require('../src/services/student-resource.service')

async function demoContext() {
  const teacher = await prisma.user.findUnique({ where: { username: 'teacher_demo' } })
  const course = await prisma.course.findUnique({ where: { course_code: 'ML001' } })
  const teachingClass = await prisma.teachingClass.findFirst({ where: { course_id: course.course_id, teaching_class_name: '软件2403班' } })
  const student = await prisma.user.findUnique({ where: { username: 'student_240302' } })
  return { user: { user_id: teacher.user_id, role: 'teacher' }, teacher, course, teachingClass, student }
}

test('教师权限严格限制到授权教学班和班内学生', async () => {
  const ctx = await demoContext()
  const ownClass = await access.ensureTeachingClassAccess(ctx.user, ctx.teachingClass.teaching_class_id)
  assert.equal(ownClass.teacher_user_id, ctx.teacher.user_id)
  await assert.rejects(() => access.ensureTeachingClassAccess({ user_id: 999999, role: 'teacher' }, ctx.teachingClass.teaching_class_id), error => error.code === 40301)
  const student = await access.ensureStudentAccess(ctx.user, ctx.student.user_id)
  assert.equal(student.user_id, ctx.student.user_id)
  const outsider = await prisma.user.findUnique({ where: { username: 'student_b' } })
  if (outsider) await assert.rejects(() => access.ensureStudentAccess(ctx.user, outsider.user_id), error => error.code === 40301)
})

test('学生可加入多个教学班且行政班关系保持独立', async () => {
  const ctx = await demoContext()
  const enrollments = await prisma.studentCourseEnrollment.findMany({ where: { student_user_id: ctx.student.user_id, enrollment_status: 'active' }, include: { teachingClass: true } })
  assert.ok(enrollments.length >= 2)
  assert.ok(new Set(enrollments.map(item => item.teaching_class_id)).size >= 2)
  const profile = await prisma.userProfile.findUnique({ where: { user_id: ctx.student.user_id }, include: { admin_class: true } })
  assert.equal(profile.admin_class.class_name, '软件2403班')
})

test('教师发布任务已经建立接收关系、通知和学生提交闭环', async () => {
  const ctx = await demoContext()
  const task = await prisma.learningTask.findFirst({ where: { teaching_class_id: ctx.teachingClass.teaching_class_id, title: '模型评估与过拟合巩固作业', status: 'PUBLISHED' }, include: { recipients: true, submissions: true } })
  assert.ok(task)
  assert.ok(task.recipients.length >= 6)
  assert.ok(task.submissions.length >= 4)
  const delivered = task.recipients.find(item => item.student_user_id === ctx.student.user_id)
  assert.ok(delivered)
  const notification = await prisma.notification.findFirst({ where: { receiver_user_id: ctx.student.user_id, business_type: 'homework', business_id: task.task_id, deleted_at: null } })
  assert.ok(notification)
  const teacherNotice = await prisma.notification.findFirst({ where: { receiver_user_id: ctx.teacher.user_id, business_type: 'homework_submission', deleted_at: null } })
  assert.ok(teacherNotice)
})

test('学情工作台只聚合授权班级的真实近期数据', async () => {
  const ctx = await demoContext()
  const result = await analytics.buildWorkbench(ctx.user, { course_id: ctx.course.course_id, teaching_class_id: ctx.teachingClass.teaching_class_id, range: '7d' }, { persist: false })
  assert.equal(result.filters.teaching_class_id, ctx.teachingClass.teaching_class_id)
  assert.ok(result.overview.student_count >= 6)
  assert.ok(result.overview.study_minutes > 0)
  assert.ok(result.learning_trend.some(item => item.study_minutes > 0))
  assert.ok(result.dialogue.keywords.length > 0)
  assert.ok(result.data_sources.counts.study_records > 0)
})

test('知识库公开申请和智慧备课版本使用真实数据库', async () => {
  const ctx = await demoContext()
  const application = await prisma.knowledgeBaseReviewRecord.findUnique({ where: { operationId: 'seed-kb-submit-ml-wrong' }, include: { knowledgeBase: true } })
  assert.equal(application.action, 'SUBMITTED')
  assert.equal(application.knowledgeBase.marketplace_visibility, 'PUBLIC_PENDING')
  const plan = await prisma.lessonPlan.findFirst({ where: { teacher_user_id: ctx.teacher.user_id, teaching_class_id: ctx.teachingClass.teaching_class_id, topic: '模型评估与过拟合诊断' }, include: { versions: true } })
  assert.ok(plan)
  assert.ok(plan.versions.length >= 1)
  assert.equal(plan.versions[0].version_number, 1)
})

async function waitForArtifact(artifactId) {
  for (let count = 0; count < 300; count += 1) {
    const artifact = await prisma.generatedArtifact.findUnique({ where: { id: artifactId }, include: { task: true, exports: { orderBy: { createdAt: 'desc' } } } })
    const ready = artifact?.exports?.find(item => item.status === 'READY')
    if (ready?.storagePath && artifact?.task?.status === 'SUCCEEDED') return ready
    if (artifact?.status === 'FAILED' || artifact?.exports?.some(item => item.status === 'FAILED')) throw new Error('教案导出失败')
    await delay(50)
  }
  throw new Error('教案导出超时')
}

const generatedArtifactRoot = path.resolve(__dirname, '../storage/generated-artifacts')

function resolveGeneratedArtifactFile(storagePath) {
  const absolutePath = path.resolve(generatedArtifactRoot, storagePath)
  const relativePath = path.relative(generatedArtifactRoot, absolutePath)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`拒绝清理生成产物目录之外的文件：${storagePath}`)
  }
  return absolutePath
}

async function cleanupGeneratedArtifact(queued) {
  if (!queued?.artifact_id) return
  const artifact = await prisma.generatedArtifact.findUnique({
    where: { id: queued.artifact_id },
    include: { exports: true },
  })
  if (!artifact) return

  const storagePaths = [...new Set([
    artifact.storagePath,
    ...artifact.exports.map(item => item.storagePath),
  ].filter(Boolean))]

  await prisma.$transaction(async tx => {
    await tx.notification.deleteMany({
      where: { business_type: 'lesson_plan_artifact', business_id: artifact.id },
    })
    await tx.knowledgeDocument.deleteMany({ where: { source_artifact_id: artifact.id } })
    await tx.learningFlowResourceLink.deleteMany({ where: { artifactId: artifact.id } })
    await tx.generatedArtifactExport.deleteMany({ where: { artifactId: artifact.id } })
    await tx.generatedArtifact.delete({ where: { id: artifact.id } })
    if (artifact.taskId) await tx.asyncTask.deleteMany({ where: { id: artifact.taskId } })
  })

  for (const storagePath of storagePaths) {
    const absolutePath = resolveGeneratedArtifactFile(storagePath)
    await fs.unlink(absolutePath).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    await fs.rmdir(path.dirname(absolutePath)).catch(error => {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error
    })
  }
}

test('教案 DOCX 与 PDF 真实生成并进入任务/产物中心', async () => {
  const ctx = await demoContext()
  const plan = await prisma.lessonPlan.findFirst({ where: { teacher_user_id: ctx.teacher.user_id, topic: '模型评估与过拟合诊断' } })
  const queuedArtifacts = []
  try {
    for (const format of ['DOCX', 'PDF']) {
      const queued = await preparation.exportPlan(ctx.user, plan.lesson_plan_id, format)
      queuedArtifacts.push(queued)
      const exported = await waitForArtifact(queued.artifact_id)
      const bytes = await fs.readFile(resolveGeneratedArtifactFile(exported.storagePath))
      assert.ok(bytes.length > 500)
      if (format === 'PDF') assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
      else assert.equal(bytes.subarray(0, 2).toString(), 'PK')
      const task = await prisma.asyncTask.findUnique({ where: { id: queued.task_id } })
      assert.equal(task.status, 'SUCCEEDED')
    }
  } finally {
    for (const queued of queuedArtifacts.reverse()) await cleanupGeneratedArtifact(queued)
  }
})

test('学生讲义导出自动进入教师资源中心', async () => {
  const ctx = await demoContext()
  const plan = await prisma.lessonPlan.findFirst({ where: { teacher_user_id: ctx.teacher.user_id, topic: '模型评估与过拟合诊断' } })
  const queued = await preparation.exportPlan(ctx.user, plan.lesson_plan_id, 'DOCX', 'STUDENT_HANDOUT')
  try {
    await waitForArtifact(queued.artifact_id)
    let resource = null
    for (let count = 0; count < 40 && !resource; count += 1) {
      resource = await prisma.knowledgeDocument.findFirst({ where: { source_artifact_id: queued.artifact_id, deleted_at: null } })
      if (!resource) await delay(25)
    }
    assert.ok(resource)
    assert.equal(resource.resource_kind, 'student_handout')
    assert.equal(resource.version_source, 'AI_GENERATED')
    assert.equal(resource.file_url.includes('/generated-artifacts/'), true)
  } finally {
    await cleanupGeneratedArtifact(queued)
  }
})

test('资源下发幂等且学生阅读完成状态真实回流', async () => {
  const ctx = await demoContext()
  const seeded = await prisma.resourceDistribution.findUnique({ where: { operation_id: 'seed-resource-distribution-model-eval' } })
  assert.ok(seeded)
  const operationId = `teacher-platform-resource-${Date.now()}`
  let distributionId = null
  try {
    const body = {
      teaching_class_id: ctx.teachingClass.teaching_class_id,
      distribution_type: 'course_material',
      student_user_ids: [ctx.student.user_id],
      operation_id: operationId,
      message: '请在课前阅读模型评估资料',
    }
    const first = await teacherKnowledge.shareResource(ctx.user, seeded.resource_id, body)
    distributionId = first.distribution_id
    const second = await teacherKnowledge.shareResource(ctx.user, seeded.resource_id, body)
    assert.equal(second.distribution_id, distributionId)
    assert.equal(second.idempotent, true)
    const assigned = await studentResources.listResources({ user_id: ctx.student.user_id, role: 'student' })
    const item = assigned.list.find((record) => record.distribution_id === distributionId)
    assert.ok(item)
    await studentResources.openResource({ user_id: ctx.student.user_id, role: 'student' }, item.recipient_id)
    await studentResources.completeResource({ user_id: ctx.student.user_id, role: 'student' }, item.recipient_id)
    const stats = await teacherKnowledge.getResourceDistributionStats(ctx.user, seeded.resource_id)
    const current = stats.list.find((record) => record.distribution_id === distributionId)
    assert.equal(current.recipient_count, 1)
    assert.equal(current.read_count, 1)
    assert.equal(current.completed_count, 1)
  } finally {
    if (distributionId) {
      await prisma.notification.deleteMany({ where: { business_type: 'resource_distribution', business_id: distributionId } })
      await prisma.resourceDistribution.deleteMany({ where: { distribution_id: distributionId } })
    }
  }
})

test.after(async () => { await prisma.$disconnect() })
