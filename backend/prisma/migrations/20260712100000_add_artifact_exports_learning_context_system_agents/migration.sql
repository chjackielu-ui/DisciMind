ALTER TABLE `user_agents`
  ADD COLUMN `system_key` VARCHAR(100) NULL,
  ADD COLUMN `is_system` BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX `user_agents_system_key_key` ON `user_agents`(`system_key`);
CREATE INDEX `user_agents_is_system_agent_type_idx` ON `user_agents`(`is_system`, `agent_type`);

CREATE TABLE `generated_artifact_exports` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `artifact_id` INTEGER NOT NULL,
  `owner_user_id` INTEGER NOT NULL,
  `format` ENUM('DOCX','PDF') NOT NULL,
  `status` ENUM('QUEUED','EXPORTING','READY','FAILED','DELETED') NOT NULL DEFAULT 'QUEUED',
  `storage_path` VARCHAR(1000) NULL,
  `file_size_bytes` BIGINT NULL,
  `mime_type` VARCHAR(120) NULL,
  `error_code` VARCHAR(100) NULL,
  `error_message` VARCHAR(500) NULL,
  `last_accessed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  UNIQUE INDEX `generated_artifact_exports_artifact_id_format_key`(`artifact_id`,`format`),
  INDEX `generated_artifact_exports_owner_user_id_status_updated_at_idx`(`owner_user_id`,`status`,`updated_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `generated_artifact_exports_artifact_id_fkey` FOREIGN KEY (`artifact_id`) REFERENCES `generated_artifacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `generated_artifact_exports_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `student_learning_contexts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `course_id` INTEGER NOT NULL,
  `knowledge_point_id` INTEGER NOT NULL,
  `learning_goal_id` INTEGER NOT NULL,
  `workflow_template_id` INTEGER NOT NULL,
  `target_mastery` INTEGER NULL,
  `completion_mode` VARCHAR(32) NOT NULL DEFAULT 'MASTERY_TARGET',
  `learning_preference_json` JSON NULL,
  `voice_config_json` JSON NULL,
  `context_snapshot_json` JSON NULL,
  `context_hash` VARCHAR(64) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `student_learning_contexts_user_id_key`(`user_id`),
  INDEX `student_learning_contexts_course_id_knowledge_point_id_idx`(`course_id`,`knowledge_point_id`),
  INDEX `student_learning_contexts_learning_goal_id_idx`(`learning_goal_id`),
  INDEX `student_learning_contexts_workflow_template_id_idx`(`workflow_template_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `student_learning_contexts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `student_learning_contexts_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `student_learning_contexts_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `student_learning_contexts_learning_goal_id_fkey` FOREIGN KEY (`learning_goal_id`) REFERENCES `learning_goals`(`goal_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `student_learning_contexts_workflow_template_id_fkey` FOREIGN KEY (`workflow_template_id`) REFERENCES `learning_workflow_templates`(`template_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
