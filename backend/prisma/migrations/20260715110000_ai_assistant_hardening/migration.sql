ALTER TABLE `ai_request_traces`
  ADD COLUMN `conversation_id` INTEGER NULL,
  ADD COLUMN `user_role` VARCHAR(24) NULL,
  ADD COLUMN `search_mode` VARCHAR(24) NULL,
  ADD COLUMN `intent_json` JSON NULL,
  ADD COLUMN `plan_json` JSON NULL,
  ADD COLUMN `context_json` JSON NULL;

CREATE INDEX `ai_request_traces_conversation_id_created_at_idx`
  ON `ai_request_traces`(`conversation_id`, `created_at`);
CREATE INDEX `ai_request_traces_user_role_created_at_idx`
  ON `ai_request_traces`(`user_role`, `created_at`);

ALTER TABLE `ai_trace_retrievals`
  ADD COLUMN `source_type` VARCHAR(48) NOT NULL DEFAULT 'knowledge',
  ADD COLUMN `source_index` INTEGER NULL,
  ADD COLUMN `site_name` VARCHAR(160) NULL,
  ADD COLUMN `icon_url` VARCHAR(1000) NULL,
  ADD COLUMN `search_strategy` VARCHAR(32) NULL,
  ADD COLUMN `provider_request_id` VARCHAR(160) NULL,
  ADD COLUMN `retrieved_at` DATETIME(3) NULL;

CREATE INDEX `ai_trace_retrievals_source_type_created_at_idx`
  ON `ai_trace_retrievals`(`source_type`, `created_at`);

ALTER TABLE `ai_trace_tool_calls`
  ADD COLUMN `retry_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `permission_decision` VARCHAR(48) NULL;

ALTER TABLE `generated_artifacts`
  ADD COLUMN `source_trace_id` INTEGER NULL,
  ADD COLUMN `source_ai_conversation_id` INTEGER NULL,
  ADD COLUMN `source_message_id` INTEGER NULL,
  ADD COLUMN `generator` VARCHAR(64) NULL,
  ADD COLUMN `metadata_json` JSON NULL;

CREATE INDEX `generated_artifacts_source_trace_id_idx`
  ON `generated_artifacts`(`source_trace_id`);
CREATE INDEX `generated_artifacts_source_ai_conversation_id_updated_at_idx`
  ON `generated_artifacts`(`source_ai_conversation_id`, `updated_at`);
