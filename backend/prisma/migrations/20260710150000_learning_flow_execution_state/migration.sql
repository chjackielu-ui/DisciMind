-- Make learning-flow execution authoritative and recoverable without deleting history.
ALTER TABLE `learning_sessions`
  ADD COLUMN `current_node_run_id` INTEGER NULL AFTER `current_node_id`,
  ADD COLUMN `execution_version` INTEGER NOT NULL DEFAULT 0 AFTER `current_node_run_id`;

ALTER TABLE `learning_session_node_runs`
  ADD COLUMN `trainer_session_id` INTEGER NULL AFTER `agent_run_id`,
  ADD COLUMN `operation_id` VARCHAR(128) NULL AFTER `trainer_session_id`,
  ADD COLUMN `execution_version` INTEGER NOT NULL DEFAULT 1 AFTER `operation_id`,
  ADD COLUMN `ended_at` DATETIME(3) NULL AFTER `completed_at`,
  ADD COLUMN `skipped_at` DATETIME(3) NULL AFTER `ended_at`;

-- Backfill terminal timestamps for old records; retain all historical node runs.
UPDATE `learning_session_node_runs`
  SET `ended_at` = COALESCE(`completed_at`, `updated_at`)
  WHERE `status` IN ('completed', 'skipped', 'failed') AND `ended_at` IS NULL;

UPDATE `learning_session_node_runs`
  SET `skipped_at` = COALESCE(`completed_at`, `updated_at`)
  WHERE `status` = 'skipped' AND `skipped_at` IS NULL;

-- Recover a current run pointer from existing running records where possible.
UPDATE `learning_sessions` s
JOIN (
  SELECT r.`session_id`, MAX(r.`node_run_id`) AS `node_run_id`
  FROM `learning_session_node_runs` r
  WHERE r.`status` = 'running'
  GROUP BY r.`session_id`
) current_run ON current_run.`session_id` = s.`session_id`
SET s.`current_node_run_id` = current_run.`node_run_id`
WHERE s.`current_node_run_id` IS NULL;

CREATE UNIQUE INDEX `learning_sessions_current_node_run_id_key`
  ON `learning_sessions`(`current_node_run_id`);
CREATE INDEX `learning_session_node_runs_trainer_session_id_idx`
  ON `learning_session_node_runs`(`trainer_session_id`);
CREATE INDEX `learning_session_node_runs_session_id_node_id_status_idx`
  ON `learning_session_node_runs`(`session_id`, `node_id`, `status`);

ALTER TABLE `learning_sessions`
  ADD CONSTRAINT `learning_sessions_current_node_run_id_fkey`
  FOREIGN KEY (`current_node_run_id`) REFERENCES `learning_session_node_runs`(`node_run_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `learning_session_node_runs`
  ADD CONSTRAINT `learning_session_node_runs_trainer_session_id_fkey`
  FOREIGN KEY (`trainer_session_id`) REFERENCES `practice_sessions`(`practice_session_id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
