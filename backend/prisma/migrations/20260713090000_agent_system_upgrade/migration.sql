-- DisciMind Agent system upgrade. All additions are nullable or have safe defaults.
ALTER TABLE `user_agents`
  ADD COLUMN `icon_key` VARCHAR(64) NULL,
  ADD COLUMN `icon_color` VARCHAR(16) NULL,
  ADD COLUMN `icon_background` VARCHAR(16) NULL,
  ADD COLUMN `avatar_url` VARCHAR(500) NULL,
  ADD COLUMN `icon_updated_at` DATETIME(3) NULL;

ALTER TABLE `user_agent_versions`
  ADD COLUMN `runtime_provider` VARCHAR(32) NOT NULL DEFAULT 'MODEL',
  ADD COLUMN `runtime_config_json` JSON NULL;

ALTER TABLE `agent_market_conversations`
  ADD COLUMN `dify_conversation_id` VARCHAR(255) NULL,
  ADD COLUMN `mode` VARCHAR(32) NOT NULL DEFAULT 'AGENT',
  ADD COLUMN `subject` VARCHAR(64) NULL;

CREATE INDEX `agent_market_conversations_filter_idx`
  ON `agent_market_conversations`(`user_id`, `agent_id`, `mode`, `updated_at`);

ALTER TABLE `agent_market_messages`
  ADD COLUMN `knowledge_base_refs_json` JSON NULL,
  ADD COLUMN `agent_refs_json` JSON NULL,
  ADD COLUMN `attachments_json` JSON NULL;

ALTER TABLE `agent_message_sources`
  ADD COLUMN `external_url` VARCHAR(1000) NULL;

ALTER TABLE `agent_memories`
  ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `last_used_at` DATETIME(3) NULL;

ALTER TABLE `ai_conversations`
  ADD COLUMN `agent_runtime_state_json` JSON NULL;

ALTER TABLE `ai_messages`
  ADD COLUMN `knowledge_base_refs_json` JSON NULL,
  ADD COLUMN `agent_refs_json` JSON NULL,
  ADD COLUMN `sources_json` JSON NULL;

ALTER TABLE `async_tasks`
  ADD COLUMN `request_payload_json` JSON NULL,
  ADD COLUMN `agent_id` INTEGER NULL,
  ADD COLUMN `conversation_id` INTEGER NULL,
  ADD COLUMN `cancelled_at` DATETIME(3) NULL;

CREATE INDEX `async_tasks_agent_status_idx` ON `async_tasks`(`agent_id`, `status`);
CREATE INDEX `async_tasks_conversation_created_idx` ON `async_tasks`(`conversation_id`, `created_at`);
ALTER TABLE `async_tasks`
  ADD CONSTRAINT `async_tasks_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `async_tasks_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `agent_market_conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `generated_artifacts`
  ADD COLUMN `parent_artifact_id` INTEGER NULL,
  ADD COLUMN `artifact_role` VARCHAR(32) NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN `file_name` VARCHAR(255) NULL,
  ADD COLUMN `mime_type` VARCHAR(120) NULL,
  ADD COLUMN `checksum` VARCHAR(64) NULL,
  ADD COLUMN `download_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `expires_at` DATETIME(3) NULL;

CREATE INDEX `generated_artifacts_parent_artifact_id_artifact_role_idx` ON `generated_artifacts`(`parent_artifact_id`, `artifact_role`);
ALTER TABLE `generated_artifacts`
  ADD CONSTRAINT `generated_artifacts_parent_artifact_id_fkey` FOREIGN KEY (`parent_artifact_id`) REFERENCES `generated_artifacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `generated_artifact_exports`
  ADD COLUMN `checksum` VARCHAR(64) NULL,
  ADD COLUMN `download_count` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `agent_market_invocations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `conversation_id` INTEGER NULL,
  `source_message_id` INTEGER NULL,
  `ai_conversation_id` INTEGER NULL,
  `ai_message_id` INTEGER NULL,
  `agent_id` INTEGER NOT NULL,
  `sequence` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
  `input_json` JSON NULL,
  `output_text` LONGTEXT NULL,
  `error_message` TEXT NULL,
  `duration_ms` INTEGER NULL,
  `task_ids_json` JSON NULL,
  `artifact_ids_json` JSON NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `agent_market_invocations_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `agent_market_invocations_conversation_id_sequence_idx`(`conversation_id`, `sequence`),
  INDEX `agent_market_invocations_ai_conversation_id_sequence_idx`(`ai_conversation_id`, `sequence`),
  INDEX `agent_market_invocations_ai_message_id_idx`(`ai_message_id`),
  INDEX `agent_market_invocations_agent_id_status_idx`(`agent_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `agent_market_invocations`
  ADD CONSTRAINT `agent_market_invocations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `agent_market_invocations_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `agent_market_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `agent_market_invocations_source_message_id_fkey` FOREIGN KEY (`source_message_id`) REFERENCES `agent_market_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `agent_market_invocations_ai_conversation_id_fkey` FOREIGN KEY (`ai_conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `agent_market_invocations_ai_message_id_fkey` FOREIGN KEY (`ai_message_id`) REFERENCES `ai_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `agent_market_invocations_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
