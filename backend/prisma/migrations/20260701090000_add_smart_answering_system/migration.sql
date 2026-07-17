-- Extend question type enum with the new fill-blank type while keeping legacy blank rows valid.
ALTER TABLE `questions`
  MODIFY `question_type` ENUM('single_choice', 'multiple_choice', 'fill_blank', 'true_false', 'blank', 'short_answer', 'programming') NOT NULL;

-- Mark correct choices directly on options for choice-question workflows.
ALTER TABLE `question_options`
  ADD COLUMN `is_correct` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `question_options_question_id_is_correct_idx` ON `question_options`(`question_id`, `is_correct`);

UPDATE `question_options` qo
JOIN `questions` q ON q.`question_id` = qo.`question_id`
SET qo.`is_correct` = true
WHERE q.`question_type` IN ('single_choice', 'multiple_choice')
  AND (
    JSON_UNQUOTE(JSON_EXTRACT(q.`correct_answer`, '$.answer')) = qo.`option_key`
    OR JSON_CONTAINS(JSON_EXTRACT(q.`correct_answer`, '$.answer'), JSON_QUOTE(qo.`option_key`))
    OR JSON_UNQUOTE(q.`correct_answer`) = qo.`option_key`
  );

CREATE TABLE `question_banks` (
  `question_bank_id` INTEGER NOT NULL AUTO_INCREMENT,
  `course_id` INTEGER NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` TEXT NULL,
  `scope_type` ENUM('platform', 'course', 'class', 'personal') NOT NULL DEFAULT 'course',
  `created_by_user_id` INTEGER NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `question_banks_course_id_name_key`(`course_id`, `name`),
  INDEX `question_banks_course_id_idx`(`course_id`),
  INDEX `question_banks_created_by_user_id_idx`(`created_by_user_id`),
  INDEX `question_banks_scope_type_idx`(`scope_type`),
  INDEX `question_banks_status_idx`(`status`),
  PRIMARY KEY (`question_bank_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `question_bank_teaching_classes` (
  `question_bank_class_id` INTEGER NOT NULL AUTO_INCREMENT,
  `question_bank_id` INTEGER NOT NULL,
  `teaching_class_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `question_bank_teaching_classes_bank_class_key`(`question_bank_id`, `teaching_class_id`),
  INDEX `question_bank_teaching_classes_teaching_class_id_idx`(`teaching_class_id`),
  PRIMARY KEY (`question_bank_class_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `question_bank_knowledge_points` (
  `question_bank_knowledge_point_id` INTEGER NOT NULL AUTO_INCREMENT,
  `question_bank_id` INTEGER NOT NULL,
  `knowledge_point_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `question_bank_knowledge_points_bank_kp_key`(`question_bank_id`, `knowledge_point_id`),
  INDEX `question_bank_knowledge_points_knowledge_point_id_idx`(`knowledge_point_id`),
  PRIMARY KEY (`question_bank_knowledge_point_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `question_bank_questions` (
  `question_bank_question_id` INTEGER NOT NULL AUTO_INCREMENT,
  `question_bank_id` INTEGER NOT NULL,
  `question_id` INTEGER NOT NULL,
  `question_order` INTEGER NOT NULL DEFAULT 0,
  `source_type` VARCHAR(20) NOT NULL DEFAULT 'manual',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `question_bank_questions_bank_question_key`(`question_bank_id`, `question_id`),
  INDEX `question_bank_questions_question_id_idx`(`question_id`),
  PRIMARY KEY (`question_bank_question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_question_generation_logs` (
  `ai_question_generation_log_id` INTEGER NOT NULL AUTO_INCREMENT,
  `course_id` INTEGER NULL,
  `teaching_class_id` INTEGER NULL,
  `question_bank_id` INTEGER NULL,
  `knowledge_point_id` INTEGER NULL,
  `created_by_user_id` INTEGER NULL,
  `prompt_json` JSON NULL,
  `request_params` JSON NULL,
  `response_json` JSON NULL,
  `status` ENUM('pending', 'running', 'success', 'failed', 'stopped') NOT NULL DEFAULT 'pending',
  `generated_question_count` INTEGER NOT NULL DEFAULT 0,
  `accepted_question_count` INTEGER NOT NULL DEFAULT 0,
  `ai_provider` VARCHAR(50) NULL,
  `model_name` VARCHAR(100) NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `ai_question_generation_logs_course_id_idx`(`course_id`),
  INDEX `ai_question_generation_logs_teaching_class_id_idx`(`teaching_class_id`),
  INDEX `ai_question_generation_logs_question_bank_id_idx`(`question_bank_id`),
  INDEX `ai_question_generation_logs_knowledge_point_id_idx`(`knowledge_point_id`),
  INDEX `ai_question_generation_logs_created_by_user_id_idx`(`created_by_user_id`),
  INDEX `ai_question_generation_logs_status_idx`(`status`),
  PRIMARY KEY (`ai_question_generation_log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_question_generation_questions` (
  `ai_question_generation_question_id` INTEGER NOT NULL AUTO_INCREMENT,
  `ai_question_generation_log_id` INTEGER NOT NULL,
  `question_id` INTEGER NOT NULL,
  `action_status` VARCHAR(20) NOT NULL DEFAULT 'accepted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ai_question_generation_questions_log_question_key`(`ai_question_generation_log_id`, `question_id`),
  INDEX `ai_question_generation_questions_question_id_idx`(`question_id`),
  PRIMARY KEY (`ai_question_generation_question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `question_banks`
  ADD CONSTRAINT `question_banks_course_id_fkey`
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `question_banks`
  ADD CONSTRAINT `question_banks_created_by_user_id_fkey`
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `question_bank_teaching_classes`
  ADD CONSTRAINT `question_bank_teaching_classes_question_bank_id_fkey`
  FOREIGN KEY (`question_bank_id`) REFERENCES `question_banks`(`question_bank_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `question_bank_teaching_classes`
  ADD CONSTRAINT `question_bank_teaching_classes_teaching_class_id_fkey`
  FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `question_bank_knowledge_points`
  ADD CONSTRAINT `question_bank_knowledge_points_question_bank_id_fkey`
  FOREIGN KEY (`question_bank_id`) REFERENCES `question_banks`(`question_bank_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `question_bank_knowledge_points`
  ADD CONSTRAINT `question_bank_knowledge_points_knowledge_point_id_fkey`
  FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `question_bank_questions`
  ADD CONSTRAINT `question_bank_questions_question_bank_id_fkey`
  FOREIGN KEY (`question_bank_id`) REFERENCES `question_banks`(`question_bank_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `question_bank_questions`
  ADD CONSTRAINT `question_bank_questions_question_id_fkey`
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_question_generation_logs`
  ADD CONSTRAINT `ai_question_generation_logs_course_id_fkey`
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_question_generation_logs`
  ADD CONSTRAINT `ai_question_generation_logs_teaching_class_id_fkey`
  FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_question_generation_logs`
  ADD CONSTRAINT `ai_question_generation_logs_question_bank_id_fkey`
  FOREIGN KEY (`question_bank_id`) REFERENCES `question_banks`(`question_bank_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_question_generation_logs`
  ADD CONSTRAINT `ai_question_generation_logs_knowledge_point_id_fkey`
  FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_question_generation_logs`
  ADD CONSTRAINT `ai_question_generation_logs_created_by_user_id_fkey`
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_question_generation_questions`
  ADD CONSTRAINT `ai_question_generation_questions_log_id_fkey`
  FOREIGN KEY (`ai_question_generation_log_id`) REFERENCES `ai_question_generation_logs`(`ai_question_generation_log_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_question_generation_questions`
  ADD CONSTRAINT `ai_question_generation_questions_question_id_fkey`
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;
