-- Additive-only migration for the student subject-chat run workbench.
CREATE TABLE `subject_chat_runs` (
  `id` VARCHAR(36) NOT NULL,
  `conversation_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `assistant_mode` VARCHAR(32) NOT NULL DEFAULT 'subject',
  `course_id` INTEGER NULL,
  `knowledge_point_id` INTEGER NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `progress` INTEGER NOT NULL DEFAULT 0,
  `current_task` VARCHAR(160) NULL,
  `total_task_count` INTEGER NOT NULL DEFAULT 0,
  `completed_task_count` INTEGER NOT NULL DEFAULT 0,
  `pending_task_count` INTEGER NOT NULL DEFAULT 0,
  `user_message_id` INTEGER NULL,
  `final_message_id` INTEGER NULL,
  `final_answer` LONGTEXT NULL,
  `error_message` TEXT NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `subject_chat_runs_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `subject_chat_runs_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
  INDEX `subject_chat_runs_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subject_chat_tasks` (
  `id` VARCHAR(36) NOT NULL,
  `run_id` VARCHAR(36) NOT NULL,
  `task_type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `order_index` INTEGER NOT NULL,
  `progress` INTEGER NOT NULL DEFAULT 0,
  `input_summary` TEXT NULL,
  `output_summary` TEXT NULL,
  `error_message` TEXT NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `subject_chat_tasks_run_id_order_index_key`(`run_id`, `order_index`),
  INDEX `subject_chat_tasks_run_id_status_idx`(`run_id`, `status`),
  INDEX `subject_chat_tasks_task_type_idx`(`task_type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subject_chat_events` (
  `id` VARCHAR(36) NOT NULL,
  `run_id` VARCHAR(36) NOT NULL,
  `task_id` VARCHAR(36) NULL,
  `sequence` INTEGER NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(160) NULL,
  `message` TEXT NULL,
  `payload` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `subject_chat_events_run_id_sequence_key`(`run_id`, `sequence`),
  INDEX `subject_chat_events_run_id_created_at_idx`(`run_id`, `created_at`),
  INDEX `subject_chat_events_task_id_idx`(`task_id`),
  INDEX `subject_chat_events_event_type_idx`(`event_type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subject_chat_sources` (
  `id` VARCHAR(36) NOT NULL,
  `run_id` VARCHAR(36) NOT NULL,
  `task_id` VARCHAR(36) NULL,
  `source_type` VARCHAR(48) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `summary` TEXT NULL,
  `url` VARCHAR(1000) NULL,
  `document_id` VARCHAR(255) NULL,
  `dataset_id` VARCHAR(255) NULL,
  `relevance_score` DOUBLE NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `subject_chat_sources_run_id_created_at_idx`(`run_id`, `created_at`),
  INDEX `subject_chat_sources_task_id_idx`(`task_id`),
  INDEX `subject_chat_sources_source_type_idx`(`source_type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `subject_chat_runs`
  ADD CONSTRAINT `subject_chat_runs_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `subject_chat_runs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `subject_chat_tasks`
  ADD CONSTRAINT `subject_chat_tasks_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `subject_chat_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `subject_chat_events`
  ADD CONSTRAINT `subject_chat_events_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `subject_chat_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `subject_chat_events_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `subject_chat_tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `subject_chat_sources`
  ADD CONSTRAINT `subject_chat_sources_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `subject_chat_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `subject_chat_sources_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `subject_chat_tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
