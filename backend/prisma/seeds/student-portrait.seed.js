// DisciMind — 学生画像种子数据
// 为 student_demo 补充科研能力画像、竞赛能力画像、历史快照趋势数据
// 可重复执行，全部使用 upsert，幂等安全
//
// 接入方式：在 seed.js / seed-expand.js 中调用
//   const { seedStudentPortrait } = require('./seeds/student-portrait.seed')
//   await seedStudentPortrait({ prisma, log })

/**
 * @param {object} opts
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {(msg: string) => void} opts.log
 */
async function seedStudentPortrait({ prisma, log }) {
  log('--- 学生画像种子数据 ---')

  // 1. 定位 student_demo 用户
  const student = await prisma.user.findUnique({ where: { username: 'student_demo' } })
  if (!student) {
    log('  student_demo 不存在，跳过画像种子')
    return
  }
  log(`  目标学生: ${student.username} (user_id=${student.user_id})`)

  // 2. 获取学生已加入的课程
  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where: { student_user_id: student.user_id, enrollment_status: 'active' },
    include: { course: true },
  })
  if (enrollments.length === 0) {
    log('  学生未加入任何课程，跳过画像种子')
    return
  }

  const mlEnrollment = enrollments.find(e => e.course.course_code === 'ML001')
  if (!mlEnrollment) {
    log('  学生未加入机器学习课程，跳过画像种子')
    return
  }
  const mlCourseId = mlEnrollment.course_id
  log(`  关联课程: ${mlEnrollment.course.course_name} (course_id=${mlCourseId})`)

  // 3. 更新 StudentPortrait — 提升学习能力，补充科研/竞赛能力
  const updatedPortrait = await prisma.studentPortrait.upsert({
    where: {
      student_user_id_course_id: {
        student_user_id: student.user_id,
        course_id: mlCourseId,
      },
    },
    update: {
      learning_total_score: 78,
      progress_score: 80,
      mastery_score: 74,
      test_score: 72,
      wrong_question_score: 68,
      activity_score: 82,
      qa_score: 76,
      research_total_score: 65,
      competition_total_score: 68,
    },
    create: {
      student_user_id: student.user_id,
      course_id: mlCourseId,
      learning_total_score: 78,
      progress_score: 80,
      mastery_score: 74,
      test_score: 72,
      wrong_question_score: 68,
      activity_score: 82,
      qa_score: 76,
      research_total_score: 65,
      competition_total_score: 68,
    },
  })
  log(`  学生画像已更新: learning=${updatedPortrait.learning_total_score}, research=${updatedPortrait.research_total_score}, competition=${updatedPortrait.competition_total_score}`)

  // 4. 创建科研能力画像
  await prisma.studentResearchProfile.upsert({
    where: {
      student_user_id_course_id: {
        student_user_id: student.user_id,
        course_id: mlCourseId,
      },
    },
    update: {
      total_score: 65,
      tags: JSON.stringify(['文献检索', '数据分析', '实验设计', '论文阅读', '学术表达']),
      teacher_comment: '具备一定的文献阅读和数据分析基础，实验设计能力正在成长，建议多参与课题组的研讨会和论文复现活动。',
    },
    create: {
      student_user_id: student.user_id,
      course_id: mlCourseId,
      total_score: 65,
      tags: JSON.stringify(['文献检索', '数据分析', '实验设计', '论文阅读', '学术表达']),
      teacher_comment: '具备一定的文献阅读和数据分析基础，实验设计能力正在成长，建议多参与课题组的研讨会和论文复现活动。',
    },
  })
  log('  科研能力画像已创建/更新 (total_score=65)')

  // 5. 创建竞赛能力画像
  await prisma.studentCompetitionProfile.upsert({
    where: {
      student_user_id_course_id: {
        student_user_id: student.user_id,
        course_id: mlCourseId,
      },
    },
    update: {
      total_score: 68,
      tags: JSON.stringify(['算法基础', '工程实现', '创新思维', '团队协作', '成果表达']),
      teacher_comment: '算法基础和工程实现能力较好，创新思维和团队协作有待加强，建议多参加编程竞赛和团队项目。',
    },
    create: {
      student_user_id: student.user_id,
      course_id: mlCourseId,
      total_score: 68,
      tags: JSON.stringify(['算法基础', '工程实现', '创新思维', '团队协作', '成果表达']),
      teacher_comment: '算法基础和工程实现能力较好，创新思维和团队协作有待加强，建议多参加编程竞赛和团队项目。',
    },
  })
  log('  竞赛能力画像已创建/更新 (total_score=68)')

  // 6. 创建历史 PortraitSnapshot 趋势数据（6个时间点，覆盖约6个月）
  // 学习能力从 55 逐步成长到 78，科研从 40 到 65，竞赛从 38 到 68
  const snapshotData = [
    { monthsAgo: 6, learning: 55, research: 40, competition: 38,
      dims: { knowledgeUnderstanding: 52, practicePerformance: 48, problemAnalysis: 44, learningEngagement: 60, learningPlanning: 55, reflectionImprovement: 50 } },
    { monthsAgo: 5, learning: 58, research: 45, competition: 42,
      dims: { knowledgeUnderstanding: 55, practicePerformance: 52, problemAnalysis: 47, learningEngagement: 63, learningPlanning: 57, reflectionImprovement: 53 } },
    { monthsAgo: 4, learning: 62, research: 50, competition: 48,
      dims: { knowledgeUnderstanding: 58, practicePerformance: 57, problemAnalysis: 52, learningEngagement: 66, learningPlanning: 60, reflectionImprovement: 57 } },
    { monthsAgo: 3, learning: 67, research: 55, competition: 55,
      dims: { knowledgeUnderstanding: 64, practicePerformance: 62, problemAnalysis: 58, learningEngagement: 70, learningPlanning: 65, reflectionImprovement: 62 } },
    { monthsAgo: 2, learning: 72, research: 60, competition: 62,
      dims: { knowledgeUnderstanding: 70, practicePerformance: 68, problemAnalysis: 64, learningEngagement: 75, learningPlanning: 70, reflectionImprovement: 66 } },
    { monthsAgo: 1, learning: 76, research: 63, competition: 66,
      dims: { knowledgeUnderstanding: 74, practicePerformance: 70, problemAnalysis: 68, learningEngagement: 80, learningPlanning: 74, reflectionImprovement: 70 } },
  ]

  for (const item of snapshotData) {
    const snapshotDate = new Date()
    snapshotDate.setMonth(snapshotDate.getMonth() - item.monthsAgo)
    snapshotDate.setDate(1)
    snapshotDate.setHours(0, 0, 0, 0)

    // 使用唯一的 snapshot_date；如果同月已有则更新
    const existingSnapshot = await prisma.studentPortraitSnapshot.findFirst({
      where: {
        student_user_id: student.user_id,
        course_id: mlCourseId,
        snapshot_date: {
          gte: new Date(snapshotDate.getFullYear(), snapshotDate.getMonth(), 1),
          lt: new Date(snapshotDate.getFullYear(), snapshotDate.getMonth() + 1, 1),
        },
      },
    })

    const snapshotPayload = {
      learning_scores: {
        learning_total_score: item.learning,
        progress_score: item.learning + 2,
        mastery_score: item.learning - 4,
        test_score: item.learning - 6,
        wrong_question_score: item.learning - 10,
        activity_score: item.learning + 4,
        qa_score: item.learning - 2,
        research_total_score: item.research,
        competition_total_score: item.competition,
        dimensions: Object.entries(item.dims).map(([key, score]) => ({
          key,
          label: { knowledgeUnderstanding: '知识理解', practicePerformance: '练习表现', problemAnalysis: '问题分析', learningEngagement: '学习投入', learningPlanning: '学习规划', reflectionImprovement: '反思改进' }[key],
          score,
        })),
        overallScore: item.learning,
        level: item.learning >= 75 ? '良好' : item.learning >= 65 ? '一般' : '待提升',
        strengths: item.learning >= 70 ? ['学习投入', '知识理解'] : ['学习投入'],
        improvements: item.learning >= 70 ? ['问题分析', '反思改进'] : ['练习表现', '问题分析', '反思改进'],
      },
      mastery_summary: {
        weak: item.learning < 65 ? 4 : item.learning < 72 ? 3 : 2,
        general: item.learning < 65 ? 3 : item.learning < 72 ? 3 : 3,
        good: item.learning < 65 ? 2 : item.learning < 72 ? 3 : 4,
        excellent: item.learning < 65 ? 1 : 1,
      },
      activity_summary: {
        total_study_time_minutes: Math.round(item.learning * 1.5),
        total_questions_answered: Math.round(item.learning * 0.8),
        correct_rate: Math.round(item.learning * 0.7 + 10),
      },
    }

    if (existingSnapshot) {
      await prisma.studentPortraitSnapshot.update({
        where: { snapshot_id: existingSnapshot.snapshot_id },
        data: {
          learning_scores: snapshotPayload.learning_scores,
          mastery_summary: snapshotPayload.mastery_summary,
          activity_summary: snapshotPayload.activity_summary,
        },
      })
    } else {
      await prisma.studentPortraitSnapshot.create({
        data: {
          student_user_id: student.user_id,
          course_id: mlCourseId,
          snapshot_date: snapshotDate,
          learning_scores: snapshotPayload.learning_scores,
          mastery_summary: snapshotPayload.mastery_summary,
          activity_summary: snapshotPayload.activity_summary,
        },
      })
    }
  }
  log(`  已创建/更新 ${snapshotData.length} 个历史画像快照（趋势数据）`)

  // 7. 验证写入
  const verifyPortrait = await prisma.studentPortrait.findUnique({
    where: { student_user_id_course_id: { student_user_id: student.user_id, course_id: mlCourseId } },
  })
  const verifyResearch = await prisma.studentResearchProfile.findFirst({
    where: { student_user_id: student.user_id },
  })
  const verifyCompetition = await prisma.studentCompetitionProfile.findFirst({
    where: { student_user_id: student.user_id },
  })
  const verifySnapshots = await prisma.studentPortraitSnapshot.count({
    where: { student_user_id: student.user_id, course_id: mlCourseId },
  })

  log('  验证结果:')
  log(`    StudentPortrait: learning=${verifyPortrait?.learning_total_score}, research=${verifyPortrait?.research_total_score}, competition=${verifyPortrait?.competition_total_score}`)
  log(`    StudentResearchProfile: total_score=${verifyResearch?.total_score}, tags=${verifyResearch?.tags}`)
  log(`    StudentCompetitionProfile: total_score=${verifyCompetition?.total_score}, tags=${verifyCompetition?.tags}`)
  log(`    StudentPortraitSnapshot: ${verifySnapshots} 条记录`)
  log('--- 学生画像种子数据完成 ---')
}

module.exports = { seedStudentPortrait }
