-- Add Explainer and Diagnostician integration state.

ALTER TABLE `chat_conversations`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer','explainer','diagnostician') NOT NULL DEFAULT 'course_qa';

ALTER TABLE `chat_messages`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer','explainer','diagnostician') NULL;

ALTER TABLE `ai_agent_configs`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer','explainer','diagnostician') NOT NULL;

ALTER TABLE `agent_run_records`
  MODIFY `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer','explainer','diagnostician') NOT NULL;

CREATE TABLE `agent_conversations` (
  `agent_conversation_id` INTEGER NOT NULL AUTO_INCREMENT,
  `student_user_id` INTEGER NOT NULL,
  `course_id` INTEGER NULL,
  `knowledge_point_id` INTEGER NULL,
  `practice_session_id` INTEGER NULL,
  `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer','explainer','diagnostician') NOT NULL,
  `dify_conversation_id` VARCHAR(255) NOT NULL,
  `learning_session_id` VARCHAR(128) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `last_strategy` VARCHAR(50) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `agent_conv_student_type_dify_key`(`student_user_id`, `agent_type`, `dify_conversation_id`),
  INDEX `agent_conv_student_kp_status_idx`(`student_user_id`, `knowledge_point_id`, `status`),
  INDEX `agent_conv_practice_idx`(`practice_session_id`),
  INDEX `agent_conv_learning_idx`(`learning_session_id`),
  PRIMARY KEY (`agent_conversation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `agent_conversations`
  ADD CONSTRAINT `agent_conversations_student_user_id_fkey`
  FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `agent_conversations`
  ADD CONSTRAINT `agent_conversations_course_id_fkey`
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_conversations`
  ADD CONSTRAINT `agent_conversations_knowledge_point_id_fkey`
  FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_conversations`
  ADD CONSTRAINT `agent_conversations_practice_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `agent_interventions` (
  `agent_intervention_id` INTEGER NOT NULL AUTO_INCREMENT,
  `intervention_uid` VARCHAR(128) NOT NULL,
  `student_user_id` INTEGER NOT NULL,
  `course_id` INTEGER NULL,
  `knowledge_point_id` INTEGER NULL,
  `practice_session_id` INTEGER NULL,
  `source_agent_run_id` INTEGER NULL,
  `applied_by_run_id` INTEGER NULL,
  `source` VARCHAR(30) NOT NULL DEFAULT 'diagnostician',
  `target_agent` VARCHAR(30) NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `params_json` JSON NULL,
  `trigger_reason` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `priority` INTEGER NOT NULL DEFAULT 50,
  `expires_at` DATETIME(3) NULL,
  `applied_at` DATETIME(3) NULL,
  `ignored_at` DATETIME(3) NULL,
  `failed_at` DATETIME(3) NULL,
  `result_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `agent_interventions_intervention_uid_key`(`intervention_uid`),
  INDEX `agent_int_student_status_idx`(`student_user_id`, `status`),
  INDEX `agent_int_student_target_status_idx`(`student_user_id`, `target_agent`, `status`),
  INDEX `agent_int_practice_status_idx`(`practice_session_id`, `status`),
  INDEX `agent_int_kp_status_idx`(`knowledge_point_id`, `status`),
  INDEX `agent_int_source_run_idx`(`source_agent_run_id`),
  INDEX `agent_int_applied_run_idx`(`applied_by_run_id`),
  PRIMARY KEY (`agent_intervention_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `agent_interventions`
  ADD CONSTRAINT `agent_interventions_student_user_id_fkey`
  FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `agent_interventions`
  ADD CONSTRAINT `agent_interventions_course_id_fkey`
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_interventions`
  ADD CONSTRAINT `agent_interventions_knowledge_point_id_fkey`
  FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_interventions`
  ADD CONSTRAINT `agent_interventions_practice_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_interventions`
  ADD CONSTRAINT `agent_interventions_source_agent_run_id_fkey`
  FOREIGN KEY (`source_agent_run_id`) REFERENCES `agent_run_records`(`agent_run_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_interventions`
  ADD CONSTRAINT `agent_interventions_applied_by_run_id_fkey`
  FOREIGN KEY (`applied_by_run_id`) REFERENCES `agent_run_records`(`agent_run_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `agent_diagnostic_reports` (
  `diagnostic_report_id` INTEGER NOT NULL AUTO_INCREMENT,
  `student_user_id` INTEGER NOT NULL,
  `course_id` INTEGER NULL,
  `knowledge_point_id` INTEGER NULL,
  `practice_session_id` INTEGER NULL,
  `agent_run_id` INTEGER NULL,
  `mode` VARCHAR(50) NOT NULL,
  `request_id` VARCHAR(128) NULL,
  `report_period_start` DATETIME(3) NULL,
  `report_period_end` DATETIME(3) NULL,
  `result_json` JSON NOT NULL,
  `statistics_snapshot_json` JSON NULL,
  `data_quality_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `agent_diag_student_mode_idx`(`student_user_id`, `mode`),
  INDEX `agent_diag_kp_mode_idx`(`knowledge_point_id`, `mode`),
  INDEX `agent_diag_practice_mode_idx`(`practice_session_id`, `mode`),
  INDEX `agent_diag_run_idx`(`agent_run_id`),
  INDEX `agent_diag_request_idx`(`request_id`),
  PRIMARY KEY (`diagnostic_report_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `agent_diagnostic_reports`
  ADD CONSTRAINT `agent_diagnostic_reports_student_user_id_fkey`
  FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `agent_diagnostic_reports`
  ADD CONSTRAINT `agent_diagnostic_reports_course_id_fkey`
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_diagnostic_reports`
  ADD CONSTRAINT `agent_diagnostic_reports_knowledge_point_id_fkey`
  FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_diagnostic_reports`
  ADD CONSTRAINT `agent_diagnostic_reports_practice_session_id_fkey`
  FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `agent_diagnostic_reports`
  ADD CONSTRAINT `agent_diagnostic_reports_agent_run_id_fkey`
  FOREIGN KEY (`agent_run_id`) REFERENCES `agent_run_records`(`agent_run_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
