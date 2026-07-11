ALTER TABLE `user_agents`
  ADD COLUMN `agent_type` ENUM('CHAT', 'FILE_GENERATOR') NOT NULL DEFAULT 'CHAT';

ALTER TABLE `user_agent_versions`
  ADD COLUMN `file_generator_config_json` JSON NULL;

ALTER TABLE `agent_market_conversations`
  ADD COLUMN `requirement_draft_json` JSON NULL,
  ADD COLUMN `requirement_status` VARCHAR(24) NOT NULL DEFAULT 'COLLECTING';

CREATE INDEX `user_agents_agent_type_status_visibility_deleted_at_idx`
  ON `user_agents`(`agent_type`, `status`, `visibility`, `deleted_at`);
