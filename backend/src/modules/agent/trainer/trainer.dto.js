function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function lower(value) {
  return value == null ? null : String(value).toLowerCase();
}

function sessionDto(session, detail = session?.trainer_detail) {
  if (!session) return null;
  return {
    sessionId: session.practice_session_id,
    courseId: session.course_id,
    knowledgePointId: session.knowledge_point_id,
    teachingClassId: session.teaching_class_id,
    mode: session.mode,
    answerMode: session.answer_mode,
    sourceType: session.source_type,
    status: session.status,
    currentItemId: session.current_item_id,
    currentItemIndex: session.current_item_index,
    questionCount: session.question_count,
    correctCount: session.correct_count,
    wrongCount: session.wrong_count,
    totalScore: session.total_score,
    maxScore: session.max_score,
    durationSeconds: session.duration_seconds,
    startedAt: toIso(session.started_at),
    submittedAt: toIso(session.submitted_at),
    lastActiveAt: toIso(session.last_active_at),
    currentPhase: detail?.current_phase || null,
    currentQuestionKey: detail?.current_question_key || null,
  };
}

function courseDto(course) {
  if (!course) return null;
  return {
    courseId: course.course_id,
    courseName: course.course_name,
    courseCode: course.course_code,
    subjectCategory: course.subject_category,
  };
}

function chapterDto(chapter) {
  if (!chapter) return null;
  return {
    chapterId: chapter.chapter_id,
    chapterName: chapter.chapter_name,
    chapterOrder: chapter.chapter_order,
  };
}

function knowledgePointDto(kp) {
  if (!kp) return null;
  return {
    knowledgePointId: kp.knowledge_point_id,
    knowledgePointName: kp.knowledge_point_name,
    knowledgePointCode: kp.knowledge_point_code,
    difficultyLevel: lower(kp.difficulty_level),
    description: kp.description,
  };
}

function answerRecordDto(record) {
  if (!record) return null;
  return {
    answerRecordId: record.answer_record_id,
    questionId: record.question_id,
    answerContent: record.answer_content,
    submittedAt: toIso(record.submitted_at),
    durationSeconds: record.duration_seconds,
    itemStatus: record.item_status,
    isCorrect: record.is_correct,
    score: record.score,
    maxScore: record.max_score,
    feedback: record.feedback,
    gradingStatus: lower(record.grading_status),
  };
}

function progressDto({ completedCount, totalCount, correctCount }) {
  const total = totalCount || 0;
  const completed = completedCount || 0;
  return {
    completedCount: completed,
    totalCount: total,
    correctCount: correctCount || 0,
    accuracy: completed > 0 ? Math.round(((correctCount || 0) / completed) * 100) : 0,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

module.exports = {
  answerRecordDto,
  chapterDto,
  courseDto,
  knowledgePointDto,
  progressDto,
  sessionDto,
  toIso,
};
