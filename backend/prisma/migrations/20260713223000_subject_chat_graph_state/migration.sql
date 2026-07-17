ALTER TABLE `subject_chat_runs`
  ADD COLUMN `graph_version` VARCHAR(64) NOT NULL DEFAULT 'agent-orchestration-v1',
  ADD COLUMN `current_node` VARCHAR(64) NULL,
  ADD COLUMN `state_json` JSON NULL,
  ADD COLUMN `operation_id` VARCHAR(96) NULL;

CREATE UNIQUE INDEX `subject_chat_runs_operation_id_key` ON `subject_chat_runs`(`operation_id`);
