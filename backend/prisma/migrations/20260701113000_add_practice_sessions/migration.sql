CREATE TABLE `practice_sessions` (
  `practice_session_id` INTEGER NOT NULL AUTO_INCREMENT,
  `student_user_id` INTEGER NOT NULL,
  `course_id` INTEGER NOT NULL,
  `teaching_class_id` INTEGER NULL,
  `mode` VARCHAR(30) NOT NULL DEFAULT 'practice',
  `question_count` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `submitted_at` DATETIME(3) NULL,
  `duration_seconds` INTEGER NULL,
  `total_score` DOUBLE NULL,
  `max_score` DOUBLE NULL,
  `objective_score` DOUBLE NULL,
  `ai_score` DOUBLE NULL,
  `correct_count` INTEGER NOT NULL DEFAULT 0,
  `wrong_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `practice_sessions_student_user_id_idx`(`student_user_id`),
  INDEX `practice_sessions_course_id_idx`(`course_id`),
  INDEX `practice_sessions_teaching_class_id_idx`(`teaching_class_id`),
  INDEX `practice_sessions_status_idx`(`status`),
  INDEX `practice_sessions_submitted_at_idx`(`submitted_at`),
  PRIMARY KEY (`practice_session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `practice_session_questions` (
  `practice_session_question_id` INTEGER NOT NULL AUTO_INCREMENT,
  `practice_session_id` INTEGER NOT NULL,
  `question_id` INTEGER NOT NULL,
  `question_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `practice_session_questions_session_question_key`(`practice_session_id`, `question_id`),
  INDEX `practice_session_questions_question_id_idx`(`question_id`),
  PRIMARY KEY (`practice_session_question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `answer_records`
  ADD COLUMN `practice_session_id` INTEGER NULL;

CREATE INDEX `answer_records_practice_session_id_idx` ON `answer_records`(`practice_session_id`);

ALTER TABLE `practice_sessions`
  ADD CONSTRAINT `practice_sessions_student_user_id_fkey`
  FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `practice_sessions`
  ADD CONSTRAINT `practice_sessions_course_id_fkey`
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `practice_sessions`
  ADD CONSTRAINT `practice_sessions_teaching_class_id_fkey`
  FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `practice_session_questions`
  ADD CONSTRAINT `practice_session_questions_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `practice_session_questions`
  ADD CONSTRAINT `practice_session_questions_question_id_fkey`
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `answer_records`
  ADD CONSTRAINT `answer_records_practice_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`) ON DELETE SET NULL ON UPDATE CASCADE;
