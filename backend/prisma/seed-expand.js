// DisciMind 种子数据扩展脚本
// 基于已有用户扩展课程、知识点、掌握度、能力画像等数据
// 可重复运行，使用 upsert 保证幂等

const { PrismaClient } = require('@prisma/client')
const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
const { loadEnv } = require('../src/config/env')
const { getDatabaseConfig } = require('../src/config/database')
const { COURSE_DEFS } = require('./seeds/seedCourseDefs')

loadEnv()

const adapter = new PrismaMariaDb(getDatabaseConfig())
const prisma = new PrismaClient({ adapter })

function log(msg) { console.log(`[seed-expand] ${msg}`) }

// ============ 工具函数 ============

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomPick(arr) {
  return arr[randomInt(0, arr.length - 1)]
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(randomInt(8, 22), randomInt(0, 59), 0, 0)
  return d
}

function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(randomInt(9, 20), randomInt(0, 59), 0, 0)
  return d
}

// 按复杂规则为每个学生-课程生成不同的种子值
function seededRandom(studentId, courseId, salt = 0) {
  const n = (studentId * 2654435761 + courseId * 1597334677 + salt * 2246822519) & 0x7FFFFFFF
  return (n % 10000) / 10000
}

function masteryLevelFromScore(score) {
  if (score >= 85) return 'EXCELLENT'
  if (score >= 70) return 'GOOD'
  if (score >= 50) return 'GENERAL'
  return 'WEAK'
}

// ============ 主流程 ============

async function main() {
  log('========== 种子数据扩展开始 ==========')

  // 1. 查询现有用户
  log('1. 查询现有用户...')
  const allUsers = await prisma.user.findMany({
    include: { profile: true },
    orderBy: { user_id: 'asc' },
  })
  log(`  共 ${allUsers.length} 个用户`)

  const students = allUsers.filter(u => u.role === 'STUDENT')
  const teachers = allUsers.filter(u => u.role === 'TEACHER')
  const admins = allUsers.filter(u => u.role === 'ADMIN')

  log(`  学生: ${students.length} 人`)
  log(`  教师: ${teachers.length} 人`)
  log(`  管理员: ${admins.length} 人`)

  if (students.length === 0) {
    log('⚠ 没有学生用户，跳过学生数据扩展')
  }

  // 2. 创建课程、章节、知识点
  log('2. 创建课程、章节与知识点...')
  let totalChapters = 0
  let totalKps = 0

  for (const courseDef of COURSE_DEFS) {
    // upsert course
    const course = await prisma.course.upsert({
      where: { course_code: courseDef.course_code },
      update: {
        course_name: courseDef.course_name,
        subject_category: courseDef.subject_category,
        description: courseDef.description,
        status: 'ACTIVE',
      },
      create: {
        course_name: courseDef.course_name,
        course_code: courseDef.course_code,
        subject_category: courseDef.subject_category,
        description: courseDef.description,
        status: 'ACTIVE',
      },
    })

    // 关联教师（取第一个教师用户）
    if (teachers.length > 0) {
      const primaryTeacher = teachers[0]
      await prisma.courseTeacherRelation.upsert({
        where: {
          course_id_teacher_user_id: {
            course_id: course.course_id,
            teacher_user_id: primaryTeacher.user_id,
          },
        },
        update: { teacher_role: 'MAIN_TEACHER' },
        create: {
          course_id: course.course_id,
          teacher_user_id: primaryTeacher.user_id,
          teacher_role: 'MAIN_TEACHER',
        },
      })
    }

    // 创建教学班
    const existingClasses = await prisma.adminClass.findMany()
    for (const adminClass of existingClasses) {
      await prisma.teachingClass.upsert({
        where: {
          course_id_teaching_class_name: {
            course_id: course.course_id,
            teaching_class_name: adminClass.class_name,
          },
        },
        update: {
          semester: '2025-2026-2',
          description: `${courseDef.course_name}课程教学班，面向${adminClass.major || '相关专业'}${adminClass.grade || ''}级${adminClass.class_name}学生。`,
        },
        create: {
          course_id: course.course_id,
          teaching_class_name: adminClass.class_name,
          semester: '2025-2026-2',
          description: `${courseDef.course_name}课程教学班，面向${adminClass.major || '相关专业'}${adminClass.grade || ''}级${adminClass.class_name}学生。`,
        },
      })
    }

    // 创建章节和知识点
    for (const chapterDef of courseDef.chapters) {
      let chapter = await prisma.chapter.findFirst({
        where: { course_id: course.course_id, chapter_name: chapterDef.name },
      })
      if (chapter) {
        chapter = await prisma.chapter.update({
          where: { chapter_id: chapter.chapter_id },
          data: { chapter_order: chapterDef.order, description: chapterDef.desc },
        })
      } else {
        chapter = await prisma.chapter.create({
          data: {
            course_id: course.course_id,
            chapter_name: chapterDef.name,
            chapter_order: chapterDef.order,
            description: chapterDef.desc,
          },
        })
      }
      totalChapters++

      for (const kpDef of chapterDef.kps) {
        await prisma.knowledgePoint.upsert({
          where: {
            course_id_knowledge_point_code: {
              course_id: course.course_id,
              knowledge_point_code: kpDef.code,
            },
          },
          update: {
            chapter_id: chapter.chapter_id,
            knowledge_point_name: kpDef.name,
            description: kpDef.desc,
            difficulty_level: kpDef.diff,
            sort_order: chapterDef.order * 100 + chapterDef.kps.indexOf(kpDef),
          },
          create: {
            course_id: course.course_id,
            chapter_id: chapter.chapter_id,
            knowledge_point_name: kpDef.name,
            knowledge_point_code: kpDef.code,
            description: kpDef.desc,
            difficulty_level: kpDef.diff,
            sort_order: chapterDef.order * 100 + chapterDef.kps.indexOf(kpDef),
          },
        })
        totalKps++
      }
    }
  }

  log(`  课程: ${COURSE_DEFS.length} 门, 章节: ${totalChapters} 个, 知识点: ${totalKps} 个`)

  // 如果没学生，跳过后续
  if (students.length === 0) {
    log('========== 种子数据扩展完成（无学生，跳过学生相关数据） ==========')
    return
  }

  // 3. 获取所有课程和知识点
  log('3. 学生选课与数据初始化...')
  const allCourses = await prisma.course.findMany({
    where: { status: 'ACTIVE' },
    include: { chapters: { include: { knowledge_points: true } } },
  })

  const allKps = await prisma.knowledgePoint.findMany()
  const teachingClasses = await prisma.teachingClass.findMany()

  // 4. 为每个学生选课 + 创建掌握度 + 画像 + 学习记录 + 任务
  let totalEnrollments = 0
  let totalMastery = 0
  let totalPortraits = 0
  let totalSnapshots = 0
  let totalStudyRecords = 0
  let totalTasks = 0

  for (const student of students) {
    log(`  处理学生: ${student.profile?.real_name || student.username} (ID:${student.user_id})`)

    // 确定该学生选哪些课（4-7门，使用种子随机保证稳定）
    const courseCount = 4 + (seededRandom(student.user_id, 0) > 0.5 ? 1 : 0)
      + (seededRandom(student.user_id, 1) > 0.5 ? 1 : 0)
      + (seededRandom(student.user_id, 2) > 0.5 ? 1 : 0)
    // 随机排序课程，取前 courseCount 门
    const shuffledCourses = [...allCourses].sort(() => seededRandom(student.user_id, 3) - 0.5)
    const selectedCourses = shuffledCourses.slice(0, Math.min(courseCount, allCourses.length))

    for (let ci = 0; ci < selectedCourses.length; ci++) {
      const course = selectedCourses[ci]
      const seed = seededRandom(student.user_id, course.course_id)
      const courseKps = allKps.filter(kp => kp.course_id === course.course_id)

      // 4a. 选课
      const tc = teachingClasses.find(t => t.course_id === course.course_id)
      if (tc) {
        const existingEnrollment = await prisma.studentCourseEnrollment.findFirst({
          where: { student_user_id: student.user_id, course_id: course.course_id },
        })
        if (!existingEnrollment) {
          await prisma.studentCourseEnrollment.create({
            data: {
              student_user_id: student.user_id,
              course_id: course.course_id,
              teaching_class_id: tc.teaching_class_id,
              enrollment_status: 'active',
            },
          })
          totalEnrollments++
        }
      }

      if (courseKps.length === 0) continue

      // 4b. 知识点掌握度
      // 按比例分配掌握等级，不同学生不同
      const masteryRatios = {
        excellent: 0.10 + seed * 0.15,
        good: 0.15 + seed * 0.10,
        general: 0.20 + (1 - seed) * 0.10,
        weak: 0.15 + (1 - seed) * 0.10,
      }
      // 剩余为未学习

      // 根据课程在选课列表中的位置决定进度
      const progressMultiplier = ci === 0 ? 0.85 : (ci <= 2 ? 0.55 : 0.35)
      const totalLearnKps = Math.floor(courseKps.length * (0.5 + seed * 0.4))
      const learnKps = [...courseKps].sort(() => seed - 0.5).slice(0, totalLearnKps)

      for (const kp of learnKps) {
        const kpSeed = seededRandom(student.user_id, kp.knowledge_point_id)
        let score, level
        const tier = kpSeed
        if (tier < masteryRatios.excellent) { score = randomInt(85, 100); level = 'EXCELLENT' }
        else if (tier < masteryRatios.excellent + masteryRatios.good) { score = randomInt(70, 84); level = 'GOOD' }
        else if (tier < masteryRatios.excellent + masteryRatios.good + masteryRatios.general) { score = randomInt(50, 69); level = 'GENERAL' }
        else { score = randomInt(20, 49); level = 'WEAK' }

        // 最近练习时间
        const daysSince = level === 'WEAK' ? randomInt(10, 30) : randomInt(1, 14)
        const lastPractice = daysAgo(daysSince)

        await prisma.studentMasteryRecord.upsert({
          where: {
            student_user_id_course_id_knowledge_point_id: {
              student_user_id: student.user_id,
              course_id: course.course_id,
              knowledge_point_id: kp.knowledge_point_id,
            },
          },
          update: {
            mastery_score: score,
            mastery_level: level,
            quiz_score: Math.round(score * 0.6 * 100) / 100,
            question_score: Math.round(score * 0.25 * 100) / 100,
            study_progress_score: Math.round(score * 0.15 * 100) / 100,
            updated_at: lastPractice,
          },
          create: {
            student_user_id: student.user_id,
            course_id: course.course_id,
            knowledge_point_id: kp.knowledge_point_id,
            mastery_score: score,
            mastery_level: level,
            quiz_score: Math.round(score * 0.6 * 100) / 100,
            question_score: Math.round(score * 0.25 * 100) / 100,
            study_progress_score: Math.round(score * 0.15 * 100) / 100,
          },
        })
        totalMastery++
      }

      // 4c. 学生能力画像 (6维度)
      // 根据掌握度生成合理的能力维度分
      const allMastery = await prisma.studentMasteryRecord.findMany({
        where: { student_user_id: student.user_id, course_id: course.course_id },
      })
      const masteredCount = allMastery.filter(r => r.mastery_level === 'EXCELLENT' || r.mastery_level === 'GOOD').length
      const weakCount = allMastery.filter(r => r.mastery_level === 'WEAK').length
      const avgScore = allMastery.length > 0
        ? allMastery.reduce((s, r) => s + r.mastery_score, 0) / allMastery.length
        : 50
      const masteryRatio = courseKps.length > 0 ? masteredCount / courseKps.length : 0

      // 6维度评分（根据学生特点和课程不同调整）
      const dim1 = Math.round(Math.min(100, avgScore + randomInt(-5, 8)))  // 知识理解
      const dim2 = Math.round(Math.min(100, avgScore + randomInt(-8, 5) + (seed > 0.5 ? 5 : -3)))  // 练习表现
      const dim3 = Math.round(Math.min(100, avgScore + randomInt(-5, 5) + (weakCount > 3 ? -5 : 3)))  // 问题分析
      const dim4 = Math.round(Math.min(100, 60 + seededRandom(student.user_id, course.course_id + 100) * 35))  // 学习投入
      const dim5 = Math.round(Math.min(100, 55 + seededRandom(student.user_id, course.course_id + 200) * 35))  // 学习规划
      const dim6 = Math.round(Math.min(100, avgScore * 0.7 + seededRandom(student.user_id, course.course_id + 300) * 30))  // 反思改进

      const overallScore = Math.round((dim1 + dim2 + dim3 + dim4 + dim5 + dim6) / 6)
      let abilityLevel = '一般'
      if (overallScore >= 85) abilityLevel = '优秀'
      else if (overallScore >= 70) abilityLevel = '良好'
      else if (overallScore >= 50) abilityLevel = '一般'
      else abilityLevel = '待提升'

      // 优势与待提升
      const dims = [
        { key: 'knowledgeUnderstanding', label: '知识理解', score: dim1 },
        { key: 'practicePerformance', label: '练习表现', score: dim2 },
        { key: 'problemAnalysis', label: '问题分析', score: dim3 },
        { key: 'learningEngagement', label: '学习投入', score: dim4 },
        { key: 'learningPlanning', label: '学习规划', score: dim5 },
        { key: 'reflectionImprovement', label: '反思改进', score: dim6 },
      ]
      dims.sort((a, b) => b.score - a.score)
      const strengths = dims.slice(0, 2).map(d => d.label)
      const improvements = dims.slice(-2).map(d => d.label)

      await prisma.studentPortrait.upsert({
        where: {
          student_user_id_course_id: {
            student_user_id: student.user_id,
            course_id: course.course_id,
          },
        },
        update: {
          learning_total_score: overallScore,
          progress_score: dim5,  // 学习规划
          mastery_score: dim1,    // 知识理解
          test_score: dim2,       // 练习表现
          wrong_question_score: dim6, // 反思改进
          activity_score: dim4,   // 学习投入
          qa_score: dim3,         // 问题分析
        },
        create: {
          student_user_id: student.user_id,
          course_id: course.course_id,
          learning_total_score: overallScore,
          progress_score: dim5,
          mastery_score: dim1,
          test_score: dim2,
          wrong_question_score: dim6,
          activity_score: dim4,
          qa_score: dim3,
        },
      })
      totalPortraits++

      // 4d. 画像快照
      const snapshotDate = daysAgo(randomInt(1, 10))
      snapshotDate.setHours(0, 0, 0, 0)
      await prisma.studentPortraitSnapshot.upsert({
        where: {
          student_user_id_course_id_snapshot_date: {
            student_user_id: student.user_id,
            course_id: course.course_id,
            snapshot_date: snapshotDate,
          },
        },
        update: {
          learning_scores: {
            overallScore,
            level: abilityLevel,
            dimensions: dims,
            strengths,
            improvements,
          },
          mastery_summary: {
            total: courseKps.length,
            learned: allMastery.length,
            mastered: masteredCount,
            weak: weakCount,
            excellenceRatio: masteryRatio,
          },
          activity_summary: {
            total_study_hours: Math.round(allMastery.length * 1.5 + seed * 10),
            tasks_completed: randomInt(3, 12),
            average_score: Math.round(avgScore),
          },
        },
        create: {
          student_user_id: student.user_id,
          course_id: course.course_id,
          snapshot_date: snapshotDate,
          learning_scores: {
            overallScore,
            level: abilityLevel,
            dimensions: dims,
            strengths,
            improvements,
          },
          mastery_summary: {
            total: courseKps.length,
            learned: allMastery.length,
            mastered: masteredCount,
            weak: weakCount,
            excellenceRatio: masteryRatio,
          },
          activity_summary: {
            total_study_hours: Math.round(allMastery.length * 1.5 + seed * 10),
            tasks_completed: randomInt(3, 12),
            average_score: Math.round(avgScore),
          },
        },
      })
      totalSnapshots++

      // 4e. 学习活动记录（最近30天）
      const daysWithActivity = new Set()
      const activeDayCount = randomInt(12, 22)
      while (daysWithActivity.size < activeDayCount) {
        daysWithActivity.add(randomInt(1, 30))
      }

      for (const day of daysWithActivity) {
        const date = daysAgo(day)
        const kp = randomPick(courseKps)
        const existingRecord = await prisma.studyRecord.findFirst({
          where: {
            student_user_id: student.user_id,
            course_id: course.course_id,
            knowledge_point_id: kp.knowledge_point_id,
            started_at: {
              gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
              lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
            },
          },
        })
        if (!existingRecord) {
          const duration = randomInt(5, 90) * 60 // 5-90分钟
          const action = day <= 7 ? randomPick(['FINISH', 'REVIEW', 'FINISH']) : randomPick(['VIEW', 'START', 'FINISH', 'REVIEW'])
          await prisma.studyRecord.create({
            data: {
              student_user_id: student.user_id,
              course_id: course.course_id,
              knowledge_point_id: kp.knowledge_point_id,
              resource_type: 'knowledge_point',
              resource_id: kp.knowledge_point_id,
              action_type: action,
              started_at: date,
              finished_at: new Date(date.getTime() + duration * 1000),
              duration_seconds: duration,
              progress_percent: action === 'FINISH' ? 100 : randomInt(30, 90),
            },
          })
          totalStudyRecords++
        }
      }
    }

    // 5. 学习任务（8-15条，最近30天到未来7天）
    const taskCount = 8 + Math.floor(seededRandom(student.user_id, 999) * 7)
    // 用学生的课程
    const studentEnrollments = await prisma.studentCourseEnrollment.findMany({
      where: { student_user_id: student.user_id, enrollment_status: 'active' },
      include: { course: { include: { chapters: { include: { knowledge_points: true } } } } },
    })

    for (let ti = 0; ti < taskCount; ti++) {
      const taskSeed = seededRandom(student.user_id, 1000 + ti)
      const enrollment = studentEnrollments[ti % studentEnrollments.length]
      if (!enrollment) continue

      const course = enrollment.course
      const chapters = course.chapters || []
      const chapter = chapters[ti % Math.max(1, chapters.length)]
      const kps = chapter?.knowledge_points || []
      const kp = kps[ti % Math.max(1, kps.length)]

      const taskTypes = ['STUDY_TASK', 'STUDY_TASK', 'REVIEW_PLAN', 'QUIZ', 'STUDY_TASK', 'REVIEW_PLAN', 'STUDY_TASK']
      const taskType = taskTypes[ti % taskTypes.length]

      const taskTitles = [
        `完成${chapter?.chapter_name || '课程'}章节学习`,
        `${kp?.knowledge_point_name || '知识点'}专项练习`,
        `错题重做——${kp?.knowledge_point_name || '重点知识'}`,
        `${chapter?.chapter_name || '章节'}测验`,
        `AI生成练习——${kp?.knowledge_point_name || '智能推荐'}`,
        `复习薄弱知识点——${kp?.knowledge_point_name || '重点难点'}`,
        `完成${chapter?.chapter_name || '课程'}课后作业`,
      ]
      const title = taskTitles[ti % taskTitles.length]

      // 状态分布
      let status, startTime, deadline, completedAt, progress
      const statusRoll = taskSeed
      if (statusRoll < 0.4) {
        status = 'FINISHED'
        startTime = daysAgo(randomInt(5, 25))
        deadline = new Date(startTime.getTime() + randomInt(1, 10) * 86400000)
        completedAt = new Date(deadline.getTime() - randomInt(1, 48) * 3600000)
        progress = 100
      } else if (statusRoll < 0.65) {
        status = 'IN_PROGRESS'
        startTime = daysAgo(randomInt(1, 10))
        deadline = daysFromNow(randomInt(1, 5))
        completedAt = null
        progress = randomInt(15, 85)
      } else if (statusRoll < 0.80) {
        status = 'OVERDUE'
        startTime = daysAgo(randomInt(10, 25))
        deadline = daysAgo(randomInt(1, 7))
        completedAt = null
        progress = randomInt(10, 70)
      } else {
        status = 'PENDING'
        startTime = daysFromNow(randomInt(1, 5))
        deadline = daysFromNow(randomInt(3, 10))
        completedAt = null
        progress = 0
      }

      // 用唯一的业务键找到或创建任务（基于学生+课程+标题+开始时间组合）
      const taskKey = `${student.user_id}-${course.course_id}-${title}-${ti}`
      const existingTask = await prisma.learningTask.findFirst({
        where: {
          course_id: course.course_id,
          title: title,
          created_by_user_id: (await prisma.courseTeacherRelation.findFirst({
            where: { course_id: course.course_id },
            select: { teacher_user_id: true },
          }))?.teacher_user_id || undefined,
        },
      })

      // 简化：为每个学生任务创建独立的学习任务记录（用于学生端展示）
      // 这里我们使用 studyRecord 来模拟学习任务。
      // 实际上 LearningTask 需要 teaching_class_id 且是教师创建的。
      // 对于学生端的"最近学习任务"展示，我们通过 studyRecord 和 enrollment 来展示。

      // 创建学习记录作为任务活动
      if (!existingTask && status !== 'PENDING') {
        // 已有状态则创建一条学习记录
        const existingRecord = await prisma.studyRecord.findFirst({
          where: {
            student_user_id: student.user_id,
            course_id: course.course_id,
            resource_type: 'learning_task',
            action_type: status === 'FINISHED' ? 'FINISH' : 'START',
            started_at: startTime,
          },
        })
        if (!existingRecord) {
          await prisma.studyRecord.create({
            data: {
              student_user_id: student.user_id,
              course_id: course.course_id,
              knowledge_point_id: kp?.knowledge_point_id || null,
              resource_type: 'learning_task',
              resource_id: ti,
              action_type: status === 'FINISHED' ? 'FINISH' : (status === 'IN_PROGRESS' || status === 'OVERDUE' ? 'START' : 'VIEW'),
              started_at: startTime,
              finished_at: completedAt,
              duration_seconds: completedAt ? randomInt(15, 120) * 60 : randomInt(5, 30) * 60,
              progress_percent: progress,
            },
          })
          totalTasks++
        }
      }
    }
  }

  log('========== 种子数据扩展完成 ==========')
  log(`  已有用户: ${allUsers.length} (学生${students.length}, 教师${teachers.length}, 管理员${admins.length})`)
  log(`  课程: ${allCourses.length} 门 (新增约 ${COURSE_DEFS.length} 门)`)
  log(`  章节: 约 ${totalChapters} 个`)
  log(`  知识点: 约 ${totalKps} 个`)
  log(`  学生选课: ${totalEnrollments} 条`)
  log(`  知识点掌握度: ${totalMastery} 条`)
  log(`  能力画像: ${totalPortraits} 条`)
  log(`  画像快照: ${totalSnapshots} 条`)
  log(`  学习记录: ${totalStudyRecords} 条`)
  log(`  学习任务记录: ${totalTasks} 条`)
}

main()
  .then(async () => { await prisma.$disconnect() })
  .catch(async (err) => {
    console.error('[seed-expand] 错误:', err)
    await prisma.$disconnect()
    process.exit(1)
  })
