ALTER TABLE `agent_market_conversations`
  ADD COLUMN `active_generation_id` VARCHAR(64) NULL;

ALTER TABLE `agent_market_messages`
  ADD COLUMN `generation_status` VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN `generation_id` VARCHAR(64) NULL,
  ADD COLUMN `metadata_json` JSON NULL;

CREATE UNIQUE INDEX `agent_market_messages_generation_id_key`
  ON `agent_market_messages`(`generation_id`);

CREATE INDEX `agent_market_messages_conversation_id_role_generation_status_idx`
  ON `agent_market_messages`(`conversation_id`, `role`, `generation_status`, `created_at`);
