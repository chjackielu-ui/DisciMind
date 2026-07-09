-- Add trainer agent integration without introducing an independent session master table.

-- Extend AgentType enum storage to include trainer everywhere the enum is used.
ALTER TABLE `chat_conversations`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer') NOT NULL DEFAULT 'course_qa';

ALTER TABLE `chat_messages`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer') NULL;

ALTER TABLE `ai_agent_configs`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer') NOT NULL;

ALTER TABLE `agent_run_records`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer') NOT NULL;

-- PracticeSession remains the only trainer session master record.
ALTER TABLE `practice_sessions`
  ADD COLUMN `knowledge_point_id` INTEGER NULL AFTER `course_id`;

CREATE INDEX `practice_sessions_student_user_id_status_idx`
  ON `practice_sessions`(`student_user_id`, `status`);

CREATE INDEX `practice_sessions_student_user_id_knowledge_point_id_status_idx`
  ON `practice_sessions`(`student_user_id`, `knowledge_point_id`, `status`);

CREATE INDEX `practice_sessions_knowledge_point_id_idx`
  ON `practice_sessions`(`knowledge_point_id`);

ALTER TABLE `practice_sessions`
  ADD CONSTRAINT `practice_sessions_knowledge_point_id_fkey`
  FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `trainer_session_details` (
  `trainer_session_detail_id` INTEGER NOT NULL AUTO_INCREMENT,
  `practice_session_id` INTEGER NOT NULL,
  `current_phase` VARCHAR(30) NOT NULL DEFAULT 'setup',
  `current_question_key` VARCHAR(100) NULL,
  `mastery_before` DOUBLE NULL,
  `mastery_after` DOUBLE NULL,
  `question_count` INTEGER NOT NULL DEFAULT 0,
  `covered_pitfall_count` INTEGER NOT NULL DEFAULT 0,
  `diagnostic_summary_json` JSON NULL,
  `final_report_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `trainer_session_details_practice_session_id_key`(`practice_session_id`),
  PRIMARY KEY (`trainer_session_detail_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `trainer_session_details`
  ADD CONSTRAINT `trainer_session_details_practice_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `trainer_session_questions` (
  `trainer_session_question_id` INTEGER NOT NULL AUTO_INCREMENT,
  `practice_session_id` INTEGER NOT NULL,
  `question_id` INTEGER NULL,
  `question_key` VARCHAR(100) NOT NULL,
  `question_order` INTEGER NOT NULL DEFAULT 0,
  `full_question_json` JSON NOT NULL,
  `public_question_json` JSON NOT NULL,
  `target_pitfall_id` VARCHAR(100) NULL,
  `target_pitfall_json` JSON NULL,
  `difficulty` VARCHAR(20) NULL,
  `adaptive_action` VARCHAR(50) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `trainer_session_questions_practice_session_id_question_key_key`(`practice_session_id`, `question_key`),
  INDEX `trainer_session_questions_practice_session_id_question_order_idx`(`practice_session_id`, `question_order`),
  INDEX `trainer_session_questions_question_id_idx`(`question_id`),
  PRIMARY KEY (`trainer_session_question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `trainer_session_questions`
  ADD CONSTRAINT `trainer_session_questions_practice_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `trainer_session_questions`
  ADD CONSTRAINT `trainer_session_questions_question_id_fkey`
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `answer_records`
  ADD INDEX `answer_records_practice_session_id_created_at_idx`(`practice_session_id`, `created_at`);

CREATE TABLE `trainer_answer_details` (
  `trainer_answer_detail_id` INTEGER NOT NULL AUTO_INCREMENT,
  `answer_record_id` INTEGER NOT NULL,
  `trainer_session_question_id` INTEGER NULL,
  `confidence_level` VARCHAR(20) NULL,
  `deep_evaluation_json` JSON NULL,
  `adaptive_decision_json` JSON NULL,
  `deterministic_result_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `trainer_answer_details_answer_record_id_key`(`answer_record_id`),
  INDEX `trainer_answer_details_trainer_session_question_id_idx`(`trainer_session_question_id`),
  PRIMARY KEY (`trainer_answer_detail_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `trainer_answer_details`
  ADD CONSTRAINT `trainer_answer_details_answer_record_id_fkey`
  FOREIGN KEY (`answer_record_id`) REFERENCES `answer_records`(`answer_record_id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `trainer_answer_details`
  ADD CONSTRAINT `trainer_answer_details_trainer_session_question_id_fkey`
  FOREIGN KEY (`trainer_session_question_id`) REFERENCES `trainer_session_questions`(`trainer_session_question_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_run_records`
  ADD COLUMN `request_id` VARCHAR(128) NULL AFTER `response_time_ms`,
  ADD COLUMN `practice_session_id` INTEGER NULL AFTER `request_id`,
  ADD COLUMN `mode` VARCHAR(50) NULL AFTER `practice_session_id`,
  ADD COLUMN `total_tokens` INTEGER NULL AFTER `mode`,
  ADD COLUMN `elapsed_ms` INTEGER NULL AFTER `total_tokens`,
  ADD COLUMN `error_code` VARCHAR(100) NULL AFTER `elapsed_ms`,
  ADD COLUMN `input_summary` JSON NULL AFTER `error_code`,
  ADD COLUMN `output_summary` JSON NULL AFTER `input_summary`;

CREATE INDEX `agent_run_records_request_id_idx`
  ON `agent_run_records`(`request_id`);

CREATE INDEX `agent_run_records_practice_session_id_created_at_idx`
  ON `agent_run_records`(`practice_session_id`, `created_at`);

CREATE INDEX `agent_run_records_mode_idx`
  ON `agent_run_records`(`mode`);

ALTER TABLE `agent_run_records`
  ADD CONSTRAINT `agent_run_records_practice_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
